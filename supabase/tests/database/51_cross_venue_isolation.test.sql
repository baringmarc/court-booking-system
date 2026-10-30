-- T12.9: cross-venue isolation. Staff of venue A can neither read nor change anything of venue B, and the other way round.
--   * a catalog sweep: every public base table with a venue_id column is probed (select, update, move to the other venue,
--     delete, insert) as staff of one venue against the rows of the other. A table added later is probed too, and it fails
--     the suite until it has fixture rows in both venues (so it can't slip in unprobed)
--   * every client-callable RPC either gets a cross-venue call here or is listed as exempt with a reason; one that is in
--     neither list fails the suite
--   * the storage buckets venue-media, payment-qr and payment-proofs
--   * a mutation check: a permissive policy added (or the venue-scoped one replaced) inside the transaction makes the same
--     probes report a leak, and removing it makes them report blocked again, so the suite is shown to fail when a policy goes
-- Complements 45 (RLS matrix), 46/47 (RPC rules), 48 (storage paths) and 50 (billing); it does not repeat their assertions.
-- Fixture: venue A and venue B (both active), each with staff, courts, bookings, payments, charges and an invoice.
begin;
create extension if not exists pgtap with schema extensions;
select plan(73);

-- ---------------------------------------------------------------- helpers
create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- The HINT raised by a statement, or null when it succeeds ('sqlstate X' when it fails without a hint).
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

-- Rows affected by a write; -1 when it fails with a privilege/RLS error.
create function pg_temp.nrows(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;

-- Hash of a venue's rows in one table / in every table with a venue_id (run as the table owner, ignores RLS).
create function pg_temp.vhash(p_tbl text, p_venue uuid) returns text language plpgsql security definer as $$
declare r text;
begin
  execute format('select coalesce(md5(string_agg(to_jsonb(t)::text, '','' order by to_jsonb(t)::text)), ''-'') from public.%I t where venue_id = %L',
                 p_tbl, p_venue) into r;
  return r;
end $$;
create function pg_temp.vstate(p_venue uuid) returns text language plpgsql security definer as $$
declare r text;
begin
  select md5(string_agg(s.tbl || ':' || pg_temp.vhash(s.tbl, p_venue), ',' order by s.tbl)
             || (select to_jsonb(v)::text from public.venues v where v.id = p_venue)) into r from pg_temp.swp s;
  return r;
end $$;

-- One probe of table p_tbl as the current role: p_victim is the venue that must stay untouched, p_own the caller's venue.
-- Returns 'blocked' or a description of what got through.
create function pg_temp.probe(p_kind text, p_tbl text, p_victim uuid, p_own uuid) returns text language plpgsql as $$
declare n bigint; j jsonb; cols text;
begin
  if p_kind = 'select' then
    execute format('select count(*) from public.%I where venue_id = %L', p_tbl, p_victim) into n;
  elsif p_kind = 'update' then
    execute format('update public.%I set venue_id = venue_id where venue_id = %L', p_tbl, p_victim);
    get diagnostics n = row_count;
  elsif p_kind = 'move' then
    execute format('update public.%I set venue_id = %L where venue_id = %L', p_tbl, p_victim, p_own);
    get diagnostics n = row_count;
  elsif p_kind = 'delete' then
    execute format('delete from public.%I where venue_id = %L', p_tbl, p_victim);
    get diagnostics n = row_count;
  elsif p_kind = 'insert' then
    -- a copy of one of the victim's own rows (so every foreign key is consistent), without its id
    select t.j into j from pg_temp.tpl t where t.tbl = p_tbl and t.venue_id = p_victim;
    select string_agg(format('%I', a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a where a.attrelid = format('public.%I', p_tbl)::regclass and a.attnum > 0 and not a.attisdropped
       and a.attgenerated = '' and a.attname <> 'id';
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', p_tbl, cols, cols, p_tbl) using j;
    get diagnostics n = row_count;
  else
    return 'ERR unknown probe ' || p_kind;
  end if;
  return case when n > 0 then 'LEAK (' || p_kind || ' reached ' || n || ' row(s))' else 'blocked' end;
exception
  when insufficient_privilege then return 'blocked';
  when others then return 'NOT REFUSED BY RLS (sqlstate ' || sqlstate || ')';
end $$;

-- Tables where the probe did not come back 'blocked' (one text per table), for is_empty().
create function pg_temp.sweep(p_kind text, p_victim uuid, p_own uuid) returns setof text language plpgsql as $$
declare t text; r text;
begin
  for t in select s.tbl from pg_temp.swp s order by s.tbl loop
    -- the published catalog of an ACTIVE venue is readable by everyone on purpose (45); everything else must stay private
    continue when p_kind = 'select' and t = any (array['blackouts', 'court_photos', 'court_rates', 'courts', 'open_play_courts', 'open_play_sessions',
      'operating_hours', 'venue_amenities', 'venue_info_sections', 'venue_payment_accounts', 'venue_settings', 'venue_social_links']);
    r := pg_temp.probe(p_kind, t, p_victim, p_own);
    if r <> 'blocked' then return next t || ': ' || r; end if;
  end loop;
end $$;

-- Tables where the caller sees none of their own venue's rows (a probe that sees nothing proves nothing).
create function pg_temp.blind(p_own uuid) returns setof text language plpgsql as $$
declare t text; n bigint;
begin
  for t in select s.tbl from pg_temp.swp s order by s.tbl loop
    begin
      execute format('select count(*) from public.%I where venue_id = %L', t, p_own) into n;
    exception when insufficient_privilege then n := 0;
    end;
    if n = 0 then return next t; end if;
  end loop;
end $$;

-- Storage probes for one bucket as the current role. The names exist for both venues (created below).
create function pg_temp.storage_sweep(p_kind text, p_victim uuid) returns setof text language plpgsql as $$
declare b text; n bigint; nm text;
begin
  foreach b in array array['venue-media', 'payment-qr', 'payment-proofs'] loop
    begin
      if p_kind = 'read' then
        select count(*) into n from storage.objects o where o.bucket_id = b and o.name like (pg_temp.folder(b, p_victim)) || '%';
      elsif p_kind = 'update' then
        update storage.objects o set name = o.name || 'x' where o.bucket_id = b and o.name like (pg_temp.folder(b, p_victim)) || '%';
        get diagnostics n = row_count;
      elsif p_kind = 'insert' then
        nm := case b when 'venue-media' then pg_temp.folder(b, p_victim) || 'banner/ffffffff-0000-4000-8000-00000000000' || (case when p_victim = 'a0000000-0000-0000-0000-00000000000a' then '1' else '2' end) || '.webp'
                     when 'payment-qr' then pg_temp.folder(b, p_victim) || 'ffffffff-0000-4000-8000-00000000000' || (case when p_victim = 'a0000000-0000-0000-0000-00000000000a' then '1' else '2' end) || '.png'
                     else pg_temp.folder(b, p_victim) || 'evil.png' end;
        insert into storage.objects (bucket_id, name) values (b, nm);
        n := 1;
      end if;
      if n > 0 then return next b || ': LEAK (' || p_kind || ' reached ' || n || ')'; end if;
    exception
      when insufficient_privilege then null;
      when others then return next b || ': NOT REFUSED BY RLS (sqlstate ' || sqlstate || ')';
    end;
  end loop;
end $$;
-- The first folder of a venue's objects in a bucket (a booking id for payment-proofs, which are keyed by booking).
create function pg_temp.folder(p_bucket text, p_venue uuid) returns text language sql as $$
  select case p_bucket
    when 'payment-proofs' then case p_venue when 'a0000000-0000-0000-0000-00000000000a'::uuid then 'b1000000-0000-0000-0000-0000000000a2/'
                                            else 'b1000000-0000-0000-0000-0000000000b2/' end
    else p_venue::text || '/' end
$$;

-- ---------------------------------------------------------------- fixtures (as postgres)
-- No automatic fee charges: the billing rows below are written by hand.
update public.platform_pricing set booking_fee = 0;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'iso-player-a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'iso-staff-a@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'iso-platform@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'iso-staff-b@test.local'),
  ('88888888-8888-8888-8888-888888888888', 'iso-player-b@test.local');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'e2e-iso-a', 'active'),
  ('b0000000-0000-0000-0000-00000000000b', 'e2e-iso-b', 'active');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', '77777777-7777-7777-7777-777777777777', 'staff');
insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');
insert into public.venue_settings (venue_id, name) values
  ('a0000000-0000-0000-0000-00000000000a', 'E2E Iso A'),
  ('b0000000-0000-0000-0000-00000000000b', 'E2E Iso B');
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v, d, time '06:00', time '22:00'
from unnest(array['a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b']::uuid[]) v, generate_series(0, 6) d;
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'E2E Iso A1', 'tennis', 500),
  ('c0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-00000000000a', 'E2E Iso A2', 'tennis', 500),
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E Iso B1', 'tennis', 600),
  ('c0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-00000000000b', 'E2E Iso B2', 'tennis', 600);
insert into public.court_rates (court_id, day_of_week, start_hour, price) values
  ('c0000000-0000-0000-0000-0000000000a1', 1, 9, 550),
  ('c0000000-0000-0000-0000-0000000000b1', 1, 9, 650);
insert into public.court_photos (id, court_id, path, sort_order) values
  ('e2000000-0000-0000-0000-00000000a001', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a/courts/c0000000-0000-0000-0000-0000000000a1/00000000-0000-0000-0000-00000000a001.jpg', 0),
  ('e2000000-0000-0000-0000-00000000a002', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a/courts/c0000000-0000-0000-0000-0000000000a1/00000000-0000-0000-0000-00000000a002.jpg', 1),
  ('e2000000-0000-0000-0000-00000000b001', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b/courts/c0000000-0000-0000-0000-0000000000b1/00000000-0000-0000-0000-00000000b001.jpg', 0),
  ('e2000000-0000-0000-0000-00000000b002', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b/courts/c0000000-0000-0000-0000-0000000000b1/00000000-0000-0000-0000-00000000b002.jpg', 1);
insert into public.blackouts (venue_id, starts_at, ends_at, reason) values
  ('a0000000-0000-0000-0000-00000000000a', now() + interval '20 days', now() + interval '20 days 1 hour', 'E2E iso A'),
  ('b0000000-0000-0000-0000-00000000000b', now() + interval '20 days', now() + interval '20 days 1 hour', 'E2E iso B');
insert into public.open_play_sessions (id, venue_id, title, starts_at, ends_at) values
  ('e0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'E2E Iso OP A', now() + interval '12 days', now() + interval '12 days 2 hours'),
  ('e0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E Iso OP B', now() + interval '12 days', now() + interval '12 days 2 hours');
insert into public.open_play_courts (session_id, court_id, during) values
  ('e0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', tstzrange(now() + interval '12 days', now() + interval '12 days 2 hours')),
  ('e0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', tstzrange(now() + interval '12 days', now() + interval '12 days 2 hours'));
insert into public.venue_social_links (venue_id, platform, url) values
  ('a0000000-0000-0000-0000-00000000000a', 'instagram', 'https://instagram.com/e2e-iso-a'),
  ('b0000000-0000-0000-0000-00000000000b', 'instagram', 'https://instagram.com/e2e-iso-b');
insert into public.venue_amenities (venue_id, builtin_key) values
  ('a0000000-0000-0000-0000-00000000000a', 'wifi'),
  ('b0000000-0000-0000-0000-00000000000b', 'wifi');
insert into public.venue_info_sections (id, venue_id, title) values
  ('d0000000-0000-0000-0000-00000000a001', 'a0000000-0000-0000-0000-00000000000a', 'Iso Sa1'),
  ('d0000000-0000-0000-0000-00000000a002', 'a0000000-0000-0000-0000-00000000000a', 'Iso Sa2'),
  ('d0000000-0000-0000-0000-00000000b001', 'b0000000-0000-0000-0000-00000000000b', 'Iso Sb1'),
  ('d0000000-0000-0000-0000-00000000b002', 'b0000000-0000-0000-0000-00000000000b', 'Iso Sb2');
insert into public.venue_payment_accounts (id, venue_id, label, account_name, account_number) values
  ('f0000000-0000-0000-0000-00000000a001', 'a0000000-0000-0000-0000-00000000000a', 'Iso Pa1', 'E2E', '1'),
  ('f0000000-0000-0000-0000-00000000a002', 'a0000000-0000-0000-0000-00000000000a', 'Iso Pa2', 'E2E', '2'),
  ('f0000000-0000-0000-0000-00000000b001', 'b0000000-0000-0000-0000-00000000000b', 'Iso Pb1', 'E2E', '3'),
  ('f0000000-0000-0000-0000-00000000b002', 'b0000000-0000-0000-0000-00000000000b', 'Iso Pb2', 'E2E', '4');

-- Per venue: a confirmed booking ('1': cancel / reschedule target) and one waiting for review ('2'), both a few days out.
create temp table fx as
select ((now() at time zone 'Asia/Manila')::date + 3 + time '10:00') at time zone 'Asia/Manila' as t10,
       ((now() at time zone 'Asia/Manila')::date + 3 + time '13:00') at time zone 'Asia/Manila' as t13,
       ((now() at time zone 'Asia/Manila')::date + 3 + time '16:00') at time zone 'Asia/Manila' as t16,
       (now() at time zone 'Asia/Manila')::date as today;
grant select on fx to anon, authenticated, service_role;
insert into public.bookings (id, reference_code, court_id, user_id, guest_name, during, total_amount, status)
select x.id, x.ref, x.court, x.usr, x.name, tstzrange(x.s, x.s + interval '1 hour'), x.amt, x.st::booking_status
from (select fx.t10, fx.t13 from fx) f, lateral (values
  ('b1000000-0000-0000-0000-0000000000a1'::uuid, 'CB-KKKKA3', 'c0000000-0000-0000-0000-0000000000a1'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Iso PA', 500, 'confirmed', f.t10),
  ('b1000000-0000-0000-0000-0000000000a2'::uuid, 'CB-KKKKA4', 'c0000000-0000-0000-0000-0000000000a2'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'Iso PA', 500, 'payment_submitted', f.t13),
  ('b1000000-0000-0000-0000-0000000000b1'::uuid, 'CB-KKKKB5', 'c0000000-0000-0000-0000-0000000000b1'::uuid, '88888888-8888-8888-8888-888888888888'::uuid, 'Iso PB', 600, 'confirmed', f.t10),
  ('b1000000-0000-0000-0000-0000000000b2'::uuid, 'CB-KKKKB6', 'c0000000-0000-0000-0000-0000000000b2'::uuid, '88888888-8888-8888-8888-888888888888'::uuid, 'Iso PB', 600, 'payment_submitted', f.t13)
) x(id, ref, court, usr, name, amt, st, s);
insert into public.payments (booking_id, method, amount) values
  ('b1000000-0000-0000-0000-0000000000a1', 'cash', 500),
  ('b1000000-0000-0000-0000-0000000000a2', 'gcash', 500),
  ('b1000000-0000-0000-0000-0000000000b1', 'cash', 600),
  ('b1000000-0000-0000-0000-0000000000b2', 'gcash', 600);
insert into public.booking_changes (booking_id, old_court_id, old_during, new_court_id, new_during, reason)
select x.bid, x.cid, tstzrange(fx.t16, fx.t16 + interval '1 hour'), x.cid, tstzrange(fx.t16 + interval '1 day', fx.t16 + interval '1 day 1 hour'), 'e2e'
from fx, (values ('b1000000-0000-0000-0000-0000000000a1'::uuid, 'c0000000-0000-0000-0000-0000000000a1'::uuid),
                 ('b1000000-0000-0000-0000-0000000000b1'::uuid, 'c0000000-0000-0000-0000-0000000000b1'::uuid)) x(bid, cid);
insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos) values
  ('b1000000-0000-0000-0000-0000000000a2', 'cs_e2eiso_a', 'https://example.com/cs', 50000),
  ('b1000000-0000-0000-0000-0000000000b2', 'cs_e2eiso_b', 'https://example.com/cs', 60000);
insert into public.email_outbox (booking_id, kind, to_email, for_guest, data) values
  ('b1000000-0000-0000-0000-0000000000a1', 'booking_created', 'e2e-iso-a@example.com', true, '{}'),
  ('b1000000-0000-0000-0000-0000000000b1', 'booking_created', 'e2e-iso-b@example.com', true, '{}');
insert into public.guest_link_tokens (booking_id, token_hash) values
  ('b1000000-0000-0000-0000-0000000000a1', '\x0011'::bytea),
  ('b1000000-0000-0000-0000-0000000000b1', '\x0022'::bytea);
insert into public.invoices (id, venue_id, billing_month) values
  ('1a000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', date_trunc('month', now())::date),
  ('1a000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', date_trunc('month', now())::date);
insert into public.billing_charges (venue_id, booking_id, kind, amount, billing_month, invoice_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-0000000000a1', 'booking_fee', 10, date_trunc('month', now())::date, '1a000000-0000-0000-0000-0000000000a1'),
  ('b0000000-0000-0000-0000-00000000000b', 'b1000000-0000-0000-0000-0000000000b1', 'booking_fee', 10, date_trunc('month', now())::date, '1a000000-0000-0000-0000-0000000000b1');

-- Objects as the storage service would create them (the service role bypasses RLS)
set local role service_role;
insert into storage.objects (bucket_id, name) values
  ('venue-media', 'a0000000-0000-0000-0000-00000000000a/banner/11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'),
  ('venue-media', 'b0000000-0000-0000-0000-00000000000b/banner/22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'),
  ('payment-qr', 'a0000000-0000-0000-0000-00000000000a/aaaaaaaa-1111-4111-8111-111111111111.png'),
  ('payment-qr', 'b0000000-0000-0000-0000-00000000000b/bbbbbbbb-1111-4111-8111-111111111111.png'),
  ('payment-proofs', 'b1000000-0000-0000-0000-0000000000a2/proof.png'),
  ('payment-proofs', 'b1000000-0000-0000-0000-0000000000b2/proof.png');
reset role;

-- The catalog sweep list, and one real row of each venue per table to copy for the insert probe.
create temp table swp as
select c.table_name::text as tbl
from information_schema.columns c
join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
where c.table_schema = 'public' and c.column_name = 'venue_id' and t.table_type = 'BASE TABLE';
create temp table tpl (tbl text, venue_id uuid, j jsonb, primary key (tbl, venue_id));
do $$
declare t text; v uuid; j jsonb;
begin
  for t in select tbl from pg_temp.swp loop
    foreach v in array array['a0000000-0000-0000-0000-00000000000a'::uuid, 'b0000000-0000-0000-0000-00000000000b'::uuid] loop
      execute format('select to_jsonb(x) from public.%I x where x.venue_id = %L order by to_jsonb(x)::text limit 1', t, v) into j;
      if j is not null then insert into pg_temp.tpl values (t, v, j); end if;
    end loop;
  end loop;
end $$;
grant select on swp, tpl to anon, authenticated, service_role;
grant execute on function pg_temp.nrows(text), pg_temp.as_user(uuid), pg_temp.hint_of(text), pg_temp.probe(text, text, uuid, uuid),
  pg_temp.sweep(text, uuid, uuid), pg_temp.blind(uuid), pg_temp.storage_sweep(text, uuid), pg_temp.folder(text, uuid)
  to anon, authenticated, service_role;

-- State of both venues before anything is attempted.
create temp table snap (k text primary key, v text);
insert into snap values
  ('a', pg_temp.vstate('a0000000-0000-0000-0000-00000000000a')),
  ('b', pg_temp.vstate('b0000000-0000-0000-0000-00000000000b'));
grant select on snap to anon, authenticated, service_role;

-- ---------------------------------------------------------------- the sweep covers what exists, and the fixture is not vacuous
select is_empty(
  $$ select tbl from pg_temp.swp
     where tbl not in (select tbl from pg_temp.tpl where venue_id = 'a0000000-0000-0000-0000-00000000000a')
        or tbl not in (select tbl from pg_temp.tpl where venue_id = 'b0000000-0000-0000-0000-00000000000b') $$,
  'every table with a venue_id has fixture rows in venue A and in venue B (add rows here when a table is added)');
select is((select count(*)::int from pg_temp.swp), 21, 'the catalog sweep finds the 21 venue-owned tables of T12.2 to T12.8');
select is(
  (select count(*)::int from pg_temp.swp where tbl in ('billing_charges', 'invoices', 'venue_members', 'guest_link_tokens', 'bookings', 'payments')),
  6, 'the sweep includes the billing, membership, booking and payment tables');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'RLS is enabled on every public table');

-- ---------------------------------------------------------------- staff A against venue B
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select results_eq($$ select * from pg_temp.blind('a0000000-0000-0000-0000-00000000000a') $$, $$ values ('guest_link_tokens') $$,
  'staff A sees rows of their own venue in every table but the deny-all guest_link_tokens (so the probes below are not vacuous)');
select is_empty($$ select * from pg_temp.sweep('select', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a') $$,
  'staff A reads no private row of venue B in any table (the published catalog of an active venue is public by design)');
select is_empty($$ select * from pg_temp.sweep('update', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a') $$,
  'staff A updates no row of venue B in any table');
select is_empty($$ select * from pg_temp.sweep('move', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a') $$,
  'staff A moves no venue A row into venue B in any table');
select is_empty($$ select * from pg_temp.sweep('delete', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a') $$,
  'staff A deletes no row of venue B in any table');
select is_empty($$ select * from pg_temp.sweep('insert', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a') $$,
  'staff A inserts no row with venue B''s venue_id in any table');
reset role;

-- ---------------------------------------------------------------- staff B against venue A
set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select results_eq($$ select * from pg_temp.blind('b0000000-0000-0000-0000-00000000000b') $$, $$ values ('guest_link_tokens') $$,
  'staff B sees rows of their own venue in every table but the deny-all guest_link_tokens');
select is_empty($$ select * from pg_temp.sweep('select', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'staff B reads no private row of venue A in any table');
select is_empty($$ select * from pg_temp.sweep('update', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'staff B updates no row of venue A in any table');
select is_empty($$ select * from pg_temp.sweep('move', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'staff B moves no venue B row into venue A in any table');
select is_empty($$ select * from pg_temp.sweep('delete', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'staff B deletes no row of venue A in any table');
select is_empty($$ select * from pg_temp.sweep('insert', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'staff B inserts no row with venue A''s venue_id in any table');
reset role;

-- ---------------------------------------------------------------- players and anon against both venues
set local role authenticated;
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is_empty($$ select s from pg_temp.sweep('select', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a') s
                   where s ~ '^(bookings|booking_changes|payments|email_outbox|paymongo_checkouts|guest_link_tokens|billing_charges|invoices|venue_members):' $$,
  'a player of venue A reads no private row of venue B (bookings, payments, outbox, tokens, billing, members)');
select is_empty($$ select * from pg_temp.sweep('update', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'a player updates no row of either venue');
select is_empty($$ select * from pg_temp.sweep('delete', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'a player deletes no row of either venue');
select is_empty($$ select * from pg_temp.sweep('insert', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'a player inserts no row into either venue');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is_empty($$ select * from pg_temp.sweep('update', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'anon updates no row of either venue');
select is_empty($$ select * from pg_temp.sweep('delete', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'anon deletes no row of either venue');
select is_empty($$ select * from pg_temp.sweep('insert', 'a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b') $$,
  'anon inserts no row into either venue');
reset role;

-- ---------------------------------------------------------------- the venue rows, memberships and platform admins
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.venue_members where venue_id = 'b0000000-0000-0000-0000-00000000000b'), 0,
  'staff A sees no member of venue B');
select throws_ok(
  $$ insert into public.venue_members (venue_id, user_id, role) values ('b0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'owner') $$,
  '42501', null, 'staff A cannot add themselves to venue B');
select throws_ok(
  $$ insert into public.platform_admins (user_id) values ('22222222-2222-2222-2222-222222222222') $$,
  '42501', null, 'staff A cannot make themselves a platform admin');
select is((select count(*)::int from public.platform_admins), 0, 'staff A sees no platform admin');
select ok(pg_temp.nrows($$ update public.venues set slug = slug || '-x' where id = 'b0000000-0000-0000-0000-00000000000b' $$) <= 0,
  'staff A cannot rename venue B');
select ok(pg_temp.nrows($$ update public.venues set status = 'suspended' where id = 'b0000000-0000-0000-0000-00000000000b' $$) <= 0,
  'staff A cannot suspend venue B');
select ok(pg_temp.nrows($$ delete from public.venues where id = 'b0000000-0000-0000-0000-00000000000b' $$) <= 0,
  'staff A cannot delete venue B');
reset role;

-- B's data is exactly as it was after the whole sweep (checked as postgres), and so is A's after B's sweep
select is(pg_temp.vstate('b0000000-0000-0000-0000-00000000000b'), (select v from snap where k = 'b'),
  'venue B''s rows in every table are byte for byte unchanged after staff A''s probes');
select is(pg_temp.vstate('a0000000-0000-0000-0000-00000000000a'), (select v from snap where k = 'a'),
  'venue A''s rows in every table are byte for byte unchanged after staff B''s, the player''s and anon''s probes');

-- ---------------------------------------------------------------- RPCs: staff A acting on venue B
-- Every call below is refused (or does nothing) and venue B's state is unchanged afterwards.
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.hint_of($$ select public.cancel_booking(p_booking_id => 'b1000000-0000-0000-0000-0000000000b1', p_reason => 'Not mine') $$), 'not_found',
  'cancel_booking: staff A cannot cancel a booking of venue B');
select is(pg_temp.hint_of($$ select * from public.review_payment('b1000000-0000-0000-0000-0000000000b2', true) $$), 'forbidden',
  'review_payment: staff A cannot approve a payment of venue B');
select is(pg_temp.hint_of($$ select * from public.review_payment('b1000000-0000-0000-0000-0000000000b2', false, 'No') $$), 'forbidden',
  'review_payment: staff A cannot reject a payment of venue B');
select is(pg_temp.hint_of($$ select * from fx, public.create_walk_in('c0000000-0000-0000-0000-0000000000b2', fx.t16, 1, 'E2E Iso Walk') $$), 'forbidden',
  'create_walk_in: staff A cannot record a walk-in on a court of venue B');
select is(pg_temp.hint_of($$ select public.reschedule_booking('b1000000-0000-0000-0000-0000000000b1', fx.t10,
    'c0000000-0000-0000-0000-0000000000b2', fx.t16, 'E2E move') from fx $$), 'forbidden',
  'reschedule_booking: staff A cannot move a booking of venue B (to another court of B)');
select is(pg_temp.hint_of($$ select public.reschedule_booking('b1000000-0000-0000-0000-0000000000a1', fx.t10,
    'c0000000-0000-0000-0000-0000000000b2', fx.t16, 'E2E move') from fx $$), 'invalid_input',
  'reschedule_booking: staff A cannot move their own booking onto a court of venue B (invalid_input, as for every admin)');
select is(pg_temp.hint_of($$ select public.delete_court('c0000000-0000-0000-0000-0000000000b2') $$), 'forbidden',
  'delete_court: staff A cannot delete a court of venue B');
select is(pg_temp.hint_of($$ select public.reorder_court_photos('c0000000-0000-0000-0000-0000000000b1',
    array['e2000000-0000-0000-0000-00000000b002', 'e2000000-0000-0000-0000-00000000b001']::uuid[]) $$), 'forbidden',
  'reorder_court_photos: staff A cannot reorder the photos of a court of venue B');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis',
    array['c0000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-0000000000b1']::uuid[]) $$), 'forbidden',
  'reorder_courts: staff A cannot reorder the courts of venue B');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(
    array['d0000000-0000-0000-0000-00000000b002', 'd0000000-0000-0000-0000-00000000b001']::uuid[], 'b0000000-0000-0000-0000-00000000000b') $$), 'forbidden',
  'reorder_info_sections: staff A naming venue B is forbidden');
select isnt(pg_temp.hint_of($$ select public.reorder_info_sections(
    array['d0000000-0000-0000-0000-00000000b002', 'd0000000-0000-0000-0000-00000000b001']::uuid[], 'a0000000-0000-0000-0000-00000000000a') $$), null,
  'reorder_info_sections: staff A naming venue A with venue B''s section ids is refused');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(
    array['f0000000-0000-0000-0000-00000000b002', 'f0000000-0000-0000-0000-00000000b001']::uuid[], 'b0000000-0000-0000-0000-00000000000b') $$), 'forbidden',
  'reorder_payment_accounts: staff A naming venue B is forbidden');
select isnt(pg_temp.hint_of($$ select public.reorder_payment_accounts(
    array['f0000000-0000-0000-0000-00000000b002', 'f0000000-0000-0000-0000-00000000b001']::uuid[], 'a0000000-0000-0000-0000-00000000000a') $$), null,
  'reorder_payment_accounts: staff A naming venue A with venue B''s account ids is refused');
select is(pg_temp.hint_of($$ select public.set_operating_hours(
    (select jsonb_agg(jsonb_build_object('day_of_week', d, 'open_time', '00:00', 'close_time', '23:00', 'is_closed', false)) from generate_series(0, 6) d),
    'b0000000-0000-0000-0000-00000000000b') $$), 'forbidden',
  'set_operating_hours: staff A cannot change the hours of venue B');
select is(pg_temp.hint_of($$ select public.get_earnings(fx.today - 1, fx.today + 7, 'b0000000-0000-0000-0000-00000000000b') from fx $$), 'forbidden',
  'get_earnings: staff A cannot read the earnings of venue B');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000b2']::uuid[], fx.t16, fx.t16 + interval '1 hour', 'E2E iso') from fx $$), 'forbidden',
  'create_open_play: staff A cannot open play on a court of venue B');
select isnt(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000b2']::uuid[],
    fx.t16, fx.t16 + interval '1 hour', 'E2E iso mix') from fx $$), null,
  'create_open_play: staff A cannot mix a court of venue B into their session');
select is(pg_temp.hint_of($$ select public.update_open_play('e0000000-0000-0000-0000-0000000000b1', array['c0000000-0000-0000-0000-0000000000b1']::uuid[],
    fx.t16, fx.t16 + interval '1 hour', 'E2E hijack') from fx $$), 'forbidden',
  'update_open_play: staff A cannot edit a session of venue B');
select isnt(pg_temp.hint_of($$ select public.update_open_play('e0000000-0000-0000-0000-0000000000a1', array['c0000000-0000-0000-0000-0000000000b1']::uuid[],
    fx.t16, fx.t16 + interval '1 hour', 'E2E move') from fx $$), null,
  'update_open_play: staff A cannot move their own session onto a court of venue B');
select is(pg_temp.hint_of($$ select public.delete_open_play('e0000000-0000-0000-0000-0000000000b1') $$), 'forbidden',
  'delete_open_play: staff A cannot delete a session of venue B');
reset role;
select is(pg_temp.vstate('b0000000-0000-0000-0000-00000000000b'), (select v from snap where k = 'b'),
  'after all those calls venue B''s rows in every table are byte for byte unchanged');

-- ---------------------------------------------------------------- RPCs: the rest are not callable across venues by design
-- Functions executable by clients, each one either probed above or exempt with the reason. A new one fails this test.
select is_empty(
  $$ select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
       and p.proname <> all (array[
         -- probed above with a cross-venue call
         'cancel_booking', 'review_payment', 'create_walk_in', 'reschedule_booking', 'delete_court', 'reorder_court_photos',
         'reorder_courts', 'reorder_info_sections', 'reorder_payment_accounts', 'set_operating_hours', 'get_earnings',
         'create_open_play', 'update_open_play', 'delete_open_play',
         -- public by design: they take a court or a slug and only ever act on that venue's own published data
         'create_booking', 'get_availability',
         -- by secret token or by the caller's own account: no venue id to cross
         'get_guest_booking', 'claim_guest_bookings'
       ]) $$,
  'every RPC a client can execute is probed above or exempt (a new venue-scoped RPC needs a cross-venue test here)');
select is_empty(
  $$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname = any (array['claim_email_outbox', 'claim_guest_link_email', 'finish_email', 'issue_guest_link', 'paymongo_checkout_for',
                                  'proof_target', 'record_payment_proof', 'record_paymongo_checkout', 'record_paymongo_payment'])
       and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')) $$,
  'service-only RPCs (webhook, proof upload, email worker, guest links) are not executable by staff, players or anon');

-- ---------------------------------------------------------------- storage: venue-media, payment-qr, payment-proofs
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is_empty($$ select * from pg_temp.storage_sweep('read', 'b0000000-0000-0000-0000-00000000000b') $$,
  'staff A reads no object of venue B in venue-media, payment-qr or payment-proofs');
select is_empty($$ select * from pg_temp.storage_sweep('update', 'b0000000-0000-0000-0000-00000000000b') $$,
  'staff A renames no object of venue B in any bucket');
select is_empty($$ select * from pg_temp.storage_sweep('insert', 'b0000000-0000-0000-0000-00000000000b') $$,
  'staff A uploads nothing under venue B in any bucket');
select isnt((select count(*)::int from storage.objects where bucket_id in ('venue-media', 'payment-qr', 'payment-proofs')
             and name like any (array['a0000000-%', 'b1000000-0000-0000-0000-0000000000a2/%'])), 0,
  'staff A does see venue A''s own objects (the storage probes are not vacuous)');
reset role;
set local role authenticated;
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is_empty($$ select * from pg_temp.storage_sweep('read', 'a0000000-0000-0000-0000-00000000000a') $$,
  'staff B reads no object of venue A in any bucket');
select is_empty($$ select * from pg_temp.storage_sweep('update', 'a0000000-0000-0000-0000-00000000000a') $$,
  'staff B renames no object of venue A in any bucket');
select is_empty($$ select * from pg_temp.storage_sweep('insert', 'a0000000-0000-0000-0000-00000000000a') $$,
  'staff B uploads nothing under venue A in any bucket');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is_empty($$ select * from pg_temp.storage_sweep('read', 'b0000000-0000-0000-0000-00000000000b') $$, 'anon reads no object of venue B in any bucket');
select is_empty($$ select * from pg_temp.storage_sweep('insert', 'b0000000-0000-0000-0000-00000000000b') $$, 'anon uploads nothing under venue B in any bucket');
reset role;

-- ---------------------------------------------------------------- mutation check: the suite must fail when a policy is removed
-- 1. read policy: the venue-scoped invoices policy is replaced with a permissive one, staff A now reads venue B's invoice.
select is(pg_temp.vhash('invoices', 'b0000000-0000-0000-0000-00000000000b') <> '-', true, 'mutation setup: venue B has an invoice');
drop policy "Venue admins read invoices" on public.invoices;
create policy "mutation read invoices" on public.invoices for select to authenticated using (true);
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.probe('select', 'invoices', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a'),
  'LEAK (select reached 1 row(s))', 'mutation: with the venue-scoped invoices policy replaced, the select probe reports a leak');
select isnt((select count(*)::int from pg_temp.sweep('select', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a')), 0,
  'mutation: the whole select sweep is no longer empty');
reset role;
drop policy "mutation read invoices" on public.invoices;
create policy "Venue admins read invoices" on public.invoices for select to authenticated using (private.is_venue_admin(venue_id));
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.probe('select', 'invoices', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a'),
  'blocked', 'mutation undone: with the venue-scoped policy back, the same probe is blocked again');
reset role;

-- 2. write policies: a permissive policy on blackouts lets staff A update, move, delete and insert across venues.
create policy "mutation write blackouts" on public.blackouts for all to authenticated using (true) with check (true);
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.probe('update', 'blackouts', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a'),
  'LEAK (update reached 1 row(s))', 'mutation: a permissive blackouts policy lets staff A update venue B''s blackout');
select is(pg_temp.probe('move', 'blackouts', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a'),
  'LEAK (move reached 1 row(s))', 'mutation: ... and move venue A''s blackout into venue B');
select is(pg_temp.probe('insert', 'blackouts', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a'),
  'LEAK (insert reached 1 row(s))', 'mutation: ... and insert one with venue B''s venue_id');
select is(pg_temp.probe('delete', 'blackouts', 'b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000a'),
  'LEAK (delete reached 3 row(s))', 'mutation: ... and delete venue B''s blackouts (the fixture one, the copy and the moved one)');
reset role;
drop policy "mutation write blackouts" on public.blackouts;

-- 3. storage: the venue-media read policy is replaced with a bucket-wide one, staff A now sees venue B's media.
drop policy "Venue admins read media" on storage.objects;
create policy "mutation read media" on storage.objects for select to authenticated using (bucket_id = 'venue-media');
set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from pg_temp.storage_sweep('read', 'b0000000-0000-0000-0000-00000000000b')), 1,
  'mutation: with the venue-media read policy replaced, the storage probe reports venue B''s media as readable');
reset role;
drop policy "mutation read media" on storage.objects;

select * from finish();
rollback;
