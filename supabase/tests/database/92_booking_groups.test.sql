-- T33.1: booking groups (TASKS M33 / T33.1, SPEC §9 item 33 and §10 2026-11-25). Written from the approved plan, not from the code.
--   * public.booking_groups (RLS: venue admins of that venue read, nobody else; anon has no privilege; no client writes),
--     bookings.booking_group_id, paymongo_checkouts.booking_group_id, payments unique on (provider_payment_id, booking_id)
--   * public.create_booking_group(p_items, p_guest_name, p_guest_email, p_guest_phone, p_waiver_accepted): 2 to 6 courts, one venue,
--     one operating date, all or nothing, one hold, one token, ONE booking fee (on the lead = earliest start, ties by court id)
--   * record_payment_proof / proof_target / review_payment / billing for a group; record_paymongo_checkout / paymongo_checkout_for /
--     record_paymongo_payment (SPEC §4's four outcomes for the group as a whole); issue_guest_link; get_guest_booking.booking_group
--   * cancel_booking on a grouped booking: the player cancels the whole group; staff cancel one court of a confirmed group
--   * ungrouped create_booking, cancel_booking, review_payment, PayMongo stay as before (regression checks)
-- Fixtures: venue A (active, hold 45 minutes, cutoff 1 hour, 2 rejections, courts A1..A8 at 100..800 an hour, A8 archived), venue B (another
-- venue's admin), venue S (suspended). The booking fee is set to 10 (the local one is 0) while the groups are created through the RPCs, and back
-- to 0 before the direct-insert fixtures. Groups made by create_booking_group use fresh (day, hour) cells so nothing collides.
-- Everything that touches an object this task adds goes through dynamic SQL or a catching helper (pg_temp.r, pg_temp.e, pg_temp.cg, ...),
-- so a missing behavior fails its own assertion instead of aborting the transaction. Dates are the venue-local today plus k days
-- (pg_temp.at(k, hour)), so the file holds at any weekday and hour. Asia/Manila is UTC+8: 06:00 local is 22:00 UTC the day before.
-- Assertions that read state after a role-switched call keep the call's answer with pg_temp.rec and read it back as postgres.
begin;
create extension if not exists pgtap with schema extensions;
select plan(254);

-- ---------------------------------------------------------------------------
-- Temp tables
-- ---------------------------------------------------------------------------
create temp table fxd (d date);
create temp table ct (label text primary key, id uuid, name text);
create temp table seqn (n integer);
insert into seqn values (0);
-- Rows returned by create_booking_group (and registered fixtures): the lead is pos 1.
create temp table gr (label text, pos integer, booking_group_id uuid, id uuid, reference_code text, court_id uuid, guest_token text);
-- Directly inserted fixture bookings.
create temp table b (label text primary key, id uuid, ref text, token text, court uuid);
create temp table gg (label text primary key, id uuid);
create temp table pp (label text, payment_id uuid);
create temp table pm (label text, payment_id uuid, outcome text);
create temp table snap (label text, v text);
create temp table links (label text, token text);
create temp table res (label text primary key, v text);
grant all on all tables in schema pg_temp to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- First column of the first row as text ('<null>' for null, 'ERR <hint or sqlstate>' on any error).
create function pg_temp.r(p_sql text) returns text language plpgsql as $$
declare v text; h text;
begin
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;

-- Runs a statement as the current role and keeps pg_temp.r's answer under a label (read it back as postgres with (select v from res ...)).
create function pg_temp.rec(p_label text, p_sql text) returns void language plpgsql as $$
begin
  insert into res values (p_label, pg_temp.r(p_sql));
end $$;

-- 'ok' or 'sqlstate/hint' for a statement that returns nothing useful (DML, or a call whose result is dropped).
create function pg_temp.e(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '/' || case when sqlstate = 'P0001' then coalesce(h, '') else '' end;
end $$;

-- 'sqlstate|hint|named|detail': does the message start with the court's name, and is the detail that court's id.
create function pg_temp.errx(p_sql text, p_court text) returns text language plpgsql as $$
declare h text; m text; d text; s text; n text; i uuid;
begin
  select c.name, c.id into n, i from ct c where c.label = p_court;
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint, m = message_text, d = pg_exception_detail;
  s := sqlstate;
  return s || '|' || case when s = 'P0001' then coalesce(h, '') else '' end || '|' || case when m like n || '%' then 'named' else 'unnamed[' || m || ']' end
    || '|' || case when d = i::text then i::text else 'detail[' || coalesce(d, '') || ']' end;
end $$;

create function pg_temp.as_anon() returns void language sql as $$ select set_config('request.jwt.claims', '{"role": "anon"}', true) $$;
create function pg_temp.as_p1() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true) $$;
create function pg_temp.as_p2() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true) $$;
create function pg_temp.as_staff_a() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true) $$;
create function pg_temp.as_staff_b() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true) $$;
create function pg_temp.as_service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role": "service_role"}', true) $$;

-- Venue-local today + k days at hh:mm on the Manila wall clock, as an instant.
create function pg_temp.at(p_k integer, p_hh integer, p_mm integer default 0) returns timestamptz language sql stable as $$
  select (((select d from fxd) + p_k) + make_interval(hours => p_hh, mins => p_mm)) at time zone 'Asia/Manila'
$$;
create function pg_temp.cid(p text) returns uuid language sql stable as $$ select id from ct where label = p $$;
-- One create_booking_group item.
create function pg_temp.it(p_court text, p_k integer, p_hh integer, p_slots integer default 1, p_mm integer default 0) returns jsonb
language sql stable as $$
  select jsonb_build_object('court_id', pg_temp.cid(p_court), 'start', pg_temp.at(p_k, p_hh, p_mm), 'slots', p_slots)
$$;

-- Lookups into gr (rows returned by create_booking_group, or registered fixtures).
create function pg_temp.gid(p_label text) returns uuid language sql stable as $$ select booking_group_id from gr where label = p_label and pos = 1 $$;
create function pg_temp.nth(p_label text, p_pos integer) returns uuid language sql stable as $$ select id from gr where label = p_label and pos = p_pos $$;
create function pg_temp.ref(p_label text, p_pos integer) returns text language sql stable as $$ select reference_code from gr where label = p_label and pos = p_pos $$;
create function pg_temp.tok(p_label text) returns text language sql stable as $$ select guest_token from gr where label = p_label and pos = 1 $$;
create function pg_temp.bid(p_label text) returns uuid language sql stable as $$ select id from b where label = p_label $$;
create function pg_temp.bref(p_label text) returns text language sql stable as $$ select ref from b where label = p_label $$;

-- create_booking_group as the current role; the rows go to gr. 'done' or 'ERR <hint>' (never a bare 'ok': a stray `ok` line is a TAP test to pg_prove).
create function pg_temp.cg(p_label text, p_items jsonb, p_name text default null, p_email text default null,
                           p_phone text default null, p_waiver boolean default false) returns text language plpgsql as $$
declare h text;
begin
  execute 'insert into gr select $1, (row_number() over ())::int, r.booking_group_id, r.id, r.reference_code, r.court_id, r.guest_token
           from public.create_booking_group($2, $3, $4, $5, $6) r'
    using p_label, p_items, p_name, p_email, p_phone, p_waiver;
  return 'done';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;

-- A refusal test: 'sqlstate/hint' (or 'ok' when it wrongly succeeds).
create function pg_temp.egrp(p_items jsonb, p_name text default 'Gina Guest', p_email text default 'gina@example.com', p_waiver boolean default false)
returns text language plpgsql as $$
declare h text;
begin
  perform public.create_booking_group(p_items, p_name, p_email, null, p_waiver);
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return sqlstate || '/' || case when sqlstate = 'P0001' then coalesce(h, '') else '' end;
end $$;

-- A group of the given courts (default A1, A2), one slot each, at the next free (day, hour) cell. Days 1-4, hours 6-20.
create function pg_temp.newgrp(p_label text, p_courts text[] default array['A1', 'A2']) returns text language plpgsql as $$
declare v_n integer; v_k integer; v_hh integer; v_items jsonb;
begin
  update seqn set n = n + 1 returning n into v_n;
  v_k := 1 + (v_n - 1) / 8;
  v_hh := 6 + 2 * ((v_n - 1) % 8);
  select jsonb_agg(pg_temp.it(c.label, v_k, v_hh, 1) order by c.ord) into v_items from unnest(p_courts) with ordinality c(label, ord);
  return pg_temp.cg(p_label, v_items, case when auth.uid() is null then 'Gina Guest' end, case when auth.uid() is null then 'gina@example.com' end);
end $$;

-- A plain create_booking as the current role; the row goes to gr with a null group.
create function pg_temp.cb(p_label text, p_court text, p_k integer, p_hh integer) returns text language plpgsql as $$
declare h text;
begin
  insert into gr
  select p_label, 1, null::uuid, r.id, r.reference_code, pg_temp.cid(p_court), r.guest_token
  from public.create_booking(pg_temp.cid(p_court), pg_temp.at(p_k, p_hh), 1,
         case when auth.uid() is null then 'Gina Guest' end, case when auth.uid() is null then 'gina@example.com' end) r;
  return 'done';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;

-- record_payment_proof as service_role on the booking id: 'done' or 'ERR <hint>'; the returned id goes to pp.
create function pg_temp.proof_raw(p_label text, p_booking uuid, p_amount numeric, p_ref text default 'REF-1') returns text language plpgsql as $$
declare h text;
begin
  insert into pp select p_label, r.payment_id
  from public.record_payment_proof(p_booking, p_booking::text || '/proof.png', 'gcash', p_amount, p_ref, null) r;
  return 'done';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;
-- The proof on the group's pos-th booking; the amount defaults to the group's total amount_due.
create function pg_temp.proof(p_label text, p_pos integer default 2, p_amount numeric default null, p_ref text default 'REF-1') returns text
language sql as $$
  select pg_temp.proof_raw(p_label, pg_temp.nth(p_label, p_pos),
    coalesce(p_amount, (select sum(bk.amount_due) from gr g join public.bookings bk on bk.id = g.id where g.label = p_label)), p_ref)
$$;

-- record_paymongo_payment as service_role; the result goes to pm. 'done' or 'ERR <hint>'.
create function pg_temp.pay_online(p_label text, p_checkout text, p_payment text, p_event text, p_centavos bigint,
                                   p_currency text default 'PHP', p_meta uuid default null) returns text language plpgsql as $$
declare h text;
begin
  insert into pm select p_label, r.payment_id, r.outcome
  from public.record_paymongo_payment(p_checkout, p_payment, p_event, p_centavos, p_currency, 'gcash', p_meta) r;
  return 'done';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;

-- issue_guest_link as service_role: the token goes to links. 'done' or 'ERR <hint>'.
create function pg_temp.il(p_label text, p_booking uuid) returns text language plpgsql as $$
declare h text;
begin
  insert into links select p_label, public.issue_guest_link(p_booking);
  return 'done';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;

-- A stored PayMongo session for the group, written directly (booking_id = the lead, booking_group_id, the group's amount_due * 100).
create function pg_temp.ck(p_label text, p_checkout text) returns text language plpgsql as $$
begin
  execute $q$ insert into public.paymongo_checkouts (booking_id, booking_group_id, checkout_id, checkout_url, amount_centavos)
    select (select g.id from gr g where g.label = $1 and g.pos = 1), (select g.booking_group_id from gr g where g.label = $1 and g.pos = 1),
           $2, 'https://checkout.paymongo.test/' || $2,
           (select (sum(bk.amount_due) * 100)::bigint from gr g join public.bookings bk on bk.id = g.id where g.label = $1) $q$
    using p_label, p_checkout;
  return 'done';
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- A booking group written directly (as postgres): its row first, then the bookings that name it, then pg_temp.mkgroup.
create function pg_temp.newg(p_label text, p_venue uuid default 'a0000000-0000-0000-0000-0000000092a1') returns text language plpgsql as $$
declare v_gid uuid := gen_random_uuid();
begin
  execute 'insert into public.booking_groups (id, venue_id) values ($1, $2)' using v_gid, p_venue;
  insert into gg values (p_label, v_gid);
  return 'done';
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- Direct fixture bookings (one court each, so nothing collides). The venue defaults to venue A; p_group names a pg_temp.newg group.
create function pg_temp.mkb(
  p_label text, p_status public.booking_status, p_from timestamptz, p_len interval default interval '1 hour',
  p_user uuid default null, p_token text default null, p_expires timestamptz default now() + interval '1 hour',
  p_total numeric default 500, p_court_name text default null, p_sport public.sport default 'tennis',
  p_by_venue boolean default false, p_reason text default null, p_venue uuid default 'a0000000-0000-0000-0000-0000000092a1',
  p_group text default null
) returns text language plpgsql as $$
declare
  v_court uuid := gen_random_uuid();
  v_ref   text := 'CB-' || translate(upper(substr(md5(p_label), 1, 6)), '01', '23');
  v_id    uuid;
  v_hash  bytea := case when p_token is null then null else sha256(convert_to(p_token, 'UTF8')) end;
  v_exp   timestamptz := case when p_status in ('pending_payment', 'payment_submitted', 'expired') then p_expires end;
  v_at    timestamptz := case when p_status = 'cancelled' then now() end;
  v_why   text := case when p_status = 'cancelled' then p_reason end;
begin
  insert into public.courts (venue_id, id, name, sport, default_hourly_rate)
  values (p_venue, v_court, coalesce(p_court_name, 'Court ' || p_label), p_sport, 500);
  if p_group is null then
    insert into public.bookings (reference_code, court_id, user_id, guest_name, during, total_amount, status, source, guest_token_hash,
                                 expires_at, cancelled_at, cancel_reason, cancelled_by_venue)
    values (v_ref, v_court, p_user, 'Test ' || p_label, tstzrange(p_from, p_from + p_len), p_total, p_status, 'online', v_hash,
            v_exp, v_at, v_why, p_by_venue)
    returning id into v_id;
  else
    execute $q$ insert into public.bookings (reference_code, court_id, user_id, guest_name, during, total_amount, status, source, guest_token_hash,
                                 expires_at, cancelled_at, cancel_reason, cancelled_by_venue, booking_group_id)
      values ($1, $2, $3, $4, $5, $6, $7, 'online', $8, $9, $10, $11, $12, (select gg.id from gg where gg.label = $13)) returning id $q$
      into v_id using v_ref, v_court, p_user, 'Test ' || p_label, tstzrange(p_from, p_from + p_len), p_total, p_status, v_hash, v_exp, v_at, v_why,
                      p_by_venue, p_group;
  end if;
  insert into b values (p_label, v_id, v_ref, p_token, v_court);
  return 'done';
exception when others then
  return 'ERR ' || sqlstate || ' ' || sqlerrm;
end $$;

-- A payment on a fixture booking (as postgres).
create function pg_temp.pay(
  p_label text, p_method public.payment_method, p_amount numeric, p_status public.payment_review_status default 'approved',
  p_reviewed timestamptz default now(), p_provider text default null, p_note text default null, p_storage text default null
) returns void language sql as $$
  insert into public.payments (booking_id, method, amount, review_status, reviewed_at, review_note, provider_payment_id, storage_path)
  select id, p_method, p_amount, p_status, case when p_status = 'pending' then null else p_reviewed end, p_note, p_provider,
         case when p_storage is null then null else id::text || '/' || p_storage end
  from b where label = p_label
$$;

-- Registers a pg_temp.newg group's bookings (the first is the lead) in gr, and sets booking_groups.lead_booking_id.
create function pg_temp.mkgroup(p_group text, variadic p_members text[]) returns text language plpgsql as $$
declare v_gid uuid; v_lead uuid;
begin
  select gg.id into v_gid from gg where gg.label = p_group;
  insert into gr
  select p_group, m.ord::integer, v_gid, bk.id, bk.reference_code, bk.court_id, x.token
  from unnest(p_members) with ordinality m(label, ord) join b x on x.label = m.label join public.bookings bk on bk.id = x.id;
  select x.id into v_lead from b x where x.label = p_members[1];
  execute 'update public.booking_groups set lead_booking_id = $1 where id = $2' using v_lead, v_gid;
  return 'done';
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- Registers one ungrouped fixture booking in gr, so the digests below work for it too.
create function pg_temp.reg(p_label text, p_member text) returns void language sql as $$
  insert into gr select p_label, 1, null::uuid, bk.id, bk.reference_code, bk.court_id, x.token
  from b x join public.bookings bk on bk.id = x.id where x.label = p_member
$$;

-- How many bookings carry the label's booking_group_id ('ERR ...' while the column does not exist).
create function pg_temp.gm(p_label text) returns text language plpgsql stable as $$
declare v text;
begin
  execute 'select count(*)::text from public.bookings where booking_group_id = $1' into v using pg_temp.gid(p_label);
  return coalesce(v, '<null>');
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- Digests of a gr label's bookings, ordered by pos (the lead first).
create function pg_temp.pst(p text) returns text language sql stable as $$
  select coalesce(string_agg(bk.status::text, ',' order by g.pos), '<none>')
  from gr g join public.bookings bk on bk.id = g.id where g.label = p
$$;
create function pg_temp.fees(p text) returns text language sql stable as $$
  select coalesce(string_agg(bk.booking_fee::text, ',' order by g.pos), '<none>')
  from gr g join public.bookings bk on bk.id = g.id where g.label = p
$$;
create function pg_temp.dues(p text) returns text language sql stable as $$
  select coalesce(string_agg(bk.amount_due::numeric(12, 2)::text, ',' order by g.pos), '<none>')
  from gr g join public.bookings bk on bk.id = g.id where g.label = p
$$;
create function pg_temp.rcn(p text) returns text language sql stable as $$
  select coalesce(string_agg(bk.rejection_count::text, ',' order by g.pos), '<none>')
  from gr g join public.bookings bk on bk.id = g.id where g.label = p
$$;
-- Remaining hold of each booking ('00:45:00' = 45 minutes from now()).
create function pg_temp.ex(p text) returns text language sql stable as $$
  select coalesce(string_agg((bk.expires_at - now())::text, ',' order by g.pos), '<none>')
  from gr g join public.bookings bk on bk.id = g.id where g.label = p
$$;
-- 'status|cancelled_by_venue|cancelled_by (first 4 chars)|cancel_reason' per booking.
create function pg_temp.cx(p text) returns text language sql stable as $$
  select coalesce(string_agg(bk.status::text || '|' || bk.cancelled_by_venue::text || '|' || coalesce(left(bk.cancelled_by::text, 4), '-')
                             || '|' || coalesce(bk.cancel_reason, '-'), ';' order by g.pos), '<none>')
  from gr g join public.bookings bk on bk.id = g.id where g.label = p
$$;
-- 'method/review_status' of every payment of the group.
create function pg_temp.pays(p text) returns text language sql stable as $$
  select coalesce(string_agg(x.method || '/' || x.review_status, ',' order by x.pos, x.method, x.review_status), '<none>')
  from (select g.pos, pa.method::text as method, pa.review_status::text as review_status
        from gr g join public.payments pa on pa.booking_id = g.id where g.label = p) x
$$;
create function pg_temp.amts(p text) returns text language sql stable as $$
  select coalesce(string_agg(x.amount::text, ',' order by x.pos, x.method, x.review_status), '<none>')
  from (select g.pos, pa.method::text as method, pa.review_status::text as review_status, pa.amount
        from gr g join public.payments pa on pa.booking_id = g.id where g.label = p) x
$$;
-- 'count|sum|positions' of the refunds of the group's bookings ('0|0|-' when none).
create function pg_temp.rfs(p text) returns text language sql stable as $$
  select count(*)::text || '|' || coalesce(sum(r.amount), 0)::text || '|' || coalesce(string_agg(g.pos::text, ',' order by g.pos), '-')
  from gr g join public.refunds r on r.booking_id = g.id where g.label = p
$$;
-- 'count|lead or other:kind:amount,...' of the billing charges of the group's bookings.
create function pg_temp.bills(p text) returns text language sql stable as $$
  select count(*)::text || '|' || coalesce(string_agg(case when g.pos = 1 then 'lead' else 'other' end || ':' || c.kind || ':' || c.amount::text, ',' order by g.pos, c.kind), '-')
  from gr g join public.billing_charges c on c.booking_id = g.id where g.label = p
$$;
-- 'payments|distinct payment ids|distinct checkout ids|distinct event ids' of the group's PayMongo rows.
create function pg_temp.pids(p text) returns text language sql stable as $$
  select count(*)::text || '|' || count(distinct pa.provider_payment_id)::text || '|' || count(distinct pa.provider_checkout_id)::text
         || '|' || count(distinct pa.provider_event_id)::text
  from gr g join public.payments pa on pa.booking_id = g.id where g.label = p and pa.method = 'paymongo'
$$;
create function pg_temp.pnote(p text) returns text language sql stable as $$
  select coalesce(bool_and(length(btrim(coalesce(pa.review_note, ''))) > 0), false)::text
  from gr g join public.payments pa on pa.booking_id = g.id where g.label = p and pa.method = 'paymongo'
$$;
-- 'rows|sum|min' of the group's payments of one method and status.
create function pg_temp.sums(p text, p_method text, p_status text) returns text language sql stable as $$
  select count(*)::text || '|' || coalesce(sum(pa.amount), 0)::text || '|' || (coalesce(min(pa.amount), 0) >= 0)::text
  from gr g join public.payments pa on pa.booking_id = g.id
  where g.label = p and pa.method::text = p_method and pa.review_status::text = p_status
$$;
-- The booking_group column of get_guest_booking as jsonb ('null' for SQL null, {"_error": hint} on an error).
create function pg_temp.bgj(p_ref text, p_token text) returns jsonb language plpgsql as $$
declare v jsonb; h text;
begin
  execute 'select g.booking_group from public.get_guest_booking($1, $2) g' into v using p_ref, p_token;
  return coalesce(v, 'null'::jsonb);
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return jsonb_build_object('_error', case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end);
end $$;
-- proof_target as 'booking_id|total|due|group id|lead id|group due' ('-' for null).
create function pg_temp.pt(p_ref text, p_token text, p_user uuid) returns text language plpgsql as $$
declare v text; h text;
begin
  execute $q$ select concat_ws('|', t.booking_id::text, t.total_amount::numeric(12, 2)::text, t.amount_due::numeric(12, 2)::text,
                coalesce(t.booking_group_id::text, '-'), coalesce(t.lead_booking_id::text, '-'), coalesce(t.group_amount_due::numeric(12, 2)::text, '-'))
              from public.proof_target($1, $2, $3) t $q$ into v using p_ref, p_token, p_user;
  return coalesce(v, '<null>');
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;
-- 'bookings|payments|groups' row counts ('missing' groups when the table does not exist yet).
create function pg_temp.counts() returns text language plpgsql as $$
declare v_b bigint; v_p bigint; v_g text;
begin
  select count(*) into v_b from public.bookings;
  select count(*) into v_p from public.payments;
  begin
    execute 'select count(*)::text from public.booking_groups' into v_g;
  exception when others then
    v_g := 'missing';
  end;
  return v_b::text || '|' || v_p::text || '|' || v_g;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: users, three venues, courts, the booking fee
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'e2e-bg-p1@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2e-bg-staff-a@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'e2e-bg-p2@example.com'),
  ('77777777-7777-7777-7777-777777777777', 'e2e-bg-staff-b@example.com');

-- Venue A (active), B (active, another venue's admin) and S (suspended). All Asia/Manila, 06:00-22:00 every day.
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000092a1', 'e2e-bg-a', 'active'),
  ('b0000000-0000-0000-0000-0000000092b1', 'e2e-bg-b', 'active'),
  ('a0000000-0000-0000-0000-0000000092c1', 'e2e-bg-s', 'suspended');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000092a1', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('b0000000-0000-0000-0000-0000000092b1', '77777777-7777-7777-7777-777777777777', 'staff');
insert into public.venue_settings (venue_id, name, timezone, waiver_text) values
  ('a0000000-0000-0000-0000-0000000092a1', 'E2E BG A', 'Asia/Manila', ''),
  ('b0000000-0000-0000-0000-0000000092b1', 'E2E BG B', 'Asia/Manila', ''),
  ('a0000000-0000-0000-0000-0000000092c1', 'E2E BG S', 'Asia/Manila', '');
update public.venue_settings set payment_hold_minutes = 45, cancel_cutoff_hours = 1, max_rejections = 2, booking_window_days = 30
  where venue_id = 'a0000000-0000-0000-0000-0000000092a1';
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v.id, d, time '06:00', time '22:00'
from (values ('a0000000-0000-0000-0000-0000000092a1'::uuid), ('b0000000-0000-0000-0000-0000000092b1'::uuid),
             ('a0000000-0000-0000-0000-0000000092c1'::uuid)) v(id), generate_series(0, 6) d;
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000092a1', 'a0000000-0000-0000-0000-0000000092a1', 'E2E BG A1', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000092a2', 'a0000000-0000-0000-0000-0000000092a1', 'E2E BG A2', 'badminton', 200, true),
  ('c0000000-0000-0000-0000-0000000092a3', 'a0000000-0000-0000-0000-0000000092a1', 'E2E BG A3', 'pickleball', 300, true),
  ('c0000000-0000-0000-0000-0000000092a4', 'a0000000-0000-0000-0000-0000000092a1', 'E2E BG A4', 'tennis', 400, true),
  ('c0000000-0000-0000-0000-0000000092a5', 'a0000000-0000-0000-0000-0000000092a1', 'E2E BG A5', 'tennis', 500, true),
  ('c0000000-0000-0000-0000-0000000092a6', 'a0000000-0000-0000-0000-0000000092a1', 'E2E BG A6', 'tennis', 600, true),
  ('c0000000-0000-0000-0000-0000000092a7', 'a0000000-0000-0000-0000-0000000092a1', 'E2E BG A7', 'tennis', 700, true),
  ('c0000000-0000-0000-0000-0000000092a8', 'a0000000-0000-0000-0000-0000000092a1', 'E2E BG A8', 'tennis', 800, false),
  ('c0000000-0000-0000-0000-0000000092b1', 'b0000000-0000-0000-0000-0000000092b1', 'E2E BG B1', 'tennis', 150, true),
  ('c0000000-0000-0000-0000-0000000092b2', 'b0000000-0000-0000-0000-0000000092b1', 'E2E BG B2', 'tennis', 250, true),
  ('c0000000-0000-0000-0000-0000000092c1', 'a0000000-0000-0000-0000-0000000092c1', 'E2E BG S1', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000092c2', 'a0000000-0000-0000-0000-0000000092c1', 'E2E BG S2', 'tennis', 100, true);
insert into ct select substr(c.name, 8), c.id, c.name from public.courts c where c.name like 'E2E BG %';
insert into fxd select private.local_today('a0000000-0000-0000-0000-0000000092a1');
grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- The local booking fee is 0, so every fee assertion first sets it to 10 (as postgres, inside this rolled-back transaction).
update public.platform_pricing set booking_fee = 10;

-- Fixtures a refusal needs: a blackout on A3, an open play session on A4 (day 8, 10:00), a stale hold on A4 (day 24, 10:00).
insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
values ('a0000000-0000-0000-0000-0000000092a1', 'c0000000-0000-0000-0000-0000000092a3', pg_temp.at(8, 10), pg_temp.at(8, 11), 'e2e bg');
insert into public.open_play_sessions (venue_id, id, title, starts_at, ends_at)
values ('a0000000-0000-0000-0000-0000000092a1', 'a0000000-0000-0000-0000-0000000092f1', 'E2E BG open play', pg_temp.at(8, 10), pg_temp.at(8, 11));
insert into public.open_play_courts (session_id, court_id, during)
values ('a0000000-0000-0000-0000-0000000092f1', 'c0000000-0000-0000-0000-0000000092a4', tstzrange(pg_temp.at(8, 10), pg_temp.at(8, 11)));
insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status, expires_at)
values ('CB-BGSTL2', 'c0000000-0000-0000-0000-0000000092a4', 'Stale Hold', tstzrange(pg_temp.at(24, 10), pg_temp.at(24, 11)), 400,
        'pending_payment', now() - interval '1 minute');

-- ---------------------------------------------------------------------------
-- Schema, constraints, grants
-- ---------------------------------------------------------------------------
select ok(to_regclass('public.booking_groups') is not null, 'booking_groups exists');
select is((select string_agg(column_name || ' ' || data_type, ', ' order by column_name) from information_schema.columns
  where table_schema = 'public' and table_name = 'booking_groups' and column_name in ('id', 'venue_id', 'lead_booking_id', 'created_at')),
  'created_at timestamp with time zone, id uuid, lead_booking_id uuid, venue_id uuid',
  'booking_groups has id, venue_id, lead_booking_id and created_at with the planned types');
select is((select string_agg(column_name || ' ' || is_nullable, ', ' order by column_name) from information_schema.columns
  where table_schema = 'public' and table_name = 'booking_groups' and column_name in ('id', 'venue_id', 'lead_booking_id')),
  'id NO, lead_booking_id YES, venue_id NO', 'booking_groups: venue_id is required, lead_booking_id may be null');
select is(pg_temp.r($$ select relrowsecurity::text from pg_class where oid = to_regclass('public.booking_groups') $$), 'true',
  'RLS is enabled on booking_groups');
select is((select string_agg(cmd, ',') from pg_policies where schemaname = 'public' and tablename = 'booking_groups'), 'SELECT',
  'booking_groups has exactly one policy and it is a select policy');
select ok(coalesce((select qual ~ 'is_venue_admin' from pg_policies where schemaname = 'public' and tablename = 'booking_groups'), false),
  'the booking_groups policy is private.is_venue_admin(venue_id): venue admins only');
select is(pg_temp.r($$ select has_table_privilege('anon', 'public.booking_groups', 'select,insert,update,delete,truncate,references,trigger')::text $$),
  'false', 'anon has no privilege at all on booking_groups');
select is(pg_temp.r($$ select concat_ws(',', has_table_privilege('authenticated', 'public.booking_groups', 'select')::text,
    has_table_privilege('authenticated', 'public.booking_groups', 'insert')::text, has_table_privilege('authenticated', 'public.booking_groups', 'update')::text,
    has_table_privilege('authenticated', 'public.booking_groups', 'delete')::text) $$),
  'true,false,false,false', 'authenticated can only select booking_groups');
select is(pg_temp.r($$ select confdeltype::text from pg_constraint
    where conrelid = to_regclass('public.booking_groups') and contype = 'f' and confrelid = 'public.venues'::regclass $$),
  'c', 'booking_groups.venue_id references venues and cascades (delete_unused_venue and the history purge need no change)');
select is((select data_type || ' ' || is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'bookings' and column_name = 'booking_group_id'), 'uuid YES',
  'bookings.booking_group_id is a nullable uuid');
select is(pg_temp.r($$ select concat_ws(',', has_column_privilege('authenticated', 'public.bookings', 'booking_group_id', 'select')::text,
    has_column_privilege('anon', 'public.bookings', 'booking_group_id', 'select')::text,
    has_column_privilege('authenticated', 'public.bookings', 'booking_group_id', 'insert,update')::text) $$),
  'true,false,false', 'authenticated can read bookings.booking_group_id (like the other columns), anon cannot, nobody writes it');
select is(pg_temp.r($$ select count(*)::text from pg_constraint where conrelid = 'public.bookings'::regclass and contype = 'f'
    and confrelid = to_regclass('public.booking_groups') and array_length(conkey, 1) = 2 $$),
  '1', 'bookings has a composite (venue_id, booking_group_id) foreign key to booking_groups');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'bookings' and indexdef like '%booking_group_id%'),
  'bookings.booking_group_id is indexed');
select is((select data_type || ' ' || is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'paymongo_checkouts' and column_name = 'booking_group_id'), 'uuid YES',
  'paymongo_checkouts.booking_group_id is a nullable uuid');
select is((select count(*)::int from pg_constraint where conname = 'payments_provider_payment_id_key'), 0,
  'the single-column payments_provider_payment_id_key is gone');
select is((select count(*)::int from pg_indexes where schemaname = 'public' and tablename = 'payments' and indexdef like 'CREATE UNIQUE INDEX%'
  and indexdef ~ '\((provider_payment_id, booking_id|booking_id, provider_payment_id)\)'), 1,
  'payments are unique on (provider_payment_id, booking_id)');

select pg_temp.mkb('ux1', 'pending_payment', pg_temp.at(12, 10));
select pg_temp.mkb('ux2', 'pending_payment', pg_temp.at(12, 10));
select is(pg_temp.e(format($f$ insert into public.payments (booking_id, method, amount, review_status, reviewed_at, provider_payment_id)
    values (%L, 'paymongo', 100, 'approved', now(), 'pay_bg_shared') $f$, pg_temp.bid('ux1'))), 'ok',
  'a PayMongo payment id can be recorded on a booking');
select is(pg_temp.e(format($f$ insert into public.payments (booking_id, method, amount, review_status, reviewed_at, provider_payment_id)
    values (%L, 'paymongo', 100, 'approved', now(), 'pay_bg_shared') $f$, pg_temp.bid('ux2'))), 'ok',
  'the same PayMongo payment id can appear on a different booking (one payment, one row per booked court)');
select is(pg_temp.e(format($f$ insert into public.payments (booking_id, method, amount, review_status, reviewed_at, review_note, provider_payment_id)
    values (%L, 'paymongo', 100, 'rejected', now(), 'twice', 'pay_bg_shared') $f$, pg_temp.bid('ux1'))), '23505/',
  'the same PayMongo payment id never appears twice on one booking (23505)');

select is(pg_temp.r($$ select pg_get_function_arguments('public.create_booking_group(jsonb, text, text, text, boolean)'::regprocedure) $$),
  'p_items jsonb, p_guest_name text DEFAULT NULL::text, p_guest_email text DEFAULT NULL::text, p_guest_phone text DEFAULT NULL::text, p_waiver_accepted boolean DEFAULT false',
  'create_booking_group takes (p_items, p_guest_name, p_guest_email, p_guest_phone, p_waiver_accepted) with the planned defaults');
select is(pg_temp.r($$ select pg_get_function_result('public.create_booking_group(jsonb, text, text, text, boolean)'::regprocedure) $$),
  'TABLE(booking_group_id uuid, id uuid, reference_code text, court_id uuid, guest_token text)',
  'create_booking_group returns (booking_group_id, id, reference_code, court_id, guest_token)');
select is(pg_temp.r($$ select concat_ws(',', has_function_privilege('anon', 'public.create_booking_group(jsonb, text, text, text, boolean)', 'execute')::text,
    has_function_privilege('authenticated', 'public.create_booking_group(jsonb, text, text, text, boolean)', 'execute')::text,
    has_function_privilege('service_role', 'public.create_booking_group(jsonb, text, text, text, boolean)', 'execute')::text) $$),
  'true,true,true', 'create_booking_group: anon, authenticated and service_role may execute (like create_booking)');
select is(pg_temp.r($$ select concat_ws(',', has_function_privilege('anon', 'public.review_payment(uuid, boolean, text)', 'execute')::text,
    has_function_privilege('authenticated', 'public.review_payment(uuid, boolean, text)', 'execute')::text,
    has_function_privilege('service_role', 'public.review_payment(uuid, boolean, text)', 'execute')::text) $$),
  'false,true,true', 'review_payment: authenticated and service_role only, as before');
select is(pg_temp.r($$ select concat_ws(',', has_function_privilege('anon', 'public.cancel_booking(uuid, text, text, text)', 'execute')::text,
    has_function_privilege('authenticated', 'public.cancel_booking(uuid, text, text, text)', 'execute')::text,
    has_function_privilege('service_role', 'public.cancel_booking(uuid, text, text, text)', 'execute')::text,
    has_function_privilege('anon', 'public.get_guest_booking(text, text)', 'execute')::text) $$),
  'true,true,true,true', 'cancel_booking and get_guest_booking stay open to anon, authenticated and service_role');
select is(pg_temp.r($$ select string_agg(f, ', ') from unnest(array[
      'public.record_payment_proof(uuid, text, public.payment_method, numeric, text, uuid)', 'public.proof_target(text, text, uuid)',
      'public.issue_guest_link(uuid)', 'public.record_paymongo_checkout(uuid, text, text, bigint)', 'public.paymongo_checkout_for(uuid)',
      'public.record_paymongo_payment(text, text, text, bigint, text, text, uuid)']) f
    where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or not has_function_privilege('service_role', f, 'execute') $$),
  '<null>', 'the payment and checkout functions stay service_role only');
select is(pg_temp.r($$ select pg_get_function_result('public.proof_target(text, text, uuid)'::regprocedure) $$),
  'TABLE(booking_id uuid, total_amount numeric, amount_due numeric, booking_group_id uuid, lead_booking_id uuid, group_amount_due numeric)',
  'proof_target keeps its three columns and gains booking_group_id, lead_booking_id and group_amount_due');
select is(pg_temp.r($$ select (pg_get_function_result('public.get_guest_booking(text, text)'::regprocedure) like '%waiver_accepted_at timestamp with time zone, refund jsonb, booking_group jsonb)')::text $$),
  'true', 'get_guest_booking gains booking_group jsonb as its new last column');
select is(pg_temp.r($$ select pg_get_function_result('public.create_booking(uuid, timestamp with time zone, integer, text, text, text, boolean, text)'::regprocedure) $$),
  'TABLE(id uuid, reference_code text, guest_token text)', 'create_booking keeps its signature and result');

-- ---------------------------------------------------------------------------
-- Waiver (venue A's waiver on for this block), then the creation block as an anonymous guest
-- ---------------------------------------------------------------------------
update public.venue_settings set waiver_text = 'E2E waiver terms' where venue_id = 'a0000000-0000-0000-0000-0000000092a1';
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10), pg_temp.it('A2', 9, 10))), 'P0001/waiver_required',
  'waiver_required: the venue has a waiver and p_waiver_accepted is not true');
select is(pg_temp.cg('g_waiver', jsonb_build_array(pg_temp.it('A1', 25, 10), pg_temp.it('A2', 25, 10)), 'Gina Guest', 'gina@example.com', null, true),
  'done', 'a group books when the waiver is accepted');
reset role;
update public.venue_settings set waiver_text = '' where venue_id = 'a0000000-0000-0000-0000-0000000092a1';

set local role anon;
select pg_temp.as_anon();
-- A plain booking holds A2 on day 8 at 10:00 (the "already taken" item), and the plain bookings the regression checks use.
select pg_temp.cb('pl_taken', 'A2', 8, 10);
select pg_temp.cb('pl_main', 'A5', 10, 10);
select pg_temp.cb('pl_rv1', 'A5', 10, 12);
select pg_temp.cb('pl_rv2', 'A5', 10, 14);
select pg_temp.cb('pl_pm', 'A5', 10, 16);
select pg_temp.cb('pl_il', 'A5', 10, 18);

select is(pg_temp.cg('g_main', jsonb_build_array(pg_temp.it('A2', 20, 10, 3), pg_temp.it('A1', 20, 10, 2)), ' Gina Guest ', 'Gina@Example.com', '0917 222 2222'),
  'done', 'a group of two courts books for an anonymous guest (items sent A2 then A1, same start)');
select is(pg_temp.cg('g_start', jsonb_build_array(pg_temp.it('A1', 21, 14), pg_temp.it('A2', 21, 10)), 'Gina Guest', 'gina@example.com'),
  'done', 'a second group books (A1 at 14:00 sent before A2 at 10:00)');
select is(pg_temp.cg('g_six', jsonb_build_array(pg_temp.it('A1', 22, 8), pg_temp.it('A2', 22, 8), pg_temp.it('A3', 22, 8), pg_temp.it('A4', 22, 8),
    pg_temp.it('A5', 22, 8), pg_temp.it('A6', 22, 8)), 'Gina Guest', 'gina@example.com'),
  'done', 'a group of six courts succeeds');
select is(pg_temp.cg('g_edge', jsonb_build_array(pg_temp.it('A1', 23, 6), pg_temp.it('A2', 23, 21)), 'Gina Guest', 'gina@example.com'),
  'done', 'a 06:00 and a 21:00 item on the same local date are one operating date (06:00 Manila is the previous day in UTC)');
select is(pg_temp.cg('g_stale', jsonb_build_array(pg_temp.it('A4', 24, 10), pg_temp.it('A5', 24, 10)), 'Gina Guest', 'gina@example.com'),
  'done', 'a stale hold overlapping an item does not block the group');
select is(pg_temp.cg('g_b', jsonb_build_array(pg_temp.it('B1', 24, 10), pg_temp.it('B2', 24, 10)), 'Gina Guest', 'gina@example.com'),
  'done', 'a group books at the other venue');

-- Groups the payment, review, PayMongo, billing and guest-link sections work on (two courts each, one slot each).
select pg_temp.newgrp('pt');
select pg_temp.newgrp('ck');
select pg_temp.newgrp('ck_amt');
select pg_temp.newgrp('ck_exp');
select pg_temp.newgrp('ck_can');
select pg_temp.newgrp('pr_eq');
select pg_temp.newgrp('pr_less');
select pg_temp.newgrp('pr_more');
select pg_temp.newgrp('pr_round', array['A1', 'A2', 'A3']);
select pg_temp.newgrp('pr_exp1');
select pg_temp.newgrp('pr_exp2');
select pg_temp.newgrp('pr_state');
select pg_temp.newgrp('rv_ok');
select pg_temp.newgrp('rv_cycle');
select pg_temp.newgrp('rv_misc');
select pg_temp.newgrp('rv_nop');
select pg_temp.newgrp('pm_conf');
select pg_temp.newgrp('pm_rev1');
select pg_temp.newgrp('pm_rev2');
select pg_temp.newgrp('pm_late1');
select pg_temp.newgrp('pm_late2');
select pg_temp.newgrp('pm_super');
select pg_temp.newgrp('pm_mis');
select pg_temp.newgrp('pm_can');
select pg_temp.newgrp('pm_rej');
select pg_temp.newgrp('pm_cnf');
select pg_temp.newgrp('pm_meta');
select pg_temp.newgrp('bl_lead');
select pg_temp.newgrp('bl_non');
select pg_temp.newgrp('bl_ply');
select pg_temp.newgrp('ig');
reset role;
select is((select count(distinct label)::int from gr where label in ('pt', 'ck', 'ck_amt', 'ck_exp', 'ck_can', 'pr_eq', 'pr_less', 'pr_more', 'pr_round',
  'pr_exp1', 'pr_exp2', 'pr_state', 'rv_ok', 'rv_cycle', 'rv_misc', 'rv_nop', 'pm_conf', 'pm_rev1', 'pm_rev2', 'pm_late1', 'pm_late2', 'pm_super',
  'pm_mis', 'pm_can', 'pm_rej', 'pm_cnf', 'pm_meta', 'bl_lead', 'bl_non', 'bl_ply', 'ig')), 31,
  'setup: all 31 two- and three-court groups for the payment, review, PayMongo, billing and guest-link sections were created');

-- ---------------------------------------------------------------------------
-- Refusals (anonymous guest). Nothing is inserted by any of them.
-- ---------------------------------------------------------------------------
insert into snap select 'before', pg_temp.counts();
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.egrp(jsonb_build_object('court_id', pg_temp.cid('A1'), 'start', pg_temp.at(9, 10), 'slots', 1)), 'P0001/invalid_input',
  'invalid_input: p_items is not an array');
select is(pg_temp.egrp('null'::jsonb), 'P0001/invalid_input', 'invalid_input: p_items is JSON null');
select is(pg_temp.egrp('[]'::jsonb), 'P0001/invalid_input', 'invalid_input: an empty list');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10))), 'P0001/invalid_input', 'invalid_input: fewer than 2 items (one)');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10) - 'court_id', pg_temp.it('A2', 9, 10))), 'P0001/invalid_input',
  'invalid_input: an item without court_id');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10) - 'start', pg_temp.it('A2', 9, 10))), 'P0001/invalid_input',
  'invalid_input: an item without start');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10) - 'slots', pg_temp.it('A2', 9, 10))), 'P0001/invalid_input',
  'invalid_input: an item without slots');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10) || '{"slots": "abc"}'::jsonb, pg_temp.it('A2', 9, 10))), 'P0001/invalid_input',
  'invalid_input: slots is not a number');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10) || '{"start": "nonsense"}'::jsonb, pg_temp.it('A2', 9, 10))), 'P0001/invalid_input',
  'invalid_input: start is not a timestamp');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10) || '{"court_id": "nonsense"}'::jsonb, pg_temp.it('A2', 9, 10))), 'P0001/invalid_input',
  'invalid_input: court_id is not a uuid');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10), '5'::jsonb)), 'P0001/invalid_input', 'invalid_input: an item that is not an object');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10), pg_temp.it('A2', 9, 10, 0))), 'P0001/invalid_input', 'invalid_input: an item with zero slots');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10),
    jsonb_build_object('court_id', gen_random_uuid(), 'start', pg_temp.at(9, 10), 'slots', 1))), 'P0001/invalid_input',
  'invalid_input: an unknown court');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10), pg_temp.it('B1', 9, 10))), 'P0001/invalid_input',
  'invalid_input: courts of two venues');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10), pg_temp.it('A2', 10, 10))), 'P0001/invalid_input',
  'invalid_input: items on two different operating dates');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 21), pg_temp.it('A2', 10, 6))), 'P0001/invalid_input',
  'invalid_input: 21:00 and the next morning 06:00 are two operating dates even though both are the same UTC date');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10, 2), pg_temp.it('A1', 9, 11, 1))), 'P0001/invalid_input',
  'invalid_input: two items overlapping on the same court');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10), pg_temp.it('A1', 9, 10))), 'P0001/invalid_input',
  'invalid_input: two identical items');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 11, 10), pg_temp.it('A2', 11, 10), pg_temp.it('A3', 11, 10), pg_temp.it('A4', 11, 10),
    pg_temp.it('A5', 11, 10), pg_temp.it('A6', 11, 10), pg_temp.it('A7', 11, 10))), 'P0001/too_many_courts',
  'too_many_courts: seven items (six succeed, see g_six)');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('S1', 9, 10), pg_temp.it('S2', 9, 10))), 'P0001/venue_unavailable',
  'venue_unavailable: a venue that is not active');
select is(pg_temp.errx($$ select public.create_booking_group(jsonb_build_array(pg_temp.it('A1', 8, 10), pg_temp.it('A2', 8, 10)), 'Gina Guest', 'gina@example.com', null, false) $$, 'A2'),
  'P0001|slot_unavailable|named|' || pg_temp.cid('A2')::text,
  'slot_unavailable: an item already taken refuses the group; the message starts with that court''s name and the detail is its id');
select is(pg_temp.errx($$ select public.create_booking_group(jsonb_build_array(pg_temp.it('A1', 8, 10), pg_temp.it('A3', 8, 10)), 'Gina Guest', 'gina@example.com', null, false) $$, 'A3'),
  'P0001|blackout|named|' || pg_temp.cid('A3')::text, 'blackout: names the blocked court');
select is(pg_temp.errx($$ select public.create_booking_group(jsonb_build_array(pg_temp.it('A1', 8, 10), pg_temp.it('A4', 8, 10)), 'Gina Guest', 'gina@example.com', null, false) $$, 'A4'),
  'P0001|open_play|named|' || pg_temp.cid('A4')::text, 'open_play: names the court reserved for open play');
select is(pg_temp.errx($$ select public.create_booking_group(jsonb_build_array(pg_temp.it('A1', 8, 10), pg_temp.it('A5', 8, 21, 2)), 'Gina Guest', 'gina@example.com', null, false) $$, 'A5'),
  'P0001|outside_hours|named|' || pg_temp.cid('A5')::text, 'outside_hours: an item running past closing (21:00 for 2 hours) names its court');
select is(pg_temp.errx($$ select public.create_booking_group(jsonb_build_array(pg_temp.it('A1', 8, 10), pg_temp.it('A8', 8, 10)), 'Gina Guest', 'gina@example.com', null, false) $$, 'A8'),
  'P0001|court_inactive|named|' || pg_temp.cid('A8')::text, 'court_inactive: names the archived court');
select is(pg_temp.errx($$ select public.create_booking_group(jsonb_build_array(pg_temp.it('A1', 8, 10), pg_temp.it('A5', 8, 10, 1, 30)), 'Gina Guest', 'gina@example.com', null, false) $$, 'A5'),
  'P0001|not_aligned|named|' || pg_temp.cid('A5')::text, 'not_aligned: an item that does not start on the hour names its court');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', -1, 10), pg_temp.it('A2', -1, 10))), 'P0001/slot_started',
  'slot_started: items in the past');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 31, 10), pg_temp.it('A2', 31, 10))), 'P0001/outside_window',
  'outside_window: items beyond the 30-day booking window');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10), pg_temp.it('A2', 9, 10)), null, 'gina@example.com'), 'P0001/invalid_guest',
  'invalid_guest: an anonymous guest must give a name');
select is(pg_temp.egrp(jsonb_build_array(pg_temp.it('A1', 9, 10), pg_temp.it('A2', 9, 10)), 'Gina Guest', 'not-an-email'), 'P0001/invalid_guest',
  'invalid_guest: an anonymous guest must give a valid email');
reset role;
insert into snap select 'after', pg_temp.counts();
select ok((select s1.v ~ '\|[0-9]+$' and s1.v = s2.v from snap s1, snap s2 where s1.label = 'before' and s2.label = 'after'),
  'all or nothing: every refused group inserted no booking, no payment and no booking_groups row');

-- ---------------------------------------------------------------------------
-- Creation block as a signed-in player
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_p1();
select is(pg_temp.cg('g_auth', jsonb_build_array(pg_temp.it('A3', 20, 16), pg_temp.it('A4', 20, 16))), 'done', 'a signed-in player books a group');
select pg_temp.newgrp('pt_auth');
reset role;

-- ---------------------------------------------------------------------------
-- What a group looks like (as postgres)
-- ---------------------------------------------------------------------------
select is((select count(*)::int from gr where label = 'g_main'), 2, 'a group of 2 returns one row per booking');
select is((select count(distinct booking_group_id)::int from gr where label = 'g_main' and booking_group_id is not null), 1,
  'every returned row names the same booking_group_id');
select is((select court_id from gr where label = 'g_main' and pos = 1), pg_temp.cid('A1'),
  'the lead is returned first; with the same start the lead is the lower court id (A1 though A2 was sent first)');
select is((select court_id from gr where label = 'g_start' and pos = 1), pg_temp.cid('A2'),
  'the lead is the earliest start (A2 at 10:00), not the first item sent or the lower court id');
select is((select string_agg(distinct bk.status::text || '/' || bk.source::text, ',') from gr g join public.bookings bk on bk.id = g.id where g.label = 'g_main'),
  'pending_payment/online', 'every booking is pending_payment and online');
select is((select count(distinct bk.expires_at)::int from gr g join public.bookings bk on bk.id = g.id where g.label = 'g_main'), 1,
  'one hold: every booking of the group has the same expires_at');
select ok((select min(bk.expires_at) between now() + interval '44 minutes' and now() + interval '46 minutes'
  from gr g join public.bookings bk on bk.id = g.id where g.label = 'g_main'), 'the hold is venue_settings.payment_hold_minutes (45) from now');
select is((select string_agg(bk.total_amount::text, ',' order by g.pos) from gr g join public.bookings bk on bk.id = g.id where g.label = 'g_main'),
  '200.00,600.00', 'server pricing: A1 2 slots at 100 and A2 3 slots at 200');
select is(pg_temp.r(format($f$ select concat_ws('|', count(*), max(lead_booking_id::text), max(venue_id::text), bool_and(created_at is not null)::text)
    from public.booking_groups where id = %L $f$, pg_temp.gid('g_main'))),
  format('1|%s|%s|true', pg_temp.nth('g_main', 1), 'a0000000-0000-0000-0000-0000000092a1'),
  'one booking_groups row: its lead_booking_id is the first returned booking, in the venue');
select is(pg_temp.r(format($f$ select count(*)::text from public.bookings where booking_group_id = %L $f$, pg_temp.gid('g_main'))), '2',
  'both bookings carry the booking_group_id');
select is((select count(distinct guest_token)::text || '|' || min(length(guest_token))::text from gr where label = 'g_main'), '1|43',
  'an anonymous guest gets ONE token (43 characters) on every row');
select ok((select bool_and(bk.guest_token_hash = sha256(convert_to(g.guest_token, 'UTF8'))) from gr g join public.bookings bk on bk.id = g.id where g.label = 'g_main'),
  'every booking stores the sha256 of the shared token');
select is((select string_agg(distinct bk.guest_name || '|' || bk.guest_email || '|' || bk.guest_phone || '|' || coalesce(bk.user_id::text, '-'), ',')
    from gr g join public.bookings bk on bk.id = g.id where g.label = 'g_main'),
  'Gina Guest|gina@example.com|09172222222|-', 'every booking stores the trimmed name, lower-cased email and normalized phone, and no user');
select is(pg_temp.fees('g_main') || ' ' || pg_temp.dues('g_main'), '10.00,0.00 210.00,600.00',
  'booking fee, one per checkout: the lead carries platform_pricing.booking_fee, the other court 0; amount_due = total + fee');
select is(pg_temp.fees('g_start') || ' ' || pg_temp.dues('g_start'), '10.00,0.00 210.00,100.00',
  'the fee is on the earliest-start court (A2 at 10:00), not on A1');
select is((select count(*)::int from gr where label = 'g_six'), 6, 'a group of six courts returns six rows');
select is((select count(distinct reference_code)::int from gr where label = 'g_six'), 6, 'six bookings, six references');
select is((select count(*)::text || '|' || sum(bk.booking_fee)::text || '|' || count(distinct bk.expires_at)::text
    from gr g join public.bookings bk on bk.id = g.id where g.label = 'g_six' and (bk.booking_fee = 10 or bk.booking_fee = 0)), '6|10.00|1',
  'six courts: the fee is on exactly one booking (total 10) and every booking shares one hold');
select is(pg_temp.r(format($f$ select (lead_booking_id = %L)::text from public.booking_groups where id = %L $f$, pg_temp.nth('g_six', 1), pg_temp.gid('g_six'))),
  'true', 'a group of six: the group row names the first returned booking as lead');
select is((select count(*)::int from gr where label = 'g_edge'), 2, '06:00 and 21:00 on one local date: one group of two bookings');
select is((select bk.status::text from public.bookings bk where bk.reference_code = 'CB-BGSTL2'), 'expired',
  'a stale hold (pending_payment past expires_at) overlapping an item is set to expired');
select is(pg_temp.pst('g_stale'), 'pending_payment,pending_payment', 'and the group books over it');
select is((select string_agg(distinct coalesce(bk.user_id::text, '-'), ',') from gr g join public.bookings bk on bk.id = g.id where g.label = 'g_auth'),
  '11111111-1111-1111-1111-111111111111', 'a signed-in caller: user_id = auth.uid() on every booking');
select is((select count(g.guest_token)::text || '|' || bool_and(bk.guest_token_hash is null)::text from gr g join public.bookings bk on bk.id = g.id where g.label = 'g_auth'),
  '0|true', 'a signed-in caller gets no guest token on any row and no token hash is stored');
select is((select string_agg(distinct bk.waiver_text || '|' || (bk.waiver_accepted_at is not null)::text, ',')
    from gr g join public.bookings bk on bk.id = g.id where g.label = 'g_waiver'), 'E2E waiver terms|true',
  'an accepted waiver is stored (text and time) on every booking');
select is(pg_temp.r(format($f$ select concat_ws('|', (booking_group_id is null)::text, booking_fee::text, amount_due::text) from public.bookings where id = %L $f$,
    pg_temp.nth('pl_main', 1))), 'true|10.00|510.00',
  'a plain create_booking is unchanged: no group, the fee, amount_due = total + fee');
select is(pg_temp.r(format($f$ select venue_id::text from public.booking_groups where id = %L $f$, pg_temp.gid('g_b'))),
  'b0000000-0000-0000-0000-0000000092b1', 'a group at venue B belongs to venue B');

-- ---------------------------------------------------------------------------
-- get_guest_booking: the shared token opens every booking, booking_group describes the checkout
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.r(format($f$ select count(*)::text from public.get_guest_booking(%L, %L) $f$, pg_temp.ref('g_main', 1), pg_temp.tok('g_main')))
  || ',' || pg_temp.r(format($f$ select count(*)::text from public.get_guest_booking(%L, %L) $f$, pg_temp.ref('g_main', 2), pg_temp.tok('g_main')))
  || ',' || pg_temp.r(format($f$ select count(*)::text from public.get_guest_booking(%L, 'wrong') $f$, pg_temp.ref('g_main', 2)))
  || ',' || pg_temp.r(format($f$ select count(*)::text from public.get_guest_booking(%L, %L) $f$, pg_temp.ref('g_main', 1), pg_temp.tok('g_start'))),
  '1,1,ERR not_found,ERR not_found',
  'the group''s one token opens each booking of the group; a wrong token and another group''s token are not_found');
select is(pg_temp.bgj(pg_temp.ref('pl_main', 1), pg_temp.tok('pl_main')), 'null'::jsonb, 'an ungrouped booking has booking_group null');
select is(pg_temp.r(format($f$ select (select string_agg(k, ',' order by k) from jsonb_object_keys(%L::jsonb) k) $f$,
    pg_temp.bgj(pg_temp.ref('g_main', 1), pg_temp.tok('g_main')))),
  'amount_due,booking_fee,bookings,id,lead_reference_code,total_amount', 'booking_group has id, lead_reference_code, totals and bookings');
select is(pg_temp.r(format($f$ select concat_ws('|', j->>'id', j->>'lead_reference_code', trim_scale((j->>'total_amount')::numeric)::text,
    trim_scale((j->>'booking_fee')::numeric)::text, trim_scale((j->>'amount_due')::numeric)::text, jsonb_array_length(j->'bookings')::text)
    from (select %L::jsonb as j) x $f$, pg_temp.bgj(pg_temp.ref('g_main', 1), pg_temp.tok('g_main')))),
  format('%s|%s|800|10|810|2', pg_temp.gid('g_main'), pg_temp.ref('g_main', 1)),
  'booking_group: the group id, the lead''s reference and totals summed over all bookings (800, fee 10, due 810)');
select is(pg_temp.r(format($f$ select string_agg(concat_ws('|', e->>'court_name', e->>'sport', e->>'status', trim_scale((e->>'total_amount')::numeric)::text,
      trim_scale((e->>'booking_fee')::numeric)::text, trim_scale((e->>'amount_due')::numeric)::text, e->>'reference_code', jsonb_typeof(e->'refund')), ';' order by o)
    from jsonb_array_elements((%L::jsonb)->'bookings') with ordinality t(e, o) $f$, pg_temp.bgj(pg_temp.ref('g_main', 1), pg_temp.tok('g_main')))),
  format('E2E BG A1|tennis|pending_payment|200|10|210|%s|null;E2E BG A2|badminton|pending_payment|600|0|600|%s|null', pg_temp.ref('g_main', 1), pg_temp.ref('g_main', 2)),
  'booking_group.bookings: one element per booking ordered by slot_start then court_name, with the money split and a null refund');
select is(pg_temp.r(format($f$ select (select string_agg(k, ',' order by k) from jsonb_object_keys(((%L::jsonb)->'bookings')->0) k) $f$,
    pg_temp.bgj(pg_temp.ref('g_main', 1), pg_temp.tok('g_main')))),
  'amount_due,booking_fee,court_name,reference_code,refund,slot_end,slot_start,sport,status,total_amount',
  'each booking element has exactly reference_code, court_name, sport, slot_start, slot_end, status, total_amount, booking_fee, amount_due, refund');
select is(pg_temp.r(format($f$ select concat_ws('|', ((e->>'slot_start')::timestamptz = pg_temp.at(20, 10))::text, ((e->>'slot_end')::timestamptz = pg_temp.at(20, 12))::text)
    from jsonb_array_elements((%L::jsonb)->'bookings') with ordinality t(e, o) where o = 1 $f$, pg_temp.bgj(pg_temp.ref('g_main', 1), pg_temp.tok('g_main')))),
  'true|true', 'the element''s slot_start and slot_end are the booking''s range');
select is(pg_temp.r(format($f$ select concat_ws('|', g.id::text, (g.booking_group->>'id')) from public.get_guest_booking(%L, %L) g $f$,
    pg_temp.ref('g_main', 2), pg_temp.tok('g_main'))),
  format('%s|%s', pg_temp.nth('g_main', 2), pg_temp.gid('g_main')),
  'opened from the second court''s reference: that booking''s own row, the same group object');
reset role;

-- ---------------------------------------------------------------------------
-- RLS: booking_groups and bookings.booking_group_id
-- ---------------------------------------------------------------------------
select is(pg_temp.r(format($f$ select count(*)::text from public.booking_groups where id in (%L, %L, %L) $f$,
    pg_temp.gid('g_main'), pg_temp.gid('g_b'), pg_temp.gid('g_auth'))), '3', 'baseline: three groups exist (A, B and a player''s)');
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.r($$ select count(*)::text from public.booking_groups $$), 'ERR 42501', 'anon: reading booking_groups raises 42501 (no privilege)');
select is(pg_temp.r($$ select booking_group_id::text from public.bookings limit 1 $$), 'ERR 42501', 'anon: bookings.booking_group_id is not readable (42501)');
reset role;
set local role authenticated;
select pg_temp.as_p1();
select is(pg_temp.r($$ select count(*)::text from public.booking_groups $$), '0',
  'a player reads no booking_groups rows, not even the group of their own bookings');
select is(pg_temp.r(format($f$ select booking_group_id::text from public.bookings where id = %L $f$, pg_temp.nth('g_auth', 1))), coalesce(pg_temp.gid('g_auth')::text, '<no group>'),
  'the owner reads booking_group_id on their own booking');
select is(pg_temp.e($$ insert into public.booking_groups (venue_id) values ('a0000000-0000-0000-0000-0000000092a1') $$)
  || ',' || pg_temp.e($$ update public.booking_groups set lead_booking_id = null $$) || ',' || pg_temp.e($$ delete from public.booking_groups $$),
  '42501/,42501/,42501/', 'a player cannot insert, update or delete booking_groups');
select pg_temp.as_p2();
select is(pg_temp.r($$ select count(*)::text from public.booking_groups $$), '0', 'another player reads no booking_groups rows');
select is(pg_temp.r(format($f$ select booking_group_id::text from public.bookings where id = %L $f$, pg_temp.nth('g_auth', 1))), '<null>',
  'another player cannot see the booking, so not its booking_group_id');
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select count(*)::text from public.booking_groups where id = %L $f$, pg_temp.gid('g_main'))), '1', 'staff of venue A read their venue''s groups');
select is(pg_temp.r(format($f$ select count(*)::text from public.booking_groups where id = %L $f$, pg_temp.gid('g_b'))), '0', 'staff of venue A do not read venue B''s group');
select is(pg_temp.r(format($f$ select booking_group_id::text from public.bookings where id = %L $f$, pg_temp.nth('g_main', 1))), coalesce(pg_temp.gid('g_main')::text, '<no group>'),
  'staff of venue A read bookings.booking_group_id of their venue');
select is(pg_temp.e($$ insert into public.booking_groups (venue_id) values ('a0000000-0000-0000-0000-0000000092a1') $$)
  || ',' || pg_temp.e($$ update public.booking_groups set lead_booking_id = null $$) || ',' || pg_temp.e($$ delete from public.booking_groups $$),
  '42501/,42501/,42501/', 'venue staff cannot write booking_groups either (only the RPCs do)');
select pg_temp.as_staff_b();
select is(pg_temp.r(format($f$ select count(*)::text from public.booking_groups where id = %L $f$, pg_temp.gid('g_main'))), '0',
  'another venue''s admin reads none of venue A''s groups');
select is(pg_temp.r(format($f$ select count(*)::text from public.booking_groups where id = %L $f$, pg_temp.gid('g_b'))), '1', 'but reads their own venue''s group');
select is(pg_temp.r(format($f$ select booking_group_id::text from public.bookings where id = %L $f$, pg_temp.nth('g_main', 1))), '<null>',
  'another venue''s admin cannot see venue A''s bookings, so not their booking_group_id');
reset role;
select is(pg_temp.e(format($f$ update public.bookings set booking_group_id = %L where id = %L $f$, pg_temp.gid('g_b'), pg_temp.nth('g_main', 1))), '23503/',
  'a booking cannot join another venue''s group (the composite foreign key, 23503)');

-- ---------------------------------------------------------------------------
-- proof_target (service role): the matched booking's columns, then the group's
-- ---------------------------------------------------------------------------
update public.bookings set expires_at = now() - interval '1 minute' where id in (select id from gr where label = 'ck_exp');
update public.bookings set status = 'cancelled' where id = (select id from gr where label = 'ck_can' and pos = 2);
set local role service_role;
select pg_temp.as_service();
select is(pg_temp.pt(pg_temp.ref('pt', 2), pg_temp.tok('pt'), null),
  format('%s|200.00|200.00|%s|%s|310.00', pg_temp.nth('pt', 2), pg_temp.gid('pt'), pg_temp.nth('pt', 1)),
  'proof_target for the second court with the shared token: its own amounts, then group id, lead id and the group''s total amount_due');
select is(pg_temp.pt(lower(pg_temp.ref('pt', 1)), pg_temp.tok('pt'), null),
  format('%s|100.00|110.00|%s|%s|310.00', pg_temp.nth('pt', 1), pg_temp.gid('pt'), pg_temp.nth('pt', 1)),
  'proof_target for the lead: its own total 100 and amount_due 110, the group due 310');
select is(pg_temp.pt(pg_temp.ref('pt_auth', 2), null, '11111111-1111-1111-1111-111111111111'),
  format('%s|200.00|200.00|%s|%s|310.00', pg_temp.nth('pt_auth', 2), pg_temp.gid('pt_auth'), pg_temp.nth('pt_auth', 1)),
  'proof_target works for the signed-in owner id as well');
select is(pg_temp.pt(pg_temp.ref('pt', 2), 'wrong', null), 'ERR not_found', 'proof_target: a wrong token is not_found');
select is(pg_temp.pt(pg_temp.ref('pt_auth', 2), null, '33333333-3333-3333-3333-333333333333'), 'ERR not_found', 'proof_target: another user is not_found');
select is(pg_temp.pt(pg_temp.ref('pt', 2), pg_temp.tok('g_start'), null), 'ERR not_found', 'proof_target: another group''s token is not_found');
select is(pg_temp.pt(pg_temp.ref('pl_main', 1), pg_temp.tok('pl_main'), null),
  format('%s|500.00|510.00|-|-|-', pg_temp.nth('pl_main', 1)), 'proof_target for an ungrouped booking: unchanged, the three new columns are null');

-- ---------------------------------------------------------------------------
-- PayMongo checkout storage (service role)
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select pg_temp.rec('ck_for0', format($f$ select count(*)::text from public.paymongo_checkout_for(%L) $f$, pg_temp.nth('ck', 2)));
select pg_temp.rec('ck_store', format($f$ select concat_ws('|', checkout_id, checkout_url) from public.record_paymongo_checkout(%L, 'cs_bg_ck', 'https://checkout.paymongo.test/ck', 31000) $f$,
  pg_temp.nth('ck', 2)));
select pg_temp.rec('ck_row', $$ select concat_ws('|', count(*), max(booking_id::text), max(booking_group_id::text), max(amount_centavos)) from public.paymongo_checkouts where checkout_id = 'cs_bg_ck' $$);
select pg_temp.rec('ck_race', format($f$ select concat_ws('|', checkout_id, checkout_url) from public.record_paymongo_checkout(%L, 'cs_bg_ck2', 'https://checkout.paymongo.test/ck2', 31000) $f$,
  pg_temp.nth('ck', 1)));
select pg_temp.rec('ck_count', format($f$ select count(*)::text from public.paymongo_checkouts where booking_id in (%L, %L) $f$, pg_temp.nth('ck', 1), pg_temp.nth('ck', 2)));
select pg_temp.rec('ck_for_2', format($f$ select concat_ws('|', checkout_id, checkout_url) from public.paymongo_checkout_for(%L) $f$, pg_temp.nth('ck', 2)));
select pg_temp.rec('ck_for_1', format($f$ select concat_ws('|', checkout_id, checkout_url) from public.paymongo_checkout_for(%L) $f$, pg_temp.nth('ck', 1)));
select pg_temp.rec('ck_amt1', format($f$ select checkout_id from public.record_paymongo_checkout(%L, 'cs_bg_amt', 'https://checkout.paymongo.test/amt', 20000) $f$, pg_temp.nth('ck_amt', 2)));
select pg_temp.rec('ck_amt2', format($f$ select checkout_id from public.record_paymongo_checkout(%L, 'cs_bg_amt', 'https://checkout.paymongo.test/amt', 30900) $f$, pg_temp.nth('ck_amt', 1)));
select pg_temp.rec('ck_amt3', format($f$ select checkout_id from public.record_paymongo_checkout(%L, 'cs_bg_amt', 'https://checkout.paymongo.test/amt', 31100) $f$, pg_temp.nth('ck_amt', 1)));
select pg_temp.rec('ck_amt_n', $$ select count(*)::text from public.paymongo_checkouts where checkout_id = 'cs_bg_amt' $$);
select pg_temp.rec('ck_exp', format($f$ select checkout_id from public.record_paymongo_checkout(%L, 'cs_bg_exp', 'https://checkout.paymongo.test/exp', 31000) $f$, pg_temp.nth('ck_exp', 2)));
select pg_temp.rec('ck_can', format($f$ select checkout_id from public.record_paymongo_checkout(%L, 'cs_bg_can', 'https://checkout.paymongo.test/can', 31000) $f$, pg_temp.nth('ck_can', 1)));
select pg_temp.rec('ck_plain', format($f$ select concat_ws('|', checkout_id, checkout_url) from public.record_paymongo_checkout(%L, 'cs_bg_plain', 'https://checkout.paymongo.test/plain', 51000) $f$,
  pg_temp.nth('pl_main', 1)));
select pg_temp.rec('ck_plain_row', $$ select concat_ws('|', booking_id::text, coalesce(booking_group_id::text, '-')) from public.paymongo_checkouts where checkout_id = 'cs_bg_plain' $$);
-- The group's session for the "confirmed" PayMongo scenario goes through the RPC too.
select pg_temp.rec('ck_conf', format($f$ select checkout_id from public.record_paymongo_checkout(%L, 'cs_bg_conf', 'https://checkout.paymongo.test/conf', 31000) $f$, pg_temp.nth('pm_conf', 2)));
select is(pg_temp.r($$ select checkout_id from public.record_paymongo_checkout(gen_random_uuid(), 'cs_bg_nf', 'https://checkout.paymongo.test/nf', 31000) $$),
  'ERR not_found', 'an unknown booking is not_found');
reset role;
select is((select v from res where label = 'ck_for0') || '|' || (select v from res where label = 'ck_store'),
  '0|cs_bg_ck|https://checkout.paymongo.test/ck',
  'record_paymongo_checkout from the second court stores the session for the group total (31000 centavos); none was stored before');
select is((select v from res where label = 'ck_row'), format('1|%s|%s|31000', pg_temp.nth('ck', 1), pg_temp.gid('ck')),
  'ONE paymongo_checkouts row: booking_id is the lead, booking_group_id is set, amount_centavos is the group total');
select is((select v from res where label = 'ck_race') || ' ' || (select v from res where label = 'ck_count'),
  'cs_bg_ck|https://checkout.paymongo.test/ck 1', 'a racing second session (even from the lead) loses: the stored one is returned, still one session for the group');
select is((select v from res where label = 'ck_for_2') || ',' || (select v from res where label = 'ck_for_1'),
  'cs_bg_ck|https://checkout.paymongo.test/ck,cs_bg_ck|https://checkout.paymongo.test/ck',
  'paymongo_checkout_for returns the group''s session from any booking of the group');
select is((select v from res where label = 'ck_amt1') || ',' || (select v from res where label = 'ck_amt2') || ',' || (select v from res where label = 'ck_amt3')
  || '|' || (select v from res where label = 'ck_amt_n'), 'ERR invalid_input,ERR invalid_input,ERR invalid_input|0',
  'the amount must equal the group''s total amount_due x 100 (one booking''s amount, 1 peso short and 1 peso over are invalid_input) and nothing is stored');
select is((select v from res where label = 'ck_exp'), 'ERR hold_expired', 'no session is stored for a group whose hold passed (hold_expired)');
select is((select v from res where label = 'ck_can'), 'ERR invalid_state', 'no session is stored when the group''s bookings are not all pending_payment (invalid_state)');
select is((select v from res where label = 'ck_plain') || ' ' || (select v from res where label = 'ck_plain_row'),
  format('cs_bg_plain|https://checkout.paymongo.test/plain %s|-', pg_temp.nth('pl_main', 1)),
  'an ungrouped booking still stores its own session, with a null booking_group_id');
select is((select v from res where label = 'ck_conf'), 'cs_bg_conf', 'setup: the checkout of the PayMongo "confirmed" group');

-- ---------------------------------------------------------------------------
-- record_payment_proof (service role): one pending payment per booking
-- ---------------------------------------------------------------------------
update public.bookings set expires_at = now() - interval '1 minute' where id in (select id from gr where label = 'pr_exp1');
update public.bookings set status = 'expired' where id in (select id from gr where label = 'pr_exp2');
update public.bookings set status = 'cancelled' where id = (select id from gr where label = 'pr_state' and pos = 1);
set local role service_role;
select pg_temp.as_service();
select pg_temp.proof('pr_eq');
select pg_temp.proof('pr_less', 2, 100);
select pg_temp.proof('pr_more', 2, 1000);
select pg_temp.proof('pr_round', 3, 100.01);
select pg_temp.proof('rv_ok');
select pg_temp.proof('rv_cycle');
select pg_temp.proof('rv_misc');
select pg_temp.proof('bl_lead');
select pg_temp.proof('bl_non');
select pg_temp.proof('bl_ply');
select pg_temp.proof_raw('pl_rv1', pg_temp.nth('pl_rv1', 1), 510);
select pg_temp.proof_raw('pl_rv2', pg_temp.nth('pl_rv2', 1), 510);
select pg_temp.rec('pr_second', format($f$ select (pg_temp.proof(%L))::text $f$, 'pr_eq'));
select pg_temp.rec('pr_exp1', format($f$ select (pg_temp.proof(%L))::text $f$, 'pr_exp1'));
select pg_temp.rec('pr_exp2', format($f$ select (pg_temp.proof(%L))::text $f$, 'pr_exp2'));
select pg_temp.rec('pr_state', format($f$ select (pg_temp.proof(%L))::text $f$, 'pr_state'));
select is(pg_temp.proof_raw('nf', gen_random_uuid(), 100), 'ERR not_found', 'not_found: an unknown booking');
select is(pg_temp.r($$ select payment_id::text from public.record_payment_proof(gen_random_uuid(), 'x/y.png', 'gcash', 100, null, null) $$), 'ERR invalid_input',
  'a path that does not start with the booking id stays invalid_input');
reset role;

select is((select v from res where label = 'pr_second') || ' ' || pg_temp.pst('pr_eq'), 'ERR invalid_state payment_submitted,payment_submitted',
  'one proof sets every booking of the group payment_submitted; a second proof on it is invalid_state');
select is((select v from res where label = 'pr_exp1') || ',' || (select v from res where label = 'pr_exp2') || ',' || (select v from res where label = 'pr_state')
  || ' ' || pg_temp.pays('pr_exp1') || ' ' || pg_temp.pays('pr_exp2') || ' ' || pg_temp.pays('pr_state')
  || ' ' || pg_temp.pst('pr_exp1') || ' ' || pg_temp.pst('pr_state'),
  'ERR hold_expired,ERR hold_expired,ERR invalid_state <none> <none> <none> pending_payment,pending_payment cancelled,pending_payment',
  'hold_expired (the hold passed, or the bookings are expired) and invalid_state (not all pending_payment): a refused proof writes no payment and changes no booking');
select is(pg_temp.pays('pr_eq'), 'gcash/pending,gcash/pending', 'one pending payment per booking, the same method');
select is(pg_temp.amts('pr_eq'), '110.00,200.00', 'the amount equals the group''s amount_due: each row is its booking''s amount_due (lead 110, second 200)');
select is((select count(*)::text || '|' || min(pa.booking_id::text) from public.payments pa where pa.storage_path is not null
    and pa.booking_id in (select id from gr where label = 'pr_eq')),
  format('1|%s', pg_temp.nth('pr_eq', 2)), 'storage_path is set only on the row of the booking passed in (the second court)');
select is(coalesce((select pa.storage_path from public.payments pa where pa.booking_id = pg_temp.nth('pr_eq', 2)), '<none>'), format('%s/proof.png', pg_temp.nth('pr_eq', 2)),
  'and it lives in that booking''s folder (payments_path_in_booking_folder)');
select is((select count(distinct pa.reference_number)::text || '|' || min(pa.reference_number) from public.payments pa
    where pa.booking_id in (select id from gr where label = 'pr_eq')), '1|REF-1', 'the same reference number on every row');
select is(coalesce((select payment_id::text from pp where label = 'pr_eq'), '<no result>'),
  coalesce((select pa.id::text from public.payments pa where pa.booking_id = pg_temp.nth('pr_eq', 2)), '<no payment>'),
  'record_payment_proof returns one row: the passed booking''s payment id');
select is(pg_temp.sums('pr_less', 'gcash', 'pending'), '2|100.00|true', 'an amount below the group''s due: the two rows still sum to exactly 100, none negative');
select is(pg_temp.sums('pr_more', 'gcash', 'pending'), '2|1000.00|true', 'an amount above the group''s due: the rows sum to exactly 1000');
select is(pg_temp.sums('pr_round', 'gcash', 'pending'), '3|100.01|true', 'three courts and 100.01: the rows sum to exactly 100.01, none negative');
select is(pg_temp.pst('pr_less') || ' ' || pg_temp.pst('pr_round'), 'payment_submitted,payment_submitted payment_submitted,payment_submitted,payment_submitted',
  'every booking of every group submitted');
select is((select count(*)::text || '|' || min(pa.amount)::text from public.payments pa where pa.booking_id = pg_temp.nth('pl_rv1', 1) and pa.review_status = 'pending'),
  '1|510.00', 'an ungrouped proof still writes exactly one pending payment for its amount');
select is(pg_temp.pst('pl_rv1'), 'payment_submitted', 'and the ungrouped booking is payment_submitted');

-- ---------------------------------------------------------------------------
-- review_payment (staff): one review for the whole group
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('rv_ok', 2))), 'confirmed',
  'approve from the second court: returns that booking''s new status');
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('bl_lead', 1))), 'confirmed', 'approve (bl_lead)');
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('bl_non', 1))), 'confirmed', 'approve (bl_non)');
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('bl_ply', 1))), 'confirmed', 'approve (bl_ply)');
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('pl_rv1', 1))), 'confirmed',
  'an ungrouped booking is approved as before');
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, false, 'Blurry proof') $f$, pg_temp.nth('pl_rv2', 1))), 'pending_payment',
  'an ungrouped first rejection gives the booking a fresh hold as before');
-- Refusals leave the group untouched.
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, false, null) $f$, pg_temp.nth('rv_misc', 1))), 'ERR note_required',
  'note_required: a rejection without a note');
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, false, '   ') $f$, pg_temp.nth('rv_misc', 1))), 'ERR note_required',
  'note_required: a blank note');
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('rv_nop', 1))), 'ERR invalid_state',
  'invalid_state: a group with no proof waiting');
select is(pg_temp.r($$ select status::text from public.review_payment(gen_random_uuid(), true, null) $$), 'ERR not_found', 'not_found: an unknown booking');
-- The first rejection of the cycle group, from the lead.
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, false, 'Wrong amount') $f$, pg_temp.nth('rv_cycle', 1))), 'pending_payment',
  'first rejection from the lead: returns the lead''s new status');
select pg_temp.as_staff_b();
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('rv_misc', 2))), 'ERR forbidden',
  'forbidden: another venue''s admin');
select pg_temp.as_p1();
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('rv_misc', 2))), 'ERR forbidden', 'forbidden: a player');
reset role;

select is(pg_temp.pst('rv_ok'), 'confirmed,confirmed', 'approving one booking confirms every booking of the group');
select is(pg_temp.pays('rv_ok'), 'gcash/approved,gcash/approved', 'every pending payment of the group is approved');
select is((select count(*)::text || '|' || bool_and(pa.reviewed_by = '22222222-2222-2222-2222-222222222222' and pa.reviewed_at is not null)::text
    from public.payments pa where pa.booking_id in (select id from gr where label = 'rv_ok')), '2|true', 'reviewed_by is the admin and reviewed_at is set on each');
select is((select string_agg(x.n::text, ',') from (select count(*) filter (where pa.review_status = 'approved') as n
    from gr g join public.bookings bk on bk.id = g.id left join public.payments pa on pa.booking_id = bk.id where g.label = 'rv_ok' group by bk.id) x), '1,1',
  'each booking has exactly one approved payment');
select is((select count(bk.confirmed_at)::int from gr g join public.bookings bk on bk.id = g.id where g.label = 'rv_ok'), 2, 'every booking got its confirmed_at');
select is(pg_temp.bills('rv_ok'), '1|lead:booking_fee:10.00', 'billing: ONE booking_fee charge for the whole group, on the lead (non-lead bookings never get one)');
select is(pg_temp.pst('pl_rv1') || ' ' || pg_temp.pays('pl_rv1') || ' ' || pg_temp.bills('pl_rv1'), 'confirmed gcash/approved 1|lead:booking_fee:10.00',
  'an ungrouped approval is unchanged (one approved payment, its own fee charge)');
select is(pg_temp.pst('pl_rv2') || ' ' || pg_temp.rcn('pl_rv2') || ' ' || pg_temp.pays('pl_rv2'), 'pending_payment 1 gcash/rejected',
  'an ungrouped rejection is unchanged (hold renewed, rejection_count 1)');
select is(pg_temp.pst('rv_misc') || ' ' || pg_temp.pays('rv_misc') || ' ' || pg_temp.rcn('rv_misc'),
  'payment_submitted,payment_submitted gcash/pending,gcash/pending 0,0', 'refused reviews change nothing');
select is(pg_temp.pst('rv_cycle') || ' ' || pg_temp.rcn('rv_cycle') || ' ' || pg_temp.pays('rv_cycle'),
  'pending_payment,pending_payment 1,1 gcash/rejected,gcash/rejected', 'a first rejection: every pending payment rejected, every booking back to pending_payment with rejection_count + 1');
select is(pg_temp.ex('rv_cycle'), '00:45:00,00:45:00', 'both bookings get the same new hold: payment_hold_minutes (45) from now');
select is((select string_agg(distinct pa.review_note, ',') from public.payments pa where pa.booking_id in (select id from gr where label = 'rv_cycle')), 'Wrong amount',
  'the rejection note is on each rejected payment');

-- Rejected once, paid again, rejected again: max_rejections (2) rejects every booking.
set local role service_role;
select pg_temp.as_service();
select pg_temp.rec('cycle_proof', format($f$ select (pg_temp.proof(%L, 1))::text $f$, 'rv_cycle'));
reset role;
select is((select v from res where label = 'cycle_proof') || ' ' || pg_temp.pst('rv_cycle') || ' ' || pg_temp.pays('rv_cycle'),
  'done payment_submitted,payment_submitted gcash/pending,gcash/rejected,gcash/pending,gcash/rejected',
  'after a rejection a new proof can be submitted for the group: one new pending payment per booking next to the rejected ones');
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, false, 'Still wrong') $f$, pg_temp.nth('rv_cycle', 2))), 'rejected',
  'reaching venue_settings.max_rejections (2) rejects the booking');
reset role;
select is(pg_temp.pst('rv_cycle') || ' ' || pg_temp.rcn('rv_cycle'), 'rejected,rejected 2,2', 'and every booking of the group, each with rejection_count 2');

-- The new hold is capped at the earliest start of the group (a group starting in 20 minutes).
select pg_temp.newg('rv_soon');
select pg_temp.mkb('rvs1', 'payment_submitted', now() + interval '20 minutes', p_group => 'rv_soon');
select pg_temp.mkb('rvs2', 'payment_submitted', now() + interval '3 hours', p_group => 'rv_soon');
select pg_temp.pay('rvs1', 'gcash', 110, 'pending', null, null, null, 'proof.png');
select pg_temp.pay('rvs2', 'gcash', 200, 'pending', null, null, null, 'proof.png');
select pg_temp.mkgroup('rv_soon', 'rvs1', 'rvs2');
set local role authenticated;
select pg_temp.as_staff_a();
select pg_temp.rec('rv_soon', format($f$ select status::text from public.review_payment(%L, false, 'Wrong amount') $f$, pg_temp.bid('rvs2')));
reset role;
select is((select v from res where label = 'rv_soon') || ' ' || pg_temp.gm('rv_soon') || ' ' || pg_temp.pst('rv_soon') || ' ' || pg_temp.ex('rv_soon'),
  'pending_payment 2 pending_payment,pending_payment 00:20:00,00:20:00',
  'a first rejection of a group starting in 20 minutes: the new hold is least(now() + payment_hold_minutes, the earliest lower(during) in the group) on every booking, the later court included');

-- ---------------------------------------------------------------------------
-- PayMongo payments (service role): SPEC §4's four outcomes for the group as a whole
-- ---------------------------------------------------------------------------
-- Fixtures (as postgres): lapsed, taken, started, mismatched, closed and proof-waiting groups, and a stored session for each.
update public.bookings set status = 'expired' where id in (select id from gr where label in ('pm_rev1', 'pm_late1', 'pm_late2'));
update public.bookings set expires_at = now() - interval '5 minutes' where id in (select id from gr where label = 'pm_rev2');
insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status, source)
select 'CB-BGTAK2', g.court_id, 'Taker', bk.during, 200, 'confirmed', 'online'
from gr g join public.bookings bk on bk.id = g.id where g.label = 'pm_late1' and g.pos = 2;
update public.bookings set during = tstzrange(now() - interval '30 minutes', now() + interval '30 minutes') where id = (select id from gr where label = 'pm_late2' and pos = 1);
update public.bookings set status = 'cancelled' where id = (select id from gr where label = 'pm_can' and pos = 2);
update public.bookings set status = 'rejected' where id in (select id from gr where label = 'pm_rej');
update public.bookings set status = 'confirmed' where id in (select id from gr where label = 'pm_cnf');
insert into public.payments (booking_id, method, amount, storage_path, review_status)
select g.id, 'gcash', bk.amount_due, g.id::text || '/p.png', 'pending' from gr g join public.bookings bk on bk.id = g.id where g.label = 'pm_super';
update public.bookings set status = 'payment_submitted' where id in (select id from gr where label = 'pm_super');
select pg_temp.ck('pm_rev1', 'cs_bg_rev1');
select pg_temp.ck('pm_rev2', 'cs_bg_rev2');
select pg_temp.ck('pm_late1', 'cs_bg_late1');
select pg_temp.ck('pm_late2', 'cs_bg_late2');
select pg_temp.ck('pm_super', 'cs_bg_super');
select pg_temp.ck('pm_mis', 'cs_bg_mis');
select pg_temp.ck('pm_can', 'cs_bg_can2');
select pg_temp.ck('pm_rej', 'cs_bg_rej');
select pg_temp.ck('pm_cnf', 'cs_bg_cnf');
select pg_temp.ck('pm_meta', 'cs_bg_meta');
select is((select count(*)::int from public.paymongo_checkouts where checkout_id in ('cs_bg_rev1', 'cs_bg_rev2', 'cs_bg_late1', 'cs_bg_late2', 'cs_bg_super',
  'cs_bg_mis', 'cs_bg_can2', 'cs_bg_rej', 'cs_bg_cnf', 'cs_bg_meta')), 10, 'setup: a stored session for each PayMongo scenario group');

set local role service_role;
select pg_temp.as_service();
select pg_temp.rec('conf_for_before', format($f$ select count(*)::text from public.paymongo_checkout_for(%L) $f$, pg_temp.nth('pm_conf', 2)));
select pg_temp.pay_online('pm_conf', 'cs_bg_conf', 'pay_bg_conf', 'evt_bg_conf', 31000, 'PHP', pg_temp.nth('pm_conf', 1));
select pg_temp.pay_online('pm_conf_dup', 'cs_bg_conf', 'pay_bg_conf', 'evt_bg_conf_retry', 31000, 'PHP', pg_temp.nth('pm_conf', 1));
select pg_temp.rec('conf_for_after', format($f$ select count(*)::text from public.paymongo_checkout_for(%L) $f$, pg_temp.nth('pm_conf', 2)));
select pg_temp.pay_online('pm_rev1', 'cs_bg_rev1', 'pay_bg_rev1', 'evt_bg_rev1', 31000, 'PHP', pg_temp.nth('pm_rev1', 1));
select pg_temp.pay_online('pm_rev2', 'cs_bg_rev2', 'pay_bg_rev2', 'evt_bg_rev2', 31000);
select pg_temp.pay_online('pm_late1', 'cs_bg_late1', 'pay_bg_late1', 'evt_bg_late1', 31000, 'PHP', pg_temp.nth('pm_late1', 1));
select pg_temp.pay_online('pm_late2', 'cs_bg_late2', 'pay_bg_late2', 'evt_bg_late2', 31000, 'PHP', pg_temp.nth('pm_late2', 1));
select pg_temp.pay_online('pm_super', 'cs_bg_super', 'pay_bg_super', 'evt_bg_super', 31000, 'PHP', pg_temp.nth('pm_super', 1));
select pg_temp.pay_online('pm_mis', 'cs_bg_mis', 'pay_bg_mis', 'evt_bg_mis', 30900, 'PHP', pg_temp.nth('pm_mis', 1));
select pg_temp.pay_online('pm_can', 'cs_bg_can2', 'pay_bg_can', 'evt_bg_can', 31000, 'PHP', pg_temp.nth('pm_can', 1));
select pg_temp.pay_online('pm_rej', 'cs_bg_rej', 'pay_bg_rej', 'evt_bg_rej', 31000, 'PHP', pg_temp.nth('pm_rej', 1));
select pg_temp.pay_online('pm_cnf', 'cs_bg_cnf', 'pay_bg_cnf', 'evt_bg_cnf', 31000, 'PHP', pg_temp.nth('pm_cnf', 1));
select pg_temp.pay_online('pm_meta_bad', 'cs_bg_meta', 'pay_bg_meta_bad', 'evt_bg_meta_bad', 31000, 'PHP', pg_temp.nth('pm_meta', 2));
select pg_temp.pay_online('pm_unknown', 'cs_bg_nope', 'pay_bg_nope', 'evt_bg_nope', 31000);
reset role;

-- 1. Paid within the hold
select is((select outcome from pm where label = 'pm_conf'), 'confirmed', 'case 1: a payment within the hold confirms the group');
select is(pg_temp.pst('pm_conf') || ' ' || pg_temp.pays('pm_conf') || ' ' || pg_temp.amts('pm_conf'),
  'confirmed,confirmed paymongo/approved,paymongo/approved 110.00,200.00', 'case 1: every booking confirmed, one approved PayMongo row per booking, amount = its amount_due');
select is(pg_temp.pids('pm_conf'), '2|1|1|1', 'case 1: the rows share the provider payment, checkout and event ids');
select is(coalesce((select payment_id::text from pm where label = 'pm_conf'), '<no result>'),
  coalesce((select pa.id::text from public.payments pa where pa.booking_id = pg_temp.nth('pm_conf', 1) and pa.method = 'paymongo'), '<no payment>'),
  'case 1: the returned payment_id is the lead booking''s row');
select is(pg_temp.bills('pm_conf') || ' ' || pg_temp.rfs('pm_conf'), '1|lead:booking_fee:10.00 0|0|-', 'case 1: one fee charge on the lead and no refund');
select is((select v from res where label = 'conf_for_before') || '>' || (select v from res where label = 'conf_for_after'), '1>0',
  'paymongo_checkout_for offers the group''s session (from any booking) until a payment is recorded on it');
select is((select outcome from pm where label = 'pm_conf_dup'), 'duplicate', 'case 6: a replayed payment id is a duplicate');
select is(pg_temp.pays('pm_conf') || ' ' || pg_temp.pids('pm_conf'), 'paymongo/approved,paymongo/approved 2|1|1|1', 'a replay adds no payment rows');
-- 2. Revived
select is((select outcome from pm where label = 'pm_rev1'), 'revived', 'case 2: a lapsed (expired) hold with every court free is revived');
select is(pg_temp.pst('pm_rev1') || ' ' || pg_temp.pays('pm_rev1') || ' ' || pg_temp.amts('pm_rev1'),
  'confirmed,confirmed paymongo/approved,paymongo/approved 110.00,200.00', 'case 2: every booking confirmed with an approved row');
select is((select outcome from pm where label = 'pm_rev2'), 'revived', 'case 2: a pending_payment hold past expires_at is revived too (no metadata booking id sent)');
select is(pg_temp.pst('pm_rev2') || ' ' || pg_temp.pays('pm_rev2'), 'confirmed,confirmed paymongo/approved,paymongo/approved', 'case 2: confirmed, rows approved');
-- 3. Late, all or nothing
select is((select outcome from pm where label = 'pm_late1'), 'late', 'case 3: a lapsed hold where one court was taken meanwhile is late for the whole group');
select is(pg_temp.pst('pm_late1') || ' ' || pg_temp.pays('pm_late1'), 'expired,expired paymongo/rejected,paymongo/rejected',
  'case 3: NO booking is confirmed (the free court is not either), one rejected row per booking');
select is(pg_temp.pnote('pm_late1') || ' ' || pg_temp.rfs('pm_late1'), 'true 2|310.00|1,2', 'case 3: every row has a note and an owed refund per booking, summing to the paid 310');
select is((select count(*)::text || '|' || string_agg(r.status::text, ',') from gr g join public.refunds r on r.booking_id = g.id where g.label = 'pm_late1'), '2|owed,owed',
  'case 3: the refunds are owed');
select is((select outcome from pm where label = 'pm_late2'), 'late', 'case 5: a lapsed hold whose slot has started is late');
select is(pg_temp.pst('pm_late2') || ' ' || pg_temp.rfs('pm_late2'), 'expired,expired 2|310.00|1,2', 'case 5: nothing confirmed, owed refunds for the whole payment');
-- 4. Proof waiting
select is((select outcome from pm where label = 'pm_super'), 'superseded_proof', 'case 4: a payment while proofs wait for review');
select is(pg_temp.pst('pm_super') || ' ' || pg_temp.rcn('pm_super'), 'confirmed,confirmed 0,0',
  'case 4: every booking confirmed; the closed proofs do not count as rejections');
select is((select string_agg(pa.method::text || '/' || pa.review_status::text || '/' || coalesce(pa.review_note, '-'), ',' order by g.pos, pa.method::text)
    from gr g join public.payments pa on pa.booking_id = g.id where g.label = 'pm_super') || ' ' || pg_temp.rfs('pm_super'),
  'gcash/rejected/Paid online with PayMongo instead.,paymongo/approved/-,gcash/rejected/Paid online with PayMongo instead.,paymongo/approved/- 0|0|-',
  'case 4: every pending proof is closed as rejected with "Paid online with PayMongo instead.", one approved PayMongo row per booking, and no refund');
-- 5. Mismatch
select is((select outcome from pm where label = 'pm_mis'), 'late', 'case 5: an amount that does not match the group total is late');
select is(pg_temp.pst('pm_mis') || ' ' || pg_temp.pays('pm_mis') || ' ' || pg_temp.pnote('pm_mis'),
  'pending_payment,pending_payment paymongo/rejected,paymongo/rejected true', 'case 5: both bookings keep their hold, rejected rows with notes');
select is(pg_temp.rfs('pm_mis') || ' ' || pg_temp.sums('pm_mis', 'paymongo', 'rejected'), '2|309.00|1,2 2|309.00|true',
  'case 5: an owed refund per booking summing to the paid 309, no row negative');
set local role service_role;
select pg_temp.as_service();
select pg_temp.rec('mis_new', format($f$ select concat_ws('|', checkout_id, checkout_url) from public.record_paymongo_checkout(%L, 'cs_bg_mis2', 'https://checkout.paymongo.test/mis2', 31000) $f$,
  pg_temp.nth('pm_mis', 2)));
select pg_temp.pay_online('pm_mis_usd', 'cs_bg_mis2', 'pay_bg_mis_usd', 'evt_bg_mis_usd', 31000, 'USD', pg_temp.nth('pm_mis', 1));
reset role;
select is((select v from res where label = 'mis_new') || ' ' || pg_temp.r($$ select count(*)::text from public.paymongo_checkouts where booking_id = (select id from gr where label = 'pm_mis' and pos = 1) $$),
  'cs_bg_mis2|https://checkout.paymongo.test/mis2 1', 'a dead session (a payment was recorded on it) is replaced by a new one for the group; still one stored session');
select is((select outcome from pm where label = 'pm_mis_usd'), 'late', 'case 5: a non-PHP payment is late');
select is(pg_temp.pst('pm_mis') || ' ' || pg_temp.rfs('pm_mis'), 'pending_payment,pending_payment 4|619.00|1,1,2,2', 'the USD payment is also refunded per booking (309 + 310)');
-- 5. Closed groups
select is((select outcome from pm where label = 'pm_can'), 'late', 'case 5: a group with a cancelled booking is late');
select is(pg_temp.pst('pm_can') || ' ' || pg_temp.pays('pm_can') || ' ' || pg_temp.rfs('pm_can'),
  'pending_payment,cancelled paymongo/rejected,paymongo/rejected 2|310.00|1,2', 'case 5: both bookings unchanged, rejected rows and owed refunds per booking');
select is((select outcome from pm where label = 'pm_rej'), 'late', 'case 5: a group whose bookings were rejected is late');
select is(pg_temp.pst('pm_rej') || ' ' || pg_temp.rfs('pm_rej'), 'rejected,rejected 2|310.00|1,2', 'case 5: unchanged, refunds owed');
select is((select outcome from pm where label = 'pm_cnf'), 'late', 'case 5: a group that is already confirmed is late (already paid)');
select is(pg_temp.pst('pm_cnf') || ' ' || pg_temp.pays('pm_cnf') || ' ' || pg_temp.rfs('pm_cnf'),
  'confirmed,confirmed paymongo/rejected,paymongo/rejected 2|310.00|1,2', 'case 5: still confirmed, the payment is rejected and refunded');
-- 6. Unknown checkout / metadata
select is((select outcome || '|' || coalesce(payment_id::text, '-') from pm where label = 'pm_unknown'), 'unknown_checkout|-', 'case 6: a checkout we did not create is ignored');
select is((select outcome from pm where label = 'pm_meta_bad') || ' ' || pg_temp.pays('pm_meta') || ' ' || pg_temp.pst('pm_meta'),
  'unknown_checkout <none> pending_payment,pending_payment', 'a metadata booking id that is not the lead is unknown_checkout and records nothing');
set local role service_role;
select pg_temp.as_service();
select pg_temp.pay_online('pm_meta_ok', 'cs_bg_meta', 'pay_bg_meta', 'evt_bg_meta', 31000, 'PHP', pg_temp.nth('pm_meta', 1));
-- Single booking (18_paymongo's behavior stays)
select pg_temp.pay_online('pl_pm', 'cs_bg_plain', 'pay_bg_plain', 'evt_bg_plain', 51000, 'PHP', pg_temp.nth('pl_main', 1));
reset role;
select is((select outcome from pm where label = 'pm_meta_ok') || ' ' || pg_temp.pst('pm_meta'), 'confirmed confirmed,confirmed', 'the lead booking id as metadata is accepted');
select is((select outcome from pm where label = 'pl_pm'), 'confirmed', 'an ungrouped booking''s payment is confirmed as before');
select is(pg_temp.pst('pl_main') || ' ' || pg_temp.pays('pl_main') || ' ' || pg_temp.amts('pl_main'), 'confirmed paymongo/approved 510.00',
  'one approved PayMongo row for the amount due');

-- ---------------------------------------------------------------------------
-- Direct fixtures, platform fee 0: cancelling grouped bookings
-- ---------------------------------------------------------------------------
update public.platform_pricing set booking_fee = 0;

-- A guest group: two confirmed courts paid 300 and 500.
select pg_temp.newg('pc_g');
select pg_temp.mkb('pcg1', 'confirmed', now() + interval '2 days', p_token => 'tok-pcg', p_group => 'pc_g');
select pg_temp.mkb('pcg2', 'confirmed', now() + interval '2 days 2 hours', p_token => 'tok-pcg', p_group => 'pc_g');
select pg_temp.pay('pcg1', 'gcash', 300);
select pg_temp.pay('pcg2', 'gcash', 500);
select pg_temp.mkgroup('pc_g', 'pcg1', 'pcg2');
-- A player's group still waiting for payment, one with a proof waiting, and a mixed one with a court the venue already dropped.
select pg_temp.newg('pc_u');
select pg_temp.mkb('pcu1', 'pending_payment', now() + interval '2 days', p_user => '11111111-1111-1111-1111-111111111111', p_group => 'pc_u');
select pg_temp.mkb('pcu2', 'pending_payment', now() + interval '2 days 2 hours', p_user => '11111111-1111-1111-1111-111111111111', p_group => 'pc_u');
select pg_temp.mkgroup('pc_u', 'pcu1', 'pcu2');
select pg_temp.newg('pc_s');
select pg_temp.mkb('pcs1', 'payment_submitted', now() + interval '2 days', p_user => '11111111-1111-1111-1111-111111111111', p_group => 'pc_s');
select pg_temp.mkb('pcs2', 'payment_submitted', now() + interval '2 days 2 hours', p_user => '11111111-1111-1111-1111-111111111111', p_group => 'pc_s');
select pg_temp.pay('pcs1', 'gcash', 300, 'pending', null, null, null, 'proof.png');
select pg_temp.pay('pcs2', 'gcash', 500, 'pending', null, null, null, 'proof.png');
select pg_temp.mkgroup('pc_s', 'pcs1', 'pcs2');
select pg_temp.newg('pc_mixed');
select pg_temp.mkb('pcm1', 'confirmed', now() + interval '2 days', p_user => '11111111-1111-1111-1111-111111111111', p_group => 'pc_mixed');
select pg_temp.mkb('pcm2', 'confirmed', now() + interval '2 days 2 hours', p_user => '11111111-1111-1111-1111-111111111111', p_group => 'pc_mixed');
select pg_temp.mkb('pcm3', 'cancelled', now() + interval '2 days 4 hours', p_user => '11111111-1111-1111-1111-111111111111', p_by_venue => true, p_reason => 'Court flooded', p_group => 'pc_mixed');
select pg_temp.mkgroup('pc_mixed', 'pcm1', 'pcm2', 'pcm3');
-- The cutoff (1 hour) is measured at the group's earliest active start.
select pg_temp.newg('pc_cut1');
select pg_temp.mkb('pcc1', 'confirmed', now() + interval '30 minutes', p_token => 'tok-cut1', p_group => 'pc_cut1');
select pg_temp.mkb('pcc2', 'confirmed', now() + interval '3 hours', p_token => 'tok-cut1', p_group => 'pc_cut1');
select pg_temp.mkgroup('pc_cut1', 'pcc1', 'pcc2');
select pg_temp.newg('pc_cut2');
select pg_temp.mkb('pcd1', 'cancelled', now() + interval '30 minutes', p_token => 'tok-cut2', p_by_venue => true, p_reason => 'Dropped', p_group => 'pc_cut2');
select pg_temp.mkb('pcd2', 'confirmed', now() + interval '3 hours', p_token => 'tok-cut2', p_group => 'pc_cut2');
select pg_temp.mkb('pcd3', 'confirmed', now() + interval '4 hours', p_token => 'tok-cut2', p_group => 'pc_cut2');
select pg_temp.mkgroup('pc_cut2', 'pcd2', 'pcd1', 'pcd3');
select pg_temp.newg('pc_edge_ok');
select pg_temp.mkb('pce1', 'confirmed', now() + interval '1 hour', p_token => 'tok-edge1', p_group => 'pc_edge_ok');
select pg_temp.mkb('pce2', 'confirmed', now() + interval '5 hours', p_token => 'tok-edge1', p_group => 'pc_edge_ok');
select pg_temp.mkgroup('pc_edge_ok', 'pce1', 'pce2');
select pg_temp.newg('pc_edge_no');
select pg_temp.mkb('pcf1', 'confirmed', now() + interval '1 hour' - interval '1 second', p_token => 'tok-edge2', p_group => 'pc_edge_no');
select pg_temp.mkb('pcf2', 'confirmed', now() + interval '5 hours', p_token => 'tok-edge2', p_group => 'pc_edge_no');
select pg_temp.mkgroup('pc_edge_no', 'pcf1', 'pcf2');
select pg_temp.newg('pc_dead');
select pg_temp.mkb('pcx1', 'expired', now() + interval '2 days', p_token => 'tok-dead', p_expires => now() - interval '2 hours', p_group => 'pc_dead');
select pg_temp.mkb('pcx2', 'rejected', now() + interval '2 days 2 hours', p_token => 'tok-dead', p_group => 'pc_dead');
select pg_temp.mkgroup('pc_dead', 'pcx1', 'pcx2');
select pg_temp.newg('pc_stale');
select pg_temp.mkb('pcy1', 'pending_payment', now() + interval '2 days', p_token => 'tok-stale', p_expires => now() - interval '1 minute', p_group => 'pc_stale');
select pg_temp.mkb('pcy2', 'pending_payment', now() + interval '2 days 2 hours', p_token => 'tok-stale', p_expires => now() - interval '1 minute', p_group => 'pc_stale');
select pg_temp.mkgroup('pc_stale', 'pcy1', 'pcy2');
select pg_temp.newg('pc_priv');
select pg_temp.mkb('ppv1', 'confirmed', now() + interval '2 days', p_user => '11111111-1111-1111-1111-111111111111', p_token => 'tok-ppv', p_group => 'pc_priv');
select pg_temp.mkb('ppv2', 'confirmed', now() + interval '2 days 2 hours', p_user => '11111111-1111-1111-1111-111111111111', p_token => 'tok-ppv', p_group => 'pc_priv');
select pg_temp.mkgroup('pc_priv', 'ppv1', 'ppv2');
select is((select count(*)::int from gr where booking_group_id is not null
  and label in ('pc_g', 'pc_u', 'pc_s', 'pc_mixed', 'pc_cut1', 'pc_cut2', 'pc_edge_ok', 'pc_edge_no', 'pc_dead', 'pc_stale', 'pc_priv')), 24,
  'setup: the 11 player-cancel fixture groups (24 bookings) are written as booking groups');

-- Player and guest cancel (anon, then the player, then people who must not cancel)
set local role anon;
select pg_temp.as_anon();
select pg_temp.rec('c_pc_g', format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'tok-pcg', p_reason => 'Rain')::text $f$, pg_temp.ref('pc_g', 2)));
select pg_temp.rec('c_cut1', format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'tok-cut1')::text $f$, pg_temp.ref('pc_cut1', 2)));
select pg_temp.rec('c_cut2', format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'tok-cut2')::text $f$, pg_temp.ref('pc_cut2', 3)));
select pg_temp.rec('c_edge_ok', format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'tok-edge1')::text $f$, pg_temp.ref('pc_edge_ok', 2)));
select pg_temp.rec('c_edge_no', format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'tok-edge2')::text $f$, pg_temp.ref('pc_edge_no', 2)));
select pg_temp.rec('c_dead', format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'tok-dead')::text $f$, pg_temp.ref('pc_dead', 1)));
select pg_temp.rec('c_stale', format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'tok-stale')::text $f$, pg_temp.ref('pc_stale', 1)));
select pg_temp.rec('c_priv_tok', format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'wrong')::text $f$, pg_temp.ref('pc_priv', 1)));
select pg_temp.rec('c_priv_other', format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'tok-edge2')::text $f$, pg_temp.ref('pc_priv', 1)));
reset role;
set local role authenticated;
select pg_temp.as_p1();
select pg_temp.rec('c_pc_u', format($f$ select public.cancel_booking(%L)::text $f$, pg_temp.nth('pc_u', 1)));
select pg_temp.rec('c_pc_s', format($f$ select public.cancel_booking(%L)::text $f$, pg_temp.nth('pc_s', 2)));
select pg_temp.rec('c_pc_mixed', format($f$ select public.cancel_booking(%L)::text $f$, pg_temp.nth('pc_mixed', 1)));
select pg_temp.as_p2();
select pg_temp.rec('c_priv_p2', format($f$ select public.cancel_booking(%L)::text $f$, pg_temp.nth('pc_priv', 1)));
select pg_temp.as_staff_b();
select pg_temp.rec('c_priv_b', format($f$ select public.cancel_booking(%L, p_reason => 'Closed')::text $f$, pg_temp.nth('pc_priv', 1)));
reset role;

select is((select v from res where label = 'c_pc_g') || ' ' || pg_temp.gm('pc_g') || ' ' || pg_temp.pst('pc_g') || ' ' || pg_temp.cx('pc_g'),
  'cancelled 2 cancelled,cancelled cancelled|false|-|Rain;cancelled|false|-|Rain',
  'a guest cancels from the second court''s reference with the shared token: EVERY booking of the group is cancelled, not by the venue, with no user, the reason on each');
select is(pg_temp.rfs('pc_g'), '2|800.00|1,2', 'a confirmed 2-court group cancelled: two owed refunds summing to the paid 800');
select is((select v from res where label = 'c_cut1') || ' ' || pg_temp.gm('pc_cut1') || ' ' || pg_temp.pst('pc_cut1'), 'ERR cutoff_passed 2 confirmed,confirmed',
  'cutoff_passed: the earliest active start (30 minutes away) is inside the 1-hour cutoff even though the booking asked for starts in 3 hours; NOTHING is cancelled');
select is((select v from res where label = 'c_cut2') || ' ' || pg_temp.gm('pc_cut2') || ' ' || pg_temp.pst('pc_cut2') || ' ' || pg_temp.cx('pc_cut2'),
  'cancelled 3 cancelled,cancelled,cancelled cancelled|false|-|-;cancelled|true|-|Dropped;cancelled|false|-|-',
  'a court already cancelled does not count: the cutoff is measured at the earliest ACTIVE start; the active courts are cancelled, the dropped one keeps its cancellation (by venue, with its reason)');
select is((select v from res where label = 'c_edge_ok') || ' ' || (select v from res where label = 'c_edge_no') || ' ' || pg_temp.gm('pc_edge_ok') || ' ' || pg_temp.gm('pc_edge_no')
  || ' ' || pg_temp.pst('pc_edge_ok') || ' ' || pg_temp.pst('pc_edge_no'),
  'cancelled ERR cutoff_passed 2 2 cancelled,cancelled confirmed,confirmed',
  'exactly at the cutoff (earliest start in 1 hour) the group can still be cancelled; one second inside it is cutoff_passed');
select is((select v from res where label = 'c_dead') || ',' || (select v from res where label = 'c_stale') || ' ' || pg_temp.gm('pc_dead') || '/' || pg_temp.gm('pc_stale')
  || ' ' || pg_temp.pst('pc_dead') || ' ' || pg_temp.pst('pc_stale'),
  'ERR not_cancellable,ERR not_cancellable 2/2 expired,rejected pending_payment,pending_payment',
  'not_cancellable: no booking of the group is active (expired and rejected; holds past expires_at are not active); nothing changes');
select is((select v from res where label = 'c_pc_u') || ' ' || pg_temp.gm('pc_u') || ' ' || pg_temp.cx('pc_u'), 'cancelled 2 cancelled|false|1111|-;cancelled|false|1111|-',
  'a player cancels a group still waiting for payment (from the lead): every booking cancelled by the player (cancelled_by = uid), not by the venue');
select is((select v from res where label = 'c_pc_s') || ' ' || pg_temp.gm('pc_s') || ' ' || pg_temp.pst('pc_s') || ' ' || pg_temp.pays('pc_s') || ' ' || pg_temp.rfs('pc_s'),
  'cancelled 2 cancelled,cancelled gcash/pending,gcash/pending 0|0|-',
  'a player cancels a group with a proof waiting: every booking cancelled, the proof stays pending, no refund (nothing approved)');
select is((select v from res where label = 'c_pc_mixed') || ' ' || pg_temp.gm('pc_mixed') || ' ' || pg_temp.cx('pc_mixed'),
  'cancelled 3 cancelled|false|1111|-;cancelled|false|1111|-;cancelled|true|-|Court flooded',
  'a player cancels a group that already lost one court: a court the venue cancelled earlier is not touched');
select is((select v from res where label = 'c_priv_tok') || ',' || (select v from res where label = 'c_priv_other') || ',' || (select v from res where label = 'c_priv_p2')
  || ',' || (select v from res where label = 'c_priv_b') || ' ' || pg_temp.gm('pc_priv') || ' ' || pg_temp.pst('pc_priv'),
  'ERR not_found,ERR not_found,ERR not_found,ERR not_found 2 confirmed,confirmed',
  'a wrong token, another group''s token, another player and another venue''s admin are not_found; nothing is cancelled');

-- Staff: one court of a confirmed group, or the whole group before payment
select pg_temp.newg('sc_conf');
select pg_temp.mkb('sc1', 'confirmed', now() + interval '2 days', p_group => 'sc_conf');
select pg_temp.mkb('sc2', 'confirmed', now() + interval '2 days 2 hours', p_group => 'sc_conf');
select pg_temp.mkb('sc3', 'confirmed', now() + interval '2 days 4 hours', p_group => 'sc_conf');
select pg_temp.pay('sc1', 'gcash', 300);
select pg_temp.pay('sc2', 'gcash', 500);
select pg_temp.pay('sc3', 'gcash', 200);
select pg_temp.mkgroup('sc_conf', 'sc1', 'sc2', 'sc3');
select pg_temp.newg('sc_end');
select pg_temp.mkb('sce1', 'confirmed', now() - interval '3 hours', p_group => 'sc_end');
select pg_temp.mkb('sce2', 'confirmed', now() + interval '3 hours', p_group => 'sc_end');
select pg_temp.mkgroup('sc_end', 'sce1', 'sce2');
select pg_temp.newg('sc_pend');
select pg_temp.mkb('scp1', 'pending_payment', now() + interval '2 days', p_group => 'sc_pend');
select pg_temp.mkb('scp2', 'pending_payment', now() + interval '2 days 2 hours', p_group => 'sc_pend');
select pg_temp.mkgroup('sc_pend', 'scp1', 'scp2');
select pg_temp.newg('sc_sub');
select pg_temp.mkb('scs1', 'payment_submitted', now() + interval '2 days', p_group => 'sc_sub');
select pg_temp.mkb('scs2', 'payment_submitted', now() + interval '2 days 2 hours', p_group => 'sc_sub');
select pg_temp.pay('scs1', 'gcash', 300, 'pending', null, null, null, 'proof.png');
select pg_temp.pay('scs2', 'gcash', 500, 'pending', null, null, null, 'proof.png');
select pg_temp.mkgroup('sc_sub', 'scs1', 'scs2');
select pg_temp.newg('sc_mix');
select pg_temp.mkb('scm1', 'confirmed', now() + interval '2 days', p_group => 'sc_mix');
select pg_temp.mkb('scm2', 'payment_submitted', now() + interval '2 days 2 hours', p_group => 'sc_mix');
select pg_temp.pay('scm1', 'gcash', 300);
select pg_temp.pay('scm2', 'gcash', 500, 'pending', null, null, null, 'proof.png');
select pg_temp.mkgroup('sc_mix', 'scm1', 'scm2');
select is((select count(*)::int from gr where booking_group_id is not null and label in ('sc_conf', 'sc_end', 'sc_pend', 'sc_sub', 'sc_mix')), 11,
  'setup: the 5 staff-cancel fixture groups (11 bookings) are written as booking groups');

set local role authenticated;
select pg_temp.as_staff_a();
select pg_temp.rec('s_reason', format($f$ select public.cancel_booking(%L)::text $f$, pg_temp.nth('sc_conf', 2)));
select pg_temp.rec('s_ended', format($f$ select public.cancel_booking(%L, p_reason => 'Court flooded')::text $f$, pg_temp.nth('sc_end', 1)));
select pg_temp.rec('s_one', format($f$ select public.cancel_booking(%L, p_reason => 'Court flooded')::text $f$, pg_temp.nth('sc_conf', 2)));
reset role;
select is((select v from res where label = 's_reason') || ',' || (select v from res where label = 's_ended') || ' ' || pg_temp.gm('sc_end') || ' ' || pg_temp.pst('sc_end'),
  'ERR reason_required,ERR booking_ended 2 confirmed,confirmed',
  'reason_required (no reason) and booking_ended (the court passed in has ended) cancel nothing');
select is((select v from res where label = 's_one') || ' ' || pg_temp.gm('sc_conf') || ' ' || pg_temp.pst('sc_conf') || ' ' || pg_temp.cx('sc_conf') || ' ' || pg_temp.rfs('sc_conf'),
  'cancelled 3 confirmed,cancelled,confirmed confirmed|false|-|-;cancelled|true|2222|Court flooded;confirmed|false|-|- 1|500.00|2',
  'staff cancel ONE court of a confirmed group: only the passed court is cancelled (by the venue, by the admin, with the reason), the others stay confirmed, and an owed refund exists for that court''s approved payment only');

set local role authenticated;
select pg_temp.as_staff_a();
select pg_temp.rec('s_two', format($f$ select public.cancel_booking(%L, p_reason => 'Court flooded')::text $f$, pg_temp.nth('sc_conf', 3)));
select pg_temp.rec('s_again', format($f$ select public.cancel_booking(%L, p_reason => 'Again')::text $f$, pg_temp.nth('sc_conf', 2)));
select pg_temp.rec('s_pend', format($f$ select public.cancel_booking(%L, p_reason => 'Closed early')::text $f$, pg_temp.nth('sc_pend', 2)));
select pg_temp.rec('s_sub', format($f$ select public.cancel_booking(%L, p_reason => 'Closed early')::text $f$, pg_temp.nth('sc_sub', 1)));
select pg_temp.rec('s_mix', format($f$ select public.cancel_booking(%L, p_reason => 'Closed early')::text $f$, pg_temp.nth('sc_mix', 1)));
-- Billing on a staff cancel (the groups were approved with a fee of 10 on the lead)
select pg_temp.rec('b_lead', format($f$ select public.cancel_booking(%L, p_reason => 'Closed')::text $f$, pg_temp.nth('bl_lead', 1)));
select pg_temp.rec('b_non', format($f$ select public.cancel_booking(%L, p_reason => 'Closed')::text $f$, pg_temp.nth('bl_non', 2)));
reset role;
set local role anon;
select pg_temp.as_anon();
select pg_temp.rec('b_ply', format($f$ select public.cancel_booking(p_reference_code => %L, p_token => %L, p_reason => 'Rain')::text $f$, pg_temp.ref('bl_ply', 2), pg_temp.tok('bl_ply')));
reset role;
select is((select v from res where label = 's_two') || ',' || (select v from res where label = 's_again') || ' ' || pg_temp.gm('sc_conf') || ' ' || pg_temp.pst('sc_conf') || ' ' || pg_temp.rfs('sc_conf'),
  'cancelled,ERR not_cancellable 3 confirmed,cancelled,cancelled 2|700.00|2,3',
  'a second staff cancel on the same group cancels only that second court (the first stays confirmed; refunds for 500 and 200); a court already cancelled is not_cancellable');
select is((select v from res where label = 's_pend') || ' ' || pg_temp.gm('sc_pend') || ' ' || pg_temp.cx('sc_pend'),
  'cancelled 2 cancelled|true|2222|Closed early;cancelled|true|2222|Closed early',
  'staff cancel in a group still waiting for payment cancels EVERY booking, by the venue, with the same reason on each');
select is((select v from res where label = 's_sub') || ' ' || pg_temp.gm('sc_sub') || ' ' || pg_temp.pst('sc_sub') || ' ' || pg_temp.cx('sc_sub') || ' ' || pg_temp.rfs('sc_sub'),
  'cancelled 2 cancelled,cancelled cancelled|true|2222|Closed early;cancelled|true|2222|Closed early 0|0|-',
  'staff cancel in a group with a proof waiting cancels EVERY booking with the same reason, and refunds nothing (nothing approved)');
select is((select v from res where label = 's_mix') || ' ' || pg_temp.gm('sc_mix') || ' ' || pg_temp.pst('sc_mix') || ' ' || pg_temp.rfs('sc_mix'),
  'cancelled 2 cancelled,cancelled 1|300.00|1', 'staff cancel in a group that is not all confirmed cancels every active booking; the confirmed one is refunded');
select is((select v from res where label = 'b_lead') || ' ' || pg_temp.pst('bl_lead') || ' ' || pg_temp.bills('bl_lead') || ' ' || pg_temp.rfs('bl_lead'),
  'cancelled cancelled,confirmed 2|lead:adjustment:-10.00,lead:booking_fee:10.00 1|110.00|1',
  'billing is unchanged: a staff cancel of the fee-carrying court (the lead) of a confirmed group credits the fee back with the existing adjustment, and refunds that court''s payment (110)');
select is((select v from res where label = 'b_non') || ' ' || pg_temp.pst('bl_non') || ' ' || pg_temp.bills('bl_non') || ' ' || pg_temp.rfs('bl_non'),
  'cancelled confirmed,cancelled 1|lead:booking_fee:10.00 1|200.00|2', 'a staff cancel of a non-lead court creates no adjustment');
select is((select v from res where label = 'b_ply') || ' ' || pg_temp.pst('bl_ply') || ' ' || pg_temp.bills('bl_ply') || ' ' || pg_temp.rfs('bl_ply'),
  'cancelled cancelled,cancelled 1|lead:booking_fee:10.00 2|310.00|1,2', 'a player cancel creates no adjustment, and refunds both courts');

-- Ungrouped cancels are unchanged
select pg_temp.mkb('u_pl', 'confirmed', now() + interval '2 days', p_token => 'tok-upl');
select pg_temp.mkb('u_st', 'confirmed', now() + interval '2 days');
select pg_temp.mkb('u_late', 'confirmed', now() + interval '30 minutes', p_token => 'tok-ulate');
select pg_temp.pay('u_pl', 'gcash', 300);
select pg_temp.pay('u_st', 'gcash', 400);
select pg_temp.reg('u_pl', 'u_pl');
select pg_temp.reg('u_st', 'u_st');
select pg_temp.reg('u_late', 'u_late');
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.r(format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'tok-upl', p_reason => 'Rain')::text $f$, pg_temp.bref('u_pl'))), 'cancelled',
  'an ungrouped guest cancel is unchanged');
select is(pg_temp.r(format($f$ select public.cancel_booking(p_reference_code => %L, p_token => 'tok-ulate')::text $f$, pg_temp.bref('u_late'))), 'ERR cutoff_passed',
  'an ungrouped booking inside the cutoff is still cutoff_passed');
reset role;
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select public.cancel_booking(%L, p_reason => 'Court flooded')::text $f$, pg_temp.bid('u_st'))), 'cancelled', 'an ungrouped staff cancel is unchanged');
reset role;
select is(pg_temp.cx('u_pl') || ' ' || pg_temp.rfs('u_pl'), 'cancelled|false|-|Rain 1|300.00|1', 'ungrouped: cancelled by the player, one refund');
select is(pg_temp.cx('u_st') || ' ' || pg_temp.rfs('u_st'), 'cancelled|true|2222|Court flooded 1|400.00|1', 'ungrouped: cancelled by the venue, one refund');
select is(pg_temp.pst('u_late'), 'confirmed', 'ungrouped: a refused cancel changes nothing');

-- ---------------------------------------------------------------------------
-- get_guest_booking.booking_group: effective status, cancelled courts, refunds, ordering
-- ---------------------------------------------------------------------------
select pg_temp.newg('jf');
select pg_temp.mkb('jf2', 'confirmed', pg_temp.at(2, 10), p_token => 'tok-jf', p_total => 500, p_court_name => 'Court JF2', p_sport => 'badminton', p_group => 'jf');
select pg_temp.mkb('jf3', 'pending_payment', pg_temp.at(2, 8), p_token => 'tok-jf', p_total => 100, p_court_name => 'Court JF3', p_sport => 'pickleball',
  p_expires => now() - interval '1 minute', p_group => 'jf');
select pg_temp.mkb('jf1', 'confirmed', pg_temp.at(2, 10), p_token => 'tok-jf', p_total => 300, p_court_name => 'Court JF1', p_sport => 'tennis', p_group => 'jf');
select pg_temp.pay('jf1', 'gcash', 300);
select pg_temp.pay('jf2', 'gcash', 500);
update public.bookings set booking_fee = 10 where id = (select id from b where label = 'jf1');
update public.bookings set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Dropped', cancelled_by_venue = true where id = (select id from b where label = 'jf2');
select pg_temp.mkgroup('jf', 'jf1', 'jf2', 'jf3');
select is((select count(*)::int from gr where label = 'jf' and booking_group_id is not null), 3,
  'setup: group jf (confirmed, cancelled with an owed refund, and a lapsed hold) is written as a booking group');
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.r(format($f$ select concat_ws('|', j->>'id', j->>'lead_reference_code', trim_scale((j->>'total_amount')::numeric)::text,
    trim_scale((j->>'booking_fee')::numeric)::text, trim_scale((j->>'amount_due')::numeric)::text, jsonb_array_length(j->'bookings')::text)
    from (select %L::jsonb as j) x $f$, pg_temp.bgj(pg_temp.bref('jf2'), 'tok-jf'))),
  format('%s|%s|900|10|910|3', pg_temp.gid('jf'), pg_temp.bref('jf1')),
  'booking_group sums over ALL bookings, cancelled courts included (900, fee 10, due 910), and works from the cancelled court''s reference');
select is(pg_temp.r(format($f$ select string_agg(concat_ws('|', e->>'court_name', e->>'sport', e->>'status', trim_scale((e->>'total_amount')::numeric)::text,
      trim_scale((e->>'booking_fee')::numeric)::text, trim_scale((e->>'amount_due')::numeric)::text, jsonb_typeof(e->'refund')), ';' order by o)
    from jsonb_array_elements((%L::jsonb)->'bookings') with ordinality t(e, o) $f$, pg_temp.bgj(pg_temp.bref('jf2'), 'tok-jf'))),
  'Court JF3|pickleball|expired|100|0|100|null;Court JF1|tennis|confirmed|300|10|310|null;Court JF2|badminton|cancelled|500|0|500|object',
  'bookings are ordered by slot_start then court_name; a lapsed hold shows the EFFECTIVE status expired; a cancelled court still appears with its refund');
select is(pg_temp.r(format($f$ select concat_ws('|', (e->'refund'->>'status'), trim_scale((e->'refund'->>'amount')::numeric)::text,
      (select string_agg(k, ',' order by k) from jsonb_object_keys(e->'refund') k))
    from jsonb_array_elements((%L::jsonb)->'bookings') with ordinality t(e, o) where o = 3 $f$, pg_temp.bgj(pg_temp.bref('jf2'), 'tok-jf'))),
  'owed|500|amount,method,reason,settled_on,status', 'the refund element is {status, amount, method, settled_on, reason}: never the note or who recorded it');
reset role;

-- ---------------------------------------------------------------------------
-- issue_guest_link (service role)
-- ---------------------------------------------------------------------------
set local role service_role;
select pg_temp.as_service();
select pg_temp.il('ig', pg_temp.nth('ig', 2));
select pg_temp.il('pl_il', pg_temp.nth('pl_il', 1));
select is(pg_temp.r(format($f$ select public.issue_guest_link(%L) $f$, pg_temp.nth('g_auth', 1))), 'ERR not_found',
  'issue_guest_link: a signed-in owner''s booking has no guest link (unchanged)');
reset role;
set local role anon;
select pg_temp.as_anon();
select pg_temp.rec('il_open1', format($f$ select count(*)::text from public.get_guest_booking(%L, %L) $f$, pg_temp.ref('ig', 1), (select token from links where label = 'ig')));
select pg_temp.rec('il_open2', format($f$ select count(*)::text from public.get_guest_booking(%L, %L) $f$, pg_temp.ref('ig', 2), (select token from links where label = 'ig')));
select pg_temp.rec('il_orig', format($f$ select count(*)::text from public.get_guest_booking(%L, %L) $f$, pg_temp.ref('ig', 1), pg_temp.tok('ig')));
select pg_temp.rec('il_cross1', format($f$ select count(*)::text from public.get_guest_booking(%L, %L) $f$, pg_temp.ref('ig', 2), (select token from links where label = 'pl_il')));
select pg_temp.rec('il_pl', format($f$ select count(*)::text from public.get_guest_booking(%L, %L) $f$, pg_temp.ref('pl_il', 1), (select token from links where label = 'pl_il')));
select pg_temp.rec('il_cross2', format($f$ select count(*)::text from public.get_guest_booking(%L, %L) $f$, pg_temp.ref('pl_il', 1), (select token from links where label = 'ig')));
reset role;
select is((select count(*)::text from links where token is not null) || ';' || (select v from res where label = 'il_open1') || ',' || (select v from res where label = 'il_open2')
  || ';' || (select v from res where label = 'il_orig') || ';' || (select v from res where label = 'il_cross1') || ';' || (select v from res where label = 'il_pl')
  || ';' || (select v from res where label = 'il_cross2'),
  '2;1,1;1;ERR not_found;1;ERR not_found',
  'a fresh guest link for a grouped booking opens EVERY booking of the group (the original token still works); it does not open an ungrouped booking, and an ungrouped booking''s link opens that booking only');

select * from finish();
rollback;
