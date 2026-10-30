-- T9.6: court_photos (grants, RLS, path rule, 6-photo limit), reorder_court_photos and cascades; T9.11: pruning rows whose
-- file is gone, and courts.photo_path dropped.
-- The hardening migration (T9.6 review): least-privilege grants, the limit on moves, appended sort_order.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';
insert into public.courts (id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-000000000001', 'Photo Court', 'tennis', 500, true),
  ('c0000000-0000-0000-0000-000000000002', 'Archived Photo Court', 'tennis', 500, false),
  ('c0000000-0000-0000-0000-000000000003', 'Legacy Photo Court', 'tennis', 500, true);

-- A valid photo path for court n (1..3) and file number k.
create function pg_temp.p(n int, k int) returns text language sql as $$
  select format('courts/c0000000-0000-0000-0000-00000000000%s/00000000-0000-0000-0000-%s.webp', n, lpad(k::text, 12, '0'))
$$;
grant execute on function pg_temp.p(int, int) to anon, authenticated;

insert into public.court_photos (id, court_id, path, sort_order) values
  ('f0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', pg_temp.p(1, 1), 0),
  ('f0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', pg_temp.p(1, 2), 1),
  ('f0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', pg_temp.p(1, 3), 2),
  ('f0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000002', pg_temp.p(2, 1), 0);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
select has_table('public', 'court_photos', 'court_photos exists');
select ok((select relrowsecurity from pg_class where oid = 'public.court_photos'::regclass), 'RLS is on');
select ok(has_table_privilege('anon', 'public.court_photos', 'SELECT'), 'anon may select (RLS decides which rows)');
select ok(not has_table_privilege('anon', 'public.court_photos', 'INSERT, UPDATE, DELETE'), 'anon has no write privileges');
select ok(not has_table_privilege('anon', 'public.court_photos', 'TRUNCATE, REFERENCES, TRIGGER'), 'anon has no truncate, references or trigger');
-- A comma-separated list means "any of", so each privilege the role needs is checked on its own.
select ok(has_table_privilege('authenticated', 'public.court_photos', 'SELECT'), 'authenticated may select');
select ok(has_table_privilege('authenticated', 'public.court_photos', 'INSERT'), 'authenticated may insert (RLS limits it to admins)');
select ok(has_table_privilege('authenticated', 'public.court_photos', 'UPDATE'), 'authenticated may update (RLS limits it to admins)');
select ok(has_table_privilege('authenticated', 'public.court_photos', 'DELETE'), 'authenticated may delete (RLS limits it to admins)');
select ok(not has_table_privilege('authenticated', 'public.court_photos', 'TRUNCATE, REFERENCES, TRIGGER'), 'authenticated has no truncate, references or trigger');

-- ---------------------------------------------------------------------------
-- As anon
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(
  (select count(*)::int from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000001'), 3,
  'anon sees the photos of an active court'
);
select is(
  (select count(*)::int from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000002'), 0,
  'anon does not see the photos of an archived court'
);
select throws_ok(
  $$ insert into public.court_photos (court_id, path) values ('c0000000-0000-0000-0000-000000000001', pg_temp.p(1, 7)) $$,
  '42501', null, 'anon cannot add photos'
);
select throws_ok(
  $$ select public.reorder_court_photos('c0000000-0000-0000-0000-000000000001', array['f0000000-0000-0000-0000-000000000001']::uuid[]) $$,
  '42501', null, 'anon cannot call reorder_court_photos'
);

-- ---------------------------------------------------------------------------
-- As a player
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into public.court_photos (court_id, path) values ('c0000000-0000-0000-0000-000000000001', pg_temp.p(1, 7)) $$,
  '42501', null, 'a player cannot add photos'
);
select lives_ok(
  $$ delete from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000001' $$,
  'a player delete is filtered by RLS'
);
select lives_ok(
  $$ update public.court_photos set sort_order = 99 where court_id = 'c0000000-0000-0000-0000-000000000001' $$,
  'a player update is filtered by RLS'
);
select throws_ok(
  $$ select public.reorder_court_photos('c0000000-0000-0000-0000-000000000001',
       array['f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
             'f0000000-0000-0000-0000-000000000002']::uuid[]) $$,
  'P0001', 'Only staff can reorder photos.', 'a player cannot reorder photos'
);

-- ---------------------------------------------------------------------------
-- As the admin
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(
  (select count(*)::int from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000001'), 3,
  'the player delete removed nothing'
);
select is(
  (select max(sort_order) from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000001'), 2,
  'the player update changed nothing'
);
select is(
  (select count(*)::int from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000002'), 1,
  'admin sees the photos of an archived court'
);

-- Path rule
select throws_ok(
  $$ insert into public.court_photos (court_id, path) values ('c0000000-0000-0000-0000-000000000001', pg_temp.p(3, 1)) $$,
  '23514', null, 'a path in another court''s folder is rejected'
);
select throws_ok(
  $$ insert into public.court_photos (court_id, path)
     values ('c0000000-0000-0000-0000-000000000001', 'banner/00000000-0000-0000-0000-000000000001.webp') $$,
  '23514', null, 'a path outside courts/ is rejected'
);
select throws_ok(
  $$ insert into public.court_photos (court_id, path) values ('c0000000-0000-0000-0000-000000000001', pg_temp.p(1, 1)) $$,
  '23505', null, 'a duplicate path is rejected'
);
select throws_ok(
  $$ insert into public.court_photos (court_id, path)
     values ('c0000000-0000-0000-0000-000000000001', 'courts/c0000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.gif') $$,
  '23514', null, 'a photo must be webp, jpg, jpeg or png'
);

-- The 6-photo limit
select lives_ok(
  $$ insert into public.court_photos (id, court_id, path)
     values ('f0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000001', pg_temp.p(1, 4)) $$,
  'admin adds a photo without choosing its place'
);
select is(
  (select sort_order from public.court_photos where id = 'f0000000-0000-0000-0000-000000000004'), 3,
  'a photo added without a sort_order goes after the last one (not 0, which would tie with the cover)'
);
select lives_ok(
  $$ insert into public.court_photos (court_id, path)
     select 'c0000000-0000-0000-0000-000000000001', pg_temp.p(1, k) from generate_series(5, 6) k $$,
  'admin adds photos up to 6'
);
select throws_ok(
  $$ insert into public.court_photos (court_id, path) values ('c0000000-0000-0000-0000-000000000001', pg_temp.p(1, 7)) $$,
  'P0001', 'A court can have at most 6 photos. Remove one first.', 'a 7th photo is rejected'
);
select is(
  (select count(*)::int from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000001'), 6,
  'the court still has 6 photos'
);
select throws_ok(
  $$ update public.court_photos
     set court_id = 'c0000000-0000-0000-0000-000000000001', path = pg_temp.p(1, 9)
     where id = 'f0000000-0000-0000-0000-000000000009' $$,
  'P0001', 'A court can have at most 6 photos. Remove one first.', 'moving a photo onto a full court is rejected'
);
select lives_ok(
  $$ update public.court_photos set sort_order = 10 where id = 'f0000000-0000-0000-0000-000000000004' $$,
  'admin can update a photo (the limit only checks moves between courts)'
);
delete from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000001' and sort_order >= 3;

-- reorder_court_photos
select throws_ok(
  $$ select public.reorder_court_photos('c0000000-0000-0000-0000-000000000001',
       array['f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001']::uuid[]) $$,
  'P0001', 'The photo list is out of date. Reload the page and try again.', 'a list missing a photo is rejected'
);
select throws_ok(
  $$ select public.reorder_court_photos('c0000000-0000-0000-0000-000000000001',
       array['f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
             'f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000009']::uuid[]) $$,
  'P0001', 'The photo list is out of date. Reload the page and try again.', 'a list with another court''s photo is rejected'
);
select throws_ok(
  $$ select public.reorder_court_photos('c0000000-0000-0000-0000-000000000001',
       array['f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
             'f0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000002']::uuid[]) $$,
  'P0001', 'The photo list is out of date. Reload the page and try again.', 'a list repeating a photo is rejected'
);
select lives_ok(
  $$ select public.reorder_court_photos('c0000000-0000-0000-0000-000000000001',
       array['f0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001',
             'f0000000-0000-0000-0000-000000000002']::uuid[]) $$,
  'admin reorders the photos'
);
select results_eq(
  $$ select id, sort_order from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000001' order by sort_order $$,
  $$ values ('f0000000-0000-0000-0000-000000000003'::uuid, 0), ('f0000000-0000-0000-0000-000000000001'::uuid, 1),
            ('f0000000-0000-0000-0000-000000000002'::uuid, 2) $$,
  'the new order is stored 0..n-1, and the first is the cover'
);

-- ---------------------------------------------------------------------------
-- Pruning rows whose file is gone (T9.11), and the cascade
-- ---------------------------------------------------------------------------
reset role;
insert into storage.objects (bucket_id, name) values ('venue-media', pg_temp.p(1, 1)), ('venue-media', pg_temp.p(1, 3));
select is(private.prune_missing_court_photos(), 2, 'rows whose file is missing from Storage are removed');
select results_eq(
  $$ select path from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000001' order by sort_order $$,
  $$ values (pg_temp.p(1, 3)), (pg_temp.p(1, 1)) $$,
  'photos whose file exists are kept, in order'
);
select is(private.prune_missing_court_photos(), 0, 'running it again removes nothing');
select hasnt_column('public', 'courts', 'photo_path', 'courts.photo_path is gone (T9.11 contract)');

insert into public.court_photos (court_id, path, sort_order)
values ('c0000000-0000-0000-0000-000000000003', pg_temp.p(3, 5), 0);
delete from public.courts where id = 'c0000000-0000-0000-0000-000000000003';
select is(
  (select count(*)::int from public.court_photos where court_id = 'c0000000-0000-0000-0000-000000000003'), 0,
  'deleting a court removes its photo rows'
);

select * from finish();
rollback;
