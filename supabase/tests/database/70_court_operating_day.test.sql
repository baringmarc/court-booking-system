-- T17.11: court-specific ownership follows the custom timetable without changing venue-only semantics.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into public.courts (id, venue_id, name, sport, default_hourly_rate)
values ('c0000000-0000-0000-0000-000000001710', private.default_venue_id(), 'T17.11 Court Ownership', 'tennis', 300);
create temp table fx as
select private.local_today(private.default_venue_id()) + 5 as d,
       extract(dow from private.local_today(private.default_venue_id()) + 5)::smallint as dow;
update public.venue_schedule_state set schedule_v2_active = true where venue_id = private.default_venue_id();
update public.court_schedule_modes set schedule_mode = 'custom'
where court_id = 'c0000000-0000-0000-0000-000000001710';
insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
select private.default_venue_id(), 'c0000000-0000-0000-0000-000000001710', dow, s, e
from fx cross join (values (360, 600), (720, 1500)) p(s, e);

select is(private.operating_day_of(private.default_venue_id(), 'c0000000-0000-0000-0000-000000001710',
  ((select d from fx) + 1 + time '00:30') at time zone 'Asia/Manila'), (select d from fx),
  'court-aware operating-day ownership includes the court custom overnight period');
select is(private.operating_day_of(private.default_venue_id(), 'c0000000-0000-0000-0000-000000001710',
  ((select d from fx) + time '11:00') at time zone 'Asia/Manila'), null::date,
  'court-aware ownership leaves the custom closed gap unowned');
select is((select count(*)::int from private.effective_open_periods(private.default_venue_id(),
  'c0000000-0000-0000-0000-000000001710', (select d from fx))), 2,
  'custom court resolves exactly its two intervals');
select * from finish();
rollback;
