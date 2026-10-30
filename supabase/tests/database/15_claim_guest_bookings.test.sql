-- T5.4: claim_guest_bookings (SPEC §5.7).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'Gina.Guest@Test.Local', now()),   -- confirmed, mixed case
  ('22222222-2222-2222-2222-222222222222', 'unverified@test.local', null),   -- never confirmed
  ('33333333-3333-3333-3333-333333333333', 'olga@test.local', now());
insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000001', 'Claim Court', 'tennis', 500);

create function pg_temp.mk(p_ref text, p_hour int, p_email text, p_user uuid default null,
                           p_token boolean default true, p_source public.booking_source default 'online')
returns void language sql as $$
  insert into public.bookings (reference_code, court_id, user_id, guest_name, guest_email, during, total_amount,
                               status, source, guest_token_hash)
  values (p_ref, 'c0000000-0000-0000-0000-000000000001', p_user, 'Test', p_email,
          tstzrange(now() + make_interval(days => 2, hours => p_hour), now() + make_interval(days => 2, hours => p_hour + 1)),
          500, 'confirmed', p_source, case when p_token then sha256(convert_to(p_ref, 'UTF8')) end);
$$;

select pg_temp.mk('CB-GUEST2', 0, 'gina.guest@test.local');                                                -- claimable
select pg_temp.mk('CB-GUEST3', 1, 'gina.guest@test.local');                                                -- claimable
select pg_temp.mk('CB-TAKEN2', 2, 'gina.guest@test.local', '33333333-3333-3333-3333-333333333333');        -- already Olga's
select pg_temp.mk('CB-DELETD', 3, 'gina.guest@test.local', null, false);                                   -- deleted player's old booking
select pg_temp.mk('CB-WALKXN', 4, 'gina.guest@test.local', null, true, 'walk_in');                         -- walk-in
select pg_temp.mk('CB-ZTHERS', 5, 'someone@test.local');                                                   -- another email
select pg_temp.mk('CB-UNVERF', 6, 'unverified@test.local');                                                -- for the unconfirmed user

-- Access
select ok(not has_function_privilege('anon', 'public.claim_guest_bookings()', 'execute'), 'anon cannot call claim_guest_bookings');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.claim_guest_bookings() $$, '42501', null, 'anon is refused (42501)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
select throws_ok($$ select public.claim_guest_bookings() $$, 'P0001', 'Log in to claim your bookings.', 'a token without a user id is refused');
reset role;

-- An unconfirmed email claims nothing
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(public.claim_guest_bookings(), 0, 'an unconfirmed email claims nothing');
reset role;
select is((select user_id from public.bookings where reference_code = 'CB-UNVERF'), null, 'the unconfirmed user''s guest booking stays unclaimed');

-- A confirmed email (stored in mixed case) claims its guest bookings
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated", "email": "someone@test.local"}', true);
select is(public.claim_guest_bookings(), 2, 'a confirmed email claims its two guest bookings (matching ignores case)');
select is(public.claim_guest_bookings(), 0, 'claiming again claims nothing (idempotent)');
reset role;

select results_eq(
  $$ select reference_code, user_id from public.bookings where court_id = 'c0000000-0000-0000-0000-000000000001' order by reference_code $$,
  $$ values
       ('CB-DELETD', null::uuid),
       ('CB-GUEST2', '11111111-1111-1111-1111-111111111111'::uuid),
       ('CB-GUEST3', '11111111-1111-1111-1111-111111111111'::uuid),
       ('CB-TAKEN2', '33333333-3333-3333-3333-333333333333'::uuid),
       ('CB-UNVERF', null::uuid),
       ('CB-WALKXN', null::uuid),
       ('CB-ZTHERS', null::uuid) $$,
  'only unclaimed guest bookings for that email moved; owned, walk-in, deleted-player and other-email rows did not (the JWT email claim is ignored)'
);

-- The claimed bookings are now visible to their new owner through RLS
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is((select count(*)::int from public.bookings), 2, 'the player now reads the two claimed bookings through RLS');

-- Another confirmed user claims nothing of Gina's
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is(public.claim_guest_bookings(), 0, 'another user claims nothing (no matching guest bookings)');
reset role;
select is((select user_id from public.bookings where reference_code = 'CB-GUEST2'), '11111111-1111-1111-1111-111111111111'::uuid,
  'a claimed booking is never moved to someone else');

-- A user whose email is later confirmed can claim then
update auth.users set email_confirmed_at = now() where id = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(public.claim_guest_bookings(), 1, 'after confirming the email, the booking can be claimed');
reset role;

select is(
  (select indexdef from pg_indexes where indexname = 'bookings_unclaimed_email_idx'),
  'CREATE INDEX bookings_unclaimed_email_idx ON public.bookings USING btree (guest_email) WHERE ((user_id IS NULL) AND (guest_token_hash IS NOT NULL))',
  'the partial index backs the claim lookup'
);

select * from finish();
rollback;
