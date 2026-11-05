-- T17.17: schedule cutover. Activation and rollback are service-only; once a venue is active, old clients cannot write
-- legacy hours or rates; rollback refuses data the legacy hours cannot represent and never widens gaps.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

-- Runs one statement and reports how it ended: {"ok":true} or {"_error","_hint","_message"}.
create function pg_temp.attempt(p_sql text) returns jsonb language plpgsql as $$
declare s text; h text; m text;
begin
  execute p_sql;
  return '{"ok":true}'::jsonb;
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint, m = message_text;
  return jsonb_build_object('_error', s, '_hint', coalesce(h, ''), '_message', m);
end $$;
create function pg_temp.call_json(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb; s text; h text;
begin
  execute p_sql into v;
  return coalesce(v, 'null'::jsonb);
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return jsonb_build_object('_error', s, '_hint', coalesce(h, ''));
end $$;
create function pg_temp.week(p_open text, p_close text) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('day_of_week', d, 'open_time', p_open, 'close_time', p_close, 'is_closed', false) order by d)
  from generate_series(0, 6) d
$$;
grant execute on function pg_temp.attempt(text), pg_temp.call_json(text), pg_temp.week(text, text) to anon, authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001781', 'e2e-cutover-a@example.com'),
  ('00000000-0000-0000-0000-000000001782', 'e2e-cutover-b@example.com'),
  ('00000000-0000-0000-0000-000000001783', 'e2e-cutover-e@example.com');
-- A active guard venue, B legacy venue, C split weekday, D custom court, E round trip, F unrepresentable period.
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-000000001781', 'e2e-cutover-a', 'active'),
  ('a0000000-0000-0000-0000-000000001782', 'e2e-cutover-b', 'active'),
  ('a0000000-0000-0000-0000-000000001783', 'e2e-cutover-c', 'active'),
  ('a0000000-0000-0000-0000-000000001784', 'e2e-cutover-d', 'active'),
  ('a0000000-0000-0000-0000-000000001785', 'e2e-cutover-e', 'active'),
  ('a0000000-0000-0000-0000-000000001786', 'e2e-cutover-f', 'active');
insert into public.venue_settings (venue_id, name, timezone)
select id, 'E2E Cutover ' || slug, 'Asia/Manila' from public.venues where slug like 'e2e-cutover-%';
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000001781', '00000000-0000-0000-0000-000000001781', 'owner'),
  ('a0000000-0000-0000-0000-000000001782', '00000000-0000-0000-0000-000000001782', 'owner'),
  ('a0000000-0000-0000-0000-000000001785', '00000000-0000-0000-0000-000000001783', 'owner');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000001781', 'a0000000-0000-0000-0000-000000001781', 'E2E Cutover A', 'tennis', 100),
  ('c0000000-0000-0000-0000-000000001782', 'a0000000-0000-0000-0000-000000001782', 'E2E Cutover B', 'tennis', 100),
  ('c0000000-0000-0000-0000-000000001783', 'a0000000-0000-0000-0000-000000001783', 'E2E Cutover C', 'tennis', 100),
  ('c0000000-0000-0000-0000-000000001784', 'a0000000-0000-0000-0000-000000001784', 'E2E Cutover D', 'tennis', 100),
  ('c0000000-0000-0000-0000-000000001785', 'a0000000-0000-0000-0000-000000001785', 'E2E Cutover E', 'tennis', 100),
  ('c0000000-0000-0000-0000-000000001786', 'a0000000-0000-0000-0000-000000001786', 'E2E Cutover F', 'tennis', 100);
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v.id, d, '06:00', '22:00' from public.venues v cross join generate_series(0, 6) d where v.slug like 'e2e-cutover-%';
insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values
  ('a0000000-0000-0000-0000-000000001781', 'c0000000-0000-0000-0000-000000001781', 1, 9, 350),
  ('a0000000-0000-0000-0000-000000001782', 'c0000000-0000-0000-0000-000000001782', 1, 9, 350);
-- C: Monday has two periods. D: a custom court. F: a 24-hour period that starts at 6 AM.
delete from public.venue_open_periods where venue_id = 'a0000000-0000-0000-0000-000000001783' and day_of_week = 1;
insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute) values
  ('a0000000-0000-0000-0000-000000001783', 1, 360, 600), ('a0000000-0000-0000-0000-000000001783', 1, 840, 1320);
update public.court_schedule_modes set schedule_mode = 'custom' where court_id = 'c0000000-0000-0000-0000-000000001784';
insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
select 'a0000000-0000-0000-0000-000000001784', 'c0000000-0000-0000-0000-000000001784', d, 360, 1320 from generate_series(0, 6) d;
delete from public.venue_open_periods where venue_id = 'a0000000-0000-0000-0000-000000001786' and day_of_week = 1;
insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
values ('a0000000-0000-0000-0000-000000001786', 1, 360, 1800);
-- E: a booking and a payment that must survive activation and rollback.
insert into public.bookings (id, venue_id, reference_code, court_id, guest_name, during, total_amount, status, source)
select 'b0000000-0000-0000-0000-000000001785', 'a0000000-0000-0000-0000-000000001785', 'CB-TCUTA2',
  'c0000000-0000-0000-0000-000000001785', 'Cutover guest',
  tstzrange((private.local_today('a0000000-0000-0000-0000-000000001785') + 5 + time '10:00') at time zone 'Asia/Manila',
            (private.local_today('a0000000-0000-0000-0000-000000001785') + 5 + time '11:00') at time zone 'Asia/Manila'),
  100, 'confirmed', 'walk_in';
insert into public.payments (booking_id, venue_id, method, amount, review_status)
values ('b0000000-0000-0000-0000-000000001785', 'a0000000-0000-0000-0000-000000001785', 'cash', 100, 'approved');

create temp table snap as
select v.slug, md5(coalesce((select string_agg(h::text, '|' order by h.day_of_week) from public.operating_hours h where h.venue_id = v.id), '')) as hours
from public.venues v where v.slug like 'e2e-cutover-%';
create temp table rev as
select venue_id, schedule_revision from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001781';

-- Privileges: activation and rollback are for postgres and the service role only.
select has_function('private', 'activate_schedule_v2', array['uuid'], 'private.activate_schedule_v2 exists');
select has_function('private', 'deactivate_schedule_v2', array['uuid'], 'private.deactivate_schedule_v2 exists');
select ok(not has_function_privilege('anon', 'private.activate_schedule_v2(uuid)', 'execute'), 'anon cannot execute activation');
select ok(not has_function_privilege('authenticated', 'private.activate_schedule_v2(uuid)', 'execute'), 'authenticated cannot execute activation');
select ok(not has_function_privilege('anon', 'private.deactivate_schedule_v2(uuid)', 'execute'), 'anon cannot execute rollback');
select ok(not has_function_privilege('authenticated', 'private.deactivate_schedule_v2(uuid)', 'execute'), 'authenticated cannot execute rollback');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001781","role":"authenticated"}';
select is(pg_temp.attempt($$ select private.activate_schedule_v2('a0000000-0000-0000-0000-000000001781') $$)->>'_error', '42501',
  'a venue admin cannot call activation');
select is(pg_temp.attempt($$ select private.deactivate_schedule_v2('a0000000-0000-0000-0000-000000001781') $$)->>'_error', '42501',
  'a venue admin cannot call rollback');
reset role;

-- Activation
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001781'), false,
  'a venue starts on the legacy schedule');
select private.activate_schedule_v2('a0000000-0000-0000-0000-000000001781');
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001781'), true,
  'activation switches the venue to schedule v2');
select is((select s.schedule_revision - r.schedule_revision from public.venue_schedule_state s join rev r using (venue_id)), 1,
  'activation bumps the schedule revision once');
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001782'), false,
  'activating one venue leaves another on legacy');

-- Rollback refuses data the legacy hours cannot hold, and writes nothing.
update public.venue_schedule_state set schedule_v2_active = true
where venue_id in ('a0000000-0000-0000-0000-000000001783', 'a0000000-0000-0000-0000-000000001784', 'a0000000-0000-0000-0000-000000001786');
select is(pg_temp.attempt($$ select private.deactivate_schedule_v2('a0000000-0000-0000-0000-000000001783') $$)->>'_error', 'P0001',
  'rollback refuses a weekday with two periods');
select is(pg_temp.attempt($$ select private.deactivate_schedule_v2('a0000000-0000-0000-0000-000000001783') $$)->>'_hint', 'schedule_rollback_unsafe',
  'split weekday rollback carries the schedule_rollback_unsafe hint');
select is(pg_temp.attempt($$ select private.deactivate_schedule_v2('a0000000-0000-0000-0000-000000001784') $$)->>'_error', 'P0001',
  'rollback refuses a venue with a custom court');
select is(pg_temp.attempt($$ select private.deactivate_schedule_v2('a0000000-0000-0000-0000-000000001784') $$)->>'_hint', 'schedule_rollback_unsafe',
  'custom court rollback carries the schedule_rollback_unsafe hint');
select is(pg_temp.attempt($$ select private.deactivate_schedule_v2('a0000000-0000-0000-0000-000000001786') $$)->>'_error', 'P0001',
  'rollback refuses a period the legacy hours cannot represent');
select is(pg_temp.attempt($$ select private.deactivate_schedule_v2('a0000000-0000-0000-0000-000000001786') $$)->>'_hint', 'schedule_rollback_unsafe',
  'unrepresentable period rollback carries the schedule_rollback_unsafe hint');
select is((select count(*)::int from public.venue_schedule_state where schedule_v2_active
  and venue_id in ('a0000000-0000-0000-0000-000000001783', 'a0000000-0000-0000-0000-000000001784', 'a0000000-0000-0000-0000-000000001786')), 3,
  'refused rollbacks leave the venues active');
select is((select count(*)::int from snap s join (
  select v.slug, md5(coalesce((select string_agg(h::text, '|' order by h.day_of_week) from public.operating_hours h where h.venue_id = v.id), '')) as hours
  from public.venues v where v.slug like 'e2e-cutover-%') now using (slug) where s.hours <> now.hours and s.slug in ('e2e-cutover-c', 'e2e-cutover-d', 'e2e-cutover-f')), 0,
  'refused rollbacks never rewrite or widen the legacy hours');
select is((select count(*)::int from public.venue_open_periods where venue_id = 'a0000000-0000-0000-0000-000000001783' and day_of_week = 1), 2,
  'refused rollback keeps the split periods');

-- Safe round trip keeps bookings and payments.
select private.activate_schedule_v2('a0000000-0000-0000-0000-000000001785');
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001785'), true, 'round trip: activated');
select private.deactivate_schedule_v2('a0000000-0000-0000-0000-000000001785');
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001785'), false,
  'rollback of safe data switches the venue back to legacy');
select is((select status::text || total_amount::text from public.bookings where id = 'b0000000-0000-0000-0000-000000001785'), 'confirmed100.00',
  'the booking survives activation and rollback unchanged');
select is((select count(*)::int || ':' || sum(amount)::text from public.payments where booking_id = 'b0000000-0000-0000-0000-000000001785'), '1:100.00',
  'the payment survives activation and rollback unchanged');
select is((select count(*)::int from snap s join (
  select v.slug, md5(coalesce((select string_agg(h::text, '|' order by h.day_of_week) from public.operating_hours h where h.venue_id = v.id), '')) as hours
  from public.venues v where v.slug like 'e2e-cutover-%') now using (slug) where s.slug = 'e2e-cutover-e' and s.hours <> now.hours), 0,
  'rollback of equivalent data leaves the legacy hours as they were');

-- Old-client guards on the active venue A (a venue admin).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001781","role":"authenticated"}';
select is(pg_temp.attempt($$ update public.operating_hours set close_time = '20:00' where venue_id = 'a0000000-0000-0000-0000-000000001781' and day_of_week = 2 $$),
  '{"_error":"P0001","_hint":"schedule_v2_managed","_message":"Schedule is managed in Weekly Hours & Rates."}'::jsonb,
  'an active venue admin cannot update legacy operating hours');
select is(pg_temp.attempt($$ insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values ('a0000000-0000-0000-0000-000000001781', 'c0000000-0000-0000-0000-000000001781', 2, 9, 1) $$),
  '{"_error":"P0001","_hint":"schedule_v2_managed","_message":"Schedule is managed in Weekly Hours & Rates."}'::jsonb,
  'an active venue admin cannot insert a legacy court rate');
select is(pg_temp.attempt($$ update public.court_rates set price = 1 where court_id = 'c0000000-0000-0000-0000-000000001781' $$),
  '{"_error":"P0001","_hint":"schedule_v2_managed","_message":"Schedule is managed in Weekly Hours & Rates."}'::jsonb,
  'an active venue admin cannot update a legacy court rate');
select is(pg_temp.attempt($$ delete from public.court_rates where court_id = 'c0000000-0000-0000-0000-000000001781' $$),
  '{"_error":"P0001","_hint":"schedule_v2_managed","_message":"Schedule is managed in Weekly Hours & Rates."}'::jsonb,
  'an active venue admin cannot delete a legacy court rate');
select is(pg_temp.attempt(format($$ select public.set_operating_hours(%L::jsonb, 'a0000000-0000-0000-0000-000000001781') $$, pg_temp.week('07:00', '21:00')::text)),
  '{"_error":"P0001","_hint":"schedule_v2_managed","_message":"Schedule is managed in Weekly Hours & Rates."}'::jsonb,
  'an active venue admin cannot call set_operating_hours');
select is((select count(*)::int from public.operating_hours where venue_id = 'a0000000-0000-0000-0000-000000001781' and close_time = '22:00'), 7,
  'refused writes left the legacy hours unchanged');
select is((select string_agg(price::text, ',') from public.court_rates where venue_id = 'a0000000-0000-0000-0000-000000001781'), '350.00',
  'refused writes left the legacy rates unchanged');

-- save_schedule still writes rates and split periods for an active venue.
create temp table save_result as
select pg_temp.call_json(format($$ select public.save_schedule('a0000000-0000-0000-0000-000000001781', %s, %L::jsonb) $$,
  (select schedule_revision from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001781'),
  jsonb_build_object(
    'venue_periods', (select jsonb_agg(p) from (
      select jsonb_build_object('day_of_week', d, 'start_minute', 360, 'end_minute', case when d = 1 then 600 else 1320 end) p from generate_series(0, 6) d
      union all select jsonb_build_object('day_of_week', 1, 'start_minute', 840, 'end_minute', 1320)) x),
    'rate_changes', jsonb_build_array(jsonb_build_object('court_id', 'c0000000-0000-0000-0000-000000001781', 'day_of_week', 2, 'start_hour', 10, 'price', 650)))::text)) as r;
grant select on save_result to authenticated;
select is((select r->>'_error' from save_result), null, 'save_schedule succeeds for an active venue');
select is((select price from public.court_rates where court_id = 'c0000000-0000-0000-0000-000000001781' and day_of_week = 2 and start_hour = 10), 650::numeric,
  'save_schedule writes the court rate on an active venue');
select is((select count(*)::int from public.venue_open_periods where venue_id = 'a0000000-0000-0000-0000-000000001781' and day_of_week = 1), 2,
  'save_schedule writes split venue periods on an active venue');
reset role;

-- The other venue's admin and anonymous callers cannot change the active venue either.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001782","role":"authenticated"}';
select pg_temp.attempt($$ update public.operating_hours set close_time = '20:00' where venue_id = 'a0000000-0000-0000-0000-000000001781' $$);
select pg_temp.attempt($$ insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values ('a0000000-0000-0000-0000-000000001781', 'c0000000-0000-0000-0000-000000001781', 3, 9, 1) $$);
select is(pg_temp.attempt(format($$ select public.set_operating_hours(%L::jsonb, 'a0000000-0000-0000-0000-000000001781') $$, pg_temp.week('07:00', '21:00')::text))->>'_error', 'P0001',
  'another venue''s admin cannot call set_operating_hours on the active venue');
reset role;
select is((select count(*)::int from public.operating_hours where venue_id = 'a0000000-0000-0000-0000-000000001781' and close_time = '22:00'), 7,
  'another venue''s admin changed nothing in the active venue hours');
select is((select count(*)::int from public.court_rates where venue_id = 'a0000000-0000-0000-0000-000000001781' and day_of_week = 3), 0,
  'another venue''s admin added no rate to the active venue');
set local role anon;
select ok(pg_temp.attempt($$ update public.operating_hours set close_time = '20:00' where venue_id = 'a0000000-0000-0000-0000-000000001781' $$)->>'_error' in ('42501', 'P0001'),
  'anon cannot update the active venue hours');
select ok(pg_temp.attempt($$ insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values ('a0000000-0000-0000-0000-000000001781', 'c0000000-0000-0000-0000-000000001781', 3, 9, 1) $$)->>'_error' in ('42501', 'P0001'),
  'anon cannot insert a rate for the active venue');
select ok(pg_temp.attempt(format($$ select public.set_operating_hours(%L::jsonb, 'a0000000-0000-0000-0000-000000001781') $$, pg_temp.week('07:00', '21:00')::text))->>'_error' in ('42501', 'P0001'),
  'anon cannot call set_operating_hours on the active venue');
reset role;
select is((select count(*)::int from public.operating_hours where venue_id = 'a0000000-0000-0000-0000-000000001781' and close_time = '22:00'), 7,
  'anon changed nothing in the active venue hours');

-- A venue still on legacy is unaffected, even though another venue is active.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001782","role":"authenticated"}';
select is(pg_temp.attempt($$ update public.operating_hours set close_time = '21:00' where venue_id = 'a0000000-0000-0000-0000-000000001782' and day_of_week = 2 $$),
  '{"ok":true}'::jsonb, 'a legacy venue admin can still update operating hours');
select is(pg_temp.attempt($$ insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values ('a0000000-0000-0000-0000-000000001782', 'c0000000-0000-0000-0000-000000001782', 2, 9, 400) $$),
  '{"ok":true}'::jsonb, 'a legacy venue admin can still add a court rate');
select is(pg_temp.attempt($$ update public.court_rates set price = 360 where court_id = 'c0000000-0000-0000-0000-000000001782' and day_of_week = 1 $$),
  '{"ok":true}'::jsonb, 'a legacy venue admin can still change a court rate');
select is(pg_temp.attempt($$ delete from public.court_rates where court_id = 'c0000000-0000-0000-0000-000000001782' and day_of_week = 2 $$),
  '{"ok":true}'::jsonb, 'a legacy venue admin can still delete a court rate');
select is(pg_temp.attempt(format($$ select public.set_operating_hours(%L::jsonb, 'a0000000-0000-0000-0000-000000001782') $$, pg_temp.week('07:00', '21:00')::text)),
  '{"ok":true}'::jsonb, 'a legacy venue admin can still call set_operating_hours');
select is((select count(*)::int from public.operating_hours where venue_id = 'a0000000-0000-0000-0000-000000001782' and open_time = '07:00' and close_time = '21:00'), 7,
  'the legacy venue hours were rewritten');
reset role;

-- After rollback the legacy path works again for the round-trip venue.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001783","role":"authenticated"}';
select is(pg_temp.attempt($$ update public.operating_hours set close_time = '21:00' where venue_id = 'a0000000-0000-0000-0000-000000001785' and day_of_week = 2 $$),
  '{"ok":true}'::jsonb, 'after rollback the venue accepts legacy writes again');
reset role;
select is((select close_time::text from public.operating_hours where venue_id = 'a0000000-0000-0000-0000-000000001785' and day_of_week = 2), '21:00:00',
  'the legacy write after rollback took effect');
select * from finish();
rollback;
