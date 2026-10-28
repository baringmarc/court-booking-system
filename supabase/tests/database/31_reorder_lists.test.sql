-- T11.5a: reorder_courts and reorder_info_sections set a whole new order (drag-to-reorder). Staff only; a list that
-- is out of date (missing, extra, duplicate, another sport's court) is refused; other sports are untouched.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
grant execute on function pg_temp.hint_of(text) to anon, authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

-- A known tennis list (the seed's tennis court removed from it), with an archived court that is ordered too.
delete from public.courts where sport = 'tennis' and id not in (select court_id from public.bookings);
update public.courts set sport = 'basketball' where sport = 'tennis';
insert into public.courts (id, name, sport, default_hourly_rate, sort_order, is_active) values
  ('c0000000-0000-0000-0000-000000000001', 'Re T-A', 'tennis', 500, 0, true),
  ('c0000000-0000-0000-0000-000000000002', 'Re T-B', 'tennis', 500, 1, true),
  ('c0000000-0000-0000-0000-000000000003', 'Re T-C', 'tennis', 500, 2, true),
  ('c0000000-0000-0000-0000-000000000004', 'Re T-D (archived)', 'tennis', 500, 3, false);
create temp table badminton_before as select id, sort_order from public.courts where sport = 'badminton';
grant select on badminton_before to authenticated;
create function pg_temp.badminton_moved() returns int language sql security definer as $$
  select count(*)::int from public.courts c join badminton_before b using (id) where c.sort_order is distinct from b.sort_order
$$;
grant execute on function pg_temp.badminton_moved() to authenticated;

delete from public.venue_info_sections;
insert into public.venue_info_sections (id, title, sort_order) values
  ('d0000000-0000-0000-0000-000000000001', 'One', 0),
  ('d0000000-0000-0000-0000-000000000002', 'Two', 1),
  ('d0000000-0000-0000-0000-000000000003', 'Three', 2);

-- Owner's view (security definer), so a player's run still sees the archived court RLS hides from them.
create function pg_temp.tennis() returns text[] language sql security definer as $$
  select array_agg(name order by sort_order, id) from public.courts where sport = 'tennis'
$$;
create function pg_temp.sections() returns text[] language sql security definer as $$
  select array_agg(title order by sort_order, id) from public.venue_info_sections
$$;
grant execute on function pg_temp.tennis() to anon, authenticated;
grant execute on function pg_temp.sections() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select is(
  has_function_privilege('anon', 'public.reorder_courts(public.sport, uuid[])', 'execute'), false,
  'anon cannot execute reorder_courts'
);
select is(
  has_function_privilege('anon', 'public.reorder_info_sections(uuid[])', 'execute'), false,
  'anon cannot execute reorder_info_sections'
);
select is(
  has_function_privilege('authenticated', 'public.reorder_courts(public.sport, uuid[])', 'execute'), true,
  'signed-in users may call reorder_courts (it checks for staff itself)'
);

-- ---------------------------------------------------------------------------
-- A player is refused
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(
  pg_temp.hint_of($$ select public.reorder_courts('tennis', array[
    'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000004']::uuid[]) $$),
  'forbidden', 'a player cannot reorder courts'
);
select is(
  pg_temp.hint_of($$ select public.reorder_info_sections(array[
    'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000002']::uuid[]) $$),
  'forbidden', 'a player cannot reorder info sections'
);
select is(pg_temp.tennis(), array['Re T-A', 'Re T-B', 'Re T-C', 'Re T-D (archived)'], 'the courts are unchanged');
select is(pg_temp.sections(), array['One', 'Two', 'Three'], 'the sections are unchanged');

-- ---------------------------------------------------------------------------
-- Staff: courts
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.reorder_courts('tennis', array[
    'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002']::uuid[]) $$,
  'staff move the third court to the top and the archived one up'
);
select is(pg_temp.tennis(), array['Re T-C', 'Re T-A', 'Re T-D (archived)', 'Re T-B'], 'the new order is stored');
create function pg_temp.tennis_numbers() returns int[] language sql security definer as $$
  select array_agg(sort_order order by sort_order) from public.courts where sport = 'tennis'
$$;
grant execute on function pg_temp.tennis_numbers() to authenticated;
select is(pg_temp.tennis_numbers(), array[0, 1, 2, 3], 'numbered 0..n-1');
select is(pg_temp.badminton_moved(), 0, 'another sport''s courts are untouched');
select is(
  pg_temp.hint_of($$ select public.reorder_courts('tennis', array[
    'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002']::uuid[]) $$),
  'invalid_input', 'a list missing a court (the archived one) is refused'
);
select is(
  pg_temp.hint_of(format($$ select public.reorder_courts('tennis', array[
    'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', %L]::uuid[]) $$,
    (select id from public.courts where sport = 'badminton' limit 1))),
  'invalid_input', 'a list with another sport''s court is refused'
);
select is(
  pg_temp.hint_of($$ select public.reorder_courts('tennis', array[
    'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003',
    'c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002']::uuid[]) $$),
  'invalid_input', 'a list with a duplicate is refused'
);
select is(
  pg_temp.hint_of($$ select public.reorder_courts(null, array[]::uuid[]) $$),
  'invalid_input', 'a missing sport is refused'
);
select is(pg_temp.tennis(), array['Re T-C', 'Re T-A', 'Re T-D (archived)', 'Re T-B'], 'refused lists change nothing');

-- ---------------------------------------------------------------------------
-- Staff: info sections
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.reorder_info_sections(array[
    'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000002']::uuid[]) $$,
  'staff move the last section to the top'
);
select is(pg_temp.sections(), array['Three', 'One', 'Two'], 'the new section order is stored');
select is(
  pg_temp.hint_of($$ select public.reorder_info_sections(array[
    'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001']::uuid[]) $$),
  'invalid_input', 'a section list missing one is refused'
);
select is(
  pg_temp.hint_of($$ select public.reorder_info_sections(array[
    'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001',
    'd0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000009']::uuid[]) $$),
  'invalid_input', 'a section list with an unknown id is refused'
);
select is(
  pg_temp.hint_of($$ select public.reorder_info_sections(null) $$),
  'invalid_input', 'a missing list is refused'
);
select is(pg_temp.sections(), array['Three', 'One', 'Two'], 'refused section lists change nothing');

select * from finish();
rollback;
