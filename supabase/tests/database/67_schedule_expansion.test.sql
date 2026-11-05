-- T17.9: additive schedule model, legacy parity and database-enforced period invariants.
-- The legacy operating_hours rows remain the authority while venue_schedule_state is inactive.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  set constraints all immediate;
  return 'ok';
exception when others then
  return sqlstate;
end $$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare s text; h text;
begin
  execute p_sql;
  set constraints all immediate;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return s || '|' || coalesce(h, '');
end $$;
create function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare r text;
begin
  execute p_sql into r;
  return coalesce(r, '<null>');
exception when others then
  return 'ERR ' || sqlstate;
end $$;
create function pg_temp.schedule_row_count(p_table text, p_venue uuid) returns integer language plpgsql as $$
declare n integer;
begin
  execute format('select count(*)::integer from public.%I where venue_id = %L', p_table, p_venue) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;
grant execute on function pg_temp.schedule_row_count(text, uuid) to anon, authenticated;

create temp table schedule_preexisting_venues as select id from public.venues;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000067a1', 'e2e-schedule-owner@example.com'),
  ('00000000-0000-0000-0000-0000000067a2', 'e2e-schedule-player@example.com');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000067a1', 'e2e-schedule-one', 'active'),
  ('a0000000-0000-0000-0000-0000000067a2', 'e2e-schedule-two', 'active');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-0000000067a1', 'E2E Schedule One', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000067a2', 'E2E Schedule Two', 'Asia/Manila');
-- This venue is created after the expansion migration. Its later legacy-hour insert must populate the matching period.
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time, is_closed) values
  ('a0000000-0000-0000-0000-0000000067a1', 5, '07:00', '19:00', false);
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000067a1', '00000000-0000-0000-0000-0000000067a1', 'owner');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000067a1', 'a0000000-0000-0000-0000-0000000067a1', 'E2E Schedule Court One', 'tennis', 100),
  ('c0000000-0000-0000-0000-0000000067a2', 'a0000000-0000-0000-0000-0000000067a2', 'E2E Schedule Court Two', 'tennis', 100);

-- Schema and fixed public contract for the expansion tables.
select has_table('public', 'venue_schedule_state', 'venue_schedule_state stores rollout state per venue');
select has_table('public', 'venue_open_periods', 'venue_open_periods stores venue defaults');
select has_table('public', 'court_schedule_modes', 'court_schedule_modes stores inherit/custom mode per court');
select has_table('public', 'court_open_periods', 'court_open_periods stores custom court hours');
select has_column('public', 'venue_schedule_state', 'schedule_revision', 'venue schedule revision is recorded');
select col_type_is('public', 'venue_schedule_state', 'schedule_v2_active', 'boolean', 'activation state is boolean');
select has_column('public', 'venue_open_periods', 'id', 'venue period rows have ids');
select has_column('public', 'venue_open_periods', 'venue_id', 'venue periods are venue-owned');
select has_column('public', 'venue_open_periods', 'day_of_week', 'venue periods name their owning weekday');
select has_column('public', 'venue_open_periods', 'start_minute', 'venue periods store start minute offsets');
select has_column('public', 'venue_open_periods', 'end_minute', 'venue periods store end minute offsets');
select has_column('public', 'court_schedule_modes', 'venue_id', 'court modes carry venue ownership');
select has_column('public', 'court_schedule_modes', 'court_id', 'court modes identify their court');
select has_column('public', 'court_schedule_modes', 'schedule_mode', 'court modes store inherit/custom');
select has_column('public', 'court_schedule_modes', 'schedule_revision', 'court modes store a revision');
select has_column('public', 'court_open_periods', 'id', 'court period rows have ids');
select has_column('public', 'court_open_periods', 'venue_id', 'court periods carry venue ownership');
select has_column('public', 'court_open_periods', 'court_id', 'court periods identify their court');
select has_column('public', 'court_open_periods', 'day_of_week', 'court periods name their owning weekday');
select has_column('public', 'court_open_periods', 'start_minute', 'court periods store start minute offsets');
select has_column('public', 'court_open_periods', 'end_minute', 'court periods store end minute offsets');
select col_type_is('public', 'operating_hours', 'day_of_week', 'smallint', 'legacy weekdays are smallint');
select col_type_is('public', 'operating_hours', 'open_time', 'time without time zone', 'legacy opening time remains a time');
select col_type_is('public', 'operating_hours', 'close_time', 'time without time zone', 'legacy closing time remains a time');
select ok(coalesce((select bool_and(relrowsecurity) from pg_class where oid in (
  to_regclass('public.venue_schedule_state'), to_regclass('public.venue_open_periods'),
  to_regclass('public.court_schedule_modes'), to_regclass('public.court_open_periods'))), false),
  'RLS is enabled on all four schedule tables');

-- Each venue's seven legacy rows are unchanged and have the same weekday/minute interpretation in the backfill.
select is(pg_temp.val($$select count(*)::text from public.venue_open_periods
  where venue_id = 'a0000000-0000-0000-0000-0000000067a1'
    and day_of_week = 5 and start_minute = 420 and end_minute = 1140$$), '1',
  'inserting legacy operating hours for a post-migration venue syncs the exact period');
select is(pg_temp.val($$select count(*)::text from public.operating_hours oh
  where (select count(*) from public.operating_hours x where x.venue_id = oh.venue_id) = 7
    and case when oh.is_closed then exists (
      select 1 from public.venue_open_periods p where p.venue_id = oh.venue_id and p.day_of_week = oh.day_of_week
    ) else not exists (
      select 1 from public.venue_open_periods p
      where p.venue_id = oh.venue_id and p.day_of_week = oh.day_of_week
        and p.start_minute = extract(epoch from oh.open_time)::int / 60
        and p.end_minute = extract(epoch from oh.close_time)::int / 60
          + case when oh.close_time <= oh.open_time then 1440 else 0 end
    ) end$$), '0', 'all seven migrated weekdays preserve legacy closed, full-day, ordinary and overnight semantics');
select is(pg_temp.val($$select count(*)::text from public.venue_open_periods p
  where not exists (select 1 from public.operating_hours oh
    where oh.venue_id = p.venue_id and oh.day_of_week = p.day_of_week)$$), '0',
  'backfill creates no periods for a weekday without a legacy row');
select ok(pg_temp.val($$select (not exists (
  select v.id from pg_temp.schedule_preexisting_venues v
  left join public.operating_hours oh on oh.venue_id = v.id
  group by v.id having count(oh.day_of_week) <> 7))::text$$) = 'true',
  'every migrated venue retains all seven legacy weekday rows');
select is(pg_temp.val($$select count(*)::text from public.venue_open_periods p
  where exists (select 1 from public.operating_hours oh where oh.venue_id = p.venue_id
    and oh.day_of_week = p.day_of_week and not oh.is_closed)$$),
  pg_temp.val($$select count(*)::text from public.operating_hours where not is_closed$$),
  'backfill creates exactly one period for every open legacy weekday and none for closed weekdays');
select is(pg_temp.val($$select count(*)::text from public.courts c
  join public.venues v on v.id = c.venue_id
  where v.slug not like 'e2e-schedule-%'
    and not exists (select 1 from public.court_schedule_modes m
      where m.venue_id = c.venue_id and m.court_id = c.id and m.schedule_mode = 'inherit')$$),
  '0', 'every pre-existing court is backfilled with inherit mode');

-- Inactive expansion state and the court mode's default.
select is((select count(*)::int from public.venue_schedule_state
  where venue_id in ('a0000000-0000-0000-0000-0000000067a1', 'a0000000-0000-0000-0000-0000000067a2')), 2,
  'post-migration venue inserts initialize exactly one state row each');
select is(pg_temp.val($$select schedule_v2_active::text from public.venue_schedule_state where venue_id = 'a0000000-0000-0000-0000-0000000067a1'$$),
  'false', 'a venue starts with new schedule behavior inactive');
select is((select count(*)::int from public.court_schedule_modes
  where court_id in ('c0000000-0000-0000-0000-0000000067a1', 'c0000000-0000-0000-0000-0000000067a2')), 2,
  'post-migration court inserts initialize exactly one mode row each');
select is(pg_temp.val($$select schedule_mode from public.court_schedule_modes where court_id = 'c0000000-0000-0000-0000-0000000067a1'$$),
  'inherit', 'a new court mode defaults to inherit');

-- Whole-hour intervals, 24-hour maximum, and touching intervals are accepted.
set local role postgres;
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 0, 0, 1440)$$), 'ok',
  'Sunday 00:00 to midnight is a valid full-day period');
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 1, 1200, 1740)$$), 'ok',
  'an overnight period belongs to its opening weekday and may end after midnight');
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 2, 360, 720),
         ('a0000000-0000-0000-0000-0000000067a1', 2, 720, 1440)$$), 'ok',
  'touching intervals on the same weekday are legal');

-- These fixture rows prove SELECT isolation for anon, a non-admin player, and a venue admin.
insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
values ('a0000000-0000-0000-0000-0000000067a1', 'c0000000-0000-0000-0000-0000000067a1', 1, 360, 720);

set local role anon;
select results_eq(
  $$select 'venue_schedule_state'::text, pg_temp.schedule_row_count('venue_schedule_state', 'a0000000-0000-0000-0000-0000000067a1')
    union all select 'venue_open_periods', pg_temp.schedule_row_count('venue_open_periods', 'a0000000-0000-0000-0000-0000000067a1')
    union all select 'court_schedule_modes', pg_temp.schedule_row_count('court_schedule_modes', 'a0000000-0000-0000-0000-0000000067a1')
    union all select 'court_open_periods', pg_temp.schedule_row_count('court_open_periods', 'a0000000-0000-0000-0000-0000000067a1') order by 1$$,
  $$values ('court_open_periods'::text, 0), ('court_schedule_modes', 0), ('venue_open_periods', 0), ('venue_schedule_state', 0)$$,
  'anon cannot read rows from any schedule table');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000067a2","role":"authenticated"}';
select results_eq(
  $$select 'venue_schedule_state'::text, pg_temp.schedule_row_count('venue_schedule_state', 'a0000000-0000-0000-0000-0000000067a1')
    union all select 'venue_open_periods', pg_temp.schedule_row_count('venue_open_periods', 'a0000000-0000-0000-0000-0000000067a1')
    union all select 'court_schedule_modes', pg_temp.schedule_row_count('court_schedule_modes', 'a0000000-0000-0000-0000-0000000067a1')
    union all select 'court_open_periods', pg_temp.schedule_row_count('court_open_periods', 'a0000000-0000-0000-0000-0000000067a1') order by 1$$,
  $$values ('court_open_periods'::text, 0), ('court_schedule_modes', 0), ('venue_open_periods', 0), ('venue_schedule_state', 0)$$,
  'a non-admin player cannot read rows from any schedule table');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000067a1","role":"authenticated"}';
select results_eq(
  $$select 'venue_schedule_state'::text, pg_temp.schedule_row_count('venue_schedule_state', 'a0000000-0000-0000-0000-0000000067a1')
    union all select 'venue_open_periods', pg_temp.schedule_row_count('venue_open_periods', 'a0000000-0000-0000-0000-0000000067a1')
    union all select 'court_schedule_modes', pg_temp.schedule_row_count('court_schedule_modes', 'a0000000-0000-0000-0000-0000000067a1')
    union all select 'court_open_periods', pg_temp.schedule_row_count('court_open_periods', 'a0000000-0000-0000-0000-0000000067a1') order by 1$$,
  $$values ('court_open_periods'::text, 1), ('court_schedule_modes', 1), ('venue_open_periods', 5), ('venue_schedule_state', 1)$$,
  'a venue admin can read the schedule rows belonging to their venue');
reset role;

select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 3, 365, 720)$$), '23514',
  'non-whole-hour start bounds are rejected');
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 3, 360, 721)$$), '23514',
  'non-whole-hour end bounds are rejected');
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 3, -60, 60)$$), '23514',
  'negative start bounds are rejected');
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 3, 60, 1560)$$), '23514',
  'periods longer than 24 hours are rejected');
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 7, 60, 120)$$), '23514',
  'weekday values outside Sunday 0 through Saturday 6 are rejected');
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 3, 600, 600)$$), '23514',
  'zero-length intervals are rejected');
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 4, 600, 1200),
         ('a0000000-0000-0000-0000-0000000067a1', 4, 1140, 1380)$$), 'P0001',
  'overlapping periods on one weekday are rejected');
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 1, 1320, 1560),
         ('a0000000-0000-0000-0000-0000000067a1', 2, 0, 120)$$), 'P0001',
  'an overnight period overlapping the following weekday is rejected');
select is(pg_temp.sqlstate_of($$insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a2', 6, 1320, 1560),
         ('a0000000-0000-0000-0000-0000000067a2', 0, 0, 120)$$), 'P0001',
  'Saturday overnight overlap with Sunday is rejected across the week boundary');

-- Court-owned rows must carry the court's actual venue, even when both ids are independently valid.
select is(pg_temp.err($$insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
  values ('a0000000-0000-0000-0000-0000000067a1', 'c0000000-0000-0000-0000-0000000067a2', 1, 360, 720)$$),
  '23503|', 'a custom court period cannot pair a court with another venue');
select is(pg_temp.err($$insert into public.court_schedule_modes (venue_id, court_id, schedule_mode)
  values ('a0000000-0000-0000-0000-0000000067a1', 'c0000000-0000-0000-0000-0000000067a2', 'custom')$$),
  '23503|', 'a schedule mode cannot pair a court with another venue');

-- Clients cannot switch the server-controlled cutover flag.
set local role anon;
select isnt(pg_temp.sqlstate_of($$update public.venue_schedule_state set schedule_v2_active = true
  where venue_id = 'a0000000-0000-0000-0000-0000000067a1'$$), 'ok', 'anon cannot activate schedule v2');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000067a2","role":"authenticated"}';
select isnt(pg_temp.sqlstate_of($$update public.venue_schedule_state set schedule_v2_active = true
  where venue_id = 'a0000000-0000-0000-0000-0000000067a1'$$), 'ok', 'a player cannot activate schedule v2');
reset role;

select is(pg_temp.val($$select count(*)::text from public.operating_hours oh
  where oh.venue_id = 'a0000000-0000-0000-0000-0000000067a1'$$), '1',
  'legacy operating_hours remains present while schedule v2 is inactive');

select * from finish();
rollback;
