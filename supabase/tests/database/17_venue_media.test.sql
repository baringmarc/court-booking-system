-- T6.2: venue-media bucket, its storage.objects policies, and the media columns on courts and venue_settings.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000001', 'Media Court', 'tennis', 500),
  ('c0000000-0000-0000-0000-000000000002', 'Other Media Court', 'tennis', 500);

-- ---------------------------------------------------------------------------
-- Bucket and policy definitions
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'venue-media' $$,
  $$ values (true, 2097152::bigint, array['image/jpeg', 'image/png', 'image/webp']) $$,
  'venue-media is public, 2 MB, JPG/PNG/WEBP only'
);
select is(
  (select string_agg(policyname || ' ' || cmd || ' ' || array_to_string(roles, ','), '; ' order by policyname)::text
   from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname like '%venue media'),
  'Admins delete venue media DELETE authenticated; Admins read venue media SELECT authenticated; '
  || 'Admins update venue media UPDATE authenticated; Admins upload venue media INSERT authenticated',
  'exactly four venue-media policies, all for authenticated (no anon policy, so listing stays closed)'
);
-- Storage blocks SQL deletes, so the delete rule is checked through its definition.
select ok(
  (select qual like '%venue-media%' and qual like '%is_admin()%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'Admins delete venue media'),
  'only admins can delete venue media, and only in this bucket'
);

-- An object as the storage service would create it (service role bypasses RLS)
set local role service_role;
insert into storage.objects (bucket_id, name) values
  ('venue-media', 'courts/c0000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp');
reset role;

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp') $$,
  '42501', null, 'anon cannot upload venue media'
);
select is_empty(
  $$ update storage.objects set name = 'banner/x.webp' where bucket_id = 'venue-media' returning id $$,
  'anon cannot rename venue media'
);
select is((select count(*)::int from storage.objects where bucket_id = 'venue-media'), 0,
  'anon sees no venue-media rows through RLS (public URLs need no policy)');
reset role;

-- ---------------------------------------------------------------------------
-- player
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp') $$,
  '42501', null, 'players cannot upload venue media'
);
select is_empty(
  $$ update storage.objects set name = 'banner/x.webp' where bucket_id = 'venue-media' returning id $$,
  'players cannot rename venue media'
);
select is((select count(*)::int from storage.objects where bucket_id = 'venue-media'), 0,
  'players see no venue-media rows through RLS');
select is_empty(
  $$ update public.courts
     set photo_path = 'courts/c0000000-0000-0000-0000-000000000001/cccccccc-cccc-cccc-cccc-cccccccccccc.webp'
     where id = 'c0000000-0000-0000-0000-000000000001' returning id $$,
  'players cannot set a court photo'
);
select is_empty(
  $$ update public.venue_settings
     set banner_path = 'banner/cccccccc-cccc-cccc-cccc-cccccccccccc.webp', banner_alt = 'Courts'
     returning id $$,
  'players cannot set the banner'
);

-- ---------------------------------------------------------------------------
-- admin: storage
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
       ('venue-media', 'courts/c0000000-0000-0000-0000-000000000002/dddddddd-dddd-dddd-dddd-dddddddddddd.jpg') $$,
  'admins can upload a court photo'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp') $$,
  'admins can upload a banner'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'other/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee.webp') $$,
  '42501', null, 'admins cannot upload outside courts/ and banner/'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee.webp') $$,
  '42501', null, 'admins cannot upload at the bucket root'
);
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'venue-media'
     and name in ('courts/c0000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp',
                  'courts/c0000000-0000-0000-0000-000000000002/dddddddd-dddd-dddd-dddd-dddddddddddd.jpg',
                  'banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp')),
  3, 'admins see venue-media objects (needed for remove and upsert)'
);
select throws_ok(
  $$ update storage.objects set name = 'other/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'
     where bucket_id = 'venue-media' and name = 'banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp' $$,
  '42501', null, 'admins cannot move an object outside courts/ and banner/'
);
with moved as (
     update storage.objects set name = 'banner/ffffffff-ffff-ffff-ffff-ffffffffffff.webp'
     where bucket_id = 'venue-media' and name = 'banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'
     returning id)
select is(count(*)::int, 1, 'admins can update objects inside the allowed folders') from moved;
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-proofs', 'courts/x.webp') $$,
  '42501', null, 'the venue-media policies do not let admins write to other buckets'
);

-- ---------------------------------------------------------------------------
-- admin: columns, through the existing admin RLS
-- ---------------------------------------------------------------------------
with u as (
     update public.courts
     set photo_path = 'courts/c0000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'
     where id = 'c0000000-0000-0000-0000-000000000001' returning id)
select is(count(*)::int, 1, 'admins can set a court photo') from u;
select lives_ok(
  $$ update public.venue_settings
     set banner_path = 'banner/ffffffff-ffff-ffff-ffff-ffffffffffff.webp', banner_alt = 'Night games on the tennis courts' $$,
  'admins can set the banner with alt text'
);
select results_eq(
  $$ select banner_path, banner_alt from public.venue_settings $$,
  $$ values ('banner/ffffffff-ffff-ffff-ffff-ffffffffffff.webp', 'Night games on the tennis courts') $$,
  'the banner is stored'
);
select lives_ok(
  $$ update public.venue_settings set banner_path = null, banner_alt = null $$,
  'admins can remove the banner'
);
select lives_ok(
  $$ update public.courts set photo_path = null where id = 'c0000000-0000-0000-0000-000000000001' $$,
  'admins can remove a court photo'
);

-- ---------------------------------------------------------------------------
-- CHECKs (as admin)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.courts
     set photo_path = 'courts/c0000000-0000-0000-0000-000000000002/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'
     where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a court photo must be under its own court''s folder'
);
select throws_ok(
  $$ update public.courts set photo_path = 'banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'
     where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a court photo cannot point at the banner folder'
);
select throws_ok(
  $$ update public.courts
     set photo_path = 'courts/c0000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.gif'
     where id = 'c0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a court photo must be webp, jpg, jpeg or png'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = 'courts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', banner_alt = 'Courts' $$,
  '23514', null, 'the banner must be under banner/'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = 'banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp' $$,
  '23514', null, 'a banner needs alt text'
);
select throws_ok(
  $$ update public.venue_settings set banner_alt = 'Courts' $$,
  '23514', null, 'alt text needs a banner'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = 'banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', banner_alt = '' $$,
  '23514', null, 'alt text cannot be empty'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = 'banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', banner_alt = E'\t\n' $$,
  '23514', null, 'alt text cannot be only tabs or newlines'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = 'banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', banner_alt = ' Courts ' $$,
  '23514', null, 'alt text is stored trimmed'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = 'banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp', banner_alt = repeat('a', 201) $$,
  '23514', null, 'alt text is at most 200 characters'
);
select lives_ok(
  $$ update public.venue_settings set banner_path = 'banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png', banner_alt = repeat('a', 200) $$,
  '200 characters of alt text are allowed'
);

select * from finish();
rollback;
