-- T4.3: payment-proofs bucket config and storage.objects access.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'other@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000001', 'Proof Court', 'tennis', 500);
insert into public.bookings (id, reference_code, court_id, user_id, guest_name, during, total_amount, status) values
  ('b0000000-0000-0000-0000-000000000001', 'CB-PRFAA2', 'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pat',
   tstzrange('2030-01-07 10:00+08', '2030-01-07 11:00+08'), 500, 'payment_submitted'),
  ('b0000000-0000-0000-0000-000000000002', 'CB-PRFBB3', 'c0000000-0000-0000-0000-000000000001', null, 'Gina',
   tstzrange('2030-01-07 12:00+08', '2030-01-07 13:00+08'), 500, 'payment_submitted');

-- The Storage API enforces storage.objects policies, so clients can write only where a write policy exists.
-- The only client write policies allowed are the three admin-only venue-media ones (M6, tested in
-- 17_venue_media) and the two payment-qr ones (T11.10, tested in 34_payment_accounts), listed by exact name so that any other write policy, including a bucket-agnostic one
-- (e.g. "with check (true)") that would open payment-proofs too, fails this check.
-- (Direct SQL deletes are blocked by Storage itself, so delete is checked through the policy list.)
select is_empty(
  $$ select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
       and policyname not in ('Admins upload venue media', 'Admins update venue media', 'Admins delete venue media',
                              'Admins upload payment QR codes', 'Admins delete payment QR codes') $$,
  'no insert, update, delete or all policy lets clients write to storage, except the venue-media and payment-qr admin policies'
);
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'payment-proofs' $$,
  $$ values (false, 5242880::bigint, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) $$,
  'payment-proofs is private, 5 MB, images and PDF only'
);

-- Objects as the storage service would create them (service role bypasses RLS)
set local role service_role;
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values
       ('payment-proofs', 'b0000000-0000-0000-0000-000000000001/a.png'),
       ('payment-proofs', 'b0000000-0000-0000-0000-000000000002/b.pdf'),
       ('payment-proofs', 'not-a-uuid/c.png') $$,
  'the service role (Edge Function) can write proofs'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select results_eq(
  $$ select name from storage.objects where bucket_id = 'payment-proofs' $$,
  $$ values ('b0000000-0000-0000-0000-000000000001/a.png') $$,
  'the booking owner reads only their own proof (and a malformed path raises no error)'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-proofs', 'b0000000-0000-0000-0000-000000000001/evil.png') $$,
  '42501', null, 'owners cannot upload directly'
);
select is_empty(
  $$ update storage.objects set name = 'x' where bucket_id = 'payment-proofs' returning id $$,
  'owners cannot rename proofs'
);

select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'payment-proofs'), 0, 'other players see no proofs');

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(
  (select count(*)::int from storage.objects
   where bucket_id = 'payment-proofs'
     and name in ('b0000000-0000-0000-0000-000000000001/a.png', 'b0000000-0000-0000-0000-000000000002/b.pdf', 'not-a-uuid/c.png')),
  3, 'admins see every proof (counted on this test''s fixtures, so other local data cannot affect it)'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-proofs', 'b0000000-0000-0000-0000-000000000001/admin.png') $$,
  '42501', null, 'admins cannot upload proofs directly either (the venue-media policies do not open this bucket)'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'payment-proofs'), 0, 'anon sees no proofs');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-proofs', 'b0000000-0000-0000-0000-000000000002/evil.png') $$,
  '42501', null, 'guests (anon) cannot upload directly'
);

select * from finish();
rollback;
