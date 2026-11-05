-- T17.17 regression: the legacy-write guards must not break service_role (e2e cleanup, Edge Functions), which has no
-- usage on the private schema.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into public.venues (id, slug, status) values ('a0000000-0000-0000-0000-000000001791', 'e2e-cutover-sr', 'active');
insert into public.venue_settings (venue_id, name, timezone) values ('a0000000-0000-0000-0000-000000001791', 'E2E Cutover SR', 'Asia/Manila');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate)
values ('c0000000-0000-0000-0000-000000001791', 'a0000000-0000-0000-0000-000000001791', 'E2E Cutover SR', 'tennis', 100);
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select 'a0000000-0000-0000-0000-000000001791', d, '06:00', '22:00' from generate_series(0, 6) d;
select private.activate_schedule_v2('a0000000-0000-0000-0000-000000001791');

set local role service_role;
select lives_ok($$ insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price)
  values ('a0000000-0000-0000-0000-000000001791', 'c0000000-0000-0000-0000-000000001791', 1, 9, 300) $$,
  'service_role can write rates of an active venue');
select lives_ok($$ update public.operating_hours set close_time = '21:00' where venue_id = 'a0000000-0000-0000-0000-000000001791' and day_of_week = 1 $$,
  'service_role can update hours of an active venue');
select lives_ok($$ delete from public.operating_hours where venue_id = 'a0000000-0000-0000-0000-000000001791' $$,
  'service_role can delete hours of an active venue');
reset role;

select * from finish();
rollback;
