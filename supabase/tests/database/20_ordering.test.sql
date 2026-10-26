-- T9.3: venue_settings.sport_order (check, RLS) and move_court; get_availability follows the sport order.
-- The seed's "Tennis Court" (sort_order 1) is also a tennis court, so expectations include it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.courts (id, name, sport, default_hourly_rate, sort_order) values
  ('c0000000-0000-0000-0000-000000000001', 'Order T-A', 'tennis', 500, 100),
  ('c0000000-0000-0000-0000-000000000002', 'Order T-B', 'tennis', 500, 100),  -- same number: name breaks the tie
  ('c0000000-0000-0000-0000-000000000003', 'Order T-C', 'tennis', 500, 107);
-- Archived courts are ordered too (the admin list shows them).
insert into public.courts (id, name, sport, default_hourly_rate, sort_order, is_active) values
  ('c0000000-0000-0000-0000-000000000004', 'Order T-D (archived)', 'tennis', 500, 108, false);

create temp table fx as select private.local_today() + 3 as d;
grant select on fx to anon, authenticated;
create temp table badminton_before as
select id, sort_order from public.courts where sport = 'badminton';
grant select on badminton_before to authenticated;

-- Tennis courts in display order, as names.
create function pg_temp.tennis_order() returns text[] language sql as $$
  select array_agg(name order by sort_order, name, id) from public.courts where sport = 'tennis'
$$;

-- ---------------------------------------------------------------------------
-- sport_order: default and check
-- ---------------------------------------------------------------------------
select has_column('public', 'venue_settings', 'sport_order', 'venue_settings has sport_order');
select is(
  (select sport_order from public.venue_settings),
  array['badminton', 'pickleball', 'basketball', 'tennis']::public.sport[],
  'sport_order defaults to the enum order (the order used before M9)'
);
select throws_ok(
  $$ update public.venue_settings set sport_order = array['badminton', 'pickleball', 'tennis']::public.sport[] $$,
  '23514', null, 'a missing sport is rejected'
);
select throws_ok(
  $$ update public.venue_settings set sport_order = array['badminton', 'tennis', 'tennis', 'pickleball']::public.sport[] $$,
  '23514', null, 'a duplicated sport (with one missing) is rejected'
);
select throws_ok(
  $$ update public.venue_settings
     set sport_order = array['badminton', 'pickleball', 'basketball', 'tennis', 'tennis']::public.sport[] $$,
  '23514', null, 'an extra duplicate is rejected'
);

-- ---------------------------------------------------------------------------
-- As anon
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(
  (select cardinality(sport_order) from public.venue_settings), 4,
  'anon can read sport_order'
);
select throws_ok(
  $$ select public.move_court('c0000000-0000-0000-0000-000000000001', 1::smallint) $$,
  '42501', null, 'anon cannot call move_court'
);

-- ---------------------------------------------------------------------------
-- As a player
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select lives_ok(
  $$ update public.venue_settings set sport_order = array['tennis', 'basketball', 'pickleball', 'badminton']::public.sport[] $$,
  'player update on sport_order is filtered by RLS'
);
select is(
  (select sport_order[1] from public.venue_settings), 'badminton'::public.sport,
  'sport_order unchanged by the player'
);
select throws_ok(
  $$ select public.move_court('c0000000-0000-0000-0000-000000000001', 1::smallint) $$,
  'P0001', 'Only staff can reorder courts.', 'a player cannot move courts'
);

-- ---------------------------------------------------------------------------
-- As the admin
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.move_court('c0000000-0000-0000-0000-000000000001', 2::smallint) $$,
  'P0001', 'Choose a court and a direction.', 'a direction other than -1 or 1 is rejected'
);
select throws_ok(
  $$ select public.move_court('c0000000-0000-0000-0000-0000000000ff', 1::smallint) $$,
  'P0001', 'That court does not exist.', 'an unknown court is rejected'
);

select lives_ok(
  $$ select public.move_court('c0000000-0000-0000-0000-000000000003', (-1)::smallint) $$,
  'admin moves Order T-C up'
);
select is(
  pg_temp.tennis_order(), array['Tennis Court', 'Order T-A', 'Order T-C', 'Order T-B', 'Order T-D (archived)'],
  'T-C swapped with its upper neighbour T-B (the tie was broken by name)'
);
select is(
  (select array_agg(sort_order order by sort_order) from public.courts where sport = 'tennis'), array[0, 1, 2, 3, 4],
  'the sport is renumbered 0..n-1, archived court included'
);

select lives_ok(
  $$ select public.move_court((select id from public.courts where name = 'Tennis Court'), (-1)::smallint) $$,
  'moving the first court up is allowed'
);
select is(
  pg_temp.tennis_order(), array['Tennis Court', 'Order T-A', 'Order T-C', 'Order T-B', 'Order T-D (archived)'],
  'moving the first court up changes nothing'
);
select lives_ok(
  $$ select public.move_court('c0000000-0000-0000-0000-000000000004', 1::smallint) $$,
  'moving the last (archived) court down is allowed'
);
select is(
  pg_temp.tennis_order(), array['Tennis Court', 'Order T-A', 'Order T-C', 'Order T-B', 'Order T-D (archived)'],
  'moving the last court down changes nothing'
);
select set_eq(
  $$ select id, sort_order from public.courts where sport = 'badminton' $$,
  $$ select id, sort_order from badminton_before $$,
  'other sports are untouched'
);

-- ---------------------------------------------------------------------------
-- get_availability follows sport_order
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.venue_settings set sport_order = array['tennis', 'basketball', 'pickleball', 'badminton']::public.sport[] $$,
  'admin can change sport_order'
);
select is(
  (select array_agg(sport order by first_row)
   from (select c.sport, min(g.n) as first_row
         from public.get_availability((select d from fx)) with ordinality as g(court_id, slot_start, slot_end, price, status, booker_first_name, open_play_session_id, block_key, n)
         join public.courts c on c.id = g.court_id
         group by c.sport) s),
  array['tennis', 'basketball', 'pickleball', 'badminton']::public.sport[],
  'get_availability lists sports in sport_order'
);
select is(
  (select array_agg(name order by first_row)
   from (select c.name, min(g.n) as first_row
         from public.get_availability((select d from fx)) with ordinality as g(court_id, slot_start, slot_end, price, status, booker_first_name, open_play_session_id, block_key, n)
         join public.courts c on c.id = g.court_id
         where c.sport = 'tennis'
         group by c.name) s),
  array['Tennis Court', 'Order T-A', 'Order T-C', 'Order T-B'],
  'within a sport, get_availability lists active courts in sort_order (the archived one is left out)'
);

select * from finish();
rollback;
