-- T29.3: venue logo. venue_settings.logo_path (nullable, venue-prefixed shape {venue}/logo/{uuid}.{webp|jpg|jpeg|png}),
-- and the venue-media upload/update policies accept the second folder 'logo' (besides courts and banner).
-- Delete and select policies already cover any folder of the venue; Storage blocks SQL deletes, so the delete rule
-- is checked through its definition. public_venues is unchanged (logo_url still comes from banner or first court photo).
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- ---------------------------------------------------------------- fixture
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'staff-a@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'staff-b@test.local');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000000a9', 'e2e-logo-a', 'active'),
  ('b0000000-0000-0000-0000-0000000000b9', 'e2e-logo-b', 'active');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-0000000000a9', 'E2E Logo A', 'Asia/Manila'),
  ('b0000000-0000-0000-0000-0000000000b9', 'E2E Logo B', 'Asia/Manila');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000000a9', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('b0000000-0000-0000-0000-0000000000b9', '77777777-7777-7777-7777-777777777777', 'staff');
update public.venues set showcase_approved = true where slug in ('e2e-logo-a', 'e2e-logo-b');
-- B has a banner and a logo already; A has neither
update public.venue_settings
   set banner_path = 'b0000000-0000-0000-0000-0000000000b9/banner/22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp',
       banner_alt = 'B banner',
       logo_path = 'b0000000-0000-0000-0000-0000000000b9/logo/22222222-cccc-cccc-cccc-cccccccccccc.webp'
 where venue_id = 'b0000000-0000-0000-0000-0000000000b9';

set local role service_role;
insert into storage.objects (bucket_id, name) values
  ('venue-media', 'a0000000-0000-0000-0000-0000000000a9/logo/11111111-cccc-cccc-cccc-cccccccccccc.webp'),
  ('venue-media', 'b0000000-0000-0000-0000-0000000000b9/logo/22222222-cccc-cccc-cccc-cccccccccccc.webp');
reset role;

-- ---------------------------------------------------------------- definitions
select is(
  (select format_type(a.atttypid, a.atttypmod) || ',' || case when a.attnotnull then 'NO' else 'YES' end
     from pg_attribute a
    where a.attrelid = 'public.venue_settings'::regclass and a.attname = 'logo_path' and not a.attisdropped),
  'text,YES',
  'venue_settings.logo_path exists, text, nullable');
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.venue_settings'::regclass and conname = 'venue_settings_logo_path_check' and contype = 'c'),
  1, 'the logo_path check is named venue_settings_logo_path_check');
select is(
  (select string_agg(column_name::text, ',' order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'public_venues'),
  'slug,name,city,logo_url', 'public_venues still has exactly slug, name, city, logo_url');
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'venue-media' $$,
  $$ values (true, 2097152::bigint, array['image/jpeg', 'image/png', 'image/webp']) $$,
  'venue-media stays public, 2 MB, JPG/PNG/WEBP only (logo objects are publicly readable by URL)');
select ok(
  (select with_check like '%logo%' and with_check like '%courts%' and with_check like '%banner%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'Venue admins upload media'),
  'the upload policy allows the folders courts, banner and logo');
select ok(
  (select with_check like '%logo%' and with_check like '%courts%' and with_check like '%banner%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'Venue admins update media'),
  'the update policy allows the folders courts, banner and logo');
select ok(
  (select qual like '%venue-media%' and qual like '%is_venue_admin%' and qual not like '%foldername%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'Venue admins delete media'),
  'the delete policy is decided by is_venue_admin with no folder restriction, so it covers logo/');

-- ---------------------------------------------------------------- the check (as the table owner, RLS aside)
select lives_ok(
  $$ update public.venue_settings set logo_path = 'a0000000-0000-0000-0000-0000000000a9/logo/11111111-cccc-cccc-cccc-cccccccccccc.webp'
     where venue_id = 'a0000000-0000-0000-0000-0000000000a9' $$,
  'a well-formed .webp logo path is accepted');
select lives_ok(
  $$ update public.venue_settings set logo_path = 'a0000000-0000-0000-0000-0000000000a9/logo/11111111-cccc-cccc-cccc-cccccccccccc.png'
     where venue_id = 'a0000000-0000-0000-0000-0000000000a9' $$,
  'a .png logo path is accepted');
select lives_ok(
  $$ update public.venue_settings set logo_path = null where venue_id = 'a0000000-0000-0000-0000-0000000000a9' $$,
  'logo_path may be null (no logo)');
select throws_ok(
  $$ update public.venue_settings set logo_path = 'b0000000-0000-0000-0000-0000000000b9/logo/11111111-cccc-cccc-cccc-cccccccccccc.webp'
     where venue_id = 'a0000000-0000-0000-0000-0000000000a9' $$,
  '23514', null, 'a logo path with another venue''s prefix violates the check');
select throws_ok(
  $$ update public.venue_settings set logo_path = 'a0000000-0000-0000-0000-0000000000a9/banner/11111111-cccc-cccc-cccc-cccccccccccc.webp'
     where venue_id = 'a0000000-0000-0000-0000-0000000000a9' $$,
  '23514', null, 'a logo path must be under logo/, not banner/');
select throws_ok(
  $$ update public.venue_settings set logo_path = 'a0000000-0000-0000-0000-0000000000a9/logo/11111111-cccc-cccc-cccc-cccccccccccc.gif'
     where venue_id = 'a0000000-0000-0000-0000-0000000000a9' $$,
  '23514', null, 'a logo path with a .gif extension violates the check');
select throws_ok(
  $$ update public.venue_settings set logo_path = 'logo/11111111-cccc-cccc-cccc-cccccccccccc.webp'
     where venue_id = 'a0000000-0000-0000-0000-0000000000a9' $$,
  '23514', null, 'a logo path without the venue prefix violates the check');
select throws_ok(
  $$ update public.venue_settings set logo_path = 'a0000000-0000-0000-0000-0000000000a9/logo/x.webp'
     where venue_id = 'a0000000-0000-0000-0000-0000000000a9' $$,
  '23514', null, 'a logo file name that is not uuid-shaped violates the check');

-- ---------------------------------------------------------------- anon
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'venue-media'), 0,
  'anon lists no venue-media rows through RLS (the public bucket serves logo URLs without a policy)');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-0000000000a9/logo/aaaaaaaa-cccc-cccc-cccc-cccccccccccc.webp') $$,
  '42501', null, 'anon cannot upload a logo');
select is_empty(
  $$ update storage.objects set name = name || 'x' where bucket_id = 'venue-media' and name like '%/logo/%' returning id $$,
  'anon cannot overwrite a logo object');
select lives_ok(
  $$ do $d$ begin
       update public.venue_settings set logo_path = 'a0000000-0000-0000-0000-0000000000a9/logo/aaaaaaaa-cccc-cccc-cccc-cccccccccccc.webp'
        where venue_id = 'a0000000-0000-0000-0000-0000000000a9';
       if found then raise exception 'anon updated logo_path'; end if;
     exception when insufficient_privilege then null;
     end $d$ $$,
  'anon cannot set logo_path (no privilege or no row visible to update)');
select is(
  (select logo_url from public.public_venues where slug = 'e2e-logo-a'), null,
  'public_venues.logo_url is not derived from logo_path (A has no banner or court photo)');
select is(
  (select logo_url from public.public_venues where slug = 'e2e-logo-b'),
  'b0000000-0000-0000-0000-0000000000b9/banner/22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp',
  'public_venues.logo_url is still the banner for B, not its logo_path');
reset role;

-- ---------------------------------------------------------------- a player (not staff anywhere)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-0000000000a9/logo/bbbbbbbb-cccc-cccc-cccc-cccccccccccc.webp') $$,
  '42501', null, 'a player cannot upload a logo');
select is_empty(
  $$ update storage.objects set name = name || 'x' where bucket_id = 'venue-media' and name like '%/logo/%' returning id $$,
  'a player cannot overwrite a logo object');
select is_empty(
  $$ update public.venue_settings
     set logo_path = 'a0000000-0000-0000-0000-0000000000a9/logo/bbbbbbbb-cccc-cccc-cccc-cccccccccccc.webp'
     returning venue_id $$,
  'a player cannot set logo_path');
reset role;

-- ---------------------------------------------------------------- admin of venue A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-0000000000a9/logo/33333333-cccc-cccc-cccc-cccccccccccc.webp') $$,
  'venue A staff can upload {venue}/logo/{uuid}.webp');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-0000000000a9/logo/33333333-dddd-dddd-dddd-dddddddddddd.png') $$,
  'venue A staff can upload {venue}/logo/{uuid}.png');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-0000000000a9/other/x.webp') $$,
  '42501', null, 'venue A staff still cannot upload into an unknown second folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'b0000000-0000-0000-0000-0000000000b9/logo/evil.webp') $$,
  '42501', null, 'venue A staff cannot upload a logo into venue B');
select results_eq(
  $$ update storage.objects set name = 'a0000000-0000-0000-0000-0000000000a9/logo/44444444-cccc-cccc-cccc-cccccccccccc.webp'
     where bucket_id = 'venue-media' and name = 'a0000000-0000-0000-0000-0000000000a9/logo/33333333-cccc-cccc-cccc-cccccccccccc.webp'
     returning name $$,
  $$ values ('a0000000-0000-0000-0000-0000000000a9/logo/44444444-cccc-cccc-cccc-cccccccccccc.webp') $$,
  'venue A staff can update (overwrite) an object under their logo/ folder');
select throws_ok(
  $$ update storage.objects set name = 'b0000000-0000-0000-0000-0000000000b9/logo/stolen.webp'
     where bucket_id = 'venue-media' and name = 'a0000000-0000-0000-0000-0000000000a9/logo/44444444-cccc-cccc-cccc-cccccccccccc.webp' $$,
  '42501', null, 'venue A staff cannot move a logo object into venue B');
select is_empty(
  $$ update storage.objects set name = name || 'x'
     where bucket_id = 'venue-media' and name like 'b0000000-0000-0000-0000-0000000000b9/logo/%' returning id $$,
  'venue A staff cannot overwrite venue B''s logo object');
select results_eq(
  $$ update public.venue_settings
     set logo_path = 'a0000000-0000-0000-0000-0000000000a9/logo/44444444-cccc-cccc-cccc-cccccccccccc.webp'
     where venue_id = 'a0000000-0000-0000-0000-0000000000a9' returning logo_path $$,
  $$ values ('a0000000-0000-0000-0000-0000000000a9/logo/44444444-cccc-cccc-cccc-cccccccccccc.webp') $$,
  'venue A staff can set logo_path on their own venue');
select is_empty(
  $$ update public.venue_settings
     set logo_path = 'b0000000-0000-0000-0000-0000000000b9/logo/44444444-cccc-cccc-cccc-cccccccccccc.webp'
     where venue_id = 'b0000000-0000-0000-0000-0000000000b9' returning venue_id $$,
  'venue A staff cannot set logo_path on venue B (0 rows updated)');
reset role;

-- ---------------------------------------------------------------- admin of venue B
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-0000000000a9/logo/evil-b.webp') $$,
  '42501', null, 'venue B staff cannot upload a logo into venue A');
select is_empty(
  $$ update storage.objects set name = name || 'x'
     where bucket_id = 'venue-media' and name like 'a0000000-0000-0000-0000-0000000000a9/logo/%' returning id $$,
  'venue B staff cannot overwrite venue A''s logo object');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'b0000000-0000-0000-0000-0000000000b9/logo/55555555-cccc-cccc-cccc-cccccccccccc.jpg') $$,
  'venue B staff can upload a .jpg logo into venue B');
reset role;

-- ---------------------------------------------------------------- what persisted (read as the table owner)
select is(
  (select logo_path from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-0000000000a9'),
  'a0000000-0000-0000-0000-0000000000a9/logo/44444444-cccc-cccc-cccc-cccccccccccc.webp',
  'venue A''s logo_path is what its admin set');
select is(
  (select logo_path from public.venue_settings where venue_id = 'b0000000-0000-0000-0000-0000000000b9'),
  'b0000000-0000-0000-0000-0000000000b9/logo/22222222-cccc-cccc-cccc-cccccccccccc.webp',
  'venue B''s logo_path was not changed by venue A''s admin or by anon or the player');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'venue-media' and name like 'b0000000-0000-0000-0000-0000000000b9/logo/%'),
  2, 'venue B has its seeded logo object plus the one its own admin uploaded, nothing from venue A');

select * from finish();
rollback;
