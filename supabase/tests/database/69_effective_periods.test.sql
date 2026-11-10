-- T17.11: the inactive schedule model supplies court-aware booking periods and their operating-day prices.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
create function pg_temp.at(p_day date, p_time time) returns timestamptz language sql as $$
  select (p_day + p_time) at time zone 'Asia/Manila'
$$;
grant execute on function pg_temp.at(date, time) to anon, authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001711', 'effective-period-staff@example.com');
insert into public.venue_members (venue_id, user_id, role)
values (private.default_venue_id(), '00000000-0000-0000-0000-000000001711', 'staff');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate)
values ('c0000000-0000-0000-0000-000000001711', private.default_venue_id(), 'Effective Period Test Court', 'tennis', 300);

create temp table fx as
select private.local_today(private.default_venue_id()) + 5 as d,
       extract(dow from private.local_today(private.default_venue_id()) + 5)::smallint as dow,
       extract(dow from private.local_today(private.default_venue_id()) + 6)::smallint as next_dow;
grant select on fx to anon, authenticated;

-- Exercise the replacement engine on this fixture only; the venue's server activation remains off by default.
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = private.default_venue_id()), false,
  'the replacement engine remains disabled until an explicit activation');
update public.venue_schedule_state set schedule_v2_active = true where venue_id = private.default_venue_id();
insert into public.court_schedule_modes (venue_id, court_id, schedule_mode)
values (private.default_venue_id(), 'c0000000-0000-0000-0000-000000001711', 'custom')
on conflict (venue_id, court_id) do update set schedule_mode = excluded.schedule_mode;
insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
select private.default_venue_id(), 'c0000000-0000-0000-0000-000000001711', dow, s, e
from fx cross join (values (360, 600), (720, 1560)) p(s, e);
insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000001711', (select dow from fx), 1, 999),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000001711', (select next_dow from fx), 1, 111);

select is((select count(*)::int from private.effective_open_periods(private.default_venue_id(),
  'c0000000-0000-0000-0000-000000001711', (select d from fx))), 2,
  'a custom court resolves to its two separate open periods');
select is(private.operating_day_of(private.default_venue_id(), 'c0000000-0000-0000-0000-000000001711',
  pg_temp.at((select d from fx) + 1, '01:00')),
  (select d from fx), 'the after-midnight period belongs to its owning weekday');
select is(private.operating_day_of(private.default_venue_id(), 'c0000000-0000-0000-0000-000000001711',
  pg_temp.at((select d from fx), '11:00')),
  null::date, 'a closed gap has no operating-day owner');
select is(private.slot_price('c0000000-0000-0000-0000-000000001711', pg_temp.at((select d from fx) + 1, '01:00')),
  999::numeric, 'the 1 AM slot uses the rate for the previous operating day');
select is(private.range_price('c0000000-0000-0000-0000-000000001711',
  tstzrange(pg_temp.at((select d from fx) + 1, '01:00'), pg_temp.at((select d from fx) + 1, '02:00'))),
  999::numeric, 'a one-hour after-midnight booking is priced from its operating day');

create temp view effective_day as
select * from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-000000001711');
grant select on effective_day to anon;
-- T18.3: walk-ins are off by default; this file records walk-ins, so its venues switch them on (as postgres).
update public.venue_settings set walk_ins_enabled = true;
set local role anon;
select is((select count(*)::int from effective_day), 18, 'availability lists both periods, not the closed gap');
select is((select count(*)::int from effective_day where slot_start = pg_temp.at((select d from fx), '10:00')), 0,
  'availability omits the first slot in a closed gap');
select is((select count(*)::int from effective_day where slot_start = pg_temp.at((select d from fx), '11:00')), 0,
  'availability omits the final slot in a closed gap');
select is((select count(*)::int from effective_day where slot_start = pg_temp.at((select d from fx) + 1, '01:00')), 1,
  'availability includes the after-midnight continuation under the owning day');
reset role;

select is(pg_temp.hint_of(format('select * from public.create_booking(%L, %L, 1, %L, %L, %L)',
  'c0000000-0000-0000-0000-000000001711', pg_temp.at((select d from fx), '10:00'),
  'Gap booking', 'gap@example.com', '09171234567')), 'outside_hours', 'online booking cannot start in a closed gap');
select is(pg_temp.hint_of(format('select * from public.create_booking(%L, %L, 4, %L, %L, %L)',
  'c0000000-0000-0000-0000-000000001711', pg_temp.at((select d from fx), '09:00'),
  'Across gap', 'across@example.com', '09171234567')), 'outside_hours',
  'a booking cannot span two periods even when both endpoints are open');
select is(pg_temp.hint_of(format('select * from public.create_booking(%L, %L, 1, %L, %L, %L)',
  'c0000000-0000-0000-0000-000000001711', pg_temp.at((select d from fx) + 1, '01:00'),
  'Overnight booking', 'night@example.com', '09171234567')), null,
  'online booking inside an overnight continuation is accepted');
select is((select total_amount from public.bookings where guest_name = 'Overnight booking'), 999::numeric,
  'the overnight booking stores the operating-day hourly price');

insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
select private.default_venue_id(), 'c0000000-0000-0000-0000-000000001711',
       pg_temp.at(d, '07:00'), pg_temp.at(d, '08:00'), 'T17.11 blackout'
from fx;
select is(pg_temp.hint_of(format('select * from public.create_booking(%L, %L, 1, %L, %L, %L)',
  'c0000000-0000-0000-0000-000000001711', pg_temp.at((select d from fx), '07:00'),
  'Blackout booking', 'blackout@example.com', '09171234567')), 'blackout', 'open periods do not bypass blackouts');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001711","role":"authenticated"}';
select is(pg_temp.hint_of(format('select * from public.create_walk_in(%L, %L, 1, %L)',
  'c0000000-0000-0000-0000-000000001711', pg_temp.at((select d from fx), '10:00'), 'Gap walk in')),
  'outside_hours', 'a walk-in cannot start in a closed gap');
reset role;

insert into public.bookings (id, reference_code, venue_id, court_id, guest_name, guest_email, during,
  total_amount, status, source, expires_at)
select 'd0000000-0000-0000-0000-000000001711', 'CB-ABCDEF', private.default_venue_id(),
  'c0000000-0000-0000-0000-000000001711', 'Active hold', 'hold@example.com',
  tstzrange(pg_temp.at(d, '08:00'), pg_temp.at(d, '09:00')), 300, 'pending_payment', 'online', now() + interval '1 hour'
from fx;
select is((select status from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-000000001711')
  where slot_start = pg_temp.at((select d from fx), '08:00')), 'booked', 'an unexpired pending hold still occupies its slot');
select is(pg_temp.hint_of(format('select * from public.create_booking(%L, %L, 1, %L, %L, %L)',
  'c0000000-0000-0000-0000-000000001711', pg_temp.at((select d from fx), '08:00'),
  'Over hold', 'overhold@example.com', '09171234567')), 'slot_unavailable', 'booking RPC preserves active-hold exclusion');
select throws_ok(format('insert into public.bookings (reference_code, venue_id, court_id, guest_name, during, total_amount, status, source) values (%L, %L, %L, %L, tstzrange(%L, %L), 300, %L, %L)',
  'CB-GHJKLM', private.default_venue_id(), 'c0000000-0000-0000-0000-000000001711', 'Direct overlap',
  pg_temp.at((select d from fx), '08:00'), pg_temp.at((select d from fx), '09:00'), 'confirmed', 'online'),
  '23P01', null, 'the database exclusion constraint still rejects a direct overlapping booking');
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = private.default_venue_id()), true,
  'the test enables replacement rules only for its rollback-scoped fixture');
select * from finish();
rollback;
