-- T17.12: scheduling dependants use every court's effective periods.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text; begin execute p_sql; return null; exception when others then
  get stacked diagnostics h = pg_exception_hint; return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate); end $$;
create function pg_temp.at(p_day date, p_time time) returns timestamptz language sql as $$
  select (p_day + p_time) at time zone 'Asia/Manila' $$;
grant execute on function pg_temp.at(date, time) to authenticated;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001712', 'schedule-dependants@example.com');
insert into public.venue_members (venue_id, user_id, role) values
  (private.default_venue_id(), '00000000-0000-0000-0000-000000001712', 'staff');
update public.courts set is_active = false where venue_id = private.default_venue_id();
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000001721', private.default_venue_id(), 'Schedule court A', 'tennis', 300),
  ('c0000000-0000-0000-0000-000000001722', private.default_venue_id(), 'Schedule court B', 'tennis', 300);
create temp table fx as select private.local_today(private.default_venue_id()) + 5 as d,
  extract(dow from private.local_today(private.default_venue_id()) + 5)::smallint as dow;
grant select on fx to authenticated;
update public.venue_schedule_state set schedule_v2_active = true where venue_id = private.default_venue_id();
update public.court_schedule_modes set schedule_mode = 'custom' where court_id in
  ('c0000000-0000-0000-0000-000000001721', 'c0000000-0000-0000-0000-000000001722');
insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
select private.default_venue_id(), c, dow, s, e from fx cross join (values
 ('c0000000-0000-0000-0000-000000001721'::uuid, 360, 600),
 ('c0000000-0000-0000-0000-000000001721'::uuid, 720, 840),
 ('c0000000-0000-0000-0000-000000001722'::uuid, 480, 600)) as p(c,s,e);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001712","role":"authenticated"}';
select is(pg_temp.hint_of(format('select public.create_open_play(array[%L,%L]::uuid[],%L,%L,%L)',
 'c0000000-0000-0000-0000-000000001721', 'c0000000-0000-0000-0000-000000001722',
 pg_temp.at((select d from fx), '07:00'), pg_temp.at((select d from fx), '08:00'), 'Different hours')),
 'outside_hours', 'session must fit the effective hours of every selected court');
select is(pg_temp.hint_of(format('select public.create_open_play(array[%L]::uuid[],%L,%L,%L)',
 'c0000000-0000-0000-0000-000000001721', pg_temp.at((select d from fx), '09:00'),
 pg_temp.at((select d from fx), '13:00'), 'Across gap')), 'outside_hours', 'session cannot span a closed gap');
select is(pg_temp.hint_of(format('select public.create_open_play(array[%L,%L]::uuid[],%L,%L,%L)',
 'c0000000-0000-0000-0000-000000001721', 'c0000000-0000-0000-0000-000000001722',
 pg_temp.at((select d from fx), '08:00'), pg_temp.at((select d from fx), '09:00'), 'Shared hours')),
 null, 'session within both courts effective hours succeeds');
select is((select (c->>'open_hours')::numeric from jsonb_array_elements(public.get_earnings((select d from fx), (select d from fx), private.default_venue_id())->'courts') c where c->>'court_id' = 'c0000000-0000-0000-0000-000000001721'), 6::numeric, 'earnings counts separate effective periods');
select is((select (c->>'open_play_hours')::numeric from jsonb_array_elements(public.get_earnings((select d from fx), (select d from fx), private.default_venue_id())->'courts') c where c->>'court_id' = 'c0000000-0000-0000-0000-000000001721'), 1::numeric, 'earnings counts open play inside effective periods');
reset role;
update public.operating_hours set is_closed = true where venue_id = private.default_venue_id();
set local role authenticated;
select is((select i->>'done' from jsonb_array_elements(public.venue_setup_status(private.default_venue_id())->'items') i where i->>'key' = 'hours'), 'true', 'readiness recognizes custom-only court hours');
reset role;
delete from public.court_open_periods where court_id in
  ('c0000000-0000-0000-0000-000000001721', 'c0000000-0000-0000-0000-000000001722');
select is((select count(*)::int from public.open_play_sessions where title = 'Shared hours'), 1, 'existing session survives schedule change');
set local role authenticated;
select is(pg_temp.hint_of(format('select public.update_open_play(%L, array[%L,%L]::uuid[], %L, %L, %L)',
  (select id from public.open_play_sessions where title = 'Shared hours'),
  'c0000000-0000-0000-0000-000000001721', 'c0000000-0000-0000-0000-000000001722',
  pg_temp.at((select d from fx), '08:00'), pg_temp.at((select d from fx), '09:00'), 'Updated title')),
  null, 'metadata-only update remains possible after effective periods close');
reset role;
select * from finish();
rollback;
