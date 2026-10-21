-- T3.4: get_availability. Dates are relative to the venue-local "today" so the test never goes stale.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into public.courts (id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-000000000001', 'Avail Court A', 'tennis', 300, true),
  ('c0000000-0000-0000-0000-000000000002', 'Avail Court B', 'tennis', 300, true),
  ('c0000000-0000-0000-0000-000000000003', 'Avail Archived', 'tennis', 300, false);

-- d = today + 3 in Manila; all fixtures below are on that day.
create temp table fx as
select private.local_today() + 3 as d, private.venue_tz() as tz;
grant select on fx to anon;

-- 10–12 confirmed, 13 stale pending hold, 14 payment_submitted on court A
insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status, expires_at)
select v.ref, 'c0000000-0000-0000-0000-000000000001', 'Fixture',
       tstzrange((fx.d + v.s) at time zone fx.tz, (fx.d + v.e) at time zone fx.tz), 300, v.st::public.booking_status, v.exp
from fx, (values
  ('CB-AAAAAA', time '10:00', time '12:00', 'confirmed',         null::timestamptz),
  ('CB-BBBBBB', time '13:00', time '14:00', 'pending_payment',   now() - interval '1 minute'),
  ('CB-CCCCCC', time '14:00', time '15:00', 'payment_submitted', null::timestamptz)
) as v(ref, s, e, st, exp);

-- 15–16 venue-wide blackout; 17–18 blackout on court B only
insert into public.blackouts (court_id, starts_at, ends_at, reason)
select v.court, (fx.d + v.s) at time zone fx.tz, (fx.d + v.e) at time zone fx.tz, 'test'
from fx, (values
  (null::uuid,                              time '15:00', time '16:00'),
  ('c0000000-0000-0000-0000-000000000002', time '17:00', time '18:00')
) as v(court, s, e);

create temp view a_slots as
select extract(hour from slot_start at time zone 'Asia/Manila')::int as h, *
from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-000000000001');

select is((select count(*)::int from a_slots), 16, 'one slot per hour from 06:00 to 22:00');
select is(
  (select min(slot_start) from a_slots),
  (select (d + time '06:00') at time zone tz from fx),
  'first slot starts at opening time in Manila'
);
select ok((select bool_and(slot_end = slot_start + interval '1 hour') from a_slots), 'slots are one hour long');
select ok(
  (select bool_and(price = private.slot_price(court_id, slot_start)) from a_slots),
  'each slot carries its server-side price'
);
select results_eq(
  $$ select h, status from a_slots where h between 9 and 16 order by h $$,
  $$ values (9, 'free'), (10, 'booked'), (11, 'booked'), (12, 'free'), (13, 'free'), (14, 'booked'), (15, 'blackout'), (16, 'free') $$,
  'booked, stale-hold (free), payment_submitted (booked) and venue-wide blackout statuses'
);
select is(
  (select status from a_slots where h = 17), 'free',
  'a blackout on another court does not affect this court'
);
select is(
  (select status from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-000000000002')
   where extract(hour from slot_start at time zone 'Asia/Manila') = 17),
  'blackout', 'a court-specific blackout marks that court'
);

select ok(
  not exists (select 1 from public.get_availability((select d from fx)) where court_id = 'c0000000-0000-0000-0000-000000000003'),
  'archived courts are not listed'
);
select cmp_ok(
  (select count(distinct court_id)::int from public.get_availability((select d from fx))), '>=', 2,
  'without p_court_id every active court is listed'
);

-- Today: open 00:00–24:00 so the result doesn't depend on the time the tests run.
update public.operating_hours set open_time = '00:00', close_time = '24:00'
where day_of_week = extract(dow from private.local_today())::smallint and not is_closed;
create temp view today_slots as
select * from public.get_availability(private.local_today(), 'c0000000-0000-0000-0000-000000000001');
select is(
  (select status from today_slots where slot_start = private.local_today()::timestamp at time zone 'Asia/Manila'),
  'past', 'today''s 00:00 slot has started, so it is past'
);
select is(
  (select count(*)::int from today_slots where slot_start <= now() and status = 'free'),
  0, 'no started slot is offered as free'
);
select is(
  (select count(*)::int from today_slots where slot_start > now() and status = 'past'),
  0, 'slots that have not started are never past'
);
-- The slot in progress keeps its real status: past only when free, booked when someone is playing.
select is(
  (select status from today_slots where slot_start <= now() and now() < slot_end),
  'past', 'a free slot in progress is past (not bookable online)'
);
insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status)
select 'CB-NQWPLY', 'c0000000-0000-0000-0000-000000000001', 'Playing now',
       tstzrange(date_trunc('hour', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila',
                 date_trunc('hour', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila' + interval '1 hour'), 300, 'confirmed';
select is(
  (select status from public.get_availability(private.local_today(), 'c0000000-0000-0000-0000-000000000001')
   where slot_start <= now() and now() < slot_end),
  'booked', 'a booked slot in progress shows as booked, so walk-ins are not offered it'
);

-- Window and closed days
select is(
  (select count(*)::int from public.get_availability(private.local_today() - 1)), 0,
  'yesterday returns no slots'
);
select is(
  (select count(*)::int from public.get_availability(private.local_today() + (select booking_window_days from public.venue_settings) + 1)), 0,
  'a date past the booking window returns no slots'
);
select cmp_ok(
  (select count(*)::int from public.get_availability(private.local_today() + (select booking_window_days from public.venue_settings), 'c0000000-0000-0000-0000-000000000001')), '>', 0,
  'the last day of the booking window is offered'
);
update public.operating_hours set is_closed = true where day_of_week = extract(dow from (select d from fx))::smallint;
select is(
  (select count(*)::int from public.get_availability((select d from fx))), 0,
  'a closed day returns no slots'
);
update public.operating_hours set is_closed = false where day_of_week = extract(dow from (select d from fx))::smallint;

-- Access
select ok(has_function_privilege('anon', 'public.get_availability(date, uuid)', 'execute'), 'anon can call get_availability');
select ok(has_function_privilege('authenticated', 'public.get_availability(date, uuid)', 'execute'), 'authenticated can call get_availability');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(
  (select count(*)::int from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-000000000001') where status = 'booked'),
  3, 'anon sees busy slots without access to bookings'
);
reset role;
select is(
  (select array_agg(attname::text order by attnum) from pg_attribute
   where attrelid = 'a_slots'::regclass and attnum > 0 and attname <> 'h'),
  array['court_id', 'slot_start', 'slot_end', 'price', 'status', 'booker_first_name'],
  'the result has no personal data columns beyond the booker''s first name (T9.8; 23_booker_names checks it)'
);

select * from finish();
rollback;
