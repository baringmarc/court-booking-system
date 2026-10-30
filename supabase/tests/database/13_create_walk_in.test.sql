-- T4.8: create_walk_in (and create_booking still behaving after the shared-validation refactor).
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

-- Open around the clock today so "the slot in progress now" always exists; normal hours on other days.
update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.operating_hours set open_time = '00:00', close_time = '24:00'
where day_of_week = extract(dow from private.local_today())::smallint;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.venue_members (venue_id, user_id, role)
select id, '22222222-2222-2222-2222-222222222222', 'staff' from public.venues where slug = 'claudex-courts';
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000001', 'Walk-in Court', 'tennis', 500);

create temp table fx as
select date_trunc('hour', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila' as current_slot,
       (private.local_today() + 3 + time '10:00') at time zone 'Asia/Manila' as t10,
       (private.local_today() + 3 + time '05:00') at time zone 'Asia/Manila' as t05,
       (private.local_today() + (select booking_window_days from public.venue_settings) + 5 + time '10:00') at time zone 'Asia/Manila' as beyond_window;
create temp table w (label text primary key, id uuid, ref text);
grant select on fx to anon, authenticated;
grant select, insert on w to authenticated;
insert into public.blackouts (court_id, starts_at, ends_at, reason)
select 'c0000000-0000-0000-0000-000000000001', t10 + interval '4 hours', t10 + interval '5 hours', 'test' from fx;

-- Access
select ok(not has_function_privilege('anon', 'public.create_walk_in(uuid, timestamptz, integer, text, text, public.payment_method, numeric, text)', 'execute'), 'anon cannot record walk-ins');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000001', (select t10 from fx), 1, 'Walker') $$),
  'forbidden', 'players cannot record walk-ins');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select current_slot from fx), 1) $$),
  'slot_started', 'online bookings still cannot start in the slot that is in progress');

-- As the admin
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
insert into w select 'now', r.id, r.reference_code
from fx, public.create_walk_in('c0000000-0000-0000-0000-000000000001', fx.current_slot, 1, ' Walk-in Wendy ', '0917 555 0000') r;
select matches((select ref from w where label = 'now'), '^CB-[A-HJ-NP-Z2-9]{6}$', 'a walk-in gets a normal reference code');

reset role;
select results_eq(
  $$ select bk.status::text, bk.source::text, bk.created_by, bk.user_id, bk.guest_name, bk.guest_phone, bk.total_amount, bk.expires_at is null
     from public.bookings bk join w on w.id = bk.id where w.label = 'now' $$,
  $$ values ('confirmed', 'walk_in', '22222222-2222-2222-2222-222222222222'::uuid, null::uuid, 'Walk-in Wendy', '09175550000', 500.00::numeric, true) $$,
  'the walk-in starts in the current slot and is confirmed, recorded by the admin'
);
select results_eq(
  $$ select p.method::text, p.amount, p.review_status::text, p.recorded_by, p.reviewed_by
     from public.payments p join w on w.id = p.booking_id where w.label = 'now' $$,
  $$ values ('cash', 500.00::numeric, 'approved', '22222222-2222-2222-2222-222222222222'::uuid, '22222222-2222-2222-2222-222222222222'::uuid) $$,
  'it has one approved cash payment for the server price, recorded by the admin'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000001', (select current_slot from fx), 1, 'Second') $$),
  'slot_unavailable', 'walk-ins respect the no-overlap rule');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000001', (select current_slot - interval '1 hour' from fx), 1, 'Late') $$),
  'slot_started', 'a slot that has already ended cannot be booked, even as a walk-in');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000001', (select t05 from fx), 1, 'Early') $$),
  'outside_hours', 'walk-ins respect operating hours');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000001', (select t10 + interval '4 hours' from fx), 1, 'Blocked') $$),
  'blackout', 'walk-ins respect blackouts');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000001', (select t10 + interval '30 minutes' from fx), 1, 'Odd') $$),
  'not_aligned', 'walk-ins must start on the hour');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000001', (select t10 from fx), 1, '  ') $$),
  'invalid_input', 'the customer name is required');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000001', (select t10 from fx), 1, 'Neg', null, 'cash', -1) $$),
  'invalid_input', 'the amount received cannot be negative');

-- Discount and other methods
insert into w select 'discount', r.id, r.reference_code
from fx, public.create_walk_in('c0000000-0000-0000-0000-000000000001', fx.t10, 2, 'Discounted', null, 'gcash', 800, ' REF-1 ') r;
reset role;
select results_eq(
  $$ select bk.total_amount, p.amount, p.method::text, p.reference_number
     from public.bookings bk join public.payments p on p.booking_id = bk.id join w on w.id = bk.id where w.label = 'discount' $$,
  $$ values (1000.00::numeric, 800.00::numeric, 'gcash', 'REF-1') $$,
  'the booking keeps the server price while the payment records the amount actually received'
);

-- Walk-ins skip the booking window
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000001', (select beyond_window from fx), 1, 'Far ahead') $$),
  null, 'walk-ins can be recorded beyond the online booking window');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select beyond_window + interval '2 hours' from fx), 1) $$),
  'outside_window', 'online bookings still respect the booking window');

-- The walk-in shows as booked to everyone
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(
  (select status from public.get_availability((select (t10 at time zone 'Asia/Manila')::date from fx), 'c0000000-0000-0000-0000-000000000001')
   where slot_start = (select t10 from fx)),
  'booked', 'availability shows the walk-in slot as booked'
);
reset role;
select ok(not has_function_privilege('anon', 'private.validate_booking_slot(uuid, timestamptz, integer, boolean)', 'execute'), 'clients cannot call the shared validator');
select ok(has_function_privilege('authenticated', 'public.create_walk_in(uuid, timestamptz, integer, text, text, public.payment_method, numeric, text)', 'execute'), 'authenticated (admins) can call create_walk_in');

select * from finish();
rollback;
