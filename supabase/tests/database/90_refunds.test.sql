-- T30.5: refund status (TASKS T30.5; SPEC §10 2026-11-20).
--   * public.refund_status enum and public.refunds table (one refund per payment, check constraint tying the fields to the
--     status, cascade from bookings and payments, no cascade from venues), RLS: venue admins read, nobody else
--   * auto-creation by triggers: a booking cancelled with an APPROVED payment creates one 'owed' refund per such payment;
--     a PayMongo payment recorded as rejected ('late' outcome) creates one; nothing else does
--   * private.backfill_refunds(): idempotent, creates the same rows for existing data
--   * public.update_refund(...): settle (full or partial), not_refunded, reopen; hints forbidden, not_found, invalid_amount,
--     missing_method, missing_reason, invalid_input; the "today" check is in the venue's timezone
--   * get_guest_booking gains a last column refund (jsonb), get_own_booking_refund(uuid): never note or recorded_by
--   * get_earnings gains refunded, net; refunds_due counts every owed refund of the venue
--   * cross-venue isolation, deletion preview
-- Calls that touch a not-yet-existing object go through dynamic SQL (the pg_temp helpers below), so a missing object fails
-- its own assertion instead of aborting the transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(157);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
grant execute on function pg_temp.hint_of(text) to anon, authenticated, service_role;

-- First column of the first row as text, '<null>' for null, 'ERR <sqlstate>' on any error.
create function pg_temp.q(p_sql text) returns text language plpgsql as $$
declare r text;
begin
  execute p_sql into r;
  return coalesce(r, '<null>');
exception when others then
  return 'ERR ' || sqlstate;
end $$;
grant execute on function pg_temp.q(text) to anon, authenticated, service_role;

create temp table b (label text primary key, id uuid, ref text, token text, venue uuid);
grant select, insert on b to anon, authenticated, service_role;
create temp table rids (label text, id uuid);
grant select on rids to anon, authenticated, service_role;
create temp table snap (label text, amount numeric);
create temp table bf (seq serial, n integer);

-- Bookings: one court each (clear of the exclusion constraint), play time 2030-03-01 10:00 Manila unless given.
create function pg_temp.mk(
  p_label text, p_venue uuid, p_status public.booking_status, p_user uuid default null,
  p_from timestamptz default '2030-03-01 10:00+08', p_expires timestamptz default now() + interval '1 hour'
) returns void language plpgsql as $$
declare
  v_court uuid := gen_random_uuid();
  v_ref   text := 'CB-' || translate(upper(substr(md5(p_label), 1, 6)), '01', '23');
  v_id    uuid;
begin
  insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values (p_venue, v_court, 'Court ' || p_label, 'tennis', 500);
  insert into public.bookings (reference_code, court_id, user_id, guest_name, during, total_amount, status, source,
                               guest_token_hash, expires_at)
  values (v_ref, v_court, p_user, 'Test ' || p_label, tstzrange(p_from, p_from + interval '1 hour'), 500, p_status, 'online',
          sha256(convert_to('tok-' || p_label, 'UTF8')),
          case when p_status in ('pending_payment', 'payment_submitted', 'expired') then p_expires end)
  returning id into v_id;
  insert into b values (p_label, v_id, v_ref, 'tok-' || p_label, p_venue);
end $$;

-- A payment on the labelled booking (as postgres).
create function pg_temp.pay(
  p_label text, p_method public.payment_method, p_amount numeric, p_status public.payment_review_status default 'approved',
  p_reviewed timestamptz default now(), p_provider text default null, p_note text default null, p_storage text default null
) returns void language sql as $$
  insert into public.payments (booking_id, method, amount, review_status, reviewed_at, review_note, provider_payment_id, storage_path)
  select id, p_method, p_amount, p_status, case when p_status = 'pending' then null else p_reviewed end, p_note, p_provider,
         case when p_storage is null then null else id::text || '/' || p_storage end
  from b where label = p_label
$$;

create function pg_temp.mkvenue(p_id uuid, p_slug text, p_name text, p_tz text, p_staff uuid) returns void language plpgsql as $$
begin
  insert into public.venues (id, slug, status) values (p_id, p_slug, 'active');
  insert into public.venue_members (venue_id, user_id, role) values (p_id, p_staff, 'staff');
  insert into public.venue_settings (venue_id, name, timezone) values (p_id, p_name, p_tz);
  insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
  select p_id, d, time '06:00', time '22:00' from generate_series(0, 6) d;
end $$;

-- Manila wall-clock instant of a date and time.
create function pg_temp.mt(p_day date, p_time time) returns timestamptz language sql as $$
  select (p_day + p_time) at time zone 'Asia/Manila'
$$;

-- The refund of the labelled booking as 'status|amount|method|settled_on|reason|note|recorded_by' ('-' for null, '<none>').
create function pg_temp.rf(p_label text) returns text language plpgsql as $$
declare r text;
begin
  execute format($f$select concat_ws('|', r.status::text, r.amount::text, coalesce(r.method::text, '-'), coalesce(r.settled_on::text, '-'),
      coalesce(r.reason, '-'), coalesce(r.note, '-'), coalesce(r.recorded_by::text, '-'))
    from public.refunds r join b on b.id = r.booking_id where b.label = %L$f$, p_label) into r;
  return coalesce(r, '<none>');
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- How many refunds the labelled booking has.
create function pg_temp.nref(p_label text) returns text language plpgsql as $$
declare r text;
begin
  execute format('select count(*)::text from public.refunds r join b on b.id = r.booking_id where b.label = %L', p_label) into r;
  return r;
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- Copies the ids of the labelled bookings' refunds into rids (idempotent, run as postgres).
create function pg_temp.fill_rids() returns text language plpgsql as $$
begin
  execute 'insert into rids select b.label, r.id from public.refunds r join b on b.id = r.booking_id
           where not exists (select 1 from rids x where x.id = r.id)';
  return 'ok';
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- A refund jsonb as 'status|amount|method|settled_on|reason' ('<null>' for SQL null).
create function pg_temp.norm(j jsonb) returns text language sql immutable as $$
  select case when j is null then '<null>' else concat_ws('|', j ->> 'status', trim_scale((j ->> 'amount')::numeric)::text,
    coalesce(j ->> 'method', '-'), coalesce(j ->> 'settled_on', '-'), coalesce(j ->> 'reason', '-')) end
$$;

-- The refund column of get_guest_booking (via the booking's reference code and token), as norm() or as its sorted keys.
create function pg_temp.gref(p_label text, p_keys boolean default false) returns text language plpgsql as $$
declare r jsonb; v_ref text; v_tok text;
begin
  select b.ref, b.token into v_ref, v_tok from b where b.label = p_label;
  execute 'select g.refund from public.get_guest_booking($1, $2) g' into r using v_ref, v_tok;
  return case when p_keys then coalesce((select string_agg(k, ',' order by k) from jsonb_object_keys(r) k), '<null>') else pg_temp.norm(r) end;
exception when others then
  return 'ERR ' || sqlstate;
end $$;
grant execute on function pg_temp.gref(text, boolean) to anon, authenticated, service_role;

-- The result of get_own_booking_refund for the labelled booking as the current role.
create function pg_temp.oref(p_label text, p_keys boolean default false) returns text language plpgsql as $$
declare r jsonb; v_id uuid;
begin
  select b.id into v_id from b where b.label = p_label;
  execute 'select public.get_own_booking_refund($1)' into r using v_id;
  return case when p_keys then coalesce((select string_agg(k, ',' order by k) from jsonb_object_keys(r) k), '<null>') else pg_temp.norm(r) end;
exception when others then
  return 'ERR ' || sqlstate;
end $$;
grant execute on function pg_temp.oref(text, boolean) to anon, authenticated, service_role;

create function pg_temp.run_backfill() returns text language plpgsql as $$
declare v integer;
begin
  execute 'select private.backfill_refunds()' into v;
  insert into bf (n) values (v);
  return 'ok';
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- ---------------------------------------------------------------------------
-- Schema, grants
-- ---------------------------------------------------------------------------
select is(pg_temp.q($$ select string_agg(enumlabel::text, ',' order by enumsortorder) from pg_enum where enumtypid = 'public.refund_status'::regtype $$),
  'owed,settled,not_refunded', 'refund_status has owed, settled and not_refunded');
select is(pg_temp.q($$ select relrowsecurity::text from pg_class where oid = 'public.refunds'::regclass $$), 'true', 'RLS is enabled on refunds');
select is(pg_temp.q($$ select string_agg(a.attname::text || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attname::text)
    from pg_attribute a where a.attrelid = 'public.refunds'::regclass and a.attnum > 0 and not a.attisdropped $$),
  'amount numeric(10,2), booking_id uuid, created_at timestamp with time zone, id uuid, method payment_method, note text, payment_id uuid, '
  || 'reason text, recorded_by uuid, settled_on date, status refund_status, updated_at timestamp with time zone, venue_id uuid',
  'refunds has exactly the planned columns and types');
select is(pg_temp.q($$ select concat_ws(',', has_table_privilege('anon', 'public.refunds', 'select')::text,
    has_table_privilege('authenticated', 'public.refunds', 'select')::text, has_table_privilege('authenticated', 'public.refunds', 'insert')::text,
    has_table_privilege('authenticated', 'public.refunds', 'update')::text, has_table_privilege('authenticated', 'public.refunds', 'delete')::text) $$),
  'false,true,false,false,false', 'anon has no privileges on refunds; authenticated can only select');
select is(pg_temp.q($$ select concat_ws(',',
    has_function_privilege('anon', 'public.update_refund(uuid, public.refund_status, numeric, public.payment_method, date, text, text)', 'execute')::text,
    has_function_privilege('authenticated', 'public.update_refund(uuid, public.refund_status, numeric, public.payment_method, date, text, text)', 'execute')::text,
    has_function_privilege('service_role', 'public.update_refund(uuid, public.refund_status, numeric, public.payment_method, date, text, text)', 'execute')::text) $$),
  'false,true,true', 'update_refund: authenticated and service_role may execute, anon may not');
select is(pg_temp.q($$ select concat_ws(',',
    has_function_privilege('anon', 'public.get_own_booking_refund(uuid)', 'execute')::text,
    has_function_privilege('authenticated', 'public.get_own_booking_refund(uuid)', 'execute')::text,
    has_function_privilege('service_role', 'public.get_own_booking_refund(uuid)', 'execute')::text) $$),
  'false,true,true', 'get_own_booking_refund: authenticated and service_role may execute, anon may not');
select is(pg_temp.q($$ select pg_get_function_result('private.backfill_refunds()'::regprocedure) $$), 'integer', 'private.backfill_refunds() returns integer');
select is(pg_temp.q($$ select (pg_get_function_result('public.get_guest_booking(text, text)'::regprocedure) like '%waiver_accepted_at timestamp with time zone, refund jsonb, booking_group jsonb)')::text $$),
  'true', 'get_guest_booking gains refund jsonb after waiver_accepted_at (the others are unchanged; T33.1 adds booking_group jsonb after it)');

-- ---------------------------------------------------------------------------
-- Fixture: venue A (Asia/Manila), B (Pacific/Kiritimati, UTC+14), C (Pacific/Pago_Pago, UTC-11), E (Asia/Manila, earnings)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'e2e-rf-p1@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2e-rf-a@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'e2e-rf-p2@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'e2e-rf-platform@example.com'),
  ('77777777-7777-7777-7777-777777777777', 'e2e-rf-b@example.com'),
  ('88888888-8888-8888-8888-888888888888', 'e2e-rf-c@example.com'),
  ('99999999-9999-9999-9999-999999999999', 'e2e-rf-e@example.com');
insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');
select pg_temp.mkvenue('a0000000-0000-0000-0000-0000000090a1', 'e2e-rf-a', 'E2E RF A', 'Asia/Manila', '22222222-2222-2222-2222-222222222222');
select pg_temp.mkvenue('a0000000-0000-0000-0000-0000000090b1', 'e2e-rf-b', 'E2E RF B', 'Pacific/Kiritimati', '77777777-7777-7777-7777-777777777777');
select pg_temp.mkvenue('a0000000-0000-0000-0000-0000000090c1', 'e2e-rf-c', 'E2E RF C', 'Pacific/Pago_Pago', '88888888-8888-8888-8888-888888888888');
select pg_temp.mkvenue('a0000000-0000-0000-0000-0000000090e1', 'e2e-rf-e', 'E2E RF E', 'Asia/Manila', '99999999-9999-9999-9999-999999999999');
update public.venue_settings set cancel_cutoff_hours = 1, walk_ins_enabled = true
  where venue_id in ('a0000000-0000-0000-0000-0000000090a1', 'a0000000-0000-0000-0000-0000000090b1',
                     'a0000000-0000-0000-0000-0000000090c1', 'a0000000-0000-0000-0000-0000000090e1');

-- The venue calendar dates "today" (all four are computed in each venue's own timezone).
create temp table today as
select private.local_today('a0000000-0000-0000-0000-0000000090a1'::uuid) as a,
       private.local_today('a0000000-0000-0000-0000-0000000090b1'::uuid) as b,
       private.local_today('a0000000-0000-0000-0000-0000000090c1'::uuid) as c,
       private.local_today('a0000000-0000-0000-0000-0000000090e1'::uuid) as e;
grant select on today to anon, authenticated, service_role;

-- Venue A: cancel scenarios
select pg_temp.mk('g_tok',   'a0000000-0000-0000-0000-0000000090a1', 'confirmed');
select pg_temp.mk('g_acct',  'a0000000-0000-0000-0000-0000000090a1', 'confirmed', '11111111-1111-1111-1111-111111111111');
select pg_temp.mk('g_staff', 'a0000000-0000-0000-0000-0000000090a1', 'confirmed');
select pg_temp.mk('g_pm',    'a0000000-0000-0000-0000-0000000090a1', 'confirmed');
select pg_temp.mk('g_zero',  'a0000000-0000-0000-0000-0000000090a1', 'confirmed');
select pg_temp.mk('g_pend',  'a0000000-0000-0000-0000-0000000090a1', 'payment_submitted', '11111111-1111-1111-1111-111111111111');
select pg_temp.mk('g_none',  'a0000000-0000-0000-0000-0000000090a1', 'confirmed', '11111111-1111-1111-1111-111111111111');
select pg_temp.mk('g_del',   'a0000000-0000-0000-0000-0000000090a1', 'confirmed', '11111111-1111-1111-1111-111111111111');
select pg_temp.pay('g_tok',   'gcash', 500);
select pg_temp.pay('g_acct',  'cash', 300);
select pg_temp.pay('g_staff', 'maya', 400);
select pg_temp.pay('g_pm',    'paymongo', 500, 'approved', now(), 'pay_g_pm');
select pg_temp.pay('g_zero',  'cash', 0);
select pg_temp.pay('g_pend',  'gcash', 500, 'rejected', now() - interval '1 hour', null, 'Blurry proof');
select pg_temp.pay('g_pend',  'gcash', 500, 'pending', null, null, null, 'proof.png');
select pg_temp.pay('g_del',   'gcash', 500);

-- Venue A: PayMongo scenarios (a checkout session of 50000 centavos each)
select pg_temp.mk('m_ok',        'a0000000-0000-0000-0000-0000000090a1', 'pending_payment');
select pg_temp.mk('m_cancelled', 'a0000000-0000-0000-0000-0000000090a1', 'cancelled');
select pg_temp.mk('m_mismatch',  'a0000000-0000-0000-0000-0000000090a1', 'pending_payment');
select pg_temp.mk('m_started',   'a0000000-0000-0000-0000-0000000090a1', 'expired', null, now() - interval '30 minutes', now() - interval '60 minutes');
select pg_temp.mk('m_revived',   'a0000000-0000-0000-0000-0000000090a1', 'pending_payment', null, '2030-03-01 10:00+08', now() - interval '5 minutes');
select pg_temp.mk('m_proof',     'a0000000-0000-0000-0000-0000000090a1', 'payment_submitted');
select pg_temp.mk('m_review',    'a0000000-0000-0000-0000-0000000090a1', 'payment_submitted');
select pg_temp.mk('m_direct',    'a0000000-0000-0000-0000-0000000090a1', 'expired', null, '2030-03-01 10:00+08', now() - interval '60 minutes');
select pg_temp.pay('m_proof',  'gcash', 500, 'pending', null, null, null, 'proof-m.png');
select pg_temp.pay('m_review', 'gcash', 500, 'pending', null, null, null, 'proof-r.png');
insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos)
select id, 'cs_' || label, 'https://checkout.paymongo.test/' || label, 50000 from b where label like 'm\_%' and label <> 'm_direct' and label <> 'm_review';

-- Venues B and C: bookings with an approved payment, to be cancelled by their staff
select pg_temp.mk('b_1', 'a0000000-0000-0000-0000-0000000090b1', 'confirmed');
select pg_temp.mk('b_2', 'a0000000-0000-0000-0000-0000000090b1', 'confirmed');
select pg_temp.mk('b_3', 'a0000000-0000-0000-0000-0000000090b1', 'confirmed');
select pg_temp.mk('c_1', 'a0000000-0000-0000-0000-0000000090c1', 'confirmed');
select pg_temp.pay('b_1', 'gcash', 800);
select pg_temp.pay('b_2', 'cash', 200);
select pg_temp.pay('b_3', 'cash', 150);
select pg_temp.pay('c_1', 'gcash', 800);

-- ---------------------------------------------------------------------------
-- Auto-creation: cancelling a booking with an approved payment
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(public.cancel_booking(p_reference_code => (select ref from b where label = 'g_tok'), p_token => 'tok-g_tok', p_reason => 'Rain'),
  'cancelled'::public.booking_status, 'a player cancels with the guest token');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(public.cancel_booking((select id from b where label = 'g_acct')), 'cancelled'::public.booking_status, 'a player cancels with their account');
select is(public.cancel_booking((select id from b where label = 'g_pend')), 'cancelled'::public.booking_status, 'a player cancels a booking with a pending proof');
select is(public.cancel_booking((select id from b where label = 'g_none')), 'cancelled'::public.booking_status, 'a player cancels a booking with no payment');
select is(public.cancel_booking((select id from b where label = 'g_del')), 'cancelled'::public.booking_status, 'a player cancels the booking that is deleted later');
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'g_acct')) $$), 'not_cancellable', 'cancelling twice is refused');

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(public.cancel_booking((select id from b where label = 'g_staff'), p_reason => 'Court flooded'), 'cancelled'::public.booking_status, 'staff cancel a booking with a reason');
select is(public.cancel_booking((select id from b where label = 'g_pm'), p_reason => 'Court flooded'), 'cancelled'::public.booking_status, 'staff cancel an online-paid booking');
select is(public.cancel_booking((select id from b where label = 'g_zero'), p_reason => 'Court flooded'), 'cancelled'::public.booking_status, 'staff cancel a booking whose payment was 0');
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is((select count(*)::int from (select public.cancel_booking(id, p_reason => 'Closed') from b where label in ('b_1', 'b_2', 'b_3')) x), 3,
  'staff of venue B cancel their three bookings');
select set_config('request.jwt.claims', '{"sub": "88888888-8888-8888-8888-888888888888", "role": "authenticated"}', true);
select is(public.cancel_booking((select id from b where label = 'c_1'), p_reason => 'Closed'), 'cancelled'::public.booking_status, 'staff of venue C cancel their booking');
reset role;

select is(pg_temp.rf('g_tok'), 'owed|500.00|-|-|-|-|-', 'guest-token cancel: one owed refund of the approved payment (no staff user yet)');
select is(pg_temp.q($$ select (r.venue_id = 'a0000000-0000-0000-0000-0000000090a1' and r.booking_id = b.id and r.payment_id = p.id
      and r.created_at is not null and r.updated_at is not null)::text
    from public.refunds r join b on b.id = r.booking_id join public.payments p on p.id = r.payment_id
    where b.label = 'g_tok' and p.review_status = 'approved' $$),
  'true', 'the refund points at the venue, the booking and the approved payment');
select is(pg_temp.rf('g_acct'), 'owed|300.00|-|-|-|-|-', 'account cancel: one owed refund');
select is(pg_temp.rf('g_staff'), 'owed|400.00|-|-|-|-|-', 'staff cancel: one owed refund');
select is(pg_temp.rf('g_pm'), 'owed|500.00|-|-|-|-|-', 'an approved PayMongo payment is refunded on cancel too');
select is(pg_temp.nref('g_zero'), '0', 'a payment of 0 gets no refund');
select is(pg_temp.nref('g_pend'), '0', 'cancelled while only a pending proof exists (and an earlier rejected one): no refund');
select is(pg_temp.nref('g_none'), '0', 'a booking with no approved payment gets no refund');
select is(pg_temp.nref('g_acct'), '1', 'cancelling twice (the second is refused) leaves one refund');
select is((select string_agg(b.label || ':' || bk.status::text, ',' order by b.label) from public.bookings bk join b on b.id = bk.id where b.label in ('g_none', 'g_pend', 'g_zero')),
  'g_none:cancelled,g_pend:cancelled,g_zero:cancelled', 'those three bookings really are cancelled');
select is(pg_temp.nref('g_del'), '1', 'the booking that is deleted later has its refund');
select is(pg_temp.rf('b_1'), 'owed|800.00|-|-|-|-|-', 'venue B cancel: one owed refund (800)');
select is(pg_temp.rf('c_1'), 'owed|800.00|-|-|-|-|-', 'venue C cancel: one owed refund (800)');

-- ---------------------------------------------------------------------------
-- Auto-creation: PayMongo payments recorded as rejected ('late')
-- ---------------------------------------------------------------------------
set local role service_role;
select is(pg_temp.q($$ select outcome from public.record_paymongo_payment('cs_m_ok', 'pay_m_ok', 'evt_m_ok', 50000, 'PHP', 'gcash') $$),
  'confirmed', 'a payment within the hold confirms the booking');
select is(pg_temp.q($$ select outcome from public.record_paymongo_payment('cs_m_ok', 'pay_m_ok', 'evt_m_ok_retry', 50000, 'PHP', 'gcash') $$),
  'duplicate', 'a replay is a duplicate');
select is(pg_temp.q($$ select outcome from public.record_paymongo_payment('cs_m_cancelled', 'pay_m_cancelled', 'evt_m_cancelled', 50000, 'PHP', 'gcash') $$),
  'late', 'a payment on a cancelled booking is late');
select is(pg_temp.q($$ select outcome from public.record_paymongo_payment('cs_m_cancelled', 'pay_m_cancelled', 'evt_m_cancelled_retry', 50000, 'PHP', 'gcash') $$),
  'duplicate', 'a replay of a late payment is a duplicate');
select is(pg_temp.q($$ select outcome from public.record_paymongo_payment('cs_m_mismatch', 'pay_m_mismatch', 'evt_m_mismatch', 49900, 'PHP', 'gcash') $$),
  'late', 'an amount mismatch is late');
select is(pg_temp.q($$ select outcome from public.record_paymongo_payment('cs_m_started', 'pay_m_started', 'evt_m_started', 50000, 'PHP', 'gcash') $$),
  'late', 'a payment on an expired booking whose time started is late');
select is(pg_temp.q($$ select outcome from public.record_paymongo_payment('cs_m_revived', 'pay_m_revived', 'evt_m_revived', 50000, 'PHP', 'gcash') $$),
  'revived', 'a lapsed hold with a free slot is revived');
select is(pg_temp.q($$ select outcome from public.record_paymongo_payment('cs_m_proof', 'pay_m_proof', 'evt_m_proof', 50000, 'PHP', 'gcash') $$),
  'superseded_proof', 'a payment while a proof waits for review supersedes it');
reset role;

-- A late PayMongo payment recorded directly as rejected (reviewed five days ago), on an expired booking.
select pg_temp.pay('m_direct', 'paymongo', 200, 'rejected', now() - interval '5 days', 'pay_m_direct', 'Payment received after the hold expired.');

select is(pg_temp.nref('m_ok'), '0', 'confirmed outcome: no refund');
select is(pg_temp.rf('m_cancelled'), 'owed|500.00|-|-|-|-|-', 'late (booking cancelled): one owed refund of the payment amount');
select is(pg_temp.nref('m_cancelled'), '1', 'the replay did not add a second refund');
select is(pg_temp.rf('m_mismatch'), 'owed|499.00|-|-|-|-|-', 'late (amount mismatch): one owed refund of what was paid (499)');
select is(pg_temp.rf('m_started'), 'owed|500.00|-|-|-|-|-', 'late (expired, time started): one owed refund');
select is(pg_temp.nref('m_revived'), '0', 'revived outcome: no refund');
select is(pg_temp.nref('m_proof'), '0', 'superseded_proof: the closed proof is not a PayMongo row, no refund');
select is(pg_temp.rf('m_direct'), 'owed|200.00|-|-|-|-|-', 'a PayMongo payment inserted as rejected creates its owed refund');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.review_payment((select id from b where label = 'm_review'), false, 'Blurry') $$), null,
  'staff reject a proof with review_payment');
reset role;
select is(pg_temp.nref('m_review'), '0', 'review_payment rejecting a proof creates no refund');

do $$ begin perform pg_temp.fill_rids(); end $$;

-- ---------------------------------------------------------------------------
-- Constraints (as postgres)
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.refunds set status = 'settled', settled_on = current_date where id = (select id from rids where label = 'g_tok') $$,
  '23514', null, 'settled needs a method');
select throws_ok($$ update public.refunds set status = 'settled', method = 'gcash', settled_on = current_date, reason = 'x' where id = (select id from rids where label = 'g_tok') $$,
  '23514', null, 'settled has no reason');
select throws_ok($$ update public.refunds set method = 'gcash' where id = (select id from rids where label = 'g_tok') $$,
  '23514', null, 'owed has no method');
select throws_ok($$ update public.refunds set status = 'not_refunded', reason = '   ' where id = (select id from rids where label = 'g_tok') $$,
  '23514', null, 'not_refunded needs a non-blank reason');
select throws_ok($$ update public.refunds set status = 'not_refunded', reason = 'Policy', method = 'cash' where id = (select id from rids where label = 'g_tok') $$,
  '23514', null, 'not_refunded has no method');
select throws_ok($$ insert into public.refunds (venue_id, booking_id, payment_id, amount)
    select b.venue, b.id, p.id, 0 from b join public.payments p on p.booking_id = b.id where b.label = 'g_zero' $$,
  '23514', null, 'a refund amount must be above 0');
select throws_ok($$ insert into public.refunds (venue_id, booking_id, payment_id, amount)
    select b.venue, b.id, p.id, 10 from b join public.payments p on p.booking_id = b.id where b.label = 'g_tok' and p.review_status = 'approved' $$,
  '23505', null, 'one refund per payment');
select throws_ok($$ insert into public.refunds (venue_id, booking_id, payment_id, amount)
    select gen_random_uuid(), b.id, p.id, 10 from b join public.payments p on p.booking_id = b.id where b.label = 'g_zero' $$,
  '23503', null, 'a refund belongs to an existing venue');
select is(pg_temp.q($$ select (count(*) = 3 and bool_and(case when confrelid = 'public.venues'::regclass then confdeltype <> 'c' else confdeltype = 'c' end))::text
    from pg_constraint where conrelid = 'public.refunds'::regclass and contype = 'f'
      and confrelid in ('public.venues'::regclass, 'public.bookings'::regclass, 'public.payments'::regclass) $$),
  'true', 'refunds cascade from bookings and payments, not from venues');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select * from public.refunds $$, '42501', null, 'anon cannot read refunds');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.q($$ select count(*)::text from public.refunds $$), '0', 'a player, even the booking''s own, sees no refunds');
select throws_ok($$ update public.refunds set status = 'owed' $$, '42501', null, 'a player cannot update refunds');
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is(pg_temp.q($$ select count(*)::text from public.refunds $$), '0', 'another player sees no refunds');
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.q($$ select count(*)::text from public.refunds $$), '9', 'staff of venue A see exactly venue A''s nine refunds');
select is(pg_temp.q($$ select count(*)::text from public.refunds where venue_id = 'a0000000-0000-0000-0000-0000000090b1' $$), '0',
  'staff of venue A read none of venue B''s refunds');
select throws_ok($$ insert into public.refunds (venue_id, booking_id, payment_id, amount)
    select b.venue, b.id, p.id, 10 from b join public.payments p on p.booking_id = b.id where b.label = 'g_zero' $$,
  '42501', null, 'staff cannot insert refunds');
select throws_ok($$ update public.refunds set status = 'owed' $$, '42501', null, 'staff cannot update refunds directly');
select throws_ok($$ delete from public.refunds $$, '42501', null, 'staff cannot delete refunds');
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is(pg_temp.q($$ select count(*)::text from public.refunds $$), '3', 'staff of venue B see exactly venue B''s three refunds');
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(pg_temp.q($$ select count(*)::text from public.refunds where venue_id in ('a0000000-0000-0000-0000-0000000090a1',
    'a0000000-0000-0000-0000-0000000090b1', 'a0000000-0000-0000-0000-0000000090c1') $$), '13', 'a platform admin sees every venue''s refunds');
select throws_ok($$ delete from public.refunds $$, '42501', null, 'a platform admin cannot delete refunds either');
reset role;

-- ---------------------------------------------------------------------------
-- update_refund: who may call it, and what it refuses
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.update_refund('00000000-0000-0000-0000-000000000000', 'owed') $$, '42501', null, 'anon cannot call update_refund');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_acct'), 'owed') $$), 'forbidden',
  'the booking''s own player cannot update the refund');
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_acct'), 'owed') $$), 'forbidden',
  'another player cannot update the refund');
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_acct'), 'owed') $$), 'forbidden',
  'staff of venue B cannot update venue A''s refund');
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'b_3'), 'owed') $$), 'forbidden',
  'staff of venue A cannot update venue B''s refund');
select is(pg_temp.hint_of($$ select public.update_refund('00000000-0000-0000-0000-000000000000', 'owed') $$), 'not_found',
  'an unknown refund id is not_found for an admin');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), null) $$), 'invalid_input', 'a null status is invalid_input');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'settled', p_settled_on => current_date - 1) $$), 'missing_method',
  'settled without a method is missing_method');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'settled', p_method => 'gcash') $$), 'invalid_input',
  'settled without a date is invalid_input');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'settled', p_method => 'gcash',
    p_settled_on => (select a from today) + 1) $$), 'invalid_input', 'settled tomorrow (venue calendar) is invalid_input');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'settled', p_amount => 0, p_method => 'gcash',
    p_settled_on => (select a from today)) $$), 'invalid_amount', 'an amount of 0 is invalid_amount');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'settled', p_amount => -5, p_method => 'gcash',
    p_settled_on => (select a from today)) $$), 'invalid_amount', 'a negative amount is invalid_amount');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'settled', p_amount => 500.01, p_method => 'gcash',
    p_settled_on => (select a from today)) $$), 'invalid_amount', 'an amount above what was paid is invalid_amount');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'not_refunded') $$), 'missing_reason',
  'not_refunded without a reason is missing_reason');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'not_refunded', p_reason => '   ') $$), 'missing_reason',
  'not_refunded with a blank reason is missing_reason');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'not_refunded', p_reason => repeat('x', 501)) $$), 'invalid_input',
  'a reason over 500 characters is invalid_input');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'settled', p_method => 'gcash',
    p_settled_on => (select a from today), p_note => repeat('x', 501)) $$), 'invalid_input', 'a note over 500 characters is invalid_input');
reset role;
select is(pg_temp.rf('g_tok'), 'owed|500.00|-|-|-|-|-', 'every refused call left the refund untouched');

-- ---------------------------------------------------------------------------
-- update_refund: settle, partial, not refunded, reopen. Players read their refund in between.
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.gref('g_tok'), 'owed|500|-|-|-', 'get_guest_booking: an owed refund (method, date and reason null)');
select is(pg_temp.gref('g_none'), '<null>', 'get_guest_booking: refund is null when the booking has none');
select is(pg_temp.gref('g_pend'), '<null>', 'get_guest_booking: refund is null for a cancelled booking with only a pending proof');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'settled', p_method => 'gcash',
    p_settled_on => (select a from today), p_note => 'Sent via GCash') $$), null, 'staff settle a refund in full');
reset role;
select is(pg_temp.rf('g_tok'), 'settled|500.00|gcash|' || (select a from today) || '|-|Sent via GCash|22222222-2222-2222-2222-222222222222',
  'settled stores status, method, date, note and the staff user');
select is(pg_temp.q($$ select (r.updated_at = now())::text from public.refunds r join b on b.id = r.booking_id where b.label = 'g_tok' $$), 'true',
  'settling sets updated_at');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_acct'), 'settled', p_amount => 250.50, p_method => 'cash',
    p_settled_on => (select a from today) - 3) $$), null, 'staff settle a partial refund (less than was paid)');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_acct'), 'settled', p_method => 'bank_transfer',
    p_settled_on => (select a from today) - 1, p_note => 'staff only memo') $$), null, 'settling again with no amount keeps the current amount');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_staff'), 'not_refunded',
    p_reason => 'Cancelled inside the no-refund window', p_note => 'internal') $$), null, 'staff mark a refund as not refunded');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_pm'), 'settled', p_amount => 500, p_method => 'gcash',
    p_settled_on => (select a from today), p_note => repeat('n', 500)) $$), null, 'the full paid amount and a 500-character note are accepted');
reset role;
select is(pg_temp.rf('g_acct'), 'settled|250.50|bank_transfer|' || ((select a from today) - 1) || '|-|staff only memo|22222222-2222-2222-2222-222222222222',
  'the partial amount stays when settled again');
select is(pg_temp.rf('g_staff'), 'not_refunded|400.00|-|-|Cancelled inside the no-refund window|internal|22222222-2222-2222-2222-222222222222',
  'not_refunded stores the reason and note, no method or date');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.gref('g_tok'), 'settled|500|gcash|' || (select a from today) || '|-', 'get_guest_booking: a settled refund shows method and date');
select is(pg_temp.gref('g_staff'), 'not_refunded|400|-|-|Cancelled inside the no-refund window', 'get_guest_booking: a not-refunded refund shows the reason');
select is(pg_temp.gref('g_acct', true), 'amount,method,reason,settled_on,status', 'get_guest_booking: exactly status, amount, method, settled_on, reason (no note, no staff user)');
select is(pg_temp.gref('g_staff', true), 'amount,method,reason,settled_on,status', 'the same keys for a not-refunded refund (the internal note stays hidden)');

select is(pg_temp.q($$ select count(*)::text from public.get_guest_booking((select ref from b where label = 'g_tok'), 'wrong-token') $$), 'ERR P0001',
  'a wrong token still gets not_found, not the refund');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.oref('g_acct'), 'settled|250.5|bank_transfer|' || ((select a from today) - 1) || '|-', 'get_own_booking_refund: the owner reads their refund');
select is(pg_temp.oref('g_acct', true), 'amount,method,reason,settled_on,status', 'get_own_booking_refund: no note, no staff user');
select is(pg_temp.oref('g_none'), '<null>', 'get_own_booking_refund: null when the booking has no refund');
select is(pg_temp.q($$ select coalesce(public.get_own_booking_refund('00000000-0000-0000-0000-000000000000')::text, '<null>') $$), '<null>',
  'get_own_booking_refund: null for an unknown booking');
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is(pg_temp.oref('g_acct'), '<null>', 'get_own_booking_refund: null for another player');
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.oref('g_acct'), '<null>', 'get_own_booking_refund: null for venue staff too');
select is(pg_temp.q($$ select note from public.refunds r join b on b.id = r.booking_id where b.label = 'g_acct' $$), 'staff only memo', 'staff of the venue read the note');
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.get_own_booking_refund('00000000-0000-0000-0000-000000000000') $$, '42501', null, 'anon cannot call get_own_booking_refund');
reset role;

-- Reopening: a platform admin (not a member) reopens a settled refund; staff reopen a not-refunded one.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_tok'), 'owed') $$), null, 'a platform admin reopens a settled refund');
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'g_staff'), 'owed') $$), null, 'staff reopen a not-refunded refund');
reset role;
select is(pg_temp.rf('g_tok'), 'owed|500.00|-|-|-|Sent via GCash|44444444-4444-4444-4444-444444444444',
  'reopened: method and date cleared, amount and note kept, the reopener recorded');
select is(pg_temp.rf('g_staff'), 'owed|400.00|-|-|-|internal|22222222-2222-2222-2222-222222222222',
  'reopened from not_refunded: the reason is cleared, amount and note kept');

-- ---------------------------------------------------------------------------
-- The "today" check uses the venue's timezone (B is UTC+14, C is UTC-11, so one of them always differs from the UTC date)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'b_1'), 'settled', p_method => 'gcash',
    p_settled_on => (select b from today)) $$), null, 'venue B: its own calendar date today is accepted');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'b_3'), 'settled', p_method => 'gcash',
    p_settled_on => (select b from today) + 1) $$), 'invalid_input', 'venue B: tomorrow on its calendar is refused');
select set_config('request.jwt.claims', '{"sub": "88888888-8888-8888-8888-888888888888", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'c_1'), 'settled', p_method => 'gcash',
    p_settled_on => (select c from today)) $$), null, 'venue C: its own calendar date today is accepted');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'c_1'), 'settled', p_method => 'gcash',
    p_settled_on => (select c from today) + 1) $$), 'invalid_input', 'venue C: tomorrow on its calendar is refused');
reset role;
select is(pg_temp.rf('b_1'), 'settled|800.00|gcash|' || (select b from today) || '|-|-|77777777-7777-7777-7777-777777777777',
  'venue B''s refund is settled on its local date');
select is(pg_temp.rf('b_3'), 'owed|150.00|-|-|-|-|-', 'the refused date left venue B''s other refund owed');

-- Venue B's second refund is settled on venue E's today (inside venue E's earnings period below).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'b_2'), 'settled', p_method => 'cash',
    p_settled_on => (select e from today)) $$), null, 'venue B settles a refund on a date that is today in Manila');
reset role;

-- ---------------------------------------------------------------------------
-- get_earnings: refunded, net, refunds_due (venue E; the period is 14 days: today-13 .. today)
-- ---------------------------------------------------------------------------
select pg_temp.mk('e1', 'a0000000-0000-0000-0000-0000000090e1', 'confirmed');
select pg_temp.mk('e2', 'a0000000-0000-0000-0000-0000000090e1', 'confirmed');
select pg_temp.mk('e3', 'a0000000-0000-0000-0000-0000000090e1', 'confirmed');
select pg_temp.mk('e4', 'a0000000-0000-0000-0000-0000000090e1', 'confirmed');
select pg_temp.mk('e5', 'a0000000-0000-0000-0000-0000000090e1', 'confirmed');
select pg_temp.mk('e6', 'a0000000-0000-0000-0000-0000000090e1', 'confirmed');
select pg_temp.mk('e7', 'a0000000-0000-0000-0000-0000000090e1', 'confirmed');
select pg_temp.mk('e8', 'a0000000-0000-0000-0000-0000000090e1', 'expired');
select pg_temp.mk('e9', 'a0000000-0000-0000-0000-0000000090e1', 'confirmed');
-- Collected: e1 at 00:30 on the first day and e3 at 23:30 the day before are 16:30 and 15:30 UTC of the previous dates.
select pg_temp.pay('e1', 'gcash', 1000, 'approved', pg_temp.mt((select e from today) - 13, '00:30'));
select pg_temp.pay('e2', 'cash',    600, 'approved', pg_temp.mt((select e from today) - 5,  '12:00'));
select pg_temp.pay('e3', 'gcash',   400, 'approved', pg_temp.mt((select e from today) - 14, '23:30'));
select pg_temp.pay('e4', 'maya',    200, 'approved', pg_temp.mt((select e from today) - 27, '00:30'));
select pg_temp.pay('e5', 'cash',    700, 'approved', pg_temp.mt((select e from today) - 28, '23:59'));
select pg_temp.pay('e6', 'cash',    300, 'approved', pg_temp.mt((select e from today) - 60, '12:00'));
select pg_temp.pay('e7', 'cash',    150, 'approved', pg_temp.mt((select e from today) - 40, '12:00'));
select pg_temp.pay('e8', 'paymongo', 250, 'rejected', pg_temp.mt((select e from today) - 100, '12:00'), 'pay_e8', 'Late payment.');
select pg_temp.pay('e9', 'cash',     90, 'approved', pg_temp.mt((select e from today) - 2,  '12:00'));
update public.bookings set status = 'cancelled', cancelled_at = now() where id in (select id from b where label in ('e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7'));
do $$ begin perform pg_temp.fill_rids(); end $$;

select is((select string_agg(label || ':' || pg_temp.nref(label), ',' order by label) from b where label like 'e%'),
  'e1:1,e2:1,e3:1,e4:1,e5:1,e6:1,e7:1,e8:1,e9:0', 'venue E: a refund per cancelled paid booking and per late PayMongo payment, none for e9');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99999999-9999-9999-9999-999999999999", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'e1'), 'settled', p_amount => 250, p_method => 'gcash', p_settled_on => (select e from today)) $$), null, 'e1 settled 250 today');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'e2'), 'settled', p_method => 'cash', p_settled_on => (select e from today) - 13) $$), null, 'e2 settled 600 on the first day');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'e3'), 'settled', p_amount => 100, p_method => 'gcash', p_settled_on => (select e from today) - 14) $$), null, 'e3 settled 100 the day before the period');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'e4'), 'settled', p_amount => 50, p_method => 'cash', p_settled_on => (select e from today) - 27) $$), null, 'e4 settled 50 on the first day of the previous period');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'e5'), 'settled', p_method => 'gcash', p_settled_on => (select e from today) - 28) $$), null, 'e5 settled 700 before both periods');
select is(pg_temp.hint_of($$ select public.update_refund((select id from rids where label = 'e7'), 'not_refunded', p_reason => 'Within the no-refund window') $$), null, 'e7 marked not refunded');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "99999999-9999-9999-9999-999999999999", "role": "authenticated"}', true);
create temp table e as select public.get_earnings((select e from today) - 13, (select e from today)) as j;
grant select on e to authenticated;
select is((select (j -> 'collected' ->> 'total') || '/' || (j -> 'collected' ->> 'count') from e), '1690.00/3', 'collected is unchanged: 1690 over three payments');
select is((select jsonb_build_object('total', j -> 'refunded' -> 'total', 'count', j -> 'refunded' -> 'count') from e),
  '{"total": 850, "count": 2}'::jsonb, 'refunded: settled refunds by settled_on inside the period (today and the first day), not the others');
select is((select jsonb_agg(m order by m ->> 'method') from e, jsonb_array_elements(e.j -> 'refunded' -> 'by_method') m),
  '[{"count": 1, "amount": 600, "method": "cash"}, {"count": 1, "amount": 250, "method": "gcash"}]'::jsonb, 'refunded per method (method, amount, count)');
select is((select jsonb_build_object('from', j -> 'refunded' -> 'previous' -> 'from', 'to', j -> 'refunded' -> 'previous' -> 'to',
    'total', j -> 'refunded' -> 'previous' -> 'total', 'count', j -> 'refunded' -> 'previous' -> 'count') from e),
  jsonb_build_object('from', (select e from today) - 27, 'to', (select e from today) - 14, 'total', 150, 'count', 2),
  'refunded.previous: the 14 days before, with the day before the period and the first day of that period');
select is((select jsonb_agg(m order by m ->> 'method') from e, jsonb_array_elements(e.j -> 'refunded' -> 'previous' -> 'by_method') m),
  '[{"count": 1, "amount": 50, "method": "cash"}, {"count": 1, "amount": 100, "method": "gcash"}]'::jsonb, 'refunded.previous per method');
select is((select string_agg(k, ',' order by k) from e, jsonb_object_keys(e.j -> 'refunded') k), 'by_method,count,previous,total', 'refunded has exactly these keys');
select is((select j -> 'net' from e), '{"total": 840, "previous": {"total": 450}}'::jsonb, 'net: collected minus refunded, for the period (1690 - 850) and the one before (600 - 150)');
select is((select j -> 'refunds_due' from e), '{"count": 2, "total": 550}'::jsonb,
  'refunds_due: every owed refund of the venue (an old cancelled booking and a late PayMongo payment), not tied to the period');
select is((select j -> 'split' ->> 'total_revenue' from e)::numeric, 1690::numeric, 'split is unchanged');
select is((select j -> 'rebooked' from e), '{"count": 0}'::jsonb, 'rebooked is unchanged');
reset role;

-- A player and a stranger are still refused
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.get_earnings((select e from today) - 13, (select e from today), 'a0000000-0000-0000-0000-0000000090e1') $$), 'forbidden', 'a player is refused get_earnings');
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.get_earnings((select a from today) - 6, (select a from today), 'a0000000-0000-0000-0000-0000000090b1') $$), 'forbidden',
  'staff of venue A are refused venue B''s earnings');
select is(pg_temp.q($$ select (public.get_earnings((select a from today) - 6, (select a from today)) -> 'refunds_due' = '{"count": 7, "total": 3099}'::jsonb)::text $$), 'true',
  'venue A''s refunds_due counts only venue A''s seven owed refunds (venue B''s owed and settled refunds are not in it)');
reset role;

-- ---------------------------------------------------------------------------
-- Deletion: a venue with a refund is not deletable
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(pg_temp.q($$ select (public.venue_deletion_preview('a0000000-0000-0000-0000-0000000090e1') ->> 'deletable') $$), 'false', 'a venue with refunds is not deletable');
select is(pg_temp.q($$ select (public.venue_deletion_preview('a0000000-0000-0000-0000-0000000090e1') -> 'blockers' @> '["bookings", "payments"]'::jsonb)::text $$), 'true',
  'the preview lists the bookings and payments blockers');
reset role;

-- ---------------------------------------------------------------------------
-- Deleting a booking removes its refunds
-- ---------------------------------------------------------------------------
select pg_temp.q($$ delete from public.bookings where id = (select id from b where label = 'g_del') returning 1 $$);
select is(pg_temp.nref('g_del'), '0', 'deleting a booking (and so its payment) cascades to its refund');

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- The labelled refunds as they are now (20 of them: A 8, B 3, C 1, E 8).
select pg_temp.q($$ insert into snap select b.label, r.amount from public.refunds r join b on b.id = r.booking_id returning 1 $$);
select is((select count(*)::text from snap), '20', 'twenty labelled refunds exist before the backfill');

-- Existing cases with no refund yet: a booking that was already cancelled with an approved payment (cancelled 3 days
-- ago), an approved payment on a confirmed booking, a rejected proof on a confirmed booking.
select pg_temp.mk('bf_direct',    'a0000000-0000-0000-0000-0000000090a1', 'cancelled');
select pg_temp.mk('bf_confirmed', 'a0000000-0000-0000-0000-0000000090a1', 'confirmed');
select pg_temp.mk('bf_rejected',  'a0000000-0000-0000-0000-0000000090a1', 'confirmed');
update public.bookings set cancelled_at = now() - interval '3 days' where id = (select id from b where label = 'bf_direct');
select pg_temp.pay('bf_direct',    'cash', 120, 'approved', now() - interval '4 days');
select pg_temp.pay('bf_confirmed', 'gcash', 77);
select pg_temp.pay('bf_rejected',  'gcash', 66, 'rejected', now(), null, 'Wrong amount.');

select pg_temp.q($$ delete from public.refunds returning 1 $$);
select is(pg_temp.q($$ select count(*)::text from public.refunds $$), '0', 'every refund row was removed before the backfill');
do $$ begin perform pg_temp.run_backfill(); end $$;
select is(pg_temp.q($$ select ((select n from bf order by seq limit 1) = count(*) and count(*) > 0)::text from public.refunds $$), 'true',
  'the backfill returns the number of rows it inserted');
select is(pg_temp.q($$ select ((select count(*) from snap) = count(*))::text
    from snap s join b on b.label = s.label join public.refunds r on r.booking_id = b.id and r.status = 'owed'
    join public.payments p on p.id = r.payment_id and p.amount = r.amount $$), 'true',
  'every refund comes back as owed with the amount that was paid, even the settled, partial and not-refunded ones');
select is(pg_temp.rf('bf_direct'), 'owed|120.00|-|-|-|-|-', 'an approved payment on a booking that was already cancelled gets an owed refund');
select is(pg_temp.q($$ select (count(*) = 2 and bool_and(r.created_at = bk.cancelled_at))::text from public.refunds r
    join public.bookings bk on bk.id = r.booking_id join b on b.id = bk.id where b.label in ('bf_direct', 'g_tok') $$), 'true',
  'a backfilled cancellation refund is created at the booking''s cancelled_at');
select is(pg_temp.q($$ select (count(*) = 2 and bool_and(r.created_at = p.reviewed_at))::text from public.refunds r
    join public.payments p on p.id = r.payment_id join b on b.id = p.booking_id where b.label in ('m_direct', 'm_cancelled') $$), 'true',
  'a backfilled PayMongo refund is created at the payment''s reviewed_at');
select is(pg_temp.q($$ select count(*)::text from public.refunds r join b on b.id = r.booking_id
    where b.label in ('bf_confirmed', 'bf_rejected', 'm_ok', 'm_revived', 'g_zero', 'g_pend', 'g_none') $$), '0',
  'no refund for approved payments on confirmed bookings, a rejected proof, a payment of 0 or a pending proof');
do $$ begin perform pg_temp.run_backfill(); end $$;
select is(pg_temp.q($$ select n::text from bf order by seq desc limit 1 $$), '0', 'a second backfill inserts nothing');

select * from finish();
rollback;
