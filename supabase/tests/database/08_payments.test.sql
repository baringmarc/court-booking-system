-- T4.2: payments table, its unique rules, checks and read-only RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'other@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000001', 'Pay Court', 'tennis', 500);
insert into public.bookings (id, reference_code, court_id, user_id, guest_name, during, total_amount, status) values
  ('b0000000-0000-0000-0000-000000000001', 'CB-PAYAA2', 'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pat',
   tstzrange('2030-01-07 10:00+08', '2030-01-07 11:00+08'), 500, 'payment_submitted'),
  ('b0000000-0000-0000-0000-000000000002', 'CB-PAYBB3', 'c0000000-0000-0000-0000-000000000001', null, 'Gina',
   tstzrange('2030-01-07 12:00+08', '2030-01-07 13:00+08'), 500, 'confirmed');

insert into public.payments (booking_id, method, amount, storage_path, review_status) values
  ('b0000000-0000-0000-0000-000000000001', 'gcash', 500, 'b0000000-0000-0000-0000-000000000001/proof.png', 'pending');
insert into public.payments (booking_id, method, amount, review_status, review_note) values
  ('b0000000-0000-0000-0000-000000000002', 'maya', 450, 'rejected', 'Amount does not match'),
  ('b0000000-0000-0000-0000-000000000002', 'maya', 500, 'approved', null);

-- Unique rules and checks
select throws_ok(
  $$ insert into public.payments (booking_id, method, amount, review_status) values ('b0000000-0000-0000-0000-000000000001', 'gcash', 500, 'pending') $$,
  '23505', null, 'only one pending payment per booking'
);
select throws_ok(
  $$ insert into public.payments (booking_id, method, amount, review_status) values ('b0000000-0000-0000-0000-000000000002', 'cash', 500, 'approved') $$,
  '23505', null, 'only one approved payment per booking'
);
select lives_ok(
  $$ insert into public.payments (booking_id, method, amount, review_status, review_note) values ('b0000000-0000-0000-0000-000000000002', 'gcash', 1, 'rejected', 'Blurry') $$,
  'any number of rejected attempts'
);
select throws_ok(
  $$ insert into public.payments (booking_id, method, amount, review_status) values ('b0000000-0000-0000-0000-000000000002', 'gcash', 1, 'rejected') $$,
  '23514', null, 'a rejection needs a note'
);
select throws_ok(
  $$ insert into public.payments (booking_id, method, amount, storage_path) values ('b0000000-0000-0000-0000-000000000002', 'gcash', 1, 'someone-else/x.png') $$,
  '23514', null, 'the proof path must be inside the booking''s folder'
);
select throws_ok(
  $$ insert into public.payments (booking_id, method, amount, review_status, review_note) values ('b0000000-0000-0000-0000-000000000002', 'gcash', -1, 'rejected', 'x') $$,
  '23514', null, 'amount cannot be negative'
);

-- Reads
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select * from public.payments $$, '42501', null, 'anon cannot read payments');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select results_eq(
  $$ select booking_id::text from public.payments $$,
  $$ values ('b0000000-0000-0000-0000-000000000001') $$,
  'the owner reads only their booking''s payments'
);
select throws_ok(
  $$ insert into public.payments (booking_id, method, amount) values ('b0000000-0000-0000-0000-000000000001', 'gcash', 500) $$,
  '42501', null, 'players cannot insert payments'
);
select throws_ok(
  $$ update public.payments set review_status = 'approved' $$,
  '42501', null, 'players cannot approve their own payment'
);
select throws_ok($$ delete from public.payments $$, '42501', null, 'players cannot delete payments');

select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is((select count(*)::int from public.payments), 0, 'another player sees no payments');

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(
  (select count(*)::int from public.payments where booking_id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')),
  4, 'admins read all payments'
);
select throws_ok(
  $$ update public.payments set review_status = 'approved' where booking_id = 'b0000000-0000-0000-0000-000000000001' $$,
  '42501', null, 'even admins change payments only through RPCs'
);

-- Seeded demo data honours the SPEC rule (seed.sql runs on db reset)
reset role;
select cmp_ok(
  (select count(*)::int from public.bookings where status = 'confirmed' and reference_code like 'CB-DEMQ%'), '>', 0,
  'the demo seed is loaded (guards the next test against passing vacuously)'
);
select is(
  (select count(*)::int from public.bookings b
   where b.status = 'confirmed' and b.reference_code like 'CB-DEMQ%'
     and (select count(*) from public.payments p where p.booking_id = b.id and p.review_status = 'approved') <> 1),
  0, 'every seeded confirmed booking has exactly one approved payment'
);
select is(
  (select count(*)::text || ' pending, file ' || coalesce(max(p.storage_path), 'none')
   from public.payments p join public.bookings b on b.id = p.booking_id
   where b.reference_code = 'CB-DEMQB3' and p.review_status = 'pending'),
  '1 pending, file none', 'the seeded payment_submitted booking has one pending payment without a file'
);

select * from finish();
rollback;
