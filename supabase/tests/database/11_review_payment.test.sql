-- T4.6: review_payment approve / reject loop.
begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.venue_settings set max_rejections = 2, payment_hold_minutes = 60;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000001', 'Review Court', 'tennis', 500);

create temp table fx as select (private.local_today() + 3 + time '10:00') at time zone 'Asia/Manila' as t10;
create temp table b (label text primary key, id uuid, ref text);
grant select on fx to anon, authenticated, service_role;
grant select, insert on b to anon, authenticated, service_role;

-- Two player bookings (approve path, reject loop) and one still waiting for a proof
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
insert into b select 'approve', r.id, r.reference_code from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10, 1) r;
insert into b select 'reject', r.id, r.reference_code from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10 + interval '2 hours', 1) r;
insert into b select 'unpaid', r.id, r.reference_code from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10 + interval '4 hours', 1) r;

reset role;
set local role service_role;
select public.record_payment_proof(id, id::text || '/1.png', 'gcash', 500) from b where label in ('approve', 'reject');

-- Access
reset role;
select ok(not has_function_privilege('anon', 'public.review_payment(uuid, boolean, text)', 'execute'), 'anon cannot call review_payment');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.review_payment((select id from b where label = 'approve'), true) $$),
  'forbidden', 'players cannot review payments, even their own');

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);

-- Input and state errors
select is(pg_temp.hint_of($$ select * from public.review_payment('00000000-0000-0000-0000-000000000000', true) $$), 'not_found', 'unknown booking');
select is(pg_temp.hint_of($$ select * from public.review_payment((select id from b where label = 'unpaid'), true) $$), 'invalid_state', 'a booking without a submitted proof cannot be reviewed');
select is(pg_temp.hint_of($$ select * from public.review_payment((select id from b where label = 'reject'), false, '   ') $$), 'note_required', 'rejecting needs a reason');
select is(pg_temp.hint_of($$ select * from public.review_payment((select id from b where label = 'reject'), null) $$), 'invalid_input', 'a decision is required');

-- Approve
select is((select r.status::text from b, public.review_payment(b.id, true) r where b.label = 'approve'), 'confirmed', 'approving returns confirmed');
reset role;
select results_eq(
  $$ select bk.status::text, p.review_status::text, p.reviewed_by from public.bookings bk join public.payments p on p.booking_id = bk.id join b on b.id = bk.id where b.label = 'approve' $$,
  $$ values ('confirmed', 'approved', '22222222-2222-2222-2222-222222222222'::uuid) $$,
  'the booking is confirmed and the payment approved by the admin'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.review_payment((select id from b where label = 'approve'), true) $$), 'invalid_state', 'a confirmed booking cannot be reviewed again');

-- First rejection: back to pending_payment with a fresh hold, slot kept
reset role;
update public.bookings set expires_at = now() - interval '30 minutes' where id = (select id from b where label = 'reject');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is((select r.status::text from b, public.review_payment(b.id, false, 'Screenshot is cut off') r where b.label = 'reject'),
  'pending_payment', 'the first rejection sends the booking back to pending_payment');
reset role;
select results_eq(
  $$ select bk.rejection_count::int, p.review_status::text, p.review_note from public.bookings bk join public.payments p on p.booking_id = bk.id join b on b.id = bk.id where b.label = 'reject' $$,
  $$ values (1, 'rejected', 'Screenshot is cut off') $$,
  'the rejection is counted and the reason saved on the payment'
);
select ok(
  (select expires_at between now() + interval '59 minutes' and now() + interval '61 minutes' from public.bookings where id = (select id from b where label = 'reject')),
  'the player gets a fresh payment_hold_minutes window'
);
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t10 + interval '2 hours' from fx), 1, 'X', 'x@example.com', '0917 000 0000') $$),
  'slot_unavailable', 'the player keeps the slot after a first rejection');

-- The player re-uploads, and the booking can be reviewed again
reset role;
set local role service_role;
select lives_ok($$ select public.record_payment_proof((select id from b where label = 'reject'), (select id::text || '/2.png' from b where label = 'reject'), 'gcash', 500) $$,
  'a new proof can be submitted after a rejection');
reset role;
select is((select status::text from public.bookings where id = (select id from b where label = 'reject')), 'payment_submitted', 'the booking is under review again');

-- Second rejection: rejected, slot freed
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is((select r.status::text from b, public.review_payment(b.id, false, 'Amount still wrong') r where b.label = 'reject'),
  'rejected', 'the second rejection (max_rejections = 2) rejects the booking');
reset role;
select is((select rejection_count::int from public.bookings where id = (select id from b where label = 'reject')), 2, 'both rejections are counted');
select is((select count(*)::int from public.payments where booking_id = (select id from b where label = 'reject') and review_status = 'rejected'), 2, 'both attempts stay on record');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t10 + interval '2 hours' from fx), 1, 'X', 'x@example.com', '0917 000 0000') $$),
  null, 'the slot is freed for others after the final rejection');
select is(pg_temp.hint_of($$ select * from public.get_guest_booking((select ref from b where label = 'reject'), 'x') $$), 'not_found', 'player bookings stay private');

-- Players see the rejection reason on their own payments (RLS)
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(
  (select review_note from public.payments where booking_id = (select id from b where label = 'reject') order by submitted_at limit 1),
  'Screenshot is cut off', 'the player can read why their proof was rejected'
);

-- A configured max_rejections = 1 rejects on the first strike
reset role;
update public.venue_settings set max_rejections = 1;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
insert into b select 'strict', r.id, r.reference_code from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10 + interval '6 hours', 1) r;
reset role;
set local role service_role;
select public.record_payment_proof(id, id::text || '/1.png', 'maya', 500) from b where label = 'strict';
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is((select r.status::text from b, public.review_payment(b.id, false, 'Not a payment receipt') r where b.label = 'strict'),
  'rejected', 'with max_rejections = 1 the first rejection is final');
select ok(has_function_privilege('authenticated', 'public.review_payment(uuid, boolean, text)', 'execute'), 'authenticated (admins) can call review_payment');

select * from finish();
rollback;
