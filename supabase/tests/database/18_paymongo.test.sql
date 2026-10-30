-- T7.2: PayMongo checkout sessions and payments (SPEC §4 four cases, RESEARCH M7 plan).
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';

insert into public.courts (venue_id, id, name, sport, default_hourly_rate, is_active) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000a1', 'PM Court A', 'tennis', 500, true),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000a2', 'PM Court B', 'tennis', 500, true),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000a3', 'PM Court Closed', 'tennis', 500, false);

-- One booking per scenario. Future slots are on 2030-01-07 (Court A) / 2030-01-08 (Court B) at different hours.
insert into public.bookings (id, reference_code, court_id, user_id, guest_name, during, total_amount, status, expires_at) values
  -- 1. pending, valid hold
  ('b0000000-0000-0000-0000-0000000000b1', 'CB-PMAAA2', 'c0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Pat',
   tstzrange('2030-01-07 08:00+08', '2030-01-07 09:00+08'), 500, 'pending_payment', now() + interval '30 minutes'),
  -- amount mismatch (pending, valid hold)
  ('b0000000-0000-0000-0000-0000000000b2', 'CB-PMAAB3', 'c0000000-0000-0000-0000-0000000000a1', null, 'Gina',
   tstzrange('2030-01-07 09:00+08', '2030-01-07 10:00+08'), 500, 'pending_payment', now() + interval '30 minutes'),
  -- 3. proof waiting for review
  ('b0000000-0000-0000-0000-0000000000b3', 'CB-PMAAC4', 'c0000000-0000-0000-0000-0000000000a1', null, 'Gina',
   tstzrange('2030-01-07 10:00+08', '2030-01-07 11:00+08'), 500, 'payment_submitted', now() + interval '30 minutes'),
  -- 2. lapsed hold, still pending_payment, slot free
  ('b0000000-0000-0000-0000-0000000000b4', 'CB-PMAAD5', 'c0000000-0000-0000-0000-0000000000a1', null, 'Gina',
   tstzrange('2030-01-07 11:00+08', '2030-01-07 12:00+08'), 500, 'pending_payment', now() - interval '5 minutes'),
  -- 2. swept to expired, slot free
  ('b0000000-0000-0000-0000-0000000000b5', 'CB-PMAAE6', 'c0000000-0000-0000-0000-0000000000a1', null, 'Gina',
   tstzrange('2030-01-07 12:00+08', '2030-01-07 13:00+08'), 500, 'expired', now() - interval '5 minutes'),
  -- 4. expired, slot taken by someone else (b7 below)
  ('b0000000-0000-0000-0000-0000000000b6', 'CB-PMAAF7', 'c0000000-0000-0000-0000-0000000000a1', null, 'Gina',
   tstzrange('2030-01-07 13:00+08', '2030-01-07 14:00+08'), 500, 'expired', now() - interval '5 minutes'),
  ('b0000000-0000-0000-0000-0000000000b7', 'CB-PMAAG8', 'c0000000-0000-0000-0000-0000000000a1', null, 'Other',
   tstzrange('2030-01-07 13:00+08', '2030-01-07 14:00+08'), 500, 'confirmed', null),
  -- 4. expired, blackout covers it
  ('b0000000-0000-0000-0000-0000000000b8', 'CB-PMAAH9', 'c0000000-0000-0000-0000-0000000000a2', null, 'Gina',
   tstzrange('2030-01-08 08:00+08', '2030-01-08 09:00+08'), 500, 'expired', now() - interval '5 minutes'),
  -- 4. expired on a court that was archived since
  ('b0000000-0000-0000-0000-0000000000b9', 'CB-PMAAJ2', 'c0000000-0000-0000-0000-0000000000a3', null, 'Gina',
   tstzrange('2030-01-08 09:00+08', '2030-01-08 10:00+08'), 500, 'expired', now() - interval '5 minutes'),
  -- 4. expired, slot already started
  ('b0000000-0000-0000-0000-0000000000c1', 'CB-PMAAK3', 'c0000000-0000-0000-0000-0000000000a2', null, 'Gina',
   tstzrange(now() - interval '30 minutes', now() + interval '30 minutes'), 500, 'expired', now() - interval '60 minutes'),
  -- 4. cancelled
  ('b0000000-0000-0000-0000-0000000000c2', 'CB-PMAAL4', 'c0000000-0000-0000-0000-0000000000a2', null, 'Gina',
   tstzrange('2030-01-08 11:00+08', '2030-01-08 12:00+08'), 500, 'cancelled', null),
  -- 4. already confirmed with an approved proof
  ('b0000000-0000-0000-0000-0000000000c3', 'CB-PMAAM5', 'c0000000-0000-0000-0000-0000000000a2', null, 'Gina',
   tstzrange('2030-01-08 12:00+08', '2030-01-08 13:00+08'), 500, 'confirmed', null),
  -- 4. rejected after max rejections
  ('b0000000-0000-0000-0000-0000000000c4', 'CB-PMAAN6', 'c0000000-0000-0000-0000-0000000000a2', null, 'Gina',
   tstzrange('2030-01-08 13:00+08', '2030-01-08 14:00+08'), 500, 'rejected', null),
  -- checkout storage scenarios
  ('b0000000-0000-0000-0000-0000000000c5', 'CB-PMAAP7', 'c0000000-0000-0000-0000-0000000000a2', null, 'Gina',
   tstzrange('2030-01-08 14:00+08', '2030-01-08 15:00+08'), 500, 'pending_payment', now() + interval '30 minutes'),
  ('b0000000-0000-0000-0000-0000000000c6', 'CB-PMAAQ8', 'c0000000-0000-0000-0000-0000000000a2', null, 'Gina',
   tstzrange('2030-01-08 15:00+08', '2030-01-08 16:00+08'), 500, 'pending_payment', now() - interval '1 minute');

insert into public.payments (booking_id, method, amount, storage_path, review_status) values
  ('b0000000-0000-0000-0000-0000000000b3', 'gcash', 500, 'b0000000-0000-0000-0000-0000000000b3/p.png', 'pending');
insert into public.payments (booking_id, method, amount, review_status, reviewed_at) values
  ('b0000000-0000-0000-0000-0000000000c3', 'gcash', 500, 'approved', now());
update public.bookings set rejection_count = 1 where id = 'b0000000-0000-0000-0000-0000000000b3';

insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000a2', '2030-01-08 07:00+08', '2030-01-08 09:00+08', 'Resurfacing');

-- Checkout sessions for the payment scenarios (cs_<booking suffix>)
insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos)
select b.id, 'cs_' || right(b.id::text, 2), 'https://checkout.paymongo.test/' || right(b.id::text, 2), 50000
from public.bookings b
where b.id::text like 'b0000000-0000-0000-0000-0000000000%' and b.id not in (
  'b0000000-0000-0000-0000-0000000000b7', 'b0000000-0000-0000-0000-0000000000c5', 'b0000000-0000-0000-0000-0000000000c6');

-- ---------------------------------------------------------------------------
-- Schema, grants and RLS
-- ---------------------------------------------------------------------------
select ok('paymongo' = any(enum_range(null::public.payment_method)::text[]), 'payment_method has paymongo');

select ok(not has_function_privilege('anon', 'public.record_paymongo_payment(text, text, text, bigint, text, text, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_paymongo_payment(text, text, text, bigint, text, text, uuid)', 'execute')
      and has_function_privilege('service_role', 'public.record_paymongo_payment(text, text, text, bigint, text, text, uuid)', 'execute'),
  'only service_role can execute record_paymongo_payment');
select ok(not has_function_privilege('anon', 'public.record_paymongo_checkout(uuid, text, text, bigint)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_paymongo_checkout(uuid, text, text, bigint)', 'execute')
      and has_function_privilege('service_role', 'public.record_paymongo_checkout(uuid, text, text, bigint)', 'execute'),
  'only service_role can execute record_paymongo_checkout');
select ok(not has_function_privilege('anon', 'public.paymongo_checkout_for(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.paymongo_checkout_for(uuid)', 'execute')
      and has_function_privilege('service_role', 'public.paymongo_checkout_for(uuid)', 'execute'),
  'only service_role can execute paymongo_checkout_for');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select * from public.paymongo_checkouts $$, '42501', null, 'anon cannot read PayMongo checkouts');
select throws_ok($$ select * from public.record_paymongo_payment('cs_b1', 'pay_x', 'evt_x', 50000, 'PHP', 'gcash') $$,
  '42501', null, 'anon cannot call record_paymongo_payment');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is((select count(*)::int from public.paymongo_checkouts), 0, 'players see no PayMongo checkouts, not even their own');
select throws_ok(
  $$ insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos)
     values ('b0000000-0000-0000-0000-0000000000c5', 'cs_evil', 'https://evil.test', 1) $$,
  '42501', null, 'players cannot write PayMongo checkouts');
select throws_ok($$ select * from public.record_paymongo_checkout('b0000000-0000-0000-0000-0000000000c5', 'cs_evil', 'https://evil.test', 50000) $$,
  '42501', null, 'players cannot call record_paymongo_checkout');

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is((select count(*)::int from public.paymongo_checkouts where booking_id::text like 'b0000000-0000-0000-0000-0000000000%'), 12,
  'admins read PayMongo checkouts (this test''s fixtures)');
select throws_ok($$ select * from public.record_paymongo_payment('cs_b1', 'pay_x', 'evt_x', 50000, 'PHP', 'gcash') $$,
  '42501', null, 'admins cannot record PayMongo payments either');

-- Existing RPCs refuse the paymongo method with a readable error (guard trigger)
select throws_ok(
  $$ select * from public.create_walk_in('c0000000-0000-0000-0000-0000000000a2', '2030-01-09 08:00+08', 1, 'Walk In', null, 'paymongo') $$,
  'P0001', 'Online PayMongo payments are recorded automatically. Choose another payment method.',
  'create_walk_in refuses the paymongo method readably'
);
reset role;

set local role service_role;
select throws_ok(
  $$ select * from public.record_payment_proof('b0000000-0000-0000-0000-0000000000c5', 'b0000000-0000-0000-0000-0000000000c5/x.png', 'paymongo', 500) $$,
  'P0001', 'Online PayMongo payments are recorded automatically. Choose another payment method.',
  'record_payment_proof refuses the paymongo method readably'
);
select is((select count(*)::int from public.paymongo_checkouts where booking_id::text like 'b0000000-0000-0000-0000-0000000000%'), 12,
  'service_role reads PayMongo checkouts directly (counted on this test''s fixtures, so other local data cannot affect it)');
select throws_ok(
  $$ update public.payments set method = 'paymongo' where booking_id = 'b0000000-0000-0000-0000-0000000000c3' $$,
  'P0001', 'Online PayMongo payments are recorded automatically. Choose another payment method.',
  'the guard also refuses turning an existing payment into a PayMongo one without its id'
);
select throws_ok(
  $$ insert into public.payments (booking_id, method, amount, provider_payment_id) values ('b0000000-0000-0000-0000-0000000000c5', 'gcash', 1, 'pay_x') $$,
  '23514', null, 'a PayMongo id requires method paymongo'
);
select throws_ok(
  $$ insert into public.payments (booking_id, method, amount, provider_payment_id) values ('b0000000-0000-0000-0000-0000000000c5', 'paymongo', 1, 'nope') $$,
  '23514', null, 'PayMongo payment ids must look like pay_…'
);

-- ---------------------------------------------------------------------------
-- Checkout storage
-- ---------------------------------------------------------------------------
select is_empty($$ select * from public.paymongo_checkout_for('b0000000-0000-0000-0000-0000000000c5') $$, 'no stored session yet');
select results_eq(
  $$ select * from public.record_paymongo_checkout('b0000000-0000-0000-0000-0000000000c5', 'cs_first', 'https://checkout.paymongo.test/first', 50000) $$,
  $$ values ('cs_first', 'https://checkout.paymongo.test/first') $$,
  'a new session is stored'
);
select results_eq(
  $$ select * from public.record_paymongo_checkout('b0000000-0000-0000-0000-0000000000c5', 'cs_second', 'https://checkout.paymongo.test/second', 50000) $$,
  $$ values ('cs_first', 'https://checkout.paymongo.test/first') $$,
  'a racing second session loses: the stored one is returned'
);
select results_eq(
  $$ select * from public.paymongo_checkout_for('b0000000-0000-0000-0000-0000000000c5') $$,
  $$ values ('cs_first', 'https://checkout.paymongo.test/first') $$,
  'the stored session is reused'
);
select throws_ok(
  $$ select * from public.record_paymongo_checkout('b0000000-0000-0000-0000-0000000000c6', 'cs_x', 'https://checkout.paymongo.test/x', 50000) $$,
  'P0001', null, 'no session is stored for a lapsed hold'
);
select throws_ok(
  $$ select * from public.record_paymongo_checkout('b0000000-0000-0000-0000-0000000000c2', 'cs_x', 'https://checkout.paymongo.test/x', 50000) $$,
  'P0001', null, 'no session is stored for a booking that is not waiting for payment'
);
select throws_ok(
  $$ select * from public.record_paymongo_checkout('b0000000-0000-0000-0000-0000000000c5', 'cs_bad', 'http://insecure.test', 50000) $$,
  '23514', null, 'checkout URLs must be https'
);

-- ---------------------------------------------------------------------------
-- record_paymongo_payment: the four cases
-- ---------------------------------------------------------------------------
-- 1. Paid within the hold
select is(
  (select outcome from public.record_paymongo_payment('cs_b1', 'pay_b1', 'evt_b1', 50000, 'PHP', 'gcash', 'b0000000-0000-0000-0000-0000000000b1')),
  'confirmed', 'case 1: a payment within the hold confirms the booking'
);
select results_eq(
  $$ select b.status::text, p.method::text, p.amount, p.review_status::text, p.provider_source, p.provider_checkout_id, p.provider_event_id
     from public.bookings b join public.payments p on p.booking_id = b.id
     where b.id = 'b0000000-0000-0000-0000-0000000000b1' $$,
  $$ values ('confirmed', 'paymongo', 500.00::numeric, 'approved', 'gcash', 'cs_b1', 'evt_b1') $$,
  'case 1: one approved PayMongo payment with its ids'
);
-- Replays are idempotent
select is(
  (select outcome from public.record_paymongo_payment('cs_b1', 'pay_b1', 'evt_b1_retry', 50000, 'PHP', 'gcash', 'b0000000-0000-0000-0000-0000000000b1')),
  'duplicate', 'a replayed event is recognised'
);
select is((select count(*)::int from public.payments where booking_id = 'b0000000-0000-0000-0000-0000000000b1'), 1,
  'a replay adds no payment');
select is_empty($$ select * from public.paymongo_checkout_for('b0000000-0000-0000-0000-0000000000b1') $$,
  'a session with a recorded payment is no longer offered');

-- Unknown or mismatched sessions are ignored
select results_eq(
  $$ select * from public.record_paymongo_payment('cs_unknown', 'pay_u1', 'evt_u1', 50000, 'PHP', 'gcash') $$,
  $$ values (null::uuid, 'unknown_checkout') $$,
  'a session we did not create is ignored'
);
select is(
  (select outcome from public.record_paymongo_payment('cs_b2', 'pay_u2', 'evt_u2', 50000, 'PHP', 'gcash', 'b0000000-0000-0000-0000-0000000000b1')),
  'unknown_checkout', 'a metadata booking id that disagrees with our record is ignored'
);
select is((select count(*)::int from public.payments where provider_payment_id in ('pay_u1', 'pay_u2')), 0,
  'ignored events record nothing');
select throws_ok(
  $$ select * from public.record_paymongo_payment('cs_b2', 'not_a_payment', 'evt', 50000, 'PHP', 'gcash') $$,
  'P0001', null, 'malformed payment ids are refused'
);

-- Amount or currency mismatch -> not accepted, booking unchanged
select is(
  (select outcome from public.record_paymongo_payment('cs_b2', 'pay_b2', 'evt_b2', 49900, 'PHP', 'gcash', 'b0000000-0000-0000-0000-0000000000b2')),
  'late', 'an amount that does not match the stored total is not accepted'
);
select results_eq(
  $$ select b.status::text, p.review_status::text, p.amount, p.review_note
     from public.bookings b join public.payments p on p.booking_id = b.id
     where b.id = 'b0000000-0000-0000-0000-0000000000b2' $$,
  $$ values ('pending_payment', 'rejected', 499.00::numeric,
             'The amount paid online didn''t match the booking total. The venue will arrange a refund.') $$,
  'amount mismatch: the booking keeps its hold and the payment is flagged for a refund'
);
select results_eq(
  $$ select * from public.record_paymongo_checkout('b0000000-0000-0000-0000-0000000000b2', 'cs_b2_new', 'https://checkout.paymongo.test/b2new', 50000) $$,
  $$ values ('cs_b2_new', 'https://checkout.paymongo.test/b2new') $$,
  'a dead session (payment recorded) is replaced by a new one'
);
select is(
  (select outcome from public.record_paymongo_payment('cs_b2_new', 'pay_b2_usd', 'evt_b2_usd', 50000, 'USD', 'card', 'b0000000-0000-0000-0000-0000000000b2')),
  'late', 'a non-PHP payment is not accepted'
);

-- 3. A proof is waiting for review
select is(
  (select outcome from public.record_paymongo_payment('cs_b3', 'pay_b3', 'evt_b3', 50000, 'PHP', 'paymaya')),
  'superseded_proof', 'case 3: a payment while a proof waits for review'
);
select results_eq(
  $$ select status::text, rejection_count from public.bookings where id = 'b0000000-0000-0000-0000-0000000000b3' $$,
  $$ values ('confirmed', 1::smallint) $$,
  'case 3: the booking is confirmed and the closed proof does not count as a rejection'
);
select results_eq(
  $$ select method::text, review_status::text, review_note from public.payments
     where booking_id = 'b0000000-0000-0000-0000-0000000000b3' order by submitted_at, method $$,
  $$ values ('gcash', 'rejected', 'Paid online with PayMongo instead.'), ('paymongo', 'approved', null) $$,
  'case 3: the proof is closed with a player-safe note and the PayMongo payment is approved'
);

-- 2. Lapsed hold, slot free -> revived
select is(
  (select outcome from public.record_paymongo_payment('cs_b4', 'pay_b4', 'evt_b4', 50000, 'PHP', 'qrph')),
  'revived', 'case 2: a lapsed pending hold with a free slot is confirmed again'
);
select is((select status::text from public.bookings where id = 'b0000000-0000-0000-0000-0000000000b4'), 'confirmed',
  'case 2: the lapsed hold is now confirmed');
select is(
  (select outcome from public.record_paymongo_payment('cs_b5', 'pay_b5', 'evt_b5', 50000, 'PHP', 'card')),
  'revived', 'case 2: an expired booking with a free slot is confirmed again'
);
select results_eq(
  $$ select b.status::text, p.review_status::text from public.bookings b join public.payments p on p.booking_id = b.id
     where b.id = 'b0000000-0000-0000-0000-0000000000b5' $$,
  $$ values ('confirmed', 'approved') $$,
  'case 2: the revived booking has its approved payment'
);

-- Lapsed but not recoverable -> late
select is(
  (select outcome from public.record_paymongo_payment('cs_b6', 'pay_b6', 'evt_b6', 50000, 'PHP', 'gcash')),
  'late', 'case 4: an expired booking whose slot was taken is not revived'
);
select results_eq(
  $$ select b.status::text, p.review_status::text, p.review_note from public.bookings b join public.payments p on p.booking_id = b.id
     where b.id = 'b0000000-0000-0000-0000-0000000000b6' $$,
  $$ values ('expired', 'rejected',
             'Payment received after the hold expired, and the time was booked by someone else. The venue will arrange a refund.') $$,
  'case 4: the taken slot keeps its new owner and the payment is flagged'
);
select is((select status::text from public.bookings where id = 'b0000000-0000-0000-0000-0000000000b7'), 'confirmed',
  'the other player keeps the slot');
select is(
  (select outcome from public.record_paymongo_payment('cs_b8', 'pay_b8', 'evt_b8', 50000, 'PHP', 'gcash')),
  'late', 'case 4: an expired booking under a blackout is not revived'
);
select is((select status::text from public.bookings where id = 'b0000000-0000-0000-0000-0000000000b8'), 'expired',
  'the blacked-out booking stays expired');
select is(
  (select outcome from public.record_paymongo_payment('cs_b9', 'pay_b9', 'evt_b9', 50000, 'PHP', 'gcash')),
  'late', 'case 4: an expired booking on an archived court is not revived'
);
select is(
  (select outcome from public.record_paymongo_payment('cs_c1', 'pay_c1', 'evt_c1', 50000, 'PHP', 'gcash')),
  'late', 'case 4: an expired booking whose time has started is not revived'
);
select is((select review_note from public.payments where provider_payment_id = 'pay_c1'),
  'Payment received after the booking time had started. The venue will arrange a refund.',
  'case 4: the started-slot note explains why');

-- 4. Cancelled, already confirmed, rejected
select is(
  (select outcome from public.record_paymongo_payment('cs_c2', 'pay_c2', 'evt_c2', 50000, 'PHP', 'gcash')),
  'late', 'case 4: a cancelled booking is not revived'
);
select results_eq(
  $$ select b.status::text, p.review_note from public.bookings b join public.payments p on p.booking_id = b.id
     where b.id = 'b0000000-0000-0000-0000-0000000000c2' $$,
  $$ values ('cancelled', 'Payment received after the booking was cancelled. The venue will arrange a refund.') $$,
  'case 4: the cancelled booking stays cancelled'
);
select is(
  (select outcome from public.record_paymongo_payment('cs_c3', 'pay_c3', 'evt_c3', 50000, 'PHP', 'gcash')),
  'late', 'case 4: a booking already paid by proof gets no second approved payment'
);
select results_eq(
  $$ select method::text, review_status::text from public.payments
     where booking_id = 'b0000000-0000-0000-0000-0000000000c3' order by method $$,
  $$ values ('gcash', 'approved'), ('paymongo', 'rejected') $$,
  'case 4: the existing approved proof stays the only approved payment'
);
select is(
  (select outcome from public.record_paymongo_payment('cs_c4', 'pay_c4', 'evt_c4', 50000, 'PHP', 'gcash')),
  'late', 'case 4: a rejected booking is not revived'
);
select is((select status::text from public.bookings where id = 'b0000000-0000-0000-0000-0000000000c4'), 'rejected',
  'the rejected booking stays rejected');

-- Takings: only accepted PayMongo payments are approved
select results_eq(
  $$ select count(*) filter (where review_status = 'approved')::int, count(*) filter (where review_status = 'rejected')::int
     from public.payments where method = 'paymongo' and booking_id::text like 'b0000000-0000-0000-0000-0000000000%' $$,
  $$ values (4, 9) $$,
  'four PayMongo payments were accepted and nine flagged for follow-up'
);
select ok(
  not exists (select 1 from public.payments where method = 'paymongo' and review_status = 'rejected'
              and (review_note is null or review_note !~ 'refund')),
  'every flagged PayMongo payment tells the player a refund will be arranged'
);
reset role;

-- Players can read their own booking's PayMongo payment (existing payments RLS)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select results_eq(
  $$ select method::text, review_status::text from public.payments where booking_id = 'b0000000-0000-0000-0000-0000000000b1' $$,
  $$ values ('paymongo', 'approved') $$,
  'the booking owner reads their PayMongo payment'
);
reset role;

select * from finish();
rollback;
