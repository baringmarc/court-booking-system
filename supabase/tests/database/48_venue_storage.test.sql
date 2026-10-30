-- T12.7: Storage per venue. Objects live under {venue_id}/... and the first folder decides who may touch them
-- (private.is_venue_admin on that folder). Covers venue-media ({venue}/courts/.. and {venue}/banner/..), payment-qr
-- ({venue}/{uuid}.png) and payment-proofs ({booking_id}/.. read by the booking owner or that booking's venue admins).
-- The legacy is_admin() policies and path shapes stay until T12.11, so legacy-shaped paths are only checked to be
-- invisible/unwritable to venue staff who are not legacy admins. A malformed first folder is denied, never a cast error.
begin;
create extension if not exists pgtap with schema extensions;
select plan(52);

-- ---------------------------------------------------------------- fixture
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'other-player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'staff-a@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'staff-b@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'platform@test.local');

insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'e2e-vst-a', 'active'),
  ('b0000000-0000-0000-0000-00000000000b', 'e2e-vst-b', 'active');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', '77777777-7777-7777-7777-777777777777', 'staff');
insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');

insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'E2E VST A1', 'tennis', 500),
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E VST B1', 'tennis', 600);
insert into public.bookings (id, reference_code, court_id, user_id, guest_name, during, total_amount, status) values
  ('bbbbbbbb-0000-0000-0000-0000000000a1', 'CB-VSTAA2', 'c0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Pat',
   tstzrange('2030-01-07 10:00+08', '2030-01-07 11:00+08'), 500, 'payment_submitted'),
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'CB-VSTBB3', 'c0000000-0000-0000-0000-0000000000b1', '33333333-3333-3333-3333-333333333333', 'Gina',
   tstzrange('2030-01-07 10:00+08', '2030-01-07 11:00+08'), 600, 'payment_submitted');

-- Objects as the storage service would create them (the service role bypasses RLS)
set local role service_role;
insert into storage.objects (bucket_id, name) values
  ('venue-media', 'a0000000-0000-0000-0000-00000000000a/courts/c0000000-0000-0000-0000-0000000000a1/11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'),
  ('venue-media', 'a0000000-0000-0000-0000-00000000000a/banner/11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'),
  ('venue-media', 'b0000000-0000-0000-0000-00000000000b/courts/c0000000-0000-0000-0000-0000000000b1/22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'),
  ('venue-media', 'b0000000-0000-0000-0000-00000000000b/banner/22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'),
  ('venue-media', 'banner/legacy-shape.webp'),
  ('venue-media', 'not-a-uuid/banner/junk.webp'),
  ('payment-qr', 'a0000000-0000-0000-0000-00000000000a/aaaaaaaa-1111-4111-8111-111111111111.png'),
  ('payment-qr', 'b0000000-0000-0000-0000-00000000000b/bbbbbbbb-1111-4111-8111-111111111111.png'),
  ('payment-qr', 'cccccccc-1111-4111-8111-111111111111.png'),
  ('payment-proofs', 'bbbbbbbb-0000-0000-0000-0000000000a1/proof.png'),
  ('payment-proofs', 'bbbbbbbb-0000-0000-0000-0000000000b1/proof.png'),
  ('payment-proofs', 'not-a-uuid/proof.png');
reset role;

-- ---------------------------------------------------------------- policies exist, by name
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in (
    'Venue admins read media', 'Venue admins upload media', 'Venue admins update media', 'Venue admins delete media',
    'Venue admins read payment QR', 'Venue admins upload payment QR', 'Venue admins delete payment QR',
    'Admins and booking owners read payment proofs')),
  8, 'the seven new venue policies and the replaced proofs policy exist');
select is(
  (select string_agg(policyname || ' ' || cmd || ' ' || array_to_string(roles, ','), '; ' order by policyname)
   from pg_policies where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('Venue admins read media', 'Venue admins upload media', 'Venue admins update media', 'Venue admins delete media',
                        'Venue admins read payment QR', 'Venue admins upload payment QR', 'Venue admins delete payment QR')),
  'Venue admins delete media DELETE authenticated; Venue admins delete payment QR DELETE authenticated; '
  || 'Venue admins read media SELECT authenticated; Venue admins read payment QR SELECT authenticated; '
  || 'Venue admins update media UPDATE authenticated; Venue admins upload media INSERT authenticated; '
  || 'Venue admins upload payment QR INSERT authenticated',
  'each new policy has the right command and is for authenticated only');
-- Storage blocks SQL deletes, so the delete rules are checked through their definitions.
select ok(
  (select qual like '%venue-media%' and qual like '%is_venue_admin%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'Venue admins delete media'),
  'venue-media deletes are decided by is_venue_admin, and only in this bucket');
select ok(
  (select qual like '%payment-qr%' and qual like '%is_venue_admin%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'Venue admins delete payment QR'),
  'payment-qr deletes are decided by is_venue_admin, and only in this bucket');
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and (coalesce(qual, '') || coalesce(with_check, '')) like '%payment-proofs%' $$,
  'payment-proofs still has no insert, update or delete policy for clients');

-- ---------------------------------------------------------------- anon
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'venue-media'), 0, 'anon lists no venue-media objects (public URLs need no policy)');
select is((select count(*)::int from storage.objects where bucket_id = 'payment-qr'), 0, 'anon lists no payment-qr objects');
select is((select count(*)::int from storage.objects where bucket_id = 'payment-proofs'), 0, 'anon reads no proofs');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-00000000000a/banner/anon.webp') $$,
  '42501', null, 'anon cannot upload venue media');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'a0000000-0000-0000-0000-00000000000a/aaaaaaaa-2222-4222-8222-222222222222.png') $$,
  '42501', null, 'anon cannot upload a payment QR');
reset role;

-- ---------------------------------------------------------------- a player (not staff anywhere)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'venue-media'), 0, 'a player lists no venue-media objects');
select is((select count(*)::int from storage.objects where bucket_id = 'payment-qr'), 0, 'a player lists no payment-qr objects');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-00000000000a/banner/player.webp') $$,
  '42501', null, 'a player cannot upload venue media into any venue');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'a0000000-0000-0000-0000-00000000000a/aaaaaaaa-3333-4333-8333-333333333333.png') $$,
  '42501', null, 'a player cannot upload a payment QR');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'payment-proofs' $$,
  $$ values ('bbbbbbbb-0000-0000-0000-0000000000a1/proof.png') $$,
  'a player reads only the proof of their own booking (the malformed path raises no error)');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-proofs', 'bbbbbbbb-0000-0000-0000-0000000000a1/evil.png') $$,
  '42501', null, 'a player cannot upload a proof directly');
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select results_eq(
  $$ select name from storage.objects where bucket_id = 'payment-proofs' $$,
  $$ values ('bbbbbbbb-0000-0000-0000-0000000000b1/proof.png') $$,
  'the other player reads only their own booking proof, not venue A''s');
reset role;

-- ---------------------------------------------------------------- admin of venue A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);

-- venue-media
select results_eq(
  $$ select name from storage.objects where bucket_id = 'venue-media' order by name $$,
  $$ values ('a0000000-0000-0000-0000-00000000000a/banner/11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'),
             ('a0000000-0000-0000-0000-00000000000a/courts/c0000000-0000-0000-0000-0000000000a1/11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp') $$,
  'venue A staff lists only venue A media (not B, not legacy-shaped, not malformed paths)');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
       ('venue-media', 'a0000000-0000-0000-0000-00000000000a/courts/c0000000-0000-0000-0000-0000000000a1/33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp') $$,
  'venue A staff can upload a court photo under their venue');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-00000000000a/banner/33333333-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp') $$,
  'venue A staff can upload the banner under their venue');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-00000000000a/other/x.webp') $$,
  '42501', null, 'venue A staff cannot upload into an unknown second folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-00000000000a/x.webp') $$,
  '42501', null, 'venue A staff cannot upload at the venue root of venue-media');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'b0000000-0000-0000-0000-00000000000b/banner/evil.webp') $$,
  '42501', null, 'venue A staff cannot upload into venue B');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'b0000000-0000-0000-0000-00000000000b/courts/c0000000-0000-0000-0000-0000000000b1/evil.webp') $$,
  '42501', null, 'venue A staff cannot upload a court photo into venue B');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'not-a-uuid/banner/x.webp') $$,
  '42501', null, 'a malformed first folder is denied with a policy error, not a cast error');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'banner/legacy-new.webp') $$,
  '42501', null, 'venue A staff (not a legacy admin) cannot write a legacy-shaped path');
select results_eq(
  $$ update storage.objects set name = 'a0000000-0000-0000-0000-00000000000a/banner/renamed.webp'
     where bucket_id = 'venue-media' and name = 'a0000000-0000-0000-0000-00000000000a/banner/11111111-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'
     returning name $$,
  $$ values ('a0000000-0000-0000-0000-00000000000a/banner/renamed.webp') $$,
  'venue A staff can update (rename) their own venue media');
select throws_ok(
  $$ update storage.objects set name = 'b0000000-0000-0000-0000-00000000000b/banner/stolen.webp'
     where bucket_id = 'venue-media' and name = 'a0000000-0000-0000-0000-00000000000a/banner/renamed.webp' $$,
  '42501', null, 'venue A staff cannot move their object into venue B');
select is_empty(
  $$ update storage.objects set name = name || 'x'
     where bucket_id = 'venue-media' and name like 'b0000000-0000-0000-0000-00000000000b/%' returning id $$,
  'venue A staff cannot update venue B media');

-- payment-qr
select results_eq(
  $$ select name from storage.objects where bucket_id = 'payment-qr' $$,
  $$ values ('a0000000-0000-0000-0000-00000000000a/aaaaaaaa-1111-4111-8111-111111111111.png') $$,
  'venue A staff lists only venue A QR codes');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'a0000000-0000-0000-0000-00000000000a/dddddddd-1111-4111-8111-111111111111.png') $$,
  'venue A staff can upload {venue}/{uuid}.png');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'a0000000-0000-0000-0000-00000000000a/dddddddd-2222-4222-8222-222222222222.webp') $$,
  '42501', null, 'a QR must be a .png');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'a0000000-0000-0000-0000-00000000000a/qr/dddddddd-3333-4333-8333-333333333333.png') $$,
  '42501', null, 'a QR must sit directly under the venue folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'a0000000-0000-0000-0000-00000000000a/not-a-uuid.png') $$,
  '42501', null, 'a QR file name must be a uuid');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'b0000000-0000-0000-0000-00000000000b/dddddddd-4444-4444-8444-444444444444.png') $$,
  '42501', null, 'venue A staff cannot upload a QR into venue B');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'dddddddd-5555-4555-8555-555555555555.png') $$,
  '42501', null, 'venue A staff (not a legacy admin) cannot write a legacy-shaped QR path');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'not-a-uuid/dddddddd-6666-4666-8666-666666666666.png') $$,
  '42501', null, 'a malformed first folder on payment-qr is denied, not a cast error');

-- payment-proofs
select results_eq(
  $$ select name from storage.objects where bucket_id = 'payment-proofs' $$,
  $$ values ('bbbbbbbb-0000-0000-0000-0000000000a1/proof.png') $$,
  'venue A staff reads proofs of venue A bookings only');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-proofs', 'bbbbbbbb-0000-0000-0000-0000000000a1/staff.png') $$,
  '42501', null, 'staff cannot upload proofs directly');
select is_empty(
  $$ update storage.objects set name = name || 'x' where bucket_id = 'payment-proofs' returning id $$,
  'staff cannot rename proofs');
reset role;

-- ---------------------------------------------------------------- admin of venue B
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select results_eq(
  $$ select name from storage.objects where bucket_id = 'venue-media' order by name $$,
  $$ values ('b0000000-0000-0000-0000-00000000000b/banner/22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp'),
             ('b0000000-0000-0000-0000-00000000000b/courts/c0000000-0000-0000-0000-0000000000b1/22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp') $$,
  'venue B staff lists only venue B media');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'a0000000-0000-0000-0000-00000000000a/banner/evil-b.webp') $$,
  '42501', null, 'venue B staff cannot upload into venue A');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'b0000000-0000-0000-0000-00000000000b/banner/44444444-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp') $$,
  'venue B staff can upload into venue B');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'payment-qr' $$,
  $$ values ('b0000000-0000-0000-0000-00000000000b/bbbbbbbb-1111-4111-8111-111111111111.png') $$,
  'venue B staff lists only venue B QR codes');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'a0000000-0000-0000-0000-00000000000a/eeeeeeee-1111-4111-8111-111111111111.png') $$,
  '42501', null, 'venue B staff cannot upload a QR into venue A');
select results_eq(
  $$ select name from storage.objects where bucket_id = 'payment-proofs' $$,
  $$ values ('bbbbbbbb-0000-0000-0000-0000000000b1/proof.png') $$,
  'venue B staff reads proofs of venue B bookings only, never venue A''s');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'payment-proofs' and name like 'bbbbbbbb-0000-0000-0000-0000000000a1/%'),
  0, 'venue A''s proof is invisible to venue B staff');
reset role;

-- ---------------------------------------------------------------- platform admin
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(
  (select count(*)::int from storage.objects where bucket_id = 'venue-media' and name ~ '^[ab]0000000-'),
  7, 'a platform admin reads media of both venues (4 seeded + 3 uploaded above)');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'payment-proofs' and name like 'bbbbbbbb-%'),
  2, 'a platform admin reads proofs of both venues');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'b0000000-0000-0000-0000-00000000000b/banner/55555555-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp') $$,
  'a platform admin can upload into any venue');
reset role;

-- ---------------------------------------------------------------- a staff member of a venue that does not exist is a stranger
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', '99999999-9999-9999-9999-999999999999/banner/x.webp') $$,
  '42501', null, 'an unknown venue id is denied');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('venue-media', 'A0000000-0000-0000-0000-00000000000A/banner/upper.webp') $$,
  '42501', null, 'a venue folder is matched exactly (no case tricks into another venue''s path shape)');
reset role;

select * from finish();
rollback;
