-- T18.3: venue_settings.walk_ins_enabled (off by default), public.set_walk_ins(p_venue_id, p_enabled) as the only way a
-- platform admin changes it, the guard trigger on direct updates, and create_walk_in refusing with walk_ins_off while it is off.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "anon"}', true)
$$;
create function pg_temp.as_player() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true)
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true)
$$;
create function pg_temp.as_platform() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true)
$$;
grant execute on function pg_temp.sqlstate_of(text), pg_temp.hint_of(text), pg_temp.as_anon(), pg_temp.as_player(),
  pg_temp.as_admin(), pg_temp.as_platform() to anon, authenticated, service_role;

-- Open around the clock today so the slot in progress exists; normal hours on other days (as in 13_create_walk_in).
update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.operating_hours set open_time = '00:00', close_time = '24:00'
where day_of_week = extract(dow from private.local_today(private.default_venue_id()))::smallint;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'plotline@test.local');
insert into public.venues (id, slug, status) values ('a0000000-0000-0000-0000-000000000182', 'e2e-wisw-other', 'active');
insert into public.venue_settings (venue_id, name, timezone) values ('a0000000-0000-0000-0000-000000000182', 'E2E WISW Other', 'Asia/Manila');
-- The venue admin owns both venues; the platform admin is a member of the first, so a direct update reaches the guard instead of RLS.
insert into public.venue_members (venue_id, user_id, role)
  select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug in ('claudex-courts', 'e2e-wisw-other');
insert into public.venue_members (venue_id, user_id, role)
  select id, '33333333-3333-3333-3333-333333333333', 'owner' from public.venues where slug = 'claudex-courts';
insert into public.platform_admins (user_id) values ('33333333-3333-3333-3333-333333333333');
insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000181', 'WISW Main Court', 'tennis', 500),
  ('a0000000-0000-0000-0000-000000000182', 'c0000000-0000-0000-0000-000000000182', 'WISW Other Court', 'tennis', 500);

create temp table fx as
select date_trunc('hour', now() at time zone 'Asia/Manila') at time zone 'Asia/Manila' as current_slot,
       (private.local_today(private.default_venue_id()) + 3 + time '10:00') at time zone 'Asia/Manila' as t10,
       (private.local_today(private.default_venue_id()) + 3 + time '05:00') at time zone 'Asia/Manila' as t05;
grant select on fx to anon, authenticated;
create temp table w (label text primary key, id uuid);
grant select, insert on w to authenticated;

create function pg_temp.main_flag() returns boolean language sql as $$
  select walk_ins_enabled from public.venue_settings s join public.venues v on v.id = s.venue_id where v.slug = 'claudex-courts'
$$;
create function pg_temp.main_id() returns uuid language sql as $$ select id from public.venues where slug = 'claudex-courts' $$;
create function pg_temp.other_flag() returns boolean language sql as $$
  select walk_ins_enabled from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-000000000182'
$$;
grant execute on function pg_temp.main_flag(), pg_temp.main_id(), pg_temp.other_flag() to anon, authenticated, service_role;

-- Column and defaults
select has_column('public', 'venue_settings', 'walk_ins_enabled', 'venue_settings has walk_ins_enabled');
select col_type_is('public', 'venue_settings', 'walk_ins_enabled', 'boolean', 'walk_ins_enabled is boolean');
select col_not_null('public', 'venue_settings', 'walk_ins_enabled', 'walk_ins_enabled is required');
select is((select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
     where d.adrelid = 'public.venue_settings'::regclass
       and d.adnum = (select attnum from pg_attribute where attrelid = 'public.venue_settings'::regclass and attname = 'walk_ins_enabled')),
  'false', 'the column default is false');
select is(pg_temp.main_flag(), false, 'Claudex Courts (an existing venue) starts with walk-ins off');
select is(pg_temp.other_flag(), false, 'a venue created without the column starts with walk-ins off');
select has_function('private', 'guard_walk_ins', 'private.guard_walk_ins() exists');

-- Function and grants
select has_function('public', 'set_walk_ins', array['uuid', 'boolean'], 'public.set_walk_ins(uuid, boolean) exists');
select function_returns('public', 'set_walk_ins', array['uuid', 'boolean'], 'void', 'it returns void');
select is((select p.prosecdef from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'set_walk_ins'), true, 'it is security definer');
select is((select has_function_privilege('anon', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'set_walk_ins'), false, 'anon cannot execute it');
select is((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'set_walk_ins'), true, 'authenticated can execute it');

-- create_walk_in while the venue is off: staff check first, then walk_ins_off before any slot check
set local role authenticated;
select pg_temp.as_player();
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000181', (select t10 from fx), 1, 'Walker') $$),
  'forbidden', 'a player is still refused with forbidden while walk-ins are off (staff check first)');
select pg_temp.as_admin();
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000181', (select t10 from fx), 1, 'Walker') $$),
  'walk_ins_off', 'staff are refused with walk_ins_off while the venue''s walk-ins are off');
select throws_ok($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000181', (select t10 from fx), 1, 'Walker') $$,
  'P0001', null, 'the walk_ins_off refusal is P0001');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000181', (select current_slot - interval '1 hour' from fx), 1, 'Late') $$),
  'walk_ins_off', 'an ended slot at a walk-ins-off venue gets walk_ins_off, not slot_started');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000181', (select t05 from fx), 1, 'Early') $$),
  'walk_ins_off', 'an outside-hours slot at a walk-ins-off venue gets walk_ins_off, not outside_hours');
reset role;
select is((select count(*)::int from public.bookings where source = 'walk_in'), 0, 'no walk-in was recorded while off');

-- A platform admin turns the main venue on; the other venue is untouched
set local role authenticated;
select pg_temp.as_platform();
select lives_ok($$ select public.set_walk_ins(pg_temp.main_id(), true) $$, 'a platform admin turns walk-ins on');
reset role;
select is(pg_temp.main_flag(), true, 'the venue flag is on');
select is(pg_temp.other_flag(), false, 'another venue''s flag is unchanged by the toggle');

-- With the flag on the walk-in books as before; the other venue still refuses; slot checks apply again
set local role authenticated;
select pg_temp.as_admin();
select lives_ok($$ insert into w select 'on', r.id from public.create_walk_in('c0000000-0000-0000-0000-000000000181', (select t10 from fx), 1, 'Walk-in Wendy', '0917 555 0000') r $$,
  'staff record a walk-in while on');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000182', (select t10 from fx), 1, 'Walker') $$),
  'walk_ins_off', 'staff of both venues are still refused at the venue whose flag is off');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000181', (select t05 from fx), 1, 'Early') $$),
  'outside_hours', 'with the flag on, slot checks apply again (outside_hours)');
reset role;
select results_eq(
  $$ select bk.status::text, bk.source::text, bk.guest_name, bk.total_amount from public.bookings bk join w on w.id = bk.id where w.label = 'on' $$,
  $$ values ('confirmed', 'walk_in', 'Walk-in Wendy', 500::numeric) $$,
  'the walk-in is a confirmed walk_in booking at the court price');

-- Turning it off again refuses again
set local role authenticated;
select pg_temp.as_platform();
select lives_ok($$ select public.set_walk_ins(pg_temp.main_id(), false) $$, 'a platform admin turns walk-ins off again');
select pg_temp.as_admin();
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-000000000181', (select t10 from fx) + interval '1 hour', 1, 'Walker') $$),
  'walk_ins_off', 'staff are refused again once the flag is off');
-- Only the named venue changes
select pg_temp.as_platform();
select lives_ok($$ select public.set_walk_ins('a0000000-0000-0000-0000-000000000182', true) $$, 'a platform admin turns the other venue on');
reset role;
select is(pg_temp.other_flag(), true, 'the other venue is on');
select is(pg_temp.main_flag(), false, 'the first venue is untouched by the other venue''s toggle');
update public.venue_settings set walk_ins_enabled = false where venue_id = 'a0000000-0000-0000-0000-000000000182';

-- Unknown venue, and a platform admin's direct update
set local role authenticated;
select pg_temp.as_platform();
select is(pg_temp.hint_of($$ select public.set_walk_ins('a0000000-0000-0000-0000-0000000001ff', true) $$), 'venue_not_found', 'an unknown venue is refused with hint venue_not_found');
select throws_ok($$ select public.set_walk_ins('a0000000-0000-0000-0000-0000000001ff', true) $$, 'P0001', null, 'the unknown-venue refusal is P0001');
select is(pg_temp.hint_of($$ update public.venue_settings set walk_ins_enabled = true $$), 'forbidden', 'a platform admin''s direct update is refused with hint forbidden');

-- Venue admin
select pg_temp.as_admin();
select is(pg_temp.hint_of($$ select public.set_walk_ins(pg_temp.main_id(), true) $$), 'not_platform_admin', 'a venue admin is refused through the RPC with hint not_platform_admin');
select is(pg_temp.hint_of($$ update public.venue_settings set walk_ins_enabled = true $$), 'forbidden', 'a venue admin''s direct update is refused with hint forbidden');
select lives_ok($$ update public.venue_settings set payment_hold_minutes = 45 where venue_id = pg_temp.main_id() $$, 'a venue admin still edits other settings');

-- Player
select pg_temp.as_player();
select is(pg_temp.hint_of($$ select public.set_walk_ins(pg_temp.main_id(), true) $$), 'not_platform_admin', 'a player is refused through the RPC with hint not_platform_admin');
select lives_ok($$ update public.venue_settings set walk_ins_enabled = true $$, 'a player''s direct update is filtered by RLS (no error, no change)');

-- Anon
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.sqlstate_of($$ select public.set_walk_ins(pg_temp.main_id(), true) $$), '42501', 'anon cannot call the RPC (permission denied)');
select is(pg_temp.sqlstate_of($$ update public.venue_settings set walk_ins_enabled = true $$), '42501', 'anon cannot update the flag directly');
reset role;
select is(pg_temp.main_flag(), false, 'the first venue flag survived every refused attempt');
select is(pg_temp.other_flag(), false, 'the other venue flag survived every refused attempt');
select is((select payment_hold_minutes::int from public.venue_settings where venue_id = pg_temp.main_id()), 45, 'the venue admin''s other setting was saved');

-- service_role direct update still works
set local role service_role;
select lives_ok($$ update public.venue_settings set walk_ins_enabled = true where venue_id = pg_temp.main_id() $$, 'service_role can still change the flag directly');
reset role;
select is(pg_temp.main_flag(), true, 'the flag is on after the service role changed it');

select * from finish();
rollback;
