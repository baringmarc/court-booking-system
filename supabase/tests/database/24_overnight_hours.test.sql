-- T9.9: overnight and 24-hour opening hours. A slot belongs to its operating day: listed, priced, windowed and
-- validated under it. Plus set_operating_hours and the no-overlap rule, and the T9.5/T9.8 follow-ups.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'nameless@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set full_name = null where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.venue_members (venue_id, user_id, role)
select id, '22222222-2222-2222-2222-222222222222', 'staff' from public.venues where slug = 'claudex-courts';
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000001', 'Night Court', 'tennis', 300);

-- d: an overnight day (06:00 → 05:00 the next morning). e: a 24-hour day (00:00 → 24:00, the only way to set one).
-- w: the last day of the booking window (30 days), also overnight. Its weekday is the one before d's
-- (30 = 2 mod 7), and d opens at 06:00, so 06:00–05:00 fits. Normal hours elsewhere.
update public.venue_settings set booking_window_days = 30;
create temp table fx as
select d, d + 4 as e, w, extract(dow from d)::smallint as dow_d, extract(dow from d + 1)::smallint as dow_next,
       extract(dow from d + 4)::smallint as dow_e, extract(dow from w)::smallint as dow_w
from (select private.local_today() + 3 as d, private.local_today() + 30 as w) x; -- = operating_today() once the hours below are set
grant select on fx to anon, authenticated;

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.operating_hours set close_time = '05:00' where day_of_week = (select dow_d from fx);
update public.operating_hours set open_time = '00:00', close_time = '24:00' where day_of_week = (select dow_e from fx);
update public.operating_hours set close_time = '05:00' where day_of_week = (select dow_w from fx);

-- A night rate on d's row at 1 AM, and a different one on the next day's row at 1 AM (must not be used).
insert into public.court_rates (court_id, day_of_week, start_hour, price)
select 'c0000000-0000-0000-0000-000000000001'::uuid, dow_d, 1, 999 from fx
union all
select 'c0000000-0000-0000-0000-000000000001'::uuid, dow_next, 1, 111 from fx;

create function pg_temp.at(p_day date, p_time time) returns timestamptz language sql as $$
  select (p_day + p_time) at time zone 'Asia/Manila'
$$;
grant execute on function pg_temp.at(date, time) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The operating day
-- ---------------------------------------------------------------------------
select is(
  private.operating_day_range((select d from fx)),
  tstzrange(pg_temp.at((select d from fx), '06:00'), pg_temp.at((select d from fx) + 1, '05:00')),
  'an overnight day runs from its opening to the close the next morning'
);
select is(
  upper(private.operating_day_range((select e from fx))) - lower(private.operating_day_range((select e from fx))),
  interval '24 hours', '12 AM to midnight is 24 hours'
);
select is(private.operating_day_of(pg_temp.at((select d from fx) + 1, '01:00')), (select d from fx),
  'a 1 AM slot after the overnight day belongs to the previous date');
select is(private.operating_day_of(pg_temp.at((select d from fx) + 1, '05:30')), null::date,
  'between the overnight close and the next opening the venue is closed');
select is(private.operating_day_of(pg_temp.at((select d from fx) + 1, '06:00')), (select d from fx) + 1,
  'the next day starts at its own opening');
select ok(private.operating_today() in (private.local_today(), private.local_today() - 1),
  'today is the local date, or the previous date while an overnight day is still running');

-- ---------------------------------------------------------------------------
-- get_availability lists the whole operating day, priced by that day's rates
-- ---------------------------------------------------------------------------
create temp view night as
select * from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-000000000001');
grant select on night to anon;

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from night), 23, 'the overnight day has 23 slots (06:00 to 05:00)');
select is((select max(slot_end) from night), pg_temp.at((select d from fx) + 1, '05:00'), 'the last slot ends at 05:00 the next morning');
select results_eq(
  $$ select status, price from night where slot_start = pg_temp.at((select d from fx) + 1, '01:00') $$,
  $$ values ('free', 999::numeric) $$,
  'the 1 AM slot is listed under d and priced from d''s rate row (999), not the next day''s (111)'
);
select is(
  (select count(*)::int from public.get_availability((select d from fx) + 1, 'c0000000-0000-0000-0000-000000000001')
   where slot_start < pg_temp.at((select d from fx) + 1, '06:00')), 0,
  'the next date does not list the after-midnight slots again'
);
select is(
  (select count(*)::int from public.get_availability((select e from fx), 'c0000000-0000-0000-0000-000000000001')), 24,
  'a 24-hour day has 24 slots'
);
reset role;

-- ---------------------------------------------------------------------------
-- create_booking on the operating day
-- ---------------------------------------------------------------------------
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at((select d from fx) + 1, '01:00'), 1, 'Night Owl', 'owl@example.com', '09171234567') $$), null,
  'a guest books the 1 AM slot');
select is(
  (select total_amount from public.bookings where guest_name = 'Night Owl'), 999::numeric,
  'it is priced from the operating day''s rates'
);
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at((select d from fx), '23:00'), 2, 'Midnight', 'mid@example.com', '09171234567') $$), null,
  'a booking across midnight inside one operating day is fine');
select is(
  (select total_amount from public.bookings where guest_name = 'Midnight'), 300 + 300::numeric,
  'it sums the 23:00 and 00:00 slots from d''s row (no rate set there, so the default)'
);
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at((select d from fx) + 1, '04:00'), 2, 'X', 'x@example.com', '09171234567') $$), 'multi_day',
  'a booking past the overnight close (into the next day) is refused');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at((select d from fx) + 1, '05:00'), 1, 'X', 'x@example.com', '09171234567') $$), 'outside_hours',
  'a booking in the gap between days is outside opening hours');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at((select e from fx), '23:00'), 1, 'Late', 'late@example.com', '09171234567') $$), null,
  'the last (11 PM) slot of a 24-hour day books');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at((select e from fx), '23:00'), 2, 'X', 'x@example.com', '09171234567') $$), 'multi_day',
  'a booking from the end of a 24-hour day into the next date is refused');

-- The window counts operating days: the last window day's after-midnight slots are in, the next day is out.
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at((select w from fx) + 1, '01:00'), 1, 'Window Edge', 'edge@example.com', '09171234567') $$), null,
  'the 1 AM slot after the last window day books (it belongs to that day)');
select is(
  (select count(*)::int from public.get_availability((select w from fx), 'c0000000-0000-0000-0000-000000000001')
   where slot_start = pg_temp.at((select w from fx) + 1, '02:00')), 1,
  'the last window day lists its after-midnight slots'
);
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at((select w from fx) + 1, '06:00'), 1, 'X', 'x@example.com', '09171234567') $$),
  'outside_window', 'the next operating day, opening the same morning, is outside the window');

-- ---------------------------------------------------------------------------
-- Walk-ins and the follow-ups
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000001',
  pg_temp.at((select d from fx) + 1, '02:00'), 1, 'Night Walk-in') $$), null,
  'a walk-in at 2 AM books under the overnight day');
reset role;
select is((select total_amount from public.bookings where guest_name = 'Night Walk-in'), 300::numeric,
  'the walk-in is priced from d''s row (default at 2 AM)');

select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
set local role authenticated;
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at((select d from fx), '08:00'), 1) $$), null, 'a signed-in player with no name books');
reset role;
select is(
  (select guest_name from public.bookings where user_id = '11111111-1111-1111-1111-111111111111'), 'Player',
  'their contact name is "Player", never the email''s local part (it would be public as the first name)'
);

-- ---------------------------------------------------------------------------
-- set_operating_hours and the no-overlap rule
-- ---------------------------------------------------------------------------
-- Every day 06:00–22:00, except Monday: 08:00 until p_overnight_close (an overnight close when it's before 08:00).
create function pg_temp.week(p_overnight_close text) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object(
    'day_of_week', g, 'open_time', case when g = 1 then '08:00' else '06:00' end,
    'close_time', case when g = 1 then p_overnight_close else '22:00' end, 'is_closed', false))
  from generate_series(0, 6) g
$$;
grant execute on function pg_temp.week(text) to authenticated;

set local role anon;
select throws_ok($$ select public.set_operating_hours(pg_temp.week('22:00')) $$, '42501', null,
  'anon cannot call set_operating_hours');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok($$ select public.set_operating_hours(pg_temp.week('22:00')) $$, 'P0001',
  'Only staff can change opening hours.', 'a player cannot change hours');

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select throws_ok($$ select public.set_operating_hours((pg_temp.week('22:00')) - 0) $$, 'P0001',
  'Send the hours for all seven days.', 'all seven days are required');
select throws_ok($$ select public.set_operating_hours(jsonb_set(pg_temp.week('22:00'), '{2,open_time}', '"06:30"')) $$, 'P0001',
  'Opening times must be whole hours from 00:00 to 23:00.', 'times must be whole hours');
select throws_ok($$ select public.set_operating_hours(jsonb_set(pg_temp.week('22:00'), '{2,open_time}', '"24:00"')) $$, 'P0001',
  'Opening times must be whole hours from 00:00 to 23:00.', 'a 24:00 opening is refused (it would start the day on the next date)');
select throws_ok($$ select public.set_operating_hours(jsonb_set(pg_temp.week('22:00'), '{2,close_time}', '"25:00"')) $$, 'P0001',
  'Closing times must be whole hours from 00:00 to 24:00.', 'closing times stop at 24:00');
select throws_ok($$ select public.set_operating_hours(jsonb_set(pg_temp.week('22:00'), '{2,day_of_week}', '"7"')) $$, 'P0001',
  'Each day needs a day of the week from 0 (Sunday) to 6 (Saturday).', 'the day of the week must be 0–6');
select throws_ok($$ select public.set_operating_hours(jsonb_set(pg_temp.week('22:00'), '{2,is_closed}', '"yes"')) $$, 'P0001',
  'Closed must be true or false.', 'closed must be a boolean');
select throws_ok($$ select public.set_operating_hours(jsonb_set(pg_temp.week('22:00'), '{2,day_of_week}', '3')) $$, 'P0001',
  'Send the hours for all seven days.', 'a repeated day (so one is missing) is refused');
select throws_ok($$ select public.set_operating_hours(pg_temp.week('07:00')) $$, 'P0001',
  'Monday runs past Tuesday''s opening time. Close earlier, or open Tuesday later.',
  'Monday closing at 07:00 the next day overlaps Tuesday''s 06:00 opening');
select lives_ok($$ select public.set_operating_hours(pg_temp.week('06:00')) $$,
  'Monday may run overnight until exactly Tuesday''s opening');
reset role;
select results_eq(
  $$ select day_of_week::int, open_time, close_time, is_closed from public.operating_hours where day_of_week in (0, 1) order by day_of_week $$,
  $$ values (0, '06:00'::time, '22:00'::time, false), (1, '08:00'::time, '06:00'::time, false) $$,
  'set_operating_hours stored the week'
);
set constraints public.operating_hours_no_overlap immediate;
select throws_ok(
  $$ update public.operating_hours set open_time = '04:00' where day_of_week = 2 $$,
  'P0001', null, 'a direct write that makes days overlap is refused too'
);
-- The check serialises on an advisory lock (T9.11), so concurrent single-day updates can't both pass into an overlap.
select ok(
  exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and granted),
  'the overlap check took its advisory lock'
);
select throws_ok(
  $$ update public.operating_hours set open_time = '24:00' where day_of_week = 3 $$,
  '23514', null, 'a direct write can''t open a day at 24:00 either'
);

select * from finish();
rollback;
