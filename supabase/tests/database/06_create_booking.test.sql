-- T3.5: create_booking. Dates are relative to the venue-local "today" so the test never goes stale.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Returns the HINT (our stable error code) raised by a statement, or null if it succeeds.
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

-- Pin the hours these tests assume, independent of the catalog migration's defaults.
update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;

insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'pat@test.local');
update public.profiles set full_name = 'Pat Player', phone = '0917 111 1111'
where id = '11111111-1111-1111-1111-111111111111';

insert into public.courts (id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-000000000001', 'CB Court', 'tennis', 300, true),
  ('c0000000-0000-0000-0000-000000000002', 'CB Archived', 'tennis', 300, false);

-- Fixture times: d = today + 3 (Manila), as instants.
create temp table fx as
select d, (d + time '10:00') at time zone 'Asia/Manila' as t10,
          (d + time '12:00') at time zone 'Asia/Manila' as t12,
          (d + time '14:00') at time zone 'Asia/Manila' as t14,
          (d + time '16:00') at time zone 'Asia/Manila' as t16,
          ((private.local_today() - 1) + time '10:00') at time zone 'Asia/Manila' as t_yesterday,
          ((private.local_today() + (select booking_window_days from public.venue_settings) + 1) + time '10:00') at time zone 'Asia/Manila' as t_past_window
from (select private.local_today() + 3 as d) x;
create temp table results (label text primary key, id uuid, ref text, token text);
grant select on fx to anon, authenticated;
grant select, insert on results to anon, authenticated;

insert into public.blackouts (court_id, starts_at, ends_at, reason)
select null, t16, t16 + interval '1 hour', 'test' from fx;

-- ---------------------------------------------------------------- guest flow (anon)
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

insert into results
select 'guest', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10, 2, ' Gina Guest ', 'Gina@Example.com', '0917 222 2222') r;

select matches((select ref from results where label = 'guest'), '^CB-[A-HJ-NP-Z2-9]{6}$', 'guest gets a CB- reference code');
select ok((select length(token) = 43 and token ~ '^[A-Za-z0-9_-]+$' from results where label = 'guest'), 'guest gets a 43-char url-safe token');

select is(
  pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t10 + interval '1 hour' from fx), 1, 'X', 'x@example.com', '0917 333 3333') $$),
  'slot_unavailable', 'a slot that is already held cannot be booked (exclusion -> slot_unavailable)'
);
select is(
  pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t12 from fx), 1, 'X', null, '0917 333 3333') $$),
  'invalid_guest', 'guests must give a name and email'
);
select is(
  pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t12 from fx), 1, 'X', 'not-an-email', '0917 333 3333') $$),
  'invalid_guest', 'guest email must look like an email'
);
select is(
  pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t12 from fx), 1, 'X', 'x@example.com', '12') $$),
  'invalid_phone', 'guest phone must be a PH mobile number (T11.17)'
);

-- Rule errors, each with its own code
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t12 from fx), 0, 'X', 'x@example.com', '09171234567') $$),
  'invalid_input', 'at least one slot');
select is(pg_temp.hint_of($$ select * from public.create_booking('00000000-0000-0000-0000-000000000000', (select t12 from fx), 1, 'X', 'x@example.com', '09171234567') $$),
  'invalid_input', 'unknown court');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000002', (select t12 from fx), 1, 'X', 'x@example.com', '09171234567') $$),
  'court_inactive', 'archived court');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t12 + interval '30 minutes' from fx), 1, 'X', 'x@example.com', '09171234567') $$),
  'not_aligned', 'start must be on the hour');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t_yesterday from fx), 1, 'X', 'x@example.com', '09171234567') $$),
  'slot_started', 'cannot book a slot that has started');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t_past_window from fx), 1, 'X', 'x@example.com', '09171234567') $$),
  'outside_window', 'cannot book past the booking window');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select (d + time '20:00') at time zone 'Asia/Manila' from fx), 5, 'X', 'x@example.com', '09171234567') $$),
  'multi_day', 'cannot cross midnight');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select (d + time '05:00') at time zone 'Asia/Manila' from fx), 1, 'X', 'x@example.com', '09171234567') $$),
  'outside_hours', 'cannot book before opening');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select (d + time '21:00') at time zone 'Asia/Manila' from fx), 2, 'X', 'x@example.com', '09171234567') $$),
  'outside_hours', 'cannot run past closing');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t16 from fx), 1, 'X', 'x@example.com', '09171234567') $$),
  'blackout', 'cannot book into a blackout');

-- ---------------------------------------------------------------- player flow
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

insert into results
select 'player', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t12, 1) r;
select ok((select token is null from results where label = 'player'), 'players get no guest token');

-- ---------------------------------------------------------------- stored rows (as postgres)
reset role;
select results_eq(
  $$ select b.user_id, b.guest_name, b.guest_email, b.guest_phone, b.status::text, b.source::text
     from public.bookings b join results r on r.id = b.id where r.label = 'guest' $$,
  $$ values (null::uuid, 'Gina Guest', 'gina@example.com', '09172222222', 'pending_payment', 'online') $$,
  'guest booking stores a trimmed, lower-cased contact snapshot and no user'
);
select ok(
  (select b.guest_token_hash = sha256(convert_to(r.token, 'UTF8')) from public.bookings b join results r on r.id = b.id where r.label = 'guest'),
  'only the sha256 of the guest token is stored'
);
select is(
  (select b.total_amount from public.bookings b join results r on r.id = b.id where r.label = 'guest'),
  (select private.range_price('c0000000-0000-0000-0000-000000000001', tstzrange(t10, t12)) from fx),
  'price is computed on the server'
);
select ok(
  (select b.expires_at between now() + interval '59 minutes' and now() + interval '61 minutes'
   from public.bookings b join results r on r.id = b.id where r.label = 'guest'),
  'hold expires after payment_hold_minutes (60)'
);
select results_eq(
  $$ select b.user_id, b.guest_name, b.guest_email, b.guest_phone, b.guest_token_hash is null
     from public.bookings b join results r on r.id = b.id where r.label = 'player' $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, 'Pat Player', 'pat@test.local', '09171111111', true) $$,
  'player booking takes user_id from the session and contact details from the profile'
);

-- Stale hold: an expired-but-unswept hold must not block a new booking.
insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status, expires_at)
select 'CB-STALE2', 'c0000000-0000-0000-0000-000000000001', 'Stale', tstzrange(t14, t14 + interval '1 hour'), 300, 'pending_payment', now() - interval '1 minute'
from fx;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(
  pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t14 from fx), 1, 'New', 'new@example.com', '0917 444 4444') $$),
  null, 'an expired-but-unswept hold does not block a new booking'
);
reset role;
select is((select status::text from public.bookings where reference_code = 'CB-STALE2'), 'expired', 'the stale hold is marked expired');

-- Reference-code retry: swap the generator (rolled back with the test) so the first attempt collides.
insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status)
select 'CB-CQLL22', 'c0000000-0000-0000-0000-000000000001', 'Existing', tstzrange(t10 - interval '2 hours', t10 - interval '1 hour'), 300, 'confirmed'
from fx;
-- A sequence, not a counter table: nextval survives the subtransaction rollback of a failed insert.
create sequence public.zz_code_calls;
create or replace function private.new_reference_code() returns text language sql volatile set search_path = '' as $$
  select case when nextval('public.zz_code_calls') = 1 then 'CB-CQLL22' else 'CB-FRESH2' end;
$$;
select is(
  (select r.reference_code from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10 + interval '7 hours', 1, 'Retry', 'retry@example.com', '0917 555 5555') r),
  'CB-FRESH2', 'a reference-code collision is retried with a new code'
);
create or replace function private.new_reference_code() returns text language sql volatile set search_path = '' as $$
  select 'CB-CQLL22';
$$;
select is(
  pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001', (select t10 + interval '8 hours' from fx), 1, 'Retry', 'retry@example.com', '0917 555 5555') $$),
  'sqlstate 23505', 'after 5 collisions the unique violation is raised, not swallowed'
);

-- Access
select ok(has_function_privilege('anon', 'public.create_booking(uuid, timestamptz, integer, text, text, text, boolean)', 'execute'), 'anon can call create_booking');
select ok(has_function_privilege('authenticated', 'public.create_booking(uuid, timestamptz, integer, text, text, text, boolean)', 'execute'), 'authenticated can call create_booking');
select ok(not has_function_privilege('anon', 'private.new_reference_code()', 'execute'), 'anon cannot call private.new_reference_code');

select * from finish();
rollback;
