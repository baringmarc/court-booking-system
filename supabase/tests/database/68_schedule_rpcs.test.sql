-- T17.10: venue-scoped schedule reads, impact preview, and atomic schedule saves.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

create function pg_temp.call_json(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb; s text; h text;
begin
  execute p_sql into v;
  return coalesce(v, 'null'::jsonb);
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return jsonb_build_object('_error', s, '_hint', coalesce(h, ''));
end $$;

create function pg_temp.call_state(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then return sqlstate;
end $$;

create function pg_temp.get_schedule(p_venue uuid) returns jsonb language sql as $$
  select pg_temp.call_json(format('select public.get_schedule(%L)', p_venue))
$$;
create function pg_temp.save_schedule(p_venue uuid, p_revision integer, p_changes jsonb) returns jsonb language sql as $$
  select pg_temp.call_json(format('select public.save_schedule(%L, %s, %L::jsonb)', p_venue, p_revision, p_changes::text))
$$;
create function pg_temp.preview_schedule(p_venue uuid, p_draft jsonb, p_from timestamptz, p_to timestamptz,
                                          p_limit integer, p_offset integer) returns jsonb language sql as $$
  select pg_temp.call_json(format('select public.preview_schedule_impact(%L, %L::jsonb, %L::timestamptz, %L::timestamptz, %s, %s)',
    p_venue, p_draft::text, p_from, p_to, p_limit, p_offset))
$$;
grant execute on function pg_temp.get_schedule(uuid), pg_temp.save_schedule(uuid, integer, jsonb),
  pg_temp.preview_schedule(uuid, jsonb, timestamptz, timestamptz, integer, integer),
  pg_temp.call_state(text) to anon, authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001710', 'e2e-schedule-rpc-owner@example.com'),
  ('00000000-0000-0000-0000-000000001711', 'e2e-schedule-rpc-player@example.com'),
  ('00000000-0000-0000-0000-000000001712', 'e2e-schedule-rpc-other-owner@example.com');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-000000001710', 'e2e-schedule-rpc-a', 'active'),
  ('a0000000-0000-0000-0000-000000001711', 'e2e-schedule-rpc-b', 'active');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-000000001710', 'E2E Schedule RPC A', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-000000001711', 'E2E Schedule RPC B', 'Asia/Manila');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000001710', '00000000-0000-0000-0000-000000001710', 'owner'),
  ('a0000000-0000-0000-0000-000000001711', '00000000-0000-0000-0000-000000001712', 'owner');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000001710', 'a0000000-0000-0000-0000-000000001710', 'E2E Schedule RPC A1', 'tennis', 100),
  ('c0000000-0000-0000-0000-000000001711', 'a0000000-0000-0000-0000-000000001710', 'E2E Schedule RPC A2', 'tennis', 100),
  ('c0000000-0000-0000-0000-000000001712', 'a0000000-0000-0000-0000-000000001710', 'E2E Schedule RPC A3', 'tennis', 100),
  ('c0000000-0000-0000-0000-000000001713', 'a0000000-0000-0000-0000-000000001711', 'E2E Schedule RPC B1', 'tennis', 100);
insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
select v, d, 360, 1320
from unnest(array['a0000000-0000-0000-0000-000000001710', 'a0000000-0000-0000-0000-000000001711']::uuid[]) v,
     generate_series(0, 6) d;
insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values
  ('a0000000-0000-0000-0000-000000001710', 'c0000000-0000-0000-0000-000000001710', 1, 9, 350),
  ('a0000000-0000-0000-0000-000000001710', 'c0000000-0000-0000-0000-000000001711', 2, 9, 777);

-- A member can read only the explicitly selected venue; neither anon nor a player has RPC access.
set local role anon;
select is((pg_temp.get_schedule('a0000000-0000-0000-0000-000000001710')->>'_error'), '42501',
  'anon cannot call the schedule read RPC');
select is((pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', '{}'::jsonb,
  now(), now() + interval '1 day', 10, 0)->>'_error'), '42501', 'anon cannot call the impact preview RPC');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001711","role":"authenticated"}';
select is((pg_temp.get_schedule('a0000000-0000-0000-0000-000000001710')->>'_error'), 'P0001',
  'a non-admin player cannot read a venue schedule');
select is((pg_temp.save_schedule('a0000000-0000-0000-0000-000000001710', 0, '{}'::jsonb)->>'_error'), 'P0001',
  'a non-admin player cannot save a venue schedule');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001710","role":"authenticated"}';
select is(pg_temp.get_schedule('a0000000-0000-0000-0000-000000001710')->>'venue_id',
  'a0000000-0000-0000-0000-000000001710', 'a venue admin reads the explicitly selected venue');
select is(pg_temp.get_schedule('a0000000-0000-0000-0000-000000001711')->>'_error', 'P0001',
  'a venue admin cannot read another venue schedule');
select is((pg_temp.save_schedule('a0000000-0000-0000-0000-000000001711', 0, '{}'::jsonb)->>'_error'), 'P0001',
  'a venue admin cannot write another venue schedule');
select is(jsonb_array_length(pg_temp.get_schedule('a0000000-0000-0000-0000-000000001710')->'venue_periods'), 7,
  'schedule read returns all seven venue weekdays');
select is((select elem->>'schedule_mode' from jsonb_array_elements(
    pg_temp.get_schedule('a0000000-0000-0000-0000-000000001710')->'courts') elem
    where elem->>'court_id' = 'c0000000-0000-0000-0000-000000001710'), 'inherit',
  'schedule read returns the court inheritance mode');
select is((select elem->>'price' from jsonb_array_elements(
    pg_temp.get_schedule('a0000000-0000-0000-0000-000000001710')->'courts') c
    cross join lateral jsonb_array_elements(c->'rates') elem
    where c->>'court_id' = 'c0000000-0000-0000-0000-000000001710'
      and elem->>'day_of_week' = '1' and elem->>'start_hour' = '9'), '350',
  'schedule read returns existing weekly court rate overrides');

-- Saving a venue's full replacement and switching inherit to custom snapshots those proposed defaults.
create temp table first_changes as
select jsonb_build_object(
  'venue_periods', (select jsonb_agg(jsonb_build_object('day_of_week', d, 'start_minute', 420, 'end_minute', 1260) order by d)
                   from generate_series(0, 6) d),
  'courts', jsonb_build_array(jsonb_build_object('court_id', 'c0000000-0000-0000-0000-000000001710', 'schedule_mode', 'custom')),
  'rate_changes', jsonb_build_array(jsonb_build_object('court_id', 'c0000000-0000-0000-0000-000000001710',
                    'day_of_week', 3, 'start_hour', 17, 'price', 500))) as changes;
select is((pg_temp.save_schedule('a0000000-0000-0000-0000-000000001710', 0, (select changes from first_changes))->>'schedule_revision'), '1',
  'save atomically replaces venue periods, mode and explicit rates at one revision');
select is((select count(*)::int from public.venue_open_periods where venue_id = 'a0000000-0000-0000-0000-000000001710'), 7,
  'full replacement persists the complete seven-day venue schedule');
select is((select count(*)::int from public.court_open_periods
  where venue_id = 'a0000000-0000-0000-0000-000000001710' and court_id = 'c0000000-0000-0000-0000-000000001710'), 7,
  'switching from inherit to custom snapshots every proposed venue default');
select is((select count(*)::int from public.court_open_periods
  where court_id = 'c0000000-0000-0000-0000-000000001710' and day_of_week = 3
    and start_minute = 420 and end_minute = 1260), 1, 'the custom snapshot uses the proposed venue periods');
select is((select price from public.court_rates where court_id = 'c0000000-0000-0000-0000-000000001710'
  and day_of_week = 3 and start_hour = 17), 500::numeric, 'explicit rates save with the period changes');
select is((select schedule_revision from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001710'), 1,
  'a successful atomic save increments the venue revision once');

-- Copying a court weekday requires explicit custom-mode agreement; rates are optional.
select is((pg_temp.save_schedule('a0000000-0000-0000-0000-000000001710', 1,
  jsonb_build_object('copy_operations', jsonb_build_array(jsonb_build_object(
    'source_court_id', 'c0000000-0000-0000-0000-000000001710', 'target_court_id', 'c0000000-0000-0000-0000-000000001711',
    'source_day_of_week', 3, 'target_day_of_week', 4, 'copy_rates', false, 'confirm_custom', true))))->>'schedule_revision'), '2',
  'copying a weekday to a court with custom consent succeeds atomically');
select is((select schedule_mode from public.court_schedule_modes where court_id = 'c0000000-0000-0000-0000-000000001711'), 'custom',
  'copying schedule hours switches the target court to custom mode');
select is((select count(*)::int from public.court_open_periods where court_id = 'c0000000-0000-0000-0000-000000001711'
  and day_of_week = 4 and start_minute = 420 and end_minute = 1260), 1, 'copy maps the source weekday to the requested target weekday');
select is((select price from public.court_rates where court_id = 'c0000000-0000-0000-0000-000000001711'
  and day_of_week = 2 and start_hour = 9), 777::numeric, 'hours-only copy preserves existing target rates');
select is((pg_temp.save_schedule('a0000000-0000-0000-0000-000000001710', 2,
  jsonb_build_object('copy_operations', jsonb_build_array(jsonb_build_object(
    'source_court_id', 'c0000000-0000-0000-0000-000000001710', 'target_court_id', 'c0000000-0000-0000-0000-000000001712',
    'source_day_of_week', 3, 'target_day_of_week', 4, 'copy_rates', true, 'confirm_custom', true))))->>'schedule_revision'), '3',
  'copy with rates succeeds at the current revision');
select is((select price from public.court_rates where court_id = 'c0000000-0000-0000-0000-000000001712'
  and day_of_week = 4 and start_hour = 17), 500::numeric, 'copy-rates copies the source weekday overrides to the target weekday');
select is((select count(*)::int from public.court_rates where court_id = 'c0000000-0000-0000-0000-000000001712'
  and day_of_week = 3 and start_hour = 17), 0, 'copy-rates does not leave the override on the source weekday');
select is((pg_temp.save_schedule('a0000000-0000-0000-0000-000000001710', 3,
  jsonb_build_object('copy_operations', jsonb_build_array(jsonb_build_object(
    'source_court_id', 'c0000000-0000-0000-0000-000000001710', 'target_court_id', 'c0000000-0000-0000-0000-000000001712',
    'source_day_of_week', 3, 'target_day_of_week', 5, 'copy_rates', false, 'confirm_custom', false))))->>'_error'), 'P0001',
  'copy without explicit target custom agreement is rejected');
select is((select schedule_revision from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001710'), 3,
  'rejected copy leaves the venue revision unchanged');

-- Stale writes, week-wrap overlaps and later-field failure must not partially save.
select is((pg_temp.save_schedule('a0000000-0000-0000-0000-000000001710', 1,
  jsonb_build_object('rate_changes', jsonb_build_array(jsonb_build_object('court_id', 'c0000000-0000-0000-0000-000000001710',
    'day_of_week', 0, 'start_hour', 8, 'price', 125))))->>'_error'), 'P0001', 'a stale schedule revision is rejected');
select is((select schedule_revision from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001710'), 3,
  'a stale revision makes no writes');
select is((pg_temp.save_schedule('a0000000-0000-0000-0000-000000001710', 3,
  jsonb_build_object('venue_periods', jsonb_build_array(
    jsonb_build_object('day_of_week', 0, 'start_minute', 0, 'end_minute', 120),
    jsonb_build_object('day_of_week', 6, 'start_minute', 1320, 'end_minute', 1560))))->>'_error'), 'P0001',
  'Saturday-to-Sunday overlap is rejected by the save RPC');
select is((select schedule_revision from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001710'), 3,
  'overlap failure leaves the revision unchanged');
select is((pg_temp.save_schedule('a0000000-0000-0000-0000-000000001710', 3,
  jsonb_build_object('venue_periods', (select jsonb_agg(jsonb_build_object('day_of_week', d, 'start_minute', 480, 'end_minute', 1200)
      order by d) from generate_series(0, 6) d),
    'rate_changes', jsonb_build_array(jsonb_build_object('court_id', 'c0000000-0000-0000-0000-000000001710',
      'day_of_week', 0, 'start_hour', 9, 'price', -1))))->>'_error' is not null), true,
  'a rate constraint failure rejects the whole schedule save');
select is((select schedule_revision from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001710'), 3,
  'a later write failure rolls back earlier period changes');
select is((select count(*)::int from public.venue_open_periods where venue_id = 'a0000000-0000-0000-0000-000000001710'
  and day_of_week = 0 and start_minute = 480 and end_minute = 1200), 0, 'atomic rollback preserves the prior venue periods');

-- Three active bookings and one expired hold fall outside this explicit custom court draft; open play is warned, never changed.
reset role;
select is((select schedule_revision from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001711'), 0,
  'a cross-venue write leaves the other venue revision unchanged');
create temp table preview_fixture as
select ((now() at time zone 'Asia/Manila')::date + 3)::date as play_date;
insert into public.bookings (id, venue_id, reference_code, court_id, guest_name, during, total_amount, status, expires_at)
select b.id, 'a0000000-0000-0000-0000-000000001710', b.ref, 'c0000000-0000-0000-0000-000000001710', b.guest,
       tstzrange((f.play_date + b.at_time) at time zone 'Asia/Manila', (f.play_date + b.at_time + interval '1 hour') at time zone 'Asia/Manila'),
       100, b.state::public.booking_status, b.expiry
from preview_fixture f cross join (values
  ('b0000000-0000-0000-0000-000000001710'::uuid, 'CB-AAAAAA', 'E2E Confirmed', time '11:00', 'confirmed', null::timestamptz),
  ('b0000000-0000-0000-0000-000000001711'::uuid, 'CB-AAAAAB', 'E2E Submitted', time '12:00', 'payment_submitted', null::timestamptz),
  ('b0000000-0000-0000-0000-000000001712'::uuid, 'CB-AAAAAC', 'E2E Active hold', time '13:00', 'pending_payment', now() + interval '1 hour'),
  ('b0000000-0000-0000-0000-000000001713'::uuid, 'CB-AAAAAD', 'E2E Expired hold', time '14:00', 'pending_payment', now() - interval '1 hour')
) b(id, ref, guest, at_time, state, expiry);
insert into public.open_play_sessions (id, venue_id, title, starts_at, ends_at)
select 'e0000000-0000-0000-0000-000000001710', 'a0000000-0000-0000-0000-000000001710', 'E2E Schedule Preview',
       (play_date + time '17:00') at time zone 'Asia/Manila', (play_date + time '18:00') at time zone 'Asia/Manila'
from preview_fixture;
insert into public.open_play_courts (venue_id, session_id, court_id, during)
select 'a0000000-0000-0000-0000-000000001710', 'e0000000-0000-0000-0000-000000001710',
       'c0000000-0000-0000-0000-000000001710', tstzrange(s.starts_at, s.ends_at)
from public.open_play_sessions s where s.id = 'e0000000-0000-0000-0000-000000001710';

create temp table preview_draft as
select jsonb_build_object(
  'venue_periods', (select jsonb_agg(jsonb_build_object('day_of_week', d, 'start_minute', 420, 'end_minute', 1260) order by d)
                    from generate_series(0, 6) d),
  'courts', jsonb_build_array(
    jsonb_build_object('court_id', 'c0000000-0000-0000-0000-000000001710', 'schedule_mode', 'custom',
      'periods', (select jsonb_agg(jsonb_build_object('day_of_week', d, 'start_minute', s, 'end_minute', e)
        order by d, s) from generate_series(0, 6) d cross join (values (360, 600), (1140, 1320)) p(s, e))),
    jsonb_build_object('court_id', 'c0000000-0000-0000-0000-000000001711', 'schedule_mode', 'inherit',
      'periods', (select jsonb_agg(jsonb_build_object('day_of_week', d, 'start_minute', 420, 'end_minute', 1260)
        order by d) from generate_series(0, 6) d)),
    jsonb_build_object('court_id', 'c0000000-0000-0000-0000-000000001712', 'schedule_mode', 'inherit',
      'periods', (select jsonb_agg(jsonb_build_object('day_of_week', d, 'start_minute', 420, 'end_minute', 1260)
        order by d) from generate_series(0, 6) d)))) as draft;
grant select on preview_fixture, preview_draft to authenticated;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000001710","role":"authenticated"}';
select is((pg_temp.save_schedule('a0000000-0000-0000-0000-000000001710', 3,
  jsonb_build_object('courts', jsonb_build_array(jsonb_build_object(
    'court_id', 'c0000000-0000-0000-0000-000000001710', 'schedule_mode', 'custom',
    'periods', (select jsonb_agg(jsonb_build_object('day_of_week', d, 'start_minute', s, 'end_minute', e)
      order by d, s) from generate_series(0, 6) d cross join (values (360, 600), (1140, 1320)) p(s, e))))))->>'schedule_revision'), '4',
  'a schedule save reports impacts but preserves the existing reservations and open-play session');
select is((pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', (select draft from preview_draft),
  ((select play_date from preview_fixture)::timestamp at time zone 'Asia/Manila'),
  (((select play_date from preview_fixture) + 90)::timestamp at time zone 'Asia/Manila'), 2, 0)->'bookings'->>'total'), '3',
  'impact preview counts confirmed, submitted and unexpired pending bookings in the explicit horizon');
select is(jsonb_array_length(pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', (select draft from preview_draft),
  ((select play_date from preview_fixture)::timestamp at time zone 'Asia/Manila'),
  (((select play_date from preview_fixture) + 90)::timestamp at time zone 'Asia/Manila'), 2, 0)->'bookings'->'items'), 2,
  'impact preview returns only the requested first page');
select is(pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', (select draft from preview_draft),
  ((select play_date from preview_fixture)::timestamp at time zone 'Asia/Manila'),
  (((select play_date from preview_fixture) + 90)::timestamp at time zone 'Asia/Manila'), 2, 0)->'bookings'->'items'->0->>'booking_id',
  'b0000000-0000-0000-0000-000000001710', 'first preview page is ordered by reservation start');
select ok(pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', (select draft from preview_draft),
  ((select play_date from preview_fixture)::timestamp at time zone 'Asia/Manila'),
  (((select play_date from preview_fixture) + 90)::timestamp at time zone 'Asia/Manila'), 20, 0)::text not like '%E2E Confirmed%',
  'impact preview omits guest contact details');
select is(jsonb_array_length(pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', (select draft from preview_draft),
  ((select play_date from preview_fixture)::timestamp at time zone 'Asia/Manila'),
  (((select play_date from preview_fixture) + 90)::timestamp at time zone 'Asia/Manila'), 2, 2)->'bookings'->'items'), 1,
  'impact preview returns the next page at the requested offset');
select is(pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', (select draft from preview_draft),
  ((select play_date from preview_fixture)::timestamp at time zone 'Asia/Manila'),
  (((select play_date from preview_fixture) + 90)::timestamp at time zone 'Asia/Manila'), 2, 2)->'bookings'->'items'->0->>'booking_id',
  'b0000000-0000-0000-0000-000000001712', 'the second preview page contains the remaining unexpired hold');
select is((pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', (select draft from preview_draft),
  ((select play_date from preview_fixture)::timestamp at time zone 'Asia/Manila'),
  (((select play_date from preview_fixture) + 90)::timestamp at time zone 'Asia/Manila'), 20, 0)->'open_play'->>'total'), '1',
  'impact preview reports conflicting open-play sessions');
select is(pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', (select draft from preview_draft),
  ((select play_date from preview_fixture)::timestamp at time zone 'Asia/Manila'),
  (((select play_date from preview_fixture) + 90)::timestamp at time zone 'Asia/Manila'), 20, 0)->'open_play'->'items'->0->>'session_id',
  'e0000000-0000-0000-0000-000000001710', 'preview identifies the affected open-play session');
select is((pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', (select draft from preview_draft),
  ((select play_date from preview_fixture)::timestamp at time zone 'Asia/Manila'),
  (((select play_date from preview_fixture) + 90)::timestamp at time zone 'Asia/Manila'), 20, 0)->>'_error'), null,
  'a preview at the maximum 90-day horizon is accepted');
select is((pg_temp.preview_schedule('a0000000-0000-0000-0000-000000001710', (select draft from preview_draft),
  ((select play_date from preview_fixture)::timestamp at time zone 'Asia/Manila'),
  (((select play_date from preview_fixture) + 91)::timestamp at time zone 'Asia/Manila'), 20, 0)->>'_error'), 'P0001',
  'a preview horizon longer than 90 days is rejected');
reset role;

select is((select count(*)::int from public.bookings where id in
  ('b0000000-0000-0000-0000-000000001710', 'b0000000-0000-0000-0000-000000001711',
   'b0000000-0000-0000-0000-000000001712', 'b0000000-0000-0000-0000-000000001713')), 4,
  'preview leaves every active and expired booking intact');
select is((select count(*)::int from public.open_play_sessions where id = 'e0000000-0000-0000-0000-000000001710'), 1,
  'preview leaves affected open-play sessions intact');
select is((select string_agg(status::text, ',' order by id) from public.bookings where id between
  'b0000000-0000-0000-0000-000000001710' and 'b0000000-0000-0000-0000-000000001713'),
  'confirmed,payment_submitted,pending_payment,pending_payment', 'save and preview preserve each booking status');
select is((select schedule_revision from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-000000001710'), 4,
  'preview does not mutate the schedule revision');

select * from finish();
rollback;
