-- T3.2: bookings table, overlap rule, checks, and read-only RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'other@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';

insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000001', 'Test Court A', 'badminton', 300),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000002', 'Test Court B', 'badminton', 300);

select is(
  (select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'btree_gist'),
  'extensions', 'btree_gist is installed in the extensions schema'
);

-- Baseline: a confirmed player booking 10:00–12:00 on court A
insert into public.bookings (reference_code, court_id, user_id, guest_name, during, total_amount, status)
values ('CB-AAAAAA', 'c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pat Player',
        tstzrange('2030-01-07 10:00+08', '2030-01-07 12:00+08'), 600, 'confirmed');

-- Overlap rule
select throws_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status, expires_at)
     values ('CB-BBBBBB', 'c0000000-0000-0000-0000-000000000001', 'Guest',
             tstzrange('2030-01-07 11:00+08', '2030-01-07 13:00+08'), 600, 'pending_payment', now() + interval '1 hour') $$,
  '23P01', null, 'overlapping active booking on the same court is rejected'
);
select lives_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status, expires_at)
     values ('CB-CCCCCC', 'c0000000-0000-0000-0000-000000000001', 'Guest',
             tstzrange('2030-01-07 12:00+08', '2030-01-07 13:00+08'), 300, 'pending_payment', now() + interval '1 hour') $$,
  'adjacent booking (end = start) is allowed'
);
select lives_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status)
     values ('CB-DDDDDD', 'c0000000-0000-0000-0000-000000000002', 'Guest',
             tstzrange('2030-01-07 10:00+08', '2030-01-07 12:00+08'), 600, 'confirmed') $$,
  'same time on another court is allowed'
);
select lives_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status)
     values ('CB-EEEEEE', 'c0000000-0000-0000-0000-000000000001', 'Guest', tstzrange('2030-01-07 10:00+08', '2030-01-07 11:00+08'), 300, 'cancelled'),
            ('CB-FFFFFF', 'c0000000-0000-0000-0000-000000000001', 'Guest', tstzrange('2030-01-07 10:00+08', '2030-01-07 11:00+08'), 300, 'expired'),
            ('CB-GGGGGG', 'c0000000-0000-0000-0000-000000000001', 'Guest', tstzrange('2030-01-07 10:00+08', '2030-01-07 11:00+08'), 300, 'rejected') $$,
  'cancelled, expired and rejected bookings do not hold the slot'
);
select throws_ok(
  $$ update public.bookings set status = 'confirmed' where reference_code = 'CB-EEEEEE' $$,
  '23P01', null, 're-activating a booking into an occupied range is rejected'
);

-- Checks
select throws_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status)
     values ('CB-HHHHHH', 'c0000000-0000-0000-0000-000000000002', 'Guest', tstzrange('2030-01-08 10:00+08', '2030-01-08 11:00+08', '(]'), 300, 'confirmed') $$,
  '23514', null, 'ranges must be [) shaped'
);
select throws_ok(
  $$ insert into public.bookings (reference_code, court_id, during, total_amount, status)
     values ('CB-JJJJJJ', 'c0000000-0000-0000-0000-000000000002', tstzrange('2030-01-08 10:00+08', '2030-01-08 11:00+08'), 300, 'confirmed') $$,
  '23502', null, 'every booking needs a contact name'
);
select throws_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status)
     values ('CB-JJJJJK', 'c0000000-0000-0000-0000-000000000002', '   ', tstzrange('2030-01-08 10:00+08', '2030-01-08 11:00+08'), 300, 'confirmed') $$,
  '23514', null, 'the contact name cannot be blank'
);
select has_trigger('public', 'bookings', 'bookings_set_updated_at', 'bookings keeps updated_at current');
select throws_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount)
     values ('CB-KKKKKK', 'c0000000-0000-0000-0000-000000000002', 'Guest', tstzrange('2030-01-08 10:00+08', '2030-01-08 11:00+08'), 300) $$,
  '23514', null, 'a pending_payment hold must have expires_at'
);
select throws_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status)
     values ('CB-O0I1AA', 'c0000000-0000-0000-0000-000000000002', 'Guest', tstzrange('2030-01-08 10:00+08', '2030-01-08 11:00+08'), 300, 'confirmed') $$,
  '23514', null, 'reference codes use the unambiguous alphabet'
);
select throws_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status)
     values ('CB-AAAAAA', 'c0000000-0000-0000-0000-000000000002', 'Guest', tstzrange('2030-01-09 10:00+08', '2030-01-09 11:00+08'), 300, 'confirmed') $$,
  '23505', null, 'reference codes are unique'
);

-- As anon
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select * from public.bookings $$, '42501', null, 'anon cannot read bookings');
select throws_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status)
     values ('CB-LLLLLL', 'c0000000-0000-0000-0000-000000000002', 'Anon', tstzrange('2030-01-10 10:00+08', '2030-01-10 11:00+08'), 0, 'confirmed') $$,
  '42501', null, 'anon cannot insert bookings directly'
);

-- As the player
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select results_eq(
  $$ select reference_code from public.bookings $$,
  $$ values ('CB-AAAAAA'::text) $$,
  'player sees only their own bookings'
);
select throws_ok(
  $$ insert into public.bookings (reference_code, court_id, user_id, guest_name, during, total_amount, status)
     values ('CB-MMMMMM', 'c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Pat', tstzrange('2030-01-10 10:00+08', '2030-01-10 11:00+08'), 0, 'confirmed') $$,
  '42501', null, 'players cannot insert bookings directly'
);
select throws_ok(
  $$ update public.bookings set total_amount = 0 where reference_code = 'CB-AAAAAA' $$,
  '42501', null, 'players cannot update bookings directly'
);
select throws_ok(
  $$ delete from public.bookings where reference_code = 'CB-AAAAAA' $$,
  '42501', null, 'players cannot delete bookings'
);

select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is((select count(*)::int from public.bookings), 0, 'another player sees none of these bookings');

-- As the admin
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(
  (select count(*)::int from public.bookings where court_id in ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002')),
  6, 'admin reads all bookings'
);

-- Deleting a player keeps their booking (user_id -> null) instead of failing
reset role;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select is(
  (select guest_name || ' / ' || coalesce(user_id::text, 'no user') from public.bookings where reference_code = 'CB-AAAAAA'),
  'Pat Player / no user', 'deleting a player keeps the booking with its contact snapshot'
);

select * from finish();
rollback;
