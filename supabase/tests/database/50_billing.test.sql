-- T12.8: billing data (docs/SAAS-PLAN.md §5 "Billing rules" and its Data section).
--   * bookings.confirmed_at: set the first time a booking is confirmed, never changes afterwards
--   * public.billing_charges: the ledger, written only by the bill_booking trigger, never edited or deleted
--   * public.invoices: one per venue and month, no stored total
-- One test group per row of the SAAS-PLAN §5 table:
--   online booking paid through PayMongo, online booking paid by manual proof, confirmed then cancelled by the
--   player (non-refundable fee), confirmed then cancelled by the venue (negative adjustment), rescheduled or
--   `moved` continuation, proof rejected / hold expired / never confirmed, late PayMongo payment for an expired
--   hold, walk-ins / open play / blackouts.
-- Fixture: Claudex Courts (Asia/Manila, staff A) and a second active venue B (Pacific/Honolulu, staff B). The
-- global platform fee is 10 unless a case says otherwise.
begin;
create extension if not exists pgtap with schema extensions;
select plan(128);

-- ---------------------------------------------------------------- helpers
-- Everything that touches the new tables goes through these, so a missing table fails one test and not the file.
create function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare r text;
begin
  execute p_sql into r;
  return coalesce(r, '<null>');
exception when others then
  return 'ERR ' || sqlstate;
end $$;

create function pg_temp.run(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- Row count of a query as text, 'denied' when the role has no privilege (42501), 'ERR <state>' otherwise.
create function pg_temp.rows(p_sql text) returns text language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into n;
  return n::text;
exception
  when insufficient_privilege then return 'denied';
  when others then return 'ERR ' || sqlstate;
end $$;

-- Charges of a booking (by label), optionally of one kind.
create function pg_temp.charges(p_label text, p_kind text default null) returns text language plpgsql as $$
declare r text;
begin
  execute format(
    'select count(*)::text from public.billing_charges c join b on b.id = c.booking_id
     where b.label = %L and (%L::text is null or c.kind::text = %L::text)', p_label, p_kind, p_kind) into r;
  return r;
exception when others then
  return 'ERR ' || sqlstate;
end $$;

-- 'null' or 'set' for bookings.confirmed_at of a booking (by label).
create function pg_temp.conf(p_label text) returns text language plpgsql as $$
declare r text;
begin
  execute format(
    'select case when bk.confirmed_at is null then ''null'' else ''set'' end
     from public.bookings bk join b on b.id = bk.id where b.label = %L', p_label) into r;
  return r;
exception when others then
  return 'ERR ' || sqlstate;
end $$;

create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "anon"}', true)
$$;
create function pg_temp.as_player() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true)
$$;
create function pg_temp.as_staff_a() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true)
$$;
create function pg_temp.as_staff_b() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true)
$$;
create function pg_temp.as_platform() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true)
$$;

-- A PayMongo checkout for a booking at its amount due (run as postgres), and the webhook payment (run as service_role).
create function pg_temp.mk_checkout(p_label text) returns void language plpgsql as $$
begin
  insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos)
  select bk.id, 'cs_bill_' || p_label, 'https://checkout.paymongo.test/bill_' || p_label, (bk.amount_due * 100)::bigint
  from public.bookings bk join b on b.id = bk.id where b.label = p_label;
  update b set cents = (select (bk.amount_due * 100)::bigint from public.bookings bk where bk.id = b.id) where b.label = p_label;
end $$;
create function pg_temp.pay(p_label text) returns text language plpgsql as $$
declare o text;
begin
  select r.outcome into o from b, public.record_paymongo_payment(
    'cs_bill_' || b.label, 'pay_bill_' || b.label, 'evt_bill_' || b.label, b.cents, 'PHP', 'gcash') r
  where b.label = p_label;
  return o;
end $$;

grant execute on function pg_temp.val(text), pg_temp.run(text), pg_temp.rows(text), pg_temp.charges(text, text),
  pg_temp.conf(text), pg_temp.as_anon(), pg_temp.as_player(), pg_temp.as_staff_a(), pg_temp.as_staff_b(),
  pg_temp.as_platform(), pg_temp.mk_checkout(text), pg_temp.pay(text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------- the backfill (before any fixture exists)
-- The migration backfilled confirmed_at from the approved payment (and created_at for confirmed or cancelled
-- walk-ins and `moved` parts with no payment), so no confirmed booking is left without it.
select is(pg_temp.val($$ select count(*) from public.bookings where status = 'confirmed' and confirmed_at is null $$), '0',
  'backfill: every existing confirmed booking has confirmed_at');
select is(pg_temp.val($$ select count(*) from public.bookings bk
  where bk.confirmed_at is null and exists (select 1 from public.payments p where p.booking_id = bk.id and p.review_status = 'approved') $$), '0',
  'backfill: every existing booking with an approved payment has confirmed_at');
select is(pg_temp.val($$ select count(*) from public.bookings bk
  where bk.confirmed_at is null and bk.source in ('walk_in', 'moved') and bk.status in ('confirmed', 'cancelled') $$), '0',
  'backfill: confirmed or cancelled walk-ins and moved parts have confirmed_at');

-- ---------------------------------------------------------------- shape
select col_type_is('public', 'bookings', 'confirmed_at', 'timestamp with time zone', 'bookings.confirmed_at is timestamptz');
select col_is_null('public', 'bookings', 'confirmed_at', 'bookings.confirmed_at is nullable (unconfirmed bookings have none)');
select has_table('public', 'invoices', 'invoices exists');
select has_table('public', 'billing_charges', 'billing_charges exists');
select columns_are('public', 'invoices',
  array['id', 'venue_id', 'billing_month', 'status', 'sent_at', 'paid_at', 'paid_method', 'paid_reference', 'created_at'],
  'invoices has no stored total: the lines are its charges');
select columns_are('public', 'billing_charges',
  array['id', 'venue_id', 'booking_id', 'kind', 'amount', 'charged_at', 'billing_month', 'invoice_id'],
  'billing_charges columns');
select col_type_is('public', 'billing_charges', 'amount', 'numeric(10,2)', 'billing_charges.amount is numeric(10,2)');
select has_function('private', 'bill_booking', 'private.bill_booking exists');
select is(pg_temp.val($$ select has_function_privilege('anon', 'private.bill_booking()', 'execute')
                           or has_function_privilege('authenticated', 'private.bill_booking()', 'execute') $$), 'false',
  'clients cannot execute private.bill_booking');
select is(pg_temp.val($$ select relrowsecurity from pg_class where oid = 'public.billing_charges'::regclass $$), 'true',
  'RLS is on for billing_charges');
select is(pg_temp.val($$ select relrowsecurity from pg_class where oid = 'public.invoices'::regclass $$), 'true',
  'RLS is on for invoices');
select is(pg_temp.val($$ select has_table_privilege('anon', 'public.billing_charges', 'insert')
                           or has_table_privilege('anon', 'public.billing_charges', 'update')
                           or has_table_privilege('anon', 'public.billing_charges', 'delete')
                           or has_table_privilege('authenticated', 'public.billing_charges', 'insert')
                           or has_table_privilege('authenticated', 'public.billing_charges', 'update')
                           or has_table_privilege('authenticated', 'public.billing_charges', 'delete') $$), 'false',
  'no client has insert, update or delete on billing_charges');
select is(pg_temp.val($$ select has_table_privilege('anon', 'public.invoices', 'insert')
                           or has_table_privilege('anon', 'public.invoices', 'update')
                           or has_table_privilege('anon', 'public.invoices', 'delete')
                           or has_table_privilege('authenticated', 'public.invoices', 'insert')
                           or has_table_privilege('authenticated', 'public.invoices', 'update')
                           or has_table_privilege('authenticated', 'public.invoices', 'delete') $$), 'false',
  'no client has insert, update or delete on invoices');

-- ---------------------------------------------------------------- fixtures
update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.venue_settings set max_rejections = 1, waiver_text = '' where venue_id = (select id from public.venues where slug = 'claudex-courts');
update public.platform_pricing set booking_fee = 10;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player-bill@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'staff-a-bill@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'staff-b-bill@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'platform-bill@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.venue_members (venue_id, user_id, role)
select id, '22222222-2222-2222-2222-222222222222', 'staff' from public.venues where slug = 'claudex-courts';
insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');

insert into public.venues (id, slug, status) values ('b1110000-0000-0000-0000-00000000000b', 'e2e-bill-b', 'active');
insert into public.venue_members (venue_id, user_id, role) values
  ('b1110000-0000-0000-0000-00000000000b', '77777777-7777-7777-7777-777777777777', 'staff');
insert into public.venue_settings (venue_id, name, timezone, waiver_text) values
  ('b1110000-0000-0000-0000-00000000000b', 'E2E Bill B', 'Pacific/Honolulu', '');
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select 'b1110000-0000-0000-0000-00000000000b', d, time '06:00', time '22:00' from generate_series(0, 6) d;

insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-00000000b0a1', (select id from public.venues where slug = 'claudex-courts'), 'Bill A1', 'tennis', 500),
  ('c0000000-0000-0000-0000-00000000b0a2', (select id from public.venues where slug = 'claudex-courts'), 'Bill A2', 'tennis', 500),
  ('c0000000-0000-0000-0000-00000000b0b1', 'b1110000-0000-0000-0000-00000000000b', 'Bill B1', 'tennis', 600);

create temp table v as select (select id from public.venues where slug = 'claudex-courts') as a,
                              'b1110000-0000-0000-0000-00000000000b'::uuid as b;
-- t0 is 07:00 in Manila three days out: slot k is t0 + k hours. tb is 10:00 in Honolulu three days out.
create temp table fx as
select (private.local_today() + 3 + time '07:00') at time zone 'Asia/Manila' as t0,
       ((now() at time zone 'Pacific/Honolulu')::date + 3 + time '10:00') at time zone 'Pacific/Honolulu' as tb;
create temp table b (label text primary key, id uuid, ref text, token text, cents bigint);
create temp table inv (label text primary key, id uuid);
create temp table kv (k text primary key, v text);
grant select on v, fx, inv to anon, authenticated, service_role;
grant select, insert, update on b to anon, authenticated, service_role;

-- ---------------------------------------------------------------- online bookings, all pending
set local role anon;
select pg_temp.as_anon();
insert into b (label, id, ref, token)
select 'pm', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-00000000b0a1', fx.t0, 1, 'Gina Guest', 'gina-bill@example.com', '0917 222 2222') r;
insert into b (label, id, ref, token)
select 'res', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-00000000b0a1', fx.t0 + interval '9 hours', 2, 'Rhea Guest', 'rhea-bill@example.com', '0917 222 3333') r;
insert into b (label, id, ref, token)
select 'bb', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-00000000b0b1', fx.tb, 1, 'Bea Guest', 'bea-bill@example.com', '0917 333 3333') r;
reset role;

set local role authenticated;
select pg_temp.as_player();
insert into b (label, id, ref, token)
select x.label, r.id, r.reference_code, r.guest_token
from fx, (values ('proof', 1), ('sub', 2), ('rej', 3), ('exp', 4), ('late', 5), ('rev', 6), ('unconf', 8), ('snap', 12)) x(label, k),
     lateral public.create_booking('c0000000-0000-0000-0000-00000000b0a1', fx.t0 + x.k * interval '1 hour', 1) r
order by x.k;
reset role;

-- ---------------------------------------------------------------- pending bookings are not billable
select is(pg_temp.conf('pm'), 'null', 'a pending online booking has no confirmed_at');
select is(pg_temp.val($$ select count(*) from public.billing_charges c join b on b.id = c.booking_id $$), '0',
  'creating online bookings writes no charge');
select results_eq($$ select booking_fee from public.bookings where id = (select id from b where label = 'pm') $$,
  $$ values (10.00::numeric) $$, 'the fee is snapshotted on the booking at 10');

-- Manual proofs: submitting is not confirming.
set local role service_role;
select public.record_payment_proof(id, id::text || '/1.png', 'gcash', 510)
from b where label in ('proof', 'sub', 'rej', 'unconf', 'snap');
reset role;
select is(pg_temp.val($$ select count(*) from public.bookings bk join b on b.id = bk.id where bk.status = 'payment_submitted' $$), '5',
  'five bookings are waiting for review');
select is(pg_temp.val($$ select count(*) from public.billing_charges c join b on b.id = c.booking_id $$), '0',
  'submitting a manual proof writes no charge');

-- ---------------------------------------------------------------- row: online booking paid through PayMongo
select pg_temp.mk_checkout('pm');
set local role service_role;
select is(pg_temp.pay('pm'), 'confirmed', 'the PayMongo webhook confirms the guest booking');
reset role;
select is(pg_temp.conf('pm'), 'set', 'PayMongo: confirming sets confirmed_at');
select is(
  pg_temp.val($$ select concat_ws('|', c.kind::text, c.amount, c.venue_id = (select a from v), c.invoice_id is null, c.charged_at is not null,
            extract(day from c.billing_month)::int = 1,
            c.billing_month = date_trunc('month', c.charged_at at time zone 'Asia/Manila')::date)
     from public.billing_charges c join b on b.id = c.booking_id where b.label = 'pm' $$),
  'booking_fee|10.00|t|t|t|t|t',
  'PayMongo: confirming writes one 10.00 booking_fee charge for the venue, uninvoiced, in the venue-timezone month');
select is(pg_temp.charges('pm'), '1', 'PayMongo: exactly one charge');

-- ---------------------------------------------------------------- row: online booking paid by manual proof
set local role authenticated;
select pg_temp.as_staff_a();
select is((select r.status::text from b, public.review_payment(b.id, true) r where b.label = 'proof'), 'confirmed',
  'staff approve the manual proof');
reset role;
select is(pg_temp.conf('proof'), 'set', 'manual proof: approving sets confirmed_at');
select is(
  pg_temp.val($$ select concat_ws('|', c.kind::text, c.amount, c.venue_id = (select a from v))
     from public.billing_charges c join b on b.id = c.booking_id where b.label = 'proof' $$),
  'booking_fee|10.00|t',
  'manual proof: approving writes one 10.00 booking_fee charge');

-- A PayMongo payment that supersedes a waiting proof still confirms once, so the fee is charged once.
select pg_temp.mk_checkout('sub');
set local role service_role;
select is(pg_temp.pay('sub'), 'superseded_proof', 'a PayMongo payment while a proof waits confirms the booking');
reset role;
select is(pg_temp.charges('sub', 'booking_fee'), '1', 'proof then PayMongo: the fee is charged once');

-- The fee on the charge is the one snapshotted on the booking, not today's fee.
set local role service_role;
update public.platform_pricing set booking_fee = 25;
reset role;
set local role authenticated;
select pg_temp.as_staff_a();
select lives_ok($$ select * from public.review_payment((select id from b where label = 'snap'), true) $$,
  'staff approve a booking made before the platform fee changed to 25');
reset role;
select is(
  pg_temp.val($$ select concat_ws('|', c.amount, bk.booking_fee) from public.billing_charges c join public.bookings bk on bk.id = c.booking_id
     join b on b.id = bk.id where b.label = 'snap' $$),
  '10.00|10.00',
  'the charge is the booking''s snapshotted fee (10), not the fee at confirmation (25)');
update public.platform_pricing set booking_fee = 10;

-- ---------------------------------------------------------------- row: proof rejected, hold expired, never confirmed
set local role authenticated;
select pg_temp.as_staff_a();
select is((select r.status::text from b, public.review_payment(b.id, false, 'Blurry proof') r where b.label = 'rej'), 'rejected',
  'staff reject the proof and the booking closes (max rejections is 1)');
reset role;
select is(pg_temp.conf('rej'), 'null', 'a rejected proof leaves confirmed_at empty');
select is(pg_temp.charges('rej'), '0', 'a rejected proof writes no charge');

update public.bookings set expires_at = now() - interval '5 minutes'
where id in (select id from b where label in ('exp', 'late', 'rev'));
select private.expire_holds();
select is(pg_temp.val($$ select count(*) from public.bookings bk join b on b.id = bk.id
  where b.label in ('exp', 'late', 'rev') and bk.status = 'expired' $$), '3', 'the sweep expired three holds');
select is(pg_temp.conf('exp'), 'null', 'an expired hold has no confirmed_at');
select is(pg_temp.charges('exp'), '0', 'an expired hold writes no charge');

-- ---------------------------------------------------------------- row: late PayMongo payment for an expired hold
insert into public.blackouts (court_id, starts_at, ends_at, reason)
select 'c0000000-0000-0000-0000-00000000b0a1', fx.t0 + interval '5 hours', fx.t0 + interval '6 hours', 'E2E bill blackout' from fx;
select pg_temp.mk_checkout('late');
set local role service_role;
select is(pg_temp.pay('late'), 'late', 'a payment for an expired hold whose slot is blacked out is late (refund due)');
reset role;
select is(pg_temp.charges('late'), '0', 'late payment for an expired hold: no charge');
select is(pg_temp.conf('late'), 'null', 'late payment for an expired hold: confirmed_at stays empty');

-- A lapsed hold whose slot is still free is revived by the payment: that is a confirmation, billed once.
select pg_temp.mk_checkout('rev');
set local role service_role;
select is(pg_temp.pay('rev'), 'revived', 'a payment for an expired hold with a free slot revives the booking');
reset role;
select is(pg_temp.conf('rev'), 'set', 'a revived booking has confirmed_at');
select is(pg_temp.charges('rev', 'booking_fee'), '1', 'a revived booking is charged the fee once');

-- ---------------------------------------------------------------- row: walk-ins, open play, blackouts
insert into kv select 'before', pg_temp.val($$ select count(*) from public.billing_charges $$);
select matches((select v from kv where k = 'before'), '^[0-9]+$', 'the ledger can be counted before the non-billable events');

set local role authenticated;
select pg_temp.as_staff_a();
insert into b (label, id, ref)
select 'walk', r.id, r.reference_code
from fx, public.create_walk_in('c0000000-0000-0000-0000-00000000b0a1', fx.t0 + interval '7 hours', 1, 'Walker') r;
reset role;
select is(pg_temp.conf('walk'), 'set', 'a walk-in is confirmed on creation, so it has confirmed_at');
select is(pg_temp.charges('walk'), '0', 'a walk-in writes no charge');

insert into public.blackouts (court_id, starts_at, ends_at, reason)
select 'c0000000-0000-0000-0000-00000000b0a2', fx.t0 + interval '12 hours', fx.t0 + interval '13 hours', 'E2E bill blackout 2' from fx;
insert into public.open_play_sessions (id, title, starts_at, ends_at)
select '0b000000-0000-0000-0000-0000000b1101', 'E2E bill open play', fx.t0 + interval '13 hours', fx.t0 + interval '15 hours' from fx;
insert into public.open_play_courts (session_id, court_id, during)
select '0b000000-0000-0000-0000-0000000b1101', 'c0000000-0000-0000-0000-00000000b0a2', tstzrange(fx.t0 + interval '13 hours', fx.t0 + interval '15 hours') from fx;
select is(pg_temp.val($$ select count(*) from public.billing_charges $$), (select v from kv where k = 'before'),
  'a walk-in, a blackout and an open play session add nothing to the ledger');

-- ---------------------------------------------------------------- row: rescheduled, or a `moved` continuation
select pg_temp.mk_checkout('res');
set local role service_role;
select is(pg_temp.pay('res'), 'confirmed', 'the two-hour guest booking is confirmed through PayMongo');
reset role;
select is(pg_temp.charges('res', 'booking_fee'), '1', 'the two-hour booking pays one fee, not one per hour');

set local role authenticated;
select pg_temp.as_staff_a();
insert into b (label, id, ref)
select 'cont', r.continuation_id, r.continuation_reference
from fx, public.reschedule_booking((select id from b where label = 'res'), fx.t0 + interval '10 hours',
  'c0000000-0000-0000-0000-00000000b0a2', fx.t0 + interval '3 hours', 'Lights out on court 1') r;
reset role;
select results_eq($$ select source::text, status::text, booking_fee from public.bookings where id = (select id from b where label = 'cont') $$,
  $$ values ('moved', 'confirmed', 0.00::numeric) $$, 'the move created a confirmed `moved` continuation with no fee');
select is(pg_temp.charges('cont'), '0', 'a moved continuation writes no charge');
select is(pg_temp.charges('res', 'booking_fee'), '1', 'a partial move leaves the root with its one fee charge');

set local role authenticated;
select pg_temp.as_staff_a();
select lives_ok($$ select * from public.reschedule_booking((select id from b where label = 'res'), (select t0 + interval '9 hours' from fx),
  'c0000000-0000-0000-0000-00000000b0a2', (select t0 + interval '6 hours' from fx), 'Court 1 still dark') $$,
  'a whole move of the root');
reset role;
select is(pg_temp.val($$ select count(*) from public.billing_charges c join b on b.id = c.booking_id where b.label in ('res', 'cont') $$), '1',
  'after both moves the root and its continuation have one charge between them');

-- ---------------------------------------------------------------- one booking, one fee row
update public.bookings set status = 'confirmed' where id = (select id from b where label = 'pm');
update public.bookings set guest_name = guest_name || ' ' where id = (select id from b where label = 'pm');
select is(pg_temp.charges('pm'), '1', 'touching a confirmed booking again never writes a second fee');

-- ---------------------------------------------------------------- venue B, venue timezone
select pg_temp.mk_checkout('bb');
set local role service_role;
select is(pg_temp.pay('bb'), 'confirmed', 'the PayMongo webhook confirms the booking at venue B');
reset role;
select is(
  pg_temp.val($$ select concat_ws('|', c.kind::text, c.amount, c.venue_id = (select b from v),
            c.billing_month = date_trunc('month', c.charged_at at time zone 'Pacific/Honolulu')::date,
            extract(day from c.billing_month)::int = 1)
     from public.billing_charges c join b on b.id = c.booking_id where b.label = 'bb' $$),
  'booking_fee|10.00|t|t|t',
  'venue B: the charge is B''s and its billing month is in B''s timezone (Pacific/Honolulu)');

-- ---------------------------------------------------------------- an invoiced charge, then the venue cancels
-- The fee of `proof` goes on an invoice (as the monthly job will do).
select is(pg_temp.run($$ with i as (
    insert into public.invoices (venue_id, billing_month)
    select (select a from v), c.billing_month
    from public.billing_charges c join b on b.id = c.booking_id where b.label = 'proof' and c.kind::text = 'booking_fee'
    returning id)
  insert into inv select 'a', id from i $$), 'ok', 'an invoice for venue A is created');
select is(pg_temp.run($$ with i as (
    insert into public.invoices (venue_id, billing_month) values ((select b from v), '2030-01-01') returning id)
  insert into inv select 'b', id from i $$), 'ok', 'an invoice for venue B is created');
select is(pg_temp.run($$ update public.billing_charges set invoice_id = (select id from inv where label = 'a')
  where kind::text = 'booking_fee' and booking_id = (select id from b where label = 'proof') $$), 'ok',
  'a charge can be put on its invoice (invoice_id is the one column that may change)');
select is(pg_temp.val($$ select status::text from public.invoices where id = (select id from inv where label = 'a') $$), 'draft',
  'a new invoice is a draft');

-- Cancelling as the player (or guest) keeps the fee: it is non-refundable.
set local role anon;
select pg_temp.as_anon();
select is((select public.cancel_booking(null, b.ref, b.token, null)::text from b where label = 'pm'), 'cancelled', 'the guest cancels their confirmed booking');
reset role;
select results_eq($$ select status::text, cancelled_by_venue from public.bookings where id = (select id from b where label = 'pm') $$,
  $$ values ('cancelled', false) $$, 'the guest''s cancellation is not a venue cancellation');
select is(pg_temp.charges('pm', 'booking_fee'), '1', 'cancelled by the guest: the fee charge stays');
select is(pg_temp.charges('pm', 'adjustment'), '0', 'cancelled by the guest: no adjustment, the fee is not refunded');

set local role authenticated;
select pg_temp.as_player();
select is((select public.cancel_booking(b.id)::text from b where label = 'sub'), 'cancelled', 'the player cancels their confirmed booking');
reset role;
select is(pg_temp.charges('sub', 'booking_fee') || '/' || pg_temp.charges('sub', 'adjustment'), '1/0',
  'cancelled by the player: the fee stays and nothing is adjusted');

-- Cancelling as the venue credits the fee.
set local role authenticated;
select pg_temp.as_staff_a();
select is((select public.cancel_booking(b.id, null, null, 'Court flooded')::text from b where label = 'proof'), 'cancelled',
  'staff cancel the confirmed booking as the venue');
reset role;
select results_eq($$ select status::text, cancelled_by_venue from public.bookings where id = (select id from b where label = 'proof') $$,
  $$ values ('cancelled', true) $$, 'the booking is marked as cancelled by the venue');
select is(
  pg_temp.val($$ select concat_ws('|', c.kind::text, c.amount, c.venue_id = (select a from v), c.invoice_id is null, c.charged_at is not null,
            c.billing_month = date_trunc('month', c.charged_at at time zone 'Asia/Manila')::date)
     from public.billing_charges c join b on b.id = c.booking_id where b.label = 'proof' and c.kind::text = 'adjustment' $$),
  'adjustment|-10.00|t|t|t|t',
  'venue cancellation: a -10.00 adjustment, not on any invoice, in the month of the cancellation');
select is(pg_temp.charges('proof'), '2', 'the original fee row is kept next to the adjustment (charges are never deleted)');
select is(pg_temp.val($$ select c.invoice_id = (select id from inv where label = 'a') from public.billing_charges c join b on b.id = c.booking_id
  where b.label = 'proof' and c.kind::text = 'booking_fee' $$), 'true',
  'the already-invoiced fee row stays on its invoice; the credit goes on a later one');
select is(pg_temp.val($$ select sum(c.amount) from public.billing_charges c join b on b.id = c.booking_id where b.label = 'proof' $$), '0.00',
  'a venue-cancelled booking nets to zero');
select is(pg_temp.conf('proof'), 'set', 'confirmed_at stays after the cancellation');

-- confirmed_at never changes once set: park a known value on the walk-in, then change its status.
select is(pg_temp.run($$ update public.bookings set confirmed_at = '2020-01-01 00:00+00' where id = (select id from b where label = 'walk') $$), 'ok',
  'a known confirmed_at is parked on the confirmed walk-in');

-- Cancelling a booking that was never confirmed, or a walk-in, credits nothing.
set local role authenticated;
select pg_temp.as_staff_a();
select is((select public.cancel_booking(b.id, null, null, 'Closed today')::text from b where label = 'unconf'), 'cancelled',
  'staff cancel a booking whose proof was never approved');
select is((select public.cancel_booking(b.id, null, null, 'Walk-in left')::text from b where label = 'walk'), 'cancelled',
  'staff cancel a walk-in');
reset role;
select is(pg_temp.charges('unconf'), '0', 'venue-cancelling an unconfirmed booking writes no adjustment');
select is(pg_temp.conf('unconf'), 'null', 'venue-cancelling an unconfirmed booking leaves confirmed_at empty');
select is(pg_temp.charges('walk'), '0', 'venue-cancelling a walk-in writes no adjustment (it never had a fee)');

select is(pg_temp.val($$ select confirmed_at = '2020-01-01 00:00+00'::timestamptz from public.bookings where id = (select id from b where label = 'walk') $$), 'true',
  'confirmed_at is not rewritten when the status changes again');

-- ---------------------------------------------------------------- the fee is 0: nothing to bill
set local role service_role;
update public.platform_pricing set booking_fee = 0;
reset role;
set local role authenticated;
select pg_temp.as_player();
insert into b (label, id, ref, token)
select 'zero', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-00000000b0a1', fx.t0 + interval '11 hours', 1) r;
reset role;
set local role service_role;
select public.record_payment_proof(id, id::text || '/1.png', 'gcash', 500) from b where label = 'zero';
reset role;
set local role authenticated;
select pg_temp.as_staff_a();
select is((select r.status::text from b, public.review_payment(b.id, true) r where b.label = 'zero'), 'confirmed', 'staff approve a zero-fee booking');
reset role;
select is(pg_temp.conf('zero'), 'set', 'a zero-fee booking still gets confirmed_at');
select is(pg_temp.charges('zero'), '0', 'a zero fee writes no charge');
update public.platform_pricing set booking_fee = 10;

-- ---------------------------------------------------------------- the ledger rules
-- Direct writes (as the table owner) hit the constraints and the guard trigger.
select is(pg_temp.run($$ insert into public.billing_charges (venue_id, booking_id, kind, amount, billing_month)
  values ((select a from v), (select id from b where label = 'proof'), 'booking_fee', 10, '2030-01-01') $$), 'ERR 23505',
  'one booking_fee row per booking');
select is(pg_temp.run($$ insert into public.billing_charges (venue_id, booking_id, kind, amount, billing_month)
  values ((select a from v), (select id from b where label = 'proof'), 'adjustment', -10, '2030-01-01') $$), 'ERR 23505',
  'at most one adjustment row per booking');
select ok(pg_temp.run($$ insert into public.billing_charges (venue_id, booking_id, kind, amount, billing_month)
  values ((select a from v), (select id from b where label = 'walk'), 'refund', -10, '2030-01-01') $$) in ('ERR 23514', 'ERR 22P02'),
  'the kind is booking_fee or adjustment');
select is(pg_temp.run($$ insert into public.billing_charges (venue_id, booking_id, kind, amount, billing_month)
  values ((select b from v), (select id from b where label = 'walk'), 'adjustment', -10, '2030-01-01') $$), 'ERR 23503',
  'a charge cannot name another venue''s booking (composite foreign key)');
select is(pg_temp.run($$ update public.billing_charges set invoice_id = (select id from inv where label = 'a')
  where booking_id = (select id from b where label = 'bb') $$), 'ERR 23503',
  'a charge cannot go on another venue''s invoice (composite foreign key)');

select ok(pg_temp.run($$ update public.billing_charges set amount = 0 where booking_id = (select id from b where label = 'pm') $$)
  not in ('ok', 'ERR 42P01', 'ERR 42703'), 'a charge''s amount cannot be edited');
select ok(pg_temp.run($$ update public.billing_charges set kind = 'adjustment' where booking_id = (select id from b where label = 'pm') $$)
  not in ('ok', 'ERR 42P01', 'ERR 42703'), 'a charge''s kind cannot be edited');
select ok(pg_temp.run($$ update public.billing_charges set billing_month = '2030-01-01' where booking_id = (select id from b where label = 'pm') $$)
  not in ('ok', 'ERR 42P01', 'ERR 42703'), 'a charge''s billing month cannot be edited');
select ok(pg_temp.run($$ update public.billing_charges set charged_at = now() - interval '2 days' where booking_id = (select id from b where label = 'pm') $$)
  not in ('ok', 'ERR 42P01', 'ERR 42703'), 'a charge''s charged_at cannot be edited');
select ok(pg_temp.run($$ delete from public.billing_charges where booking_id = (select id from b where label = 'pm') $$)
  not in ('ok', 'ERR 42P01', 'ERR 42703'), 'a charge cannot be deleted');
select ok(pg_temp.run($$ delete from public.billing_charges $$) not in ('ok', 'ERR 42P01', 'ERR 42703'),
  'the ledger cannot be emptied');
select is(pg_temp.val($$ select concat_ws('|', c.kind::text, c.amount) from public.billing_charges c join b on b.id = c.booking_id where b.label = 'pm' $$),
  'booking_fee|10.00', 'after the refused edits the charge is exactly as written');

-- ---------------------------------------------------------------- invoices
select is(pg_temp.run($$ insert into public.invoices (venue_id, billing_month)
  select venue_id, billing_month from public.invoices where id = (select id from inv where label = 'a') $$), 'ERR 23505',
  'one invoice per venue and month');
select is(pg_temp.run($$ insert into public.invoices (venue_id, billing_month, status) values ((select b from v), '2031-01-01', 'bogus') $$), 'ERR 23514',
  'an invoice is draft, sent or paid');
select is(pg_temp.run($$ update public.invoices set status = 'sent', sent_at = now() where id = (select id from inv where label = 'b') $$), 'ok',
  'a draft invoice is marked sent');
select is(pg_temp.run($$ update public.invoices set status = 'paid', paid_at = now(), paid_method = 'gcash', paid_reference = 'REF-123'
  where id = (select id from inv where label = 'b') $$), 'ok', 'a sent invoice is marked paid with a method and reference');
select is(pg_temp.val($$ select concat_ws('|', status::text, paid_method, paid_reference, sent_at is not null, paid_at is not null)
  from public.invoices where id = (select id from inv where label = 'b') $$),
  'paid|gcash|REF-123|t|t', 'the invoice records how it was paid');

-- ---------------------------------------------------------------- RLS: who reads, who writes
-- Totals: venue A has 6 fee rows (pm, proof, sub, rev, res, snap) and 1 adjustment (proof); venue B has 1 fee row.
set local role anon;
select pg_temp.as_anon();
select ok(pg_temp.rows($$ select 1 from public.billing_charges $$) in ('0', 'denied'), 'anon sees no charges');
select ok(pg_temp.rows($$ select 1 from public.invoices $$) in ('0', 'denied'), 'anon sees no invoices');
reset role;

set local role authenticated;
select pg_temp.as_player();
select ok(pg_temp.rows($$ select 1 from public.billing_charges $$) in ('0', 'denied'), 'a player sees no charges, not even their own bookings''');
select ok(pg_temp.rows($$ select 1 from public.invoices $$) in ('0', 'denied'), 'a player sees no invoices');

select pg_temp.as_staff_a();
select is(pg_temp.rows($$ select 1 from public.billing_charges where booking_id in (select id from b) $$), '7',
  'venue A''s staff read all 7 of A''s charges');
select is(pg_temp.rows($$ select 1 from public.billing_charges where venue_id = (select b from v) $$), '0',
  'venue A''s staff see none of B''s charges');
select is(pg_temp.rows($$ select 1 from public.invoices where id in (select id from inv) $$), '1', 'venue A''s staff see only A''s invoice');
select is(pg_temp.rows($$ select 1 from public.invoices where id = (select id from inv where label = 'b') $$), '0', 'venue A''s staff cannot see B''s invoice');
select is(pg_temp.run($$ insert into public.billing_charges (venue_id, booking_id, kind, amount, billing_month)
  values ((select a from v), (select id from b where label = 'walk'), 'adjustment', -5, '2030-01-01') $$), 'ERR 42501',
  'staff cannot insert a charge');
select is(pg_temp.run($$ update public.billing_charges set invoice_id = null $$), 'ERR 42501', 'staff cannot update a charge');
select is(pg_temp.run($$ delete from public.billing_charges $$), 'ERR 42501', 'staff cannot delete a charge');
select is(pg_temp.run($$ insert into public.invoices (venue_id, billing_month) values ((select a from v), '2031-02-01') $$), 'ERR 42501',
  'staff cannot create an invoice');
select is(pg_temp.run($$ update public.invoices set status = 'paid' $$), 'ERR 42501', 'staff cannot mark an invoice paid');
select is(pg_temp.run($$ delete from public.invoices $$), 'ERR 42501', 'staff cannot delete an invoice');

select pg_temp.as_staff_b();
select is(pg_temp.rows($$ select 1 from public.billing_charges where booking_id in (select id from b) $$), '1',
  'venue B''s staff read only B''s 1 charge');
select is(pg_temp.rows($$ select 1 from public.billing_charges where venue_id = (select a from v) $$), '0',
  'venue B''s staff see none of A''s charges');
select is(pg_temp.rows($$ select 1 from public.invoices where id in (select id from inv) $$), '1', 'venue B''s staff see only B''s invoice');
select is(pg_temp.rows($$ select 1 from public.invoices where id = (select id from inv where label = 'a') $$), '0', 'venue B''s staff cannot see A''s invoice');

select pg_temp.as_platform();
select is(pg_temp.rows($$ select 1 from public.billing_charges where booking_id in (select id from b) $$), '8',
  'a platform admin reads the charges of both venues');
select is(pg_temp.rows($$ select 1 from public.invoices where id in (select id from inv) $$), '2', 'a platform admin reads the invoices of both venues');
reset role;

-- ---------------------------------------------------------------- the whole ledger
select is(pg_temp.val($$ select string_agg(x.k || ':' || x.n || ':' || x.total, ' ' order by x.k)
  from (select c.kind::text as k, count(*) as n, sum(c.amount) as total from public.billing_charges c join b on b.id = c.booking_id
        where c.venue_id = (select a from v) group by c.kind) x $$),
  'adjustment:1:-10.00 booking_fee:6:60.00',
  'venue A''s ledger: six fees and one credit, nothing for the rejected, expired, late, zero-fee, walk-in and moved bookings');
select is(pg_temp.val($$ select sum(c.amount) from public.billing_charges c join b on b.id = c.booking_id where c.venue_id = (select a from v) $$), '50.00',
  'venue A owes 50.00 for the month so far');
select is(pg_temp.val($$ select count(*) from public.bookings where status = 'confirmed' and confirmed_at is null $$), '0',
  'every confirmed booking has confirmed_at, including the ones this test made');

-- Deleting a booking cascades to its charges (e2e cleanup; only the service role and postgres can delete bookings).
-- Last, so no earlier total depends on the deleted booking.
select is(pg_temp.val($$ select count(*) from public.billing_charges where booking_id = (select id from b where label = 'snap') $$), '1',
  'the booking about to be deleted has a charge');
select is(pg_temp.run($$ delete from public.bookings where id = (select id from b where label = 'snap') $$), 'ok',
  'a booking with charges can be deleted');
select is(pg_temp.val($$ select count(*) from public.billing_charges where booking_id = (select id from b where label = 'snap') $$), '0',
  'deleting a booking removes its charges');

select * from finish();
rollback;
