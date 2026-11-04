-- T17.7: platform-owned Showcase approval. Legacy venue selections are retained, but only platform approval controls
-- the public showcase. public_venues keeps its existing marketing-site contract.
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;

create function pg_temp.error_of(p_sql text) returns text language plpgsql as $$
declare s text; h text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return s || '|' || coalesce(h, '');
end $$;
create function pg_temp.column_text(p_table text, p_column text, p_id uuid) returns text language plpgsql as $$
declare v text;
begin
  execute format('select %I::text from public.%I where id = $1', p_column, p_table) into v using p_id;
  return v;
exception when undefined_column then
  return null;
end $$;
grant execute on function pg_temp.sqlstate_of(text) to anon, authenticated;
grant execute on function pg_temp.error_of(text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000066a1', 'e2e-showcase-owner@example.com'),
  ('00000000-0000-0000-0000-0000000066a2', 'e2e-showcase-platform@example.com'),
  ('00000000-0000-0000-0000-0000000066a3', 'e2e-showcase-player@example.com');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000066a1', 'e2e-showcase-active', 'active'),
  ('a0000000-0000-0000-0000-0000000066a2', 'e2e-showcase-unapproved', 'active'),
  ('a0000000-0000-0000-0000-0000000066a3', 'e2e-showcase-draft', 'draft'),
  ('a0000000-0000-0000-0000-0000000066a4', 'e2e-showcase-suspended', 'suspended');
insert into public.venue_settings (venue_id, name, city, showcase_opt_in) values
  ('a0000000-0000-0000-0000-0000000066a1', 'E2E Showcase Active', 'Cebu', true),
  ('a0000000-0000-0000-0000-0000000066a2', 'E2E Showcase Unapproved', 'Davao', true),
  ('a0000000-0000-0000-0000-0000000066a3', 'E2E Showcase Draft', 'Iloilo', true),
  ('a0000000-0000-0000-0000-0000000066a4', 'E2E Showcase Suspended', 'Baguio', true);
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000066a1', '00000000-0000-0000-0000-0000000066a1', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000066a2');

-- ---------------------------------------------------------------- schema and public contract
select has_column('public', 'venues', 'showcase_approved', 'venues has platform-owned showcase approval state');
select col_type_is('public', 'venues', 'showcase_approved', 'boolean', 'showcase_approved is boolean');
select col_not_null('public', 'venues', 'showcase_approved', 'showcase_approved is required');
select is(pg_temp.column_text('venues', 'showcase_approved', 'a0000000-0000-0000-0000-0000000066a1'),
  'false', 'new venues start without platform showcase approval');
select has_function('public', 'set_venue_showcase_approval', array['uuid', 'boolean'],
  'the platform approval RPC exists');
select ok(coalesce((select prosecdef from pg_proc where oid = to_regprocedure('public.set_venue_showcase_approval(uuid,boolean)')), false),
  'the approval RPC is SECURITY DEFINER');
select ok(not exists (select 1 from pg_proc p
  where p.oid = to_regprocedure('public.set_venue_showcase_approval(uuid,boolean)')
    and has_function_privilege('anon', p.oid, 'execute')),
  'anon cannot execute the approval RPC');
select has_view('public', 'public_venues', 'public.public_venues exists');
select columns_are('public', 'public_venues', array['slug', 'name', 'city', 'logo_url'],
  'public_venues preserves its four marketing-site columns');
select col_type_is('public', 'public_venues', 'slug', 'text', 'public_venues.slug remains text');
select col_type_is('public', 'public_venues', 'name', 'text', 'public_venues.name remains text');
select col_type_is('public', 'public_venues', 'city', 'text', 'public_venues.city remains text');
select col_type_is('public', 'public_venues', 'logo_url', 'text', 'public_venues.logo_url remains text');

-- ---------------------------------------------------------------- venue admin cannot edit the legacy switch, but may still edit ordinary venue settings
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000066a1","role":"authenticated"}';
select lives_ok($$update public.venue_settings set city = 'Cebu City' where venue_id = 'a0000000-0000-0000-0000-0000000066a1'$$,
  'venue admin can still update ordinary venue settings');
select ok(pg_temp.sqlstate_of($$update public.venue_settings set showcase_opt_in = false where venue_id = 'a0000000-0000-0000-0000-0000000066a1'$$) is not null,
  'venue admin cannot directly change the legacy showcase selection');
select is(pg_temp.error_of($$select public.set_venue_showcase_approval('a0000000-0000-0000-0000-0000000066a1', true)$$),
  'P0001|not_platform_admin', 'venue admin cannot approve a showcase venue');
reset role;
select is((select city from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-0000000066a1'),
  'Cebu City', 'ordinary venue setting save persists despite the legacy write guard');
select is((select showcase_opt_in from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-0000000066a1'),
  true, 'guarded legacy selection remains unchanged');

-- ---------------------------------------------------------------- player cannot approve
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000066a3","role":"authenticated"}';
select is(pg_temp.error_of($$select public.set_venue_showcase_approval('a0000000-0000-0000-0000-0000000066a1', true)$$),
  'P0001|not_platform_admin', 'ordinary player cannot approve a showcase venue');
reset role;

-- ---------------------------------------------------------------- platform admin controls approval; the view requires active status and approval
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000066a2","role":"authenticated"}';
select lives_ok($$select public.set_venue_showcase_approval('a0000000-0000-0000-0000-0000000066a1', true)$$,
  'platform admin can approve a showcase venue');
select lives_ok($$select public.set_venue_showcase_approval('a0000000-0000-0000-0000-0000000066a3', true)$$,
  'platform admin can approve a draft venue');
select lives_ok($$select public.set_venue_showcase_approval('a0000000-0000-0000-0000-0000000066a4', true)$$,
  'platform admin can approve a suspended venue');
reset role;
select is(pg_temp.column_text('venues', 'showcase_approved', 'a0000000-0000-0000-0000-0000000066a1'),
  'true', 'platform approval is stored on the venue');
select results_eq(
  $$select slug from public.public_venues where slug like 'e2e-showcase-%' order by slug$$,
  $$values ('e2e-showcase-active'::text)$$,
  'public view includes active approved venue and excludes unapproved and non-active venues');
select is((select city from public.public_venues where slug = 'e2e-showcase-active'),
  'Cebu City', 'public view keeps reading the venue city');
select is((select showcase_opt_in from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-0000000066a1'),
  true, 'platform approval does not rewrite the preserved legacy selection');

select lives_ok($$select public.set_venue_showcase_approval('a0000000-0000-0000-0000-0000000066a1', false)$$,
  'platform admin can revoke showcase approval');
select is((select count(*)::int from public.public_venues where slug = 'e2e-showcase-active'),
  0, 'revoking approval removes the venue from the public view');

select * from finish();
rollback;
