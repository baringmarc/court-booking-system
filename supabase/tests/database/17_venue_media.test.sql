-- T6.2: venue-media bucket, its storage.objects policies, and the banner columns on venue_settings.
-- The court photo rules moved to court_photos (22_court_photos) when T9.11 dropped courts.photo_path.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';
insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000001', 'Media Court', 'tennis', 500),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000002', 'Other Media Court', 'tennis', 500);
-- Since T12.11 every venue-media path starts with the venue id: vp('banner/x') is '{claudex id}/banner/x'.
create function pg_temp.vp(p text) returns text language sql security definer set search_path = ''
  as $f$ select private.default_venue_id()::text || '/' || p $f$;
grant execute on function pg_temp.vp(text) to anon, authenticated;

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
   where schemaname = 'storage' and tablename = 'objects' and policyname like 'Venue admins % media'),
  'Venue admins delete media DELETE authenticated; Venue admins read media SELECT authenticated; '
  || 'Venue admins update media UPDATE authenticated; Venue admins upload media INSERT authenticated',
  'exactly four venue-media policies, all for authenticated (no anon policy, so listing stays closed)'
);
-- Storage blocks SQL deletes, so the delete rule is checked through its definition.
select ok(
  (select qual like '%venue-media%' and qual like '%is_venue_admin%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'Venue admins delete media'),
  'only admins can delete venue media, and only in this bucket'
);

-- An object as the storage service would create it (service role bypasses RLS)
set local role service_role;
insert into storage.objects (bucket_id, name) values
  ('venue-media', pg_temp.vp('courts/c0000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'));
reset role;

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', pg_temp.vp('banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp')) $$,
  '42501', null, 'anon cannot upload venue media'
);
select is_empty(
  $$ update storage.objects set name = pg_temp.vp('banner/x.webp') where bucket_id = 'venue-media' returning id $$,
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
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', pg_temp.vp('banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp')) $$,
  '42501', null, 'players cannot upload venue media'
);
select is_empty(
  $$ update storage.objects set name = pg_temp.vp('banner/x.webp') where bucket_id = 'venue-media' returning id $$,
  'players cannot rename venue media'
);
select is((select count(*)::int from storage.objects where bucket_id = 'venue-media'), 0,
  'players see no venue-media rows through RLS');
select is_empty(
  $$ update public.venue_settings
     set banner_path = pg_temp.vp('banner/cccccccc-cccc-cccc-cccc-cccccccccccc.webp'), banner_alt = 'Courts'
     returning venue_id $$,
  'players cannot set the banner'
);

-- ---------------------------------------------------------------------------
-- admin: storage
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
       ('venue-media', pg_temp.vp('courts/c0000000-0000-0000-0000-000000000002/dddddddd-dddd-dddd-dddd-dddddddddddd.jpg')) $$,
  'admins can upload a court photo'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', pg_temp.vp('banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp')) $$,
  'admins can upload a banner'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', pg_temp.vp('other/eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee.webp')) $$,
  '42501', null, 'admins cannot upload outside courts/ and banner/'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee.webp') $$,
  '42501', null, 'admins cannot upload at the bucket root'
);
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'venue-media'
     and name in (pg_temp.vp('courts/c0000000-0000-0000-0000-000000000001/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'),
                  pg_temp.vp('courts/c0000000-0000-0000-0000-000000000002/dddddddd-dddd-dddd-dddd-dddddddddddd.jpg'),
                  pg_temp.vp('banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'))),
  3, 'admins see venue-media objects (needed for remove and upsert)'
);
select throws_ok(
  $$ update storage.objects set name = pg_temp.vp('other/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp')
     where bucket_id = 'venue-media' and name = pg_temp.vp('banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp') $$,
  '42501', null, 'admins cannot move an object outside courts/ and banner/'
);
with moved as (
     update storage.objects set name = pg_temp.vp('banner/ffffffff-ffff-ffff-ffff-ffffffffffff.webp')
     where bucket_id = 'venue-media' and name = pg_temp.vp('banner/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp')
     returning id)
select is(count(*)::int, 1, 'admins can update objects inside the allowed folders') from moved;
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-proofs', pg_temp.vp('courts/x.webp')) $$,
  '42501', null, 'the venue-media policies do not let admins write to other buckets'
);

-- ---------------------------------------------------------------------------
-- admin: columns, through the existing admin RLS
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ update public.venue_settings
     set banner_path = pg_temp.vp('banner/ffffffff-ffff-ffff-ffff-ffffffffffff.webp'), banner_alt = 'Night games on the tennis courts' $$,
  'admins can set the banner with alt text'
);
select results_eq(
  $$ select banner_path, banner_alt from public.venue_settings $$,
  $$ values (pg_temp.vp('banner/ffffffff-ffff-ffff-ffff-ffffffffffff.webp'), 'Night games on the tennis courts') $$,
  'the banner is stored'
);
select lives_ok(
  $$ update public.venue_settings set banner_path = null, banner_alt = null $$,
  'admins can remove the banner'
);

-- ---------------------------------------------------------------------------
-- CHECKs (as admin)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.venue_settings set banner_path = pg_temp.vp('courts/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'), banner_alt = 'Courts' $$,
  '23514', null, 'the banner must be under banner/'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = pg_temp.vp('banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp') $$,
  '23514', null, 'a banner needs alt text'
);
select throws_ok(
  $$ update public.venue_settings set banner_alt = 'Courts' $$,
  '23514', null, 'alt text needs a banner'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = pg_temp.vp('banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'), banner_alt = '' $$,
  '23514', null, 'alt text cannot be empty'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = pg_temp.vp('banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'), banner_alt = E'\t\n' $$,
  '23514', null, 'alt text cannot be only tabs or newlines'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = pg_temp.vp('banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'), banner_alt = ' Courts ' $$,
  '23514', null, 'alt text is stored trimmed'
);
select throws_ok(
  $$ update public.venue_settings set banner_path = pg_temp.vp('banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'), banner_alt = repeat('a', 201) $$,
  '23514', null, 'alt text is at most 200 characters'
);
select lives_ok(
  $$ update public.venue_settings set banner_path = pg_temp.vp('banner/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.png'), banner_alt = repeat('a', 200) $$,
  '200 characters of alt text are allowed'
);

select * from finish();
rollback;
