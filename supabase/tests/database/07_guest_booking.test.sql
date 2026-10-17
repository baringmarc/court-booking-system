-- T3.6: get_guest_booking (guest path) and the owner read path through RLS.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

create function pg_temp.error_of(p_sql text) returns text language plpgsql as $$
declare h text; m text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint, m = message_text;
  return coalesce(h, '') || ': ' || m;
end $$;

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'other@test.local');
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000001', 'Guest Court', 'pickleball', 400);

create temp table fx as
select (private.local_today() + 3 + time '10:00') at time zone 'Asia/Manila' as t10;
create temp table b (label text primary key, ref text, token text);
grant select on fx to anon, authenticated;
grant select, insert on b to anon, authenticated;

-- A guest booking and a player booking, both made through create_booking
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
insert into b select 'guest', r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10, 2, 'Gina Guest', 'gina@example.com', '0917 222 2222') r;

select results_eq(
  $$ select g.court_name, g.sport::text, g.slot_start, g.slot_end, g.status::text, g.total_amount, g.guest_name
     from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'guest' $$,
  $$ select 'Guest Court', 'pickleball', t10, t10 + interval '2 hours', 'pending_payment', 800.00::numeric, 'Gina Guest' from fx $$,
  'the right reference code and token return the booking'
);
select is(
  (select g.payment_instructions from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'guest'),
  (select payment_instructions from public.venue_settings),
  'payment instructions are included'
);
select is(
  (select count(*)::int from b, public.get_guest_booking(lower(b.ref), b.token) g where b.label = 'guest'),
  1, 'the reference code is case-insensitive'
);

select is(
  pg_temp.error_of($$ select * from public.get_guest_booking((select ref from b where label = 'guest'), 'wrong-token') $$),
  'not_found: Booking not found. Check that you opened the full link from your confirmation.',
  'a wrong token is not_found'
);
select is(
  pg_temp.error_of($$ select * from public.get_guest_booking('CB-ZZZZZZ', 'wrong-token') $$),
  pg_temp.error_of($$ select * from public.get_guest_booking((select ref from b where label = 'guest'), 'wrong-token') $$),
  'an unknown reference code gives exactly the same error as a wrong token'
);
select is(
  pg_temp.error_of($$ select * from public.get_guest_booking((select ref from b where label = 'guest'), null) $$),
  'not_found: Booking not found. Check that you opened the full link from your confirmation.',
  'a missing token is not_found'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
insert into b select 'player', r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t10 + interval '3 hours', 1) r;
select alike(
  pg_temp.error_of($$ select * from public.get_guest_booking((select ref from b where label = 'player'), '') $$),
  'not_found:%', 'player bookings have no guest token and cannot be opened as a guest'
);

-- Owner read path through RLS
select is(
  (select count(*)::int from public.bookings where reference_code = (select ref from b where label = 'player')),
  1, 'the owner reads their booking by reference code through RLS'
);
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is(
  (select count(*)::int from public.bookings where reference_code = (select ref from b where label = 'player')),
  0, 'another player cannot read it'
);

-- Effective status and token secrecy (as postgres)
reset role;
update public.bookings set expires_at = now() - interval '1 minute' where reference_code = (select ref from b where label = 'guest');
select is(
  (select g.status::text from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'guest'),
  'expired', 'a hold past expires_at is reported as expired before the sweep'
);
select ok(
  not exists (select 1 from public.bookings bk, b where bk::text like '%' || b.token || '%' and b.label = 'guest'),
  'the plaintext token appears nowhere in the bookings row'
);
select ok(has_function_privilege('anon', 'public.get_guest_booking(text, text)', 'execute'), 'anon can call get_guest_booking');
select ok(has_function_privilege('authenticated', 'public.get_guest_booking(text, text)', 'execute'), 'authenticated can call get_guest_booking');

select * from finish();
rollback;
