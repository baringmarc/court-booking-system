-- T11.13: bookings.amount_due becomes NOT NULL (T11.12 follow-up, so the generated types read it as a number).
-- It stays the stored generated column total_amount + booking_fee, nothing can write it, and every reader
-- (bookings through RLS, get_guest_booking, proof_target) still gets the sum.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "anon"}', true)
$$;
create function pg_temp.as_player() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true)
$$;
grant execute on function pg_temp.as_anon() to anon, authenticated, service_role;
grant execute on function pg_temp.as_player() to anon, authenticated, service_role;

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'pat@test.local');

insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000036a1', 'Due Court 1', 'tennis', 350);

create temp table fx as
select (private.local_today() + 4 + time '07:00') at time zone 'Asia/Manila' as t07;
create temp table b (label text primary key, id uuid, ref text, token text);
grant select on fx to anon, authenticated, service_role;
grant select, insert on b to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Shape: not null, still a stored generated column with the same expression
-- ---------------------------------------------------------------------------
select col_not_null('public', 'bookings', 'amount_due', 'bookings.amount_due is not null');
select is((select attgenerated::text from pg_attribute where attrelid = 'public.bookings'::regclass and attname = 'amount_due'), 's',
  'bookings.amount_due is still a stored generated column');
select is(
  (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
   where d.adrelid = 'public.bookings'::regclass and a.attname = 'amount_due'),
  '(total_amount + booking_fee)',
  'bookings.amount_due is still total_amount + booking_fee');
select col_type_is('public', 'bookings', 'amount_due', 'numeric', 'bookings.amount_due is still numeric');
select is((select count(*)::int from public.bookings where amount_due is null), 0,
  'no existing booking has a null amount_due');

-- ---------------------------------------------------------------------------
-- Behavior: the sum is still computed, and still can't be written
-- ---------------------------------------------------------------------------
set local role service_role;
update public.platform_pricing set booking_fee = 10;
reset role;

set local role anon;
select pg_temp.as_anon();
insert into b select 'guest', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-0000000036a1', fx.t07, 1, 'Gina Guest', 'gina@example.com', '0917 222 2222') r;
reset role;
set local role authenticated;
select pg_temp.as_player();
insert into b select 'player', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-0000000036a1', fx.t07 + interval '1 hour', 2) r;
reset role;

select results_eq(
  $$ select total_amount, booking_fee, amount_due from public.bookings where id = (select id from b where label = 'guest') $$,
  $$ values (350.00::numeric, 10.00::numeric, 360.00::numeric) $$,
  'a 7 AM guest booking still gets amount_due = 350 + 10 = 360');
select results_eq(
  $$ select total_amount, booking_fee, amount_due from public.bookings where id = (select id from b where label = 'player') $$,
  $$ values (700.00::numeric, 10.00::numeric, 710.00::numeric) $$,
  'a two-hour player booking still gets amount_due = 700 + 10 = 710');
select throws_ok(
  $$ update public.bookings set amount_due = 1 where id = (select id from b where label = 'guest') $$,
  '428C9', null, 'amount_due still cannot be written directly');
select throws_ok(
  $$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status, amount_due)
     select 'CB-DUE36X', 'c0000000-0000-0000-0000-0000000036a1', 'Direct Insert',
            tstzrange(fx.t07 + interval '5 hours', fx.t07 + interval '6 hours'), 350, 'confirmed', 999 from fx $$,
  '428C9', null, 'amount_due still cannot be set on insert');

-- ---------------------------------------------------------------------------
-- Readers: the player through RLS and the guest through get_guest_booking see the sum
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_player();
select results_eq(
  $$ select amount_due from public.bookings where id = (select id from b where label = 'player') $$,
  $$ values (710.00::numeric) $$,
  'the player reads amount_due 710 on their booking through RLS');
reset role;

set local role anon;
select pg_temp.as_anon();
select results_eq(
  $$ select g.booking_fee, g.amount_due from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'guest' $$,
  $$ values (10.00::numeric, 360.00::numeric) $$,
  'get_guest_booking returns the fee 10 and amount_due 360 to the guest');
reset role;

select results_eq(
  $$ select p.amount_due from b, public.proof_target(b.ref, b.token, null) p where b.label = 'guest' $$,
  $$ values (360.00::numeric) $$,
  'proof_target (manual proofs and PayMongo checkout) still asks for amount_due 360');

select * from finish();
rollback;
