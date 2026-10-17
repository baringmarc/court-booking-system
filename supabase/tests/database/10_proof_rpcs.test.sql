-- T4.4: proof_target / record_payment_proof (service-role only) and get_guest_booking's payments.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'other@test.local');
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000001', 'Proof RPC Court', 'tennis', 500);

create temp table fx as select (private.local_today() + 3 + time '10:00') at time zone 'Asia/Manila' as t10;
create temp table b (label text primary key, id uuid, ref text, token text);
grant select on fx to anon, authenticated, service_role;
grant select, insert on b to anon, authenticated, service_role;

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
insert into b select 'guest', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10, 1, 'Gina', 'gina@example.com', '0917 222 2222') r;
insert into b select 'expiring', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10 + interval '4 hours', 1, 'Eve', 'eve@example.com', '0917 333 3333') r;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
insert into b select 'player', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10 + interval '2 hours', 1) r;

-- Access: only the service role may call these
select ok(not has_function_privilege('anon', 'public.proof_target(text, text, uuid)', 'execute'), 'anon cannot call proof_target');
select ok(not has_function_privilege('authenticated', 'public.record_payment_proof(uuid, text, public.payment_method, numeric, text)', 'execute'), 'authenticated cannot call record_payment_proof');
select ok(has_function_privilege('service_role', 'public.record_payment_proof(uuid, text, public.payment_method, numeric, text)', 'execute'), 'service_role can call record_payment_proof');
select ok(not has_function_privilege('authenticated', 'public.proof_target(text, text, uuid)', 'execute'), 'authenticated cannot call proof_target');
select ok(not has_function_privilege('anon', 'public.record_payment_proof(uuid, text, public.payment_method, numeric, text)', 'execute'), 'anon cannot call record_payment_proof');
select ok(has_function_privilege('service_role', 'public.proof_target(text, text, uuid)', 'execute'), 'service_role can call proof_target');

reset role;
set local role service_role;

-- Authorization
select results_eq(
  $$ select t.booking_id, t.total_amount from b, public.proof_target(b.ref, b.token, null) t where b.label = 'guest' $$,
  $$ select id, 500.00::numeric from b where label = 'guest' $$,
  'a guest with the right token gets the booking id and total'
);
select results_eq(
  $$ select t.booking_id from b, public.proof_target(lower(b.ref), null, '11111111-1111-1111-1111-111111111111') t where b.label = 'player' $$,
  $$ select id from b where label = 'player' $$,
  'the owning player gets their booking (reference is case-insensitive)'
);
select is(pg_temp.hint_of($$ select * from public.proof_target((select ref from b where label = 'guest'), 'wrong', null) $$),
  'not_found', 'a wrong token is not_found');
select is(pg_temp.hint_of($$ select * from public.proof_target('CB-ZZZZZZ', 'wrong', null) $$),
  'not_found', 'an unknown reference is not_found');
select is(pg_temp.hint_of($$ select * from public.proof_target((select ref from b where label = 'player'), null, '33333333-3333-3333-3333-333333333333') $$),
  'not_found', 'another player cannot submit for this booking');
select is(pg_temp.hint_of($$ select * from public.proof_target((select ref from b where label = 'player'), '', null) $$),
  'not_found', 'a player booking cannot be reached without the owner');

-- Input checks on record_payment_proof
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'guest'), (select id::text || '/p.png' from b where label = 'guest'), 'cash', 500) $$),
  'invalid_input', 'cash is not accepted as an uploaded proof');
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'guest'), 'elsewhere/p.png', 'gcash', 500) $$),
  'invalid_input', 'the file must be inside the booking''s folder');
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'guest'), (select id::text || '/p.png' from b where label = 'guest'), 'gcash', -1) $$),
  'invalid_input', 'the amount cannot be negative');

select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'guest'), (select id::text || '/p.png' from b where label = 'guest'), 'gcash', null) $$),
  'invalid_input', 'the amount is required');
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'guest'), (select id::text || '/p.png' from b where label = 'guest'), 'gcash', 1000001) $$),
  'invalid_input', 'an absurd amount is rejected');
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'guest'), null, 'gcash', 500) $$),
  'invalid_input', 'the proof file path is required');
select is(pg_temp.hint_of($$ select * from public.record_payment_proof('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000/p.png', 'gcash', 500) $$),
  'not_found', 'an unknown booking id is not_found');

-- Recording
select lives_ok(
  $$ select * from public.record_payment_proof((select id from b where label = 'guest'), (select id::text || '/proof.png' from b where label = 'guest'), 'gcash', 500, ' 1234 5678 ') $$,
  'a valid proof is recorded'
);
select results_eq(
  $$ select bk.status::text, p.method::text, p.amount, p.reference_number, p.review_status::text
     from public.bookings bk join public.payments p on p.booking_id = bk.id join b on b.id = bk.id where b.label = 'guest' $$,
  $$ values ('payment_submitted', 'gcash', 500.00::numeric, '1234 5678', 'pending') $$,
  'the booking moves to payment_submitted with one pending payment'
);
select is(pg_temp.hint_of($$ select * from public.proof_target((select ref from b where label = 'guest'), (select token from b where label = 'guest'), null) $$),
  'invalid_state', 'a booking already under review cannot take another proof');
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'guest'), (select id::text || '/again.png' from b where label = 'guest'), 'gcash', 500) $$),
  'invalid_state', 'recording re-checks the state (race between two submissions)');
select lives_ok(
  $$ select * from public.record_payment_proof((select id from b where label = 'player'), (select id::text || '/p.pdf' from b where label = 'player'), 'bank_transfer', 450) $$,
  'an amount different from the total is accepted (the admin sees a warning)'
);

-- Expired holds
reset role;
update public.bookings set expires_at = now() - interval '1 second' where id = (select id from b where label = 'expiring');
set local role service_role;
select is(pg_temp.hint_of($$ select * from public.proof_target((select ref from b where label = 'expiring'), (select token from b where label = 'expiring'), null) $$),
  'hold_expired', 'an expired hold cannot take a proof');
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'expiring'), (select id::text || '/late.png' from b where label = 'expiring'), 'maya', 500) $$),
  'hold_expired', 'recording also rejects a hold that expired during the upload');

-- Terminal states cannot take a proof
reset role;
update public.bookings set status = 'cancelled', cancelled_at = now() where id = (select id from b where label = 'expiring');
set local role service_role;
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'expiring'), (select id::text || '/x.png' from b where label = 'expiring'), 'maya', 500) $$),
  'invalid_state', 'a cancelled booking cannot take a proof');

-- Guest view of payments: metadata only
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(
  (select jsonb_array_length(g.payments) from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'guest'),
  1, 'get_guest_booking lists the payment attempts'
);
select is(
  (select g.payments -> 0 ->> 'review_status' from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'guest'),
  'pending', 'each attempt shows its review status'
);
select ok(
  (select not (g.payments -> 0 ? 'storage_path') from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'guest'),
  'guests never receive file paths'
);

select * from finish();
rollback;
