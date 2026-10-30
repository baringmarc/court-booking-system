-- T11.12: the booking fee (SPEC §10 2026-10-27 "Fee"; RESEARCH M11 "Booking fee: where the amount due is read",
-- "Earnings split"). platform_pricing holds the current fee (read by anyone, written only by the service role);
-- online bookings snapshot it into bookings.booking_fee (walk-ins and `moved` continuations get 0);
-- bookings.amount_due = total_amount + booking_fee is what the player pays everywhere (proof_target, PayMongo,
-- get_guest_booking, the email payload); get_earnings splits total revenue into Plotline fees and owner earnings.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

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

create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "anon"}', true)
$$;
create function pg_temp.as_player() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true)
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true)
$$;
grant execute on function pg_temp.as_anon() to anon, authenticated, service_role;
grant execute on function pg_temp.as_player() to anon, authenticated, service_role;
grant execute on function pg_temp.as_admin() to anon, authenticated, service_role;

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.venue_members (venue_id, user_id, role)
select id, '22222222-2222-2222-2222-222222222222', 'staff' from public.venues where slug = 'claudex-courts';

insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000000f1', 'Fee Court 1', 'tennis', 500),
  ('c0000000-0000-0000-0000-0000000000f2', 'Fee Court 2', 'tennis', 500),
  ('c0000000-0000-0000-0000-0000000000f3', 'Fee Court 3', 'tennis', 500),
  ('c0000000-0000-0000-0000-0000000000f4', 'Fee Earnings Court', 'tennis', 500);

create temp table fx as
select (private.local_today() + 3 + time '10:00') at time zone 'Asia/Manila' as t10,
       (private.local_today() + 2 + time '10:00') at time zone 'Asia/Manila' as m10;
create temp table b (label text primary key, id uuid, ref text, token text);
grant select on fx to anon, authenticated, service_role;
grant select, insert on b to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- platform_pricing: shape, the single row, seeded at 0
-- ---------------------------------------------------------------------------
select has_table('public', 'platform_pricing', 'platform_pricing exists');
select col_type_is('public', 'platform_pricing', 'booking_fee', 'numeric(10,2)', 'platform_pricing.booking_fee is numeric(10,2)');
select results_eq($$ select id, booking_fee from public.platform_pricing $$, $$ values (true, 0.00::numeric) $$,
  'platform_pricing has exactly one row, seeded with a booking fee of 0');
select throws_ok($$ insert into public.platform_pricing (booking_fee) values (5) $$, '23505', null,
  'a second row (id defaults to true) is refused');
select throws_ok($$ insert into public.platform_pricing (id, booking_fee) values (false, 5) $$, '23514', null,
  'the id can only be true (one row)');
select throws_ok($$ update public.platform_pricing set booking_fee = -1 $$, '23514', null,
  'a negative fee is refused');
select is((select count(*)::int from public.bookings where booking_fee <> 0), 0,
  'existing bookings carry no fee (default 0)');

-- ---------------------------------------------------------------------------
-- platform_pricing: privileges and RLS
-- ---------------------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.platform_pricing'::regclass), 'RLS is on for platform_pricing');
select ok(not has_table_privilege('anon', 'public.platform_pricing', 'insert')
      and not has_table_privilege('anon', 'public.platform_pricing', 'update')
      and not has_table_privilege('anon', 'public.platform_pricing', 'delete'),
  'anon has no insert, update or delete grant on platform_pricing');
select ok(not has_table_privilege('authenticated', 'public.platform_pricing', 'insert')
      and not has_table_privilege('authenticated', 'public.platform_pricing', 'update')
      and not has_table_privilege('authenticated', 'public.platform_pricing', 'delete'),
  'authenticated (admins included) has no insert, update or delete grant on platform_pricing');

set local role anon;
select pg_temp.as_anon();
select results_eq($$ select booking_fee from public.platform_pricing $$, $$ values (0.00::numeric) $$,
  'anon reads the current fee');
select throws_ok($$ update public.platform_pricing set booking_fee = 1 $$, '42501', null, 'anon cannot change the fee');
reset role;

set local role authenticated;
select pg_temp.as_player();
select results_eq($$ select booking_fee from public.platform_pricing $$, $$ values (0.00::numeric) $$,
  'a player reads the current fee');
select throws_ok($$ update public.platform_pricing set booking_fee = 1 $$, '42501', null, 'a player cannot change the fee');

select pg_temp.as_admin();
select results_eq($$ select booking_fee from public.platform_pricing $$, $$ values (0.00::numeric) $$,
  'an admin reads the current fee');
select throws_ok($$ update public.platform_pricing set booking_fee = 1 $$, '42501', null, 'an admin cannot change the fee');
select throws_ok($$ insert into public.platform_pricing (id, booking_fee) values (true, 1) $$, '42501', null,
  'an admin cannot insert a fee row');
select throws_ok($$ delete from public.platform_pricing $$, '42501', null, 'an admin cannot delete the fee row');
reset role;

set local role service_role;
select lives_ok($$ update public.platform_pricing set booking_fee = 10 $$, 'the service role sets the fee');
reset role;
select is((select booking_fee from public.platform_pricing), 10.00::numeric, 'the fee is now 10');

-- ---------------------------------------------------------------------------
-- bookings.booking_fee and amount_due: shape and constraints
-- ---------------------------------------------------------------------------
select col_type_is('public', 'bookings', 'booking_fee', 'numeric(10,2)', 'bookings.booking_fee is numeric(10,2)');
select col_not_null('public', 'bookings', 'booking_fee', 'bookings.booking_fee is not null');
select is((select attgenerated::text from pg_attribute where attrelid = 'public.bookings'::regclass and attname = 'amount_due'), 's',
  'bookings.amount_due is a stored generated column');

-- ---------------------------------------------------------------------------
-- The snapshot: online bookings copy the fee
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_anon();
insert into b select 'guest', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-0000000000f1', fx.t10, 1, 'Gina Guest', 'gina@example.com', '0917 222 2222') r;
reset role;
set local role authenticated;
select pg_temp.as_player();
insert into b select 'player', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-0000000000f1', fx.t10 + interval '2 hours', 2) r;
reset role;

select results_eq(
  $$ select total_amount, booking_fee, amount_due from public.bookings where id = (select id from b where label = 'guest') $$,
  $$ values (500.00::numeric, 10.00::numeric, 510.00::numeric) $$,
  'an online guest booking snapshots the fee: court price 500, fee 10, amount due 510');
select results_eq(
  $$ select total_amount, booking_fee, amount_due from public.bookings where id = (select id from b where label = 'player') $$,
  $$ values (1000.00::numeric, 10.00::numeric, 1010.00::numeric) $$,
  'a two-hour player booking pays one fee per booking (1000 + 10 = 1010)');

-- Walk-ins carry no fee.
set local role authenticated;
select pg_temp.as_admin();
insert into b (label, id, ref)
select 'walkin', r.id, r.reference_code
from fx, public.create_walk_in('c0000000-0000-0000-0000-0000000000f1', fx.t10 + interval '6 hours', 1, 'Walker') r;
reset role;
select results_eq(
  $$ select source::text, total_amount, booking_fee, amount_due from public.bookings where id = (select id from b where label = 'walkin') $$,
  $$ values ('walk_in', 500.00::numeric, 0.00::numeric, 500.00::numeric) $$,
  'create_walk_in writes a fee of 0 while the platform fee is 10');

-- The fee comes from platform_pricing, not from whoever inserts the row.
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status, cancelled_at, booking_fee)
select 'b0000000-0000-0000-0000-0000000000f1', 'CB-FEEAA2', 'c0000000-0000-0000-0000-0000000000f2', 'Sneaky',
       tstzrange(t10, t10 + interval '1 hour'), 500, 'cancelled', now(), 99
from fx;
select is((select booking_fee from public.bookings where id = 'b0000000-0000-0000-0000-0000000000f1'), 10.00::numeric,
  'an online insert that names its own fee still gets the platform fee');
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status, source, booking_fee)
select 'b0000000-0000-0000-0000-0000000000f2', 'CB-FEEAB3', 'c0000000-0000-0000-0000-0000000000f2', 'Walk Direct',
       tstzrange(t10 + interval '2 hours', t10 + interval '3 hours'), 400, 'confirmed', 'walk_in', 10
from fx;
select results_eq(
  $$ select booking_fee, amount_due from public.bookings where id = 'b0000000-0000-0000-0000-0000000000f2' $$,
  $$ values (0.00::numeric, 400.00::numeric) $$,
  'a walk-in inserted with a fee is written with 0 instead');

-- Constraints
select throws_ok(
  $$ update public.bookings set booking_fee = 10 where id = 'b0000000-0000-0000-0000-0000000000f2' $$,
  '23514', 'new row for relation "bookings" violates check constraint "bookings_fee_online_only"',
  'bookings_fee_online_only: a walk-in can never carry a fee');
select throws_ok(
  $$ update public.bookings set booking_fee = -1 where id = 'b0000000-0000-0000-0000-0000000000f1' $$,
  '23514', null, 'a negative booking fee is refused');
select throws_ok(
  $$ update public.bookings set amount_due = 1 where id = 'b0000000-0000-0000-0000-0000000000f1' $$,
  '428C9', null, 'amount_due cannot be written directly');
update public.bookings set total_amount = 450 where id = 'b0000000-0000-0000-0000-0000000000f1';
select is((select amount_due from public.bookings where id = 'b0000000-0000-0000-0000-0000000000f1'), 460.00::numeric,
  'amount_due follows total_amount + booking_fee');

-- `moved` continuations carry no fee; the root keeps its own, including through a whole move.
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status)
select 'b0000000-0000-0000-0000-0000000000f3', 'CB-FEEAC4', 'c0000000-0000-0000-0000-0000000000f2', 'Mover',
       tstzrange(m10, m10 + interval '2 hours'), 1000, 'confirmed'
from fx;
insert into public.payments (booking_id, method, amount, review_status, reviewed_at)
values ('b0000000-0000-0000-0000-0000000000f3', 'cash', 1010, 'approved', now());

set local role authenticated;
select pg_temp.as_admin();
insert into b (label, id, ref)
select 'cont', r.continuation_id, r.continuation_reference
from fx, public.reschedule_booking('b0000000-0000-0000-0000-0000000000f3', fx.m10 + interval '1 hour',
  'c0000000-0000-0000-0000-0000000000f3', fx.m10 + interval '5 hours', 'Lights out on court 2') r;
reset role;
select results_eq(
  $$ select source::text, booking_fee, amount_due from public.bookings where id = (select id from b where label = 'cont') $$,
  $$ values ('moved', 0.00::numeric, 0.00::numeric) $$,
  'a moved continuation gets a fee of 0 while the platform fee is 10');
select is((select booking_fee from public.bookings where id = 'b0000000-0000-0000-0000-0000000000f3'), 10.00::numeric,
  'the shortened root keeps its fee');

set local role authenticated;
select pg_temp.as_admin();
select lives_ok(
  $$ select * from public.reschedule_booking('b0000000-0000-0000-0000-0000000000f3', (select m10 from fx),
       'c0000000-0000-0000-0000-0000000000f3', (select m10 from fx) + interval '7 hours', 'Court 2 still dark') $$,
  'a whole move of the root');
reset role;
select is((select booking_fee from public.bookings where id = 'b0000000-0000-0000-0000-0000000000f3'), 10.00::numeric,
  'a whole move keeps the booking''s fee');

-- Changing the price later never touches existing bookings.
set local role service_role;
select lives_ok($$ update public.platform_pricing set booking_fee = 25 $$, 'the service role changes the fee to 25');
reset role;
select results_eq(
  $$ select booking_fee, amount_due from public.bookings where id = (select id from b where label = 'guest') $$,
  $$ values (10.00::numeric, 510.00::numeric) $$,
  'an existing booking keeps the fee it was made with after the price changes');
set local role anon;
select pg_temp.as_anon();
insert into b select 'later', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-0000000000f1', fx.t10 + interval '8 hours', 1, 'Lara Later', 'lara@example.com', '0917 444 4444') r;
reset role;
select results_eq(
  $$ select booking_fee, amount_due from public.bookings where id = (select id from b where label = 'later') $$,
  $$ values (25.00::numeric, 525.00::numeric) $$,
  'a booking made after the change snapshots the new fee');

-- ---------------------------------------------------------------------------
-- proof_target (manual proofs and the PayMongo checkout read the amount due)
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.proof_target(text, text, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.proof_target(text, text, uuid)', 'execute')
      and has_function_privilege('service_role', 'public.proof_target(text, text, uuid)', 'execute'),
  'proof_target is still service role only');
set local role service_role;
select results_eq(
  $$ select t.booking_id, t.amount_due from b, public.proof_target(b.ref, b.token, null) t where b.label = 'guest' $$,
  $$ select id, 510.00::numeric from b where label = 'guest' $$,
  'proof_target returns the amount due (court price + fee) for a guest');
select results_eq(
  $$ select t.booking_id, t.amount_due from b, public.proof_target(b.ref, null, '11111111-1111-1111-1111-111111111111') t where b.label = 'player' $$,
  $$ select id, 1010.00::numeric from b where label = 'player' $$,
  'proof_target returns the amount due for a player');
reset role;

-- ---------------------------------------------------------------------------
-- get_guest_booking
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_anon();
select results_eq(
  $$ select g.total_amount, g.booking_fee, g.amount_due from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'guest' $$,
  $$ values (500.00::numeric, 10.00::numeric, 510.00::numeric) $$,
  'get_guest_booking returns the court price, the fee and the amount due');
reset role;
select ok(has_function_privilege('anon', 'public.get_guest_booking(text, text)', 'execute')
      and has_function_privilege('authenticated', 'public.get_guest_booking(text, text)', 'execute'),
  'anon and authenticated can still call get_guest_booking');

-- ---------------------------------------------------------------------------
-- The email payload
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select (d ->> 'total_amount')::numeric, (d ->> 'booking_fee')::numeric, (d ->> 'amount_due')::numeric
     from (select private.booking_email_data(bk) as d from public.bookings bk where bk.id = (select id from b where label = 'guest')) x $$,
  $$ values (500::numeric, 10::numeric, 510::numeric) $$,
  'booking_email_data: total_amount stays the court price, with booking_fee and amount_due beside it');
select results_eq(
  $$ select (data ->> 'booking_fee')::numeric, (data ->> 'amount_due')::numeric from public.email_outbox
     where booking_id = (select id from b where label = 'guest') and kind = 'booking_created' $$,
  $$ values (10::numeric, 510::numeric) $$,
  'the queued booking_created email carries the fee and the amount due');
select is(
  (select (private.booking_email_data(bk) ->> 'booking_fee')::numeric from public.bookings bk where bk.id = (select id from b where label = 'walkin')),
  0::numeric, 'a walk-in''s payload has a fee of 0');

-- ---------------------------------------------------------------------------
-- record_paymongo_payment: the amount check uses amount_due
-- ---------------------------------------------------------------------------
insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos)
select id, 'cs_fee_' || label, 'https://checkout.paymongo.test/fee_' || label,
       case label when 'guest' then 51000 else 101000 end
from b where label in ('guest', 'player');

set local role service_role;
select is(
  (select outcome from public.record_paymongo_payment('cs_fee_guest', 'pay_fee_guest', 'evt_fee_guest', 50000, 'PHP', 'gcash')),
  'late', 'paying the court price alone (500.00) when the fee is 10 is not accepted');
select is(
  (select outcome from public.record_paymongo_payment('cs_fee_player', 'pay_fee_player', 'evt_fee_player', 101000, 'PHP', 'gcash')),
  'confirmed', 'paying the amount due (1010.00) confirms the booking');
reset role;
select results_eq(
  $$ select bk.status::text, p.review_status::text, p.amount
     from public.bookings bk join public.payments p on p.booking_id = bk.id
     where bk.id = (select id from b where label = 'guest') $$,
  $$ values ('pending_payment', 'rejected', 500.00::numeric) $$,
  'the short PayMongo payment is flagged for a refund and the booking keeps its hold');
select results_eq(
  $$ select bk.status::text, p.review_status::text, p.amount
     from public.bookings bk join public.payments p on p.booking_id = bk.id
     where bk.id = (select id from b where label = 'player') $$,
  $$ values ('confirmed', 'approved', 1010.00::numeric) $$,
  'the full PayMongo payment is approved at the amount due');

-- ---------------------------------------------------------------------------
-- get_earnings: total revenue, Plotline fees, owner earnings (this week and the week before)
-- ---------------------------------------------------------------------------
-- A Monday at least 40 days ahead, clear of the seeded demo payments (as in 29_earnings).
create temp table wk as
select d + ((8 - extract(isodow from d)::int) % 7) as mon
from (select private.local_today() + 40 as d) x;
grant select on wk to anon, authenticated;
create function pg_temp.at(p_offset int, p_time time) returns timestamptz language sql as $$
  select ((select mon from wk) + p_offset + p_time) at time zone 'Asia/Manila'
$$;
grant execute on function pg_temp.at(int, time) to anon, authenticated;

-- Online bookings made at a fee of 10 (one at 25), each on its own hour of the earnings court.
update public.platform_pricing set booking_fee = 10;
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status, cancelled_at, cancelled_by_venue)
values
  -- e1 confirmed, paid Tuesday
  ('e0000000-0000-0000-0000-0000000000e1', 'CB-ERFAA2', 'c0000000-0000-0000-0000-0000000000f4', 'E One',
   tstzrange(pg_temp.at(1, '10:00'), pg_temp.at(1, '11:00')), 500, 'confirmed', null, false),
  -- e2 cancelled by the venue after it was paid on Wednesday: its fee is not Plotline's
  ('e0000000-0000-0000-0000-0000000000e2', 'CB-ERFAB3', 'c0000000-0000-0000-0000-0000000000f4', 'E Two',
   tstzrange(pg_temp.at(2, '10:00'), pg_temp.at(2, '11:00')), 500, 'cancelled', now(), true),
  -- e3 cancelled by the player after it was paid on Thursday: the fee stays
  ('e0000000-0000-0000-0000-0000000000e3', 'CB-ERFAC4', 'c0000000-0000-0000-0000-0000000000f4', 'E Three',
   tstzrange(pg_temp.at(3, '10:00'), pg_temp.at(3, '11:00')), 500, 'cancelled', now(), false),
  -- e4 only a rejected proof this week
  ('e0000000-0000-0000-0000-0000000000e4', 'CB-ERFAD5', 'c0000000-0000-0000-0000-0000000000f4', 'E Four',
   tstzrange(pg_temp.at(4, '10:00'), pg_temp.at(4, '11:00')), 500, 'cancelled', now(), false),
  -- e6 paid Sunday 23:59 the week before (the previous period)
  ('e0000000-0000-0000-0000-0000000000e6', 'CB-ERFAF7', 'c0000000-0000-0000-0000-0000000000f4', 'E Six',
   tstzrange(pg_temp.at(-1, '10:00'), pg_temp.at(-1, '11:00')), 500, 'confirmed', null, false),
  -- e7 paid next Monday 00:00 (outside the range)
  ('e0000000-0000-0000-0000-0000000000e7', 'CB-ERFAG8', 'c0000000-0000-0000-0000-0000000000f4', 'E Seven',
   tstzrange(pg_temp.at(7, '10:00'), pg_temp.at(7, '11:00')), 500, 'confirmed', null, false),
  -- e8 a proof still waiting for review
  ('e0000000-0000-0000-0000-0000000000e8', 'CB-ERFAH9', 'c0000000-0000-0000-0000-0000000000f4', 'E Eight',
   tstzrange(pg_temp.at(5, '10:00'), pg_temp.at(5, '11:00')), 500, 'payment_submitted', null, false),
  -- e10 paid Monday 00:30 local (Sunday in UTC): this week
  ('e0000000-0000-0000-0000-000000000010', 'CB-ERFAJ2', 'c0000000-0000-0000-0000-0000000000f4', 'E Ten',
   tstzrange(pg_temp.at(0, '10:00'), pg_temp.at(0, '11:00')), 500, 'confirmed', null, false);
-- e5 a walk-in paid Friday (no fee)
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status, source)
values ('e0000000-0000-0000-0000-0000000000e5', 'CB-ERFAE6', 'c0000000-0000-0000-0000-0000000000f4', 'E Five',
        tstzrange(pg_temp.at(4, '12:00'), pg_temp.at(4, '13:00')), 300, 'confirmed', 'walk_in');
-- e9 made at a fee of 25, paid Sunday 23:59:59 (the last instant of the week)
update public.platform_pricing set booking_fee = 25;
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status)
values ('e0000000-0000-0000-0000-0000000000e9', 'CB-ERFAK3', 'c0000000-0000-0000-0000-0000000000f4', 'E Nine',
        tstzrange(pg_temp.at(6, '10:00'), pg_temp.at(6, '11:00')), 500, 'confirmed');

insert into public.payments (booking_id, method, amount, review_status, reviewed_at, review_note, storage_path) values
  ('e0000000-0000-0000-0000-0000000000e1', 'gcash',  510, 'approved', pg_temp.at(1, '12:00'),    null, null),
  ('e0000000-0000-0000-0000-0000000000e2', 'gcash',  510, 'approved', pg_temp.at(2, '12:00'),    null, null),
  ('e0000000-0000-0000-0000-0000000000e3', 'gcash',  510, 'approved', pg_temp.at(3, '12:00'),    null, null),
  ('e0000000-0000-0000-0000-0000000000e4', 'gcash',  510, 'rejected', pg_temp.at(4, '12:00'),    'Blurry.', null),
  ('e0000000-0000-0000-0000-0000000000e5', 'cash',   300, 'approved', pg_temp.at(4, '13:00'),    null, null),
  ('e0000000-0000-0000-0000-0000000000e6', 'gcash',  510, 'approved', pg_temp.at(-1, '23:59'),   null, null),
  ('e0000000-0000-0000-0000-0000000000e7', 'gcash',  510, 'approved', pg_temp.at(7, '00:00'),    null, null),
  ('e0000000-0000-0000-0000-0000000000e8', 'gcash',  510, 'pending',  null,                      null,
   'e0000000-0000-0000-0000-0000000000e8/p.png'),
  ('e0000000-0000-0000-0000-0000000000e9', 'gcash',  525, 'approved', pg_temp.at(6, '23:59:59'), null, null),
  ('e0000000-0000-0000-0000-000000000010', 'gcash',  510, 'approved', pg_temp.at(0, '00:30'),    null, null);

set local role authenticated;
select pg_temp.as_admin();
create temp table e as select public.get_earnings((select mon from wk), (select mon from wk) + 6) as j;
reset role;

select is((select j -> 'collected' -> 'total' from e)::numeric, 2865::numeric,
  'collected.total is unchanged: every approved payment this week (510 × 4 + 300 + 525)');
select is((select (j -> 'split' ->> 'total_revenue')::numeric from e), (select (j -> 'collected' ->> 'total')::numeric from e),
  'split.total_revenue is the collected total');
select is((select (j -> 'split' ->> 'plotline_fees')::numeric from e), 55::numeric,
  'split.plotline_fees: fees of bookings paid this week (10 + 10 + 10 + 25); the venue-cancelled booking, the walk-in, the rejected and pending proofs and next week are left out');
select is((select (j -> 'split' ->> 'owner_earnings')::numeric from e), 2810::numeric,
  'split.owner_earnings is total revenue minus Plotline fees (2865 - 55)');
select is((select j -> 'split' -> 'previous' from e),
  '{"total_revenue": 510, "plotline_fees": 10, "owner_earnings": 500}'::jsonb,
  'split.previous covers the week before (paid Sunday 23:59, the last minute of that week)');
select ok((select j ? 'previous' and j ? 'refunds_due' and j ? 'daily' and j ? 'courts' and j ? 'sports' and j ? 'coming_up' from e),
  'the existing get_earnings keys are still there');
select is((select (j -> 'previous' ->> 'total')::numeric from e), 510::numeric,
  'the existing previous.total is unchanged');

-- A venue cancellation alone moves the fee out of Plotline's share (same week, before and after the cancel).
update public.bookings set cancelled_by_venue = false where id = 'e0000000-0000-0000-0000-0000000000e2';
set local role authenticated;
select pg_temp.as_admin();
select is((public.get_earnings((select mon from wk), (select mon from wk) + 6) -> 'split' ->> 'plotline_fees')::numeric, 65::numeric,
  'the same booking cancelled by the player instead keeps its fee in Plotline''s share');
reset role;

-- Only admins read the split.
set local role authenticated;
select pg_temp.as_player();
select is(pg_temp.hint_of($$ select public.get_earnings((select mon from wk), (select mon from wk) + 6) $$), 'forbidden',
  'a player still cannot call get_earnings');
reset role;
select ok(not has_function_privilege('anon', 'public.get_earnings(date, date, uuid)', 'EXECUTE'), 'anon still cannot call get_earnings');

select * from finish();
rollback;
