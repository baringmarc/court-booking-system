-- T18.1: public.set_online_payments(p_venue_id, p_enabled): the only way a platform admin changes the online payments flag.
-- The guard trigger still refuses every direct update except postgres/service_role (venue admins, players, anon, platform admins).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

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
grant execute on function pg_temp.sqlstate_of(text) to anon, authenticated, service_role;
grant execute on function pg_temp.hint_of(text) to anon, authenticated, service_role;
grant execute on function pg_temp.as_anon() to anon, authenticated, service_role;
grant execute on function pg_temp.as_player() to anon, authenticated, service_role;
grant execute on function pg_temp.as_admin() to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'plotline@test.local');
insert into public.venue_members (venue_id, user_id, role)
  select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';
-- The platform admin is also a member of the first venue, so a direct update reaches the guard trigger instead of being filtered by RLS.
insert into public.venue_members (venue_id, user_id, role)
  select id, '33333333-3333-3333-3333-333333333333', 'owner' from public.venues where slug = 'claudex-courts';
insert into public.platform_admins (user_id) values ('33333333-3333-3333-3333-333333333333');
insert into public.venues (id, slug, status) values ('a0000000-0000-0000-0000-000000000181', 'e2e-opsw-other', 'active');
insert into public.venue_settings (venue_id, name, timezone, online_payments_enabled)
  values ('a0000000-0000-0000-0000-000000000181', 'E2E OPSW Other', 'Asia/Manila', true);
create function pg_temp.as_platform() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true)
$$;
grant execute on function pg_temp.as_platform() to anon, authenticated, service_role;
create function pg_temp.main_flag() returns boolean language sql as $$
  select online_payments_enabled from public.venue_settings s join public.venues v on v.id = s.venue_id where v.slug = 'claudex-courts'
$$;
create function pg_temp.main_id() returns uuid language sql as $$ select id from public.venues where slug = 'claudex-courts' $$;
create function pg_temp.other_flag() returns boolean language sql as $$
  select online_payments_enabled from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-000000000181'
$$;
grant execute on function pg_temp.main_flag(), pg_temp.main_id(), pg_temp.other_flag() to anon, authenticated, service_role;

-- Function and grants
select has_function('public', 'set_online_payments', array['uuid', 'boolean'], 'public.set_online_payments(uuid, boolean) exists');
select function_returns('public', 'set_online_payments', array['uuid', 'boolean'], 'void', 'it returns void');
select is((select p.prosecdef from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'set_online_payments'), true, 'it is security definer');
select is((select has_function_privilege('anon', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'set_online_payments'), false, 'anon cannot execute it');
select is((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'set_online_payments'), true, 'authenticated can execute it');

-- Platform admin: off, on, and only the named venue changes
set local role authenticated;
select pg_temp.as_platform();
select lives_ok($$ select public.set_online_payments(pg_temp.main_id(), false) $$, 'a platform admin turns online payments off');
reset role;
select is(pg_temp.main_flag(), false, 'the venue flag is off');
select is(pg_temp.other_flag(), true, 'another venue''s flag is unchanged by the toggle');
set local role authenticated;
select pg_temp.as_platform();
select lives_ok($$ select public.set_online_payments(pg_temp.main_id(), true) $$, 'a platform admin turns online payments back on');
reset role;
select is(pg_temp.main_flag(), true, 'the venue flag is on again');
set local role authenticated;
select pg_temp.as_platform();
select lives_ok($$ select public.set_online_payments('a0000000-0000-0000-0000-000000000181', false) $$, 'a platform admin turns the other venue off');
reset role;
select is(pg_temp.other_flag(), false, 'the other venue is off');
select is(pg_temp.main_flag(), true, 'the first venue is untouched by the other venue''s toggle');
update public.venue_settings set online_payments_enabled = true where venue_id = 'a0000000-0000-0000-0000-000000000181';

-- Unknown venue
set local role authenticated;
select pg_temp.as_platform();
select is(pg_temp.hint_of($$ select public.set_online_payments('a0000000-0000-0000-0000-0000000001ff', true) $$), 'venue_not_found', 'an unknown venue is refused with hint venue_not_found');
select throws_ok($$ select public.set_online_payments('a0000000-0000-0000-0000-0000000001ff', true) $$, 'P0001', null, 'the unknown-venue refusal is P0001');
-- A platform admin's direct update is still refused by the guard
select is(pg_temp.hint_of($$ update public.venue_settings set online_payments_enabled = false $$), 'forbidden', 'a platform admin''s direct update is refused with hint forbidden');

-- Venue admin
select pg_temp.as_admin();
select is(pg_temp.hint_of($$ select public.set_online_payments(pg_temp.main_id(), false) $$), 'not_platform_admin', 'a venue admin is refused through the RPC with hint not_platform_admin');
select is(pg_temp.hint_of($$ update public.venue_settings set online_payments_enabled = false $$), 'forbidden', 'a venue admin''s direct update is refused with hint forbidden');

-- Player
select pg_temp.as_player();
select is(pg_temp.hint_of($$ select public.set_online_payments(pg_temp.main_id(), false) $$), 'not_platform_admin', 'a player is refused through the RPC with hint not_platform_admin');
select lives_ok($$ update public.venue_settings set online_payments_enabled = false $$, 'a player''s direct update is filtered by RLS (no error, no change)');

-- Anon
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.sqlstate_of($$ select public.set_online_payments(pg_temp.main_id(), false) $$), '42501', 'anon cannot call the RPC (permission denied)');
select is(pg_temp.sqlstate_of($$ update public.venue_settings set online_payments_enabled = false $$), '42501', 'anon cannot update the flag directly');
reset role;
select is(pg_temp.main_flag(), true, 'the first venue flag survived every refused attempt');
select is(pg_temp.other_flag(), true, 'the other venue flag survived every refused attempt');

-- service_role direct update still works
set local role service_role;
select lives_ok($$ update public.venue_settings set online_payments_enabled = false where venue_id = pg_temp.main_id() $$, 'service_role can still change the flag directly');
reset role;
select is(pg_temp.main_flag(), false, 'the flag is off after the service role changed it');

select * from finish();
rollback;
