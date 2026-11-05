-- T17.13: public court schedules expose periods without exposing private schedule tables.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);
create function pg_temp.at(p_day date, p_time time) returns timestamptz language sql as $$
  select (p_day + p_time) at time zone 'Asia/Manila' $$;
grant execute on function pg_temp.at(date, time) to anon, authenticated;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001731', 'schedule-player@example.com'),
  ('00000000-0000-0000-0000-000000001732', 'schedule-staff@example.com');
create temp table fx as select v.id as venue_id, v.slug, private.local_today(v.id) + 5 as d,
  extract(dow from private.local_today(v.id) + 5)::smallint as dow
  from public.venues v where v.id = private.default_venue_id();
grant select on fx to anon, authenticated;
insert into public.venue_members (venue_id, user_id, role)
select venue_id, '00000000-0000-0000-0000-000000001732', 'staff' from fx;
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) select
  'c0000000-0000-0000-0000-000000001731', venue_id, 'Public schedule test court', 'tennis', 300 from fx;
update public.venue_schedule_state set schedule_v2_active = true where venue_id = (select venue_id from fx);
update public.operating_hours set is_closed = true where venue_id = (select venue_id from fx) and day_of_week = (select dow from fx);
update public.court_schedule_modes set schedule_mode = 'custom' where court_id = 'c0000000-0000-0000-0000-000000001731';
insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
select venue_id, 'c0000000-0000-0000-0000-000000001731', dow, s, e
from fx cross join (values (360, 480), (480, 600), (1320, 1560)) p(s,e);
select has_function('public', 'get_public_schedule', array['text'], 'public schedule RPC exists');
set local role anon;
select is((select count(*)::int from public.get_public_schedule((select slug from fx))
 where court_id = 'c0000000-0000-0000-0000-000000001731' and operating_date = (select d from fx)), 3,
 'custom-only open day returns its three separate periods');
select is((select count(*)::int from public.get_public_schedule((select slug from fx))
 where court_id = 'c0000000-0000-0000-0000-000000001731' and operating_date = (select d from fx)
 and period_start = pg_temp.at((select d from fx), '06:00') and period_end = pg_temp.at((select d from fx), '08:00')), 1,
 'first touching period keeps its own boundary');
select is((select count(*)::int from public.get_public_schedule((select slug from fx))
 where court_id = 'c0000000-0000-0000-0000-000000001731' and operating_date = (select d from fx)
 and period_start = pg_temp.at((select d from fx), '08:00') and period_end = pg_temp.at((select d from fx), '10:00')), 1,
 'second touching period is not merged');
select is((select count(*)::int from public.get_public_schedule((select slug from fx))
 where court_id = 'c0000000-0000-0000-0000-000000001731' and operating_date = (select d from fx)
 and period_start < pg_temp.at((select d from fx), '11:00') and period_end > pg_temp.at((select d from fx), '11:00')), 0,
 'closed gap is not represented as open');
select is((select count(*)::int from public.get_public_schedule((select slug from fx))
 where court_id = 'c0000000-0000-0000-0000-000000001731' and operating_date = (select d from fx)
 and period_start = pg_temp.at((select d from fx), '22:00') and period_end = pg_temp.at((select d from fx) + 1, '02:00')), 1,
 'overnight period is returned on its owning operating date');
select ok((select bool_and(booking_start <= operating_date and booking_end >= operating_date)
 from public.get_public_schedule((select slug from fx)) where court_id = 'c0000000-0000-0000-0000-000000001731'
 and operating_date = (select d from fx)), 'returned booking window includes the operating date');
select throws_ok('select * from public.court_open_periods', '42501', null, 'anon cannot read private court schedule rows directly');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001731","role":"authenticated"}';
select is((select count(*)::int from public.get_public_schedule((select slug from fx))
 where court_id = 'c0000000-0000-0000-0000-000000001731' and operating_date = (select d from fx)), 3,
 'signed-in player sees the same public court periods');
select is((select count(*)::int from public.court_open_periods
 where court_id = 'c0000000-0000-0000-0000-000000001731'), 0,
 'signed-in player cannot read private court schedule rows');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001732","role":"authenticated"}';
select is((select count(*)::int from public.get_public_schedule((select slug from fx))
 where court_id = 'c0000000-0000-0000-0000-000000001731' and operating_date = (select d from fx)), 3,
 'venue staff sees the same public court periods');
reset role;
select is((select count(*)::int from information_schema.parameters where specific_schema = 'public' and specific_name like 'get_public_schedule_%' and parameter_mode = 'OUT' and parameter_name in ('guest_name','guest_email','user_id','phone')), 0,
 'public schedule result exposes no personal data fields');
select * from finish();
rollback;
