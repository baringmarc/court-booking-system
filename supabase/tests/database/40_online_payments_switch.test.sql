-- T11.22: online payments switch. venue_settings.online_payments_enabled (default false, true for the existing venue),
-- guarded by private.guard_online_payments(): only postgres and service_role may change it; admins edit everything else.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';

-- Column
select has_column('public', 'venue_settings', 'online_payments_enabled', 'venue_settings has online_payments_enabled');
select col_type_is('public', 'venue_settings', 'online_payments_enabled', 'boolean', 'it is boolean');
select col_not_null('public', 'venue_settings', 'online_payments_enabled', 'it is required');
select is((select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
     where d.adrelid = 'public.venue_settings'::regclass
       and d.adnum = (select attnum from pg_attribute where attrelid = 'public.venue_settings'::regclass and attname = 'online_payments_enabled')),
  'false', 'it defaults to false for new venues');
select is((select online_payments_enabled from public.venue_settings), true, 'the existing venue keeps online payments on (rollout)');

-- Function and trigger
select has_function('private', 'guard_online_payments', array[]::text[], 'private.guard_online_payments() exists');
select is((select prosecdef from pg_proc where oid = 'private.guard_online_payments()'::regprocedure), false, 'it is security invoker');
select is((select proconfig from pg_proc where oid = 'private.guard_online_payments()'::regprocedure), array['search_path=""'], 'it pins search_path to empty');
select has_trigger('public', 'venue_settings', 'venue_settings_guard_online_payments', 'venue_settings has the guard trigger');
select is((select tgtype & 2 from pg_trigger where tgname = 'venue_settings_guard_online_payments' and tgrelid = 'public.venue_settings'::regclass), 2, 'it fires before');
select is((select tgtype & 16 from pg_trigger where tgname = 'venue_settings_guard_online_payments' and tgrelid = 'public.venue_settings'::regclass), 16, 'it fires on update');
select is((select tgtype & 1 from pg_trigger where tgname = 'venue_settings_guard_online_payments' and tgrelid = 'public.venue_settings'::regclass), 1, 'it is row-level');

-- Anon: no update at all
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.sqlstate_of($$ update public.venue_settings set online_payments_enabled = false $$), '42501', 'anon cannot change the flag');

-- Player: the update policy filters them out, the flag is unchanged
set local role authenticated;
select pg_temp.as_player();
select lives_ok($$ update public.venue_settings set online_payments_enabled = false $$, 'a player''s update is filtered by RLS (no error)');
reset role;
select is((select online_payments_enabled from public.venue_settings), true, 'the player did not change the flag');

-- Admin: cannot change the flag, can change everything else
set local role authenticated;
select pg_temp.as_admin();
select is(pg_temp.hint_of($$ update public.venue_settings set online_payments_enabled = false $$), 'forbidden', 'an admin changing the flag is refused with hint forbidden');
select throws_ok($$ update public.venue_settings set online_payments_enabled = false $$, 'P0001', 'Online payments are managed by Plotline.', 'the refusal is P0001 with the exact message');
select lives_ok($$ update public.venue_settings set waiver_text = 'Admin edit.' $$, 'an admin can still update other settings');
select lives_ok($$ update public.venue_settings set online_payments_enabled = online_payments_enabled, waiver_text = 'Admin edit 2.' $$, 'an admin update that leaves the flag unchanged is allowed');
reset role;
select is((select online_payments_enabled from public.venue_settings), true, 'the flag is still on after the admin attempts');
select is((select waiver_text from public.venue_settings), 'Admin edit 2.', 'the admin''s other edits were stored');

-- service_role and postgres can change it
set local role service_role;
select lives_ok($$ update public.venue_settings set online_payments_enabled = false $$, 'service_role can turn the flag off');
reset role;
select is((select online_payments_enabled from public.venue_settings), false, 'the flag is off after the service role changed it');
select lives_ok($$ update public.venue_settings set online_payments_enabled = true $$, 'postgres can turn the flag back on');

select * from finish();
rollback;
