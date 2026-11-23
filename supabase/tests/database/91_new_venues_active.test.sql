-- T32.1: new venues start on schedule v2. A venue made by create_venue (or inserted directly) is active from the start
-- with seven default periods 06:00-22:00; the owner's later closing time reaches players with no manual activation; the
-- legacy write path is refused; activation and rollback behave as before; a flag set false stays false.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.call_json(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb; s text; h text;
begin
  execute p_sql into v;
  return coalesce(v, 'null'::jsonb);
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return jsonb_build_object('_error', s, '_hint', coalesce(h, ''));
end $$;
grant execute on function pg_temp.call_json(text) to anon, authenticated;

create temp table made (id uuid);
grant all on made to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003211', 'e2e-newv-platform@example.com'),
  ('00000000-0000-0000-0000-000000003212', 'e2e-newv-owner@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-000000003211');

-- A platform admin creates the venue (create_venue(p_slug, p_name, p_timezone)).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000003211","role":"authenticated"}';
insert into made select public.create_venue('e2e-newv-made', 'E2E New Venue', 'Asia/Manila');
reset role;

-- The rest of the onboarding the console does later: an owner, a court, and publishing the venue.
insert into public.venue_members (venue_id, user_id, role)
select id, '00000000-0000-0000-0000-000000003212', 'owner' from made;
insert into public.courts (id, venue_id, name, sport, default_hourly_rate)
select 'c0000000-0000-0000-0000-000000003211', id, 'E2E New Venue Court', 'tennis', 100 from made;
update public.venues set status = 'active' where id = (select id from made);

select is((select schedule_v2_active from public.venue_schedule_state where venue_id = (select id from made)), true,
  'a venue made by create_venue starts on schedule v2');
select is((select count(*)::int from public.venue_open_periods
  where venue_id = (select id from made) and start_minute = 360 and end_minute = 1320
    and day_of_week between 0 and 6), 7, 'create_venue gives seven default periods 06:00-22:00, days 0-6');
select is((select count(distinct day_of_week)::int from public.venue_open_periods where venue_id = (select id from made)), 7,
  'the default periods cover every weekday once');

create temp table fx as
select private.local_today((select id from made)) + 3 as d;
grant select on fx to anon, authenticated;

set local role anon;
select is((select max((slot_end at time zone 'Asia/Manila')::time)::text
  from public.get_availability((select d from fx), null, 'e2e-newv-made')), '22:00:00',
  'before any edit the last slot ends at the 22:00 default close');
reset role;

-- The owner moves the close to 23:00 every day, with no activation step.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000003212","role":"authenticated"}';
create temp table saved as
select pg_temp.call_json(format($$ select public.save_schedule(%L, %s, %L::jsonb) $$,
  (select id from made),
  (select schedule_revision from public.venue_schedule_state where venue_id = (select id from made)),
  jsonb_build_object('venue_periods', (select jsonb_agg(jsonb_build_object('day_of_week', d, 'start_minute', 360, 'end_minute', 1380) order by d)
    from generate_series(0, 6) d))::text)) as r;
grant select on saved to anon, authenticated;
select is((select r->>'_error' from saved), null, 'the new venue''s owner can save a 23:00 close straight away');
select is(pg_temp.call_json(format($$ select public.set_operating_hours(%L::jsonb, %L) $$,
  (select jsonb_agg(jsonb_build_object('day_of_week', d, 'open_time', '07:00', 'close_time', '21:00', 'is_closed', false) order by d)
    from generate_series(0, 6) d)::text, (select id from made)))->>'_hint', 'schedule_v2_managed',
  'set_operating_hours is refused on a new venue with hint schedule_v2_managed');
reset role;

set local role anon;
select is((select max((slot_end at time zone 'Asia/Manila')::time)::text
  from public.get_availability((select d from fx), null, 'e2e-newv-made')), '23:00:00',
  'after the owner saves a 23:00 close the last public slot ends at 23:00');
reset role;

-- Activation and rollback still work on a new venue (the saved periods are representable as legacy hours).
select private.deactivate_schedule_v2((select id from made));
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = (select id from made)), false,
  'rollback still switches a new venue back to legacy');
select private.activate_schedule_v2((select id from made));
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = (select id from made)), true,
  'activation still switches the venue to schedule v2');

-- A venue inserted directly is active too; a flag set false afterwards stays false.
insert into public.venues (id, slug, status) values ('a0000000-0000-0000-0000-000000003213', 'e2e-newv-direct', 'active');
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000003213'), true,
  'a venue inserted directly starts on schedule v2');
update public.venue_schedule_state set schedule_v2_active = false where venue_id = 'a0000000-0000-0000-0000-000000003213';
select is((select schedule_v2_active from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000003213'), false,
  'a venue explicitly set to legacy stays on legacy');

select * from finish();
rollback;
