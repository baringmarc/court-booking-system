-- T13.5: the single-venue default is gone. A public call names its venue (a slug, or a court that belongs to one).
--   * private.resolve_public_venue(slug): null slug -> venue_required ('Say which venue you mean.'), even when one venue is active
--   * get_availability(date, court default null, slug default null): neither -> venue_required; slug alone works per venue
--   * venues_slug_not_reserved: www, app, api, admin, demo, staging, mail, help, blog, status, support, plotline
--   * private.default_venue_id() stays (the venue_id column default)
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;
create function pg_temp.insert_slug(p_slug text) returns text language plpgsql as $$
begin
  insert into public.venues (slug) values (p_slug);
  return 'ok';
exception when check_violation then
  return 'check_violation';
end $$;
grant execute on function pg_temp.hint_of(text) to anon, authenticated;
grant execute on function pg_temp.msg_of(text) to anon, authenticated;

-- Two active venues next to Claudex Courts, one court each.
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'e2e-ndv-a', 'active'),
  ('b0000000-0000-0000-0000-00000000000b', 'e2e-ndv-b', 'active');
insert into public.venue_settings (venue_id, name) values
  ('a0000000-0000-0000-0000-00000000000a', 'E2E NDV A'),
  ('b0000000-0000-0000-0000-00000000000b', 'E2E NDV B');
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v, d, time '06:00', time '22:00'
from unnest(array['a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b']::uuid[]) v, generate_series(0, 6) d;
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'E2E NDV A1', 'tennis', 500, true),
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E NDV B1', 'tennis', 600, true);
create temp table fx as
select (now() at time zone 'UTC')::date + 2 as d;
grant select on fx to anon, authenticated;

-- ---------------------------------------------------------------- resolve_public_venue
select is(pg_temp.hint_of($$ select private.resolve_public_venue(null) $$), 'venue_required',
  'resolve: a null slug is venue_required');
select is(pg_temp.msg_of($$ select private.resolve_public_venue(null) $$), 'P0001 Say which venue you mean.',
  'resolve: venue_required is P0001 with the readable message');
select is(pg_temp.hint_of($$ select private.resolve_public_venue('e2e-ndv-nope') $$), 'venue_not_found',
  'resolve: an unknown slug is still venue_not_found');
select is(private.resolve_public_venue('e2e-ndv-a'), 'a0000000-0000-0000-0000-00000000000a'::uuid, 'resolve: venue A by slug');
select is(private.resolve_public_venue('claudex-courts'), private.default_venue_id(), 'resolve: claudex-courts by slug');
select is(to_regprocedure('private.resolve_public_venue()'), null, 'resolve: there is no zero-argument form');
select has_function('private', 'default_venue_id', array[]::text[], 'private.default_venue_id() stays');

-- ---------------------------------------------------------------- get_availability
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(pg_temp.hint_of($$ select * from public.get_availability((select d from fx)) $$), 'venue_required',
  'availability: no court and no slug is venue_required');
select is(pg_temp.hint_of($$ select * from public.get_availability((select d from fx), null, null) $$), 'venue_required',
  'availability: null court and null slug is venue_required');
select is(pg_temp.msg_of($$ select * from public.get_availability((select d from fx)) $$), 'P0001 Say which venue you mean.',
  'availability: venue_required is P0001 with the readable message');
select cmp_ok((select count(*)::int from public.get_availability((select d from fx), null, 'e2e-ndv-a')), '>', 0,
  'availability: a slug alone works for venue A');
select cmp_ok((select count(*)::int from public.get_availability((select d from fx), null, 'e2e-ndv-b')), '>', 0,
  'availability: a slug alone works for venue B');
select is((select array_agg(distinct court_id) from public.get_availability((select d from fx), null, 'e2e-ndv-a')),
  array['c0000000-0000-0000-0000-0000000000a1']::uuid[], 'availability: venue A lists only its own court');
select is((select array_agg(distinct court_id) from public.get_availability((select d from fx), null, 'e2e-ndv-b')),
  array['c0000000-0000-0000-0000-0000000000b1']::uuid[], 'availability: venue B lists only its own court');
select cmp_ok((select count(*)::int from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-0000000000b1')), '>', 0,
  'availability: a court alone still picks its venue');
select is(pg_temp.hint_of($$ select * from public.get_availability((select d from fx), null, 'e2e-ndv-nope') $$), 'venue_not_found',
  'availability: an unknown slug is venue_not_found');
reset role;
select ok(has_function_privilege('anon', 'public.get_availability(date, uuid, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.get_availability(date, uuid, text)', 'EXECUTE')
      and not has_function_privilege('public', 'public.get_availability(date, uuid, text)', 'EXECUTE'),
  'availability: anon and authenticated execute, PUBLIC does not');
select is(to_regprocedure('public.get_availability(date, uuid)'), null, 'availability: the two-argument wrapper is gone');

-- ---------------------------------------------------------------- reserved slugs
select is((select array_agg(pg_temp.insert_slug(s) order by s) from unnest(array['help', 'blog', 'plotline']) s),
  array['check_violation', 'check_violation', 'check_violation'], 'slug: help, blog and plotline are reserved');
select is(pg_temp.insert_slug('e2e-ndv-fresh'), 'ok', 'slug: a non-reserved slug still works');

select * from finish();
rollback;
