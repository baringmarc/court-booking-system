-- T17.14: staff schedule reads are venue-scoped and preserve effective period boundaries.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
create temp table fx as select v.id as venue_id, private.local_today(v.id) + 5 as d,
  extract(dow from private.local_today(v.id) + 5)::smallint as dow
  from public.venues v where v.id = private.default_venue_id();
grant select on fx to authenticated;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001741', 'staff-schedule-player@example.com'),
  ('00000000-0000-0000-0000-000000001742', 'staff-schedule-staff@example.com');
insert into public.venue_members (venue_id, user_id, role)
select venue_id, '00000000-0000-0000-0000-000000001742', 'staff' from fx;
insert into public.courts (id, venue_id, name, sport, default_hourly_rate)
select 'c0000000-0000-0000-0000-000000001741', venue_id, 'Staff schedule test court', 'tennis', 300 from fx;
update public.venue_schedule_state set schedule_v2_active = true where venue_id = (select venue_id from fx);
update public.court_schedule_modes set schedule_mode = 'custom' where court_id = 'c0000000-0000-0000-0000-000000001741';
insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
select venue_id, 'c0000000-0000-0000-0000-000000001741', dow, s, e
from fx cross join (values (360, 480), (480, 600), (1320, 1560)) p(s,e);
select has_function('public', 'get_staff_schedule', array['uuid','date'], 'staff schedule RPC exists');
select ok(not has_function_privilege('anon', 'public.get_staff_schedule(uuid,date)', 'execute'), 'anonymous cannot execute staff schedule');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001742","role":"authenticated"}';
select is((select count(*)::int from public.get_staff_schedule((select venue_id from fx), (select d from fx))
where court_id = 'c0000000-0000-0000-0000-000000001741'), 3, 'staff sees separate periods for selected date');
select is((select count(*)::int from public.get_staff_schedule((select venue_id from fx), (select d from fx))
where court_id = 'c0000000-0000-0000-0000-000000001741' and period_start = ((select d from fx) + time '06:00') at time zone 'Asia/Manila'
and period_end = ((select d from fx) + time '08:00') at time zone 'Asia/Manila'), 1, 'touching periods retain boundary');
select is((select count(*)::int from public.get_staff_schedule((select venue_id from fx), (select d from fx))
where court_id = 'c0000000-0000-0000-0000-000000001741' and period_start = ((select d from fx) + time '22:00') at time zone 'Asia/Manila'
and period_end = (((select d from fx) + 1) + time '02:00') at time zone 'Asia/Manila'), 1, 'overnight period belongs to selected operating date');
select is((select count(*)::int from public.get_staff_schedule((select venue_id from fx), (select d from fx) + 1)
where court_id = 'c0000000-0000-0000-0000-000000001741'), 0, 'periods are selected by date');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001741","role":"authenticated"}';
select throws_ok(format('select * from public.get_staff_schedule(%L::uuid, %L::date)', (select venue_id from fx), (select d from fx)), 'P0001', 'You cannot read this venue schedule.', 'non-member cannot read staff schedule');
reset role;
select * from finish();
rollback;
