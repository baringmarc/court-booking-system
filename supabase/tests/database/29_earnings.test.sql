-- T10.6: get_earnings — admin only; money by approved time (venue calendar dates), refunds due apart, the previous
-- period; hours by operating day with blackouts (unioned, clipped) and open play; coming up.
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
grant execute on function pg_temp.hint_of(text) to anon, authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000000a1', 'Earn Court 1', 'tennis', 500),
  ('c0000000-0000-0000-0000-0000000000a2', 'Earn Court 2', 'tennis', 500);

-- Every day 06:00–22:00, except Saturday 18:00–02:00 (overnight). The week is a Monday at least 40 days ahead,
-- clear of the seeded demo payments.
update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.operating_hours set open_time = '18:00', close_time = '02:00' where day_of_week = 6;
create temp table fx as
select d + ((8 - extract(isodow from d)::int) % 7) as mon
from (select private.local_today() + 40 as d) x;
grant select on fx to anon, authenticated;

create function pg_temp.at(p_offset int, p_time time) returns timestamptz language sql as $$
  select ((select mon from fx) + p_offset + p_time) at time zone 'Asia/Manila'
$$;
grant execute on function pg_temp.at(int, time) to anon, authenticated;

-- What counts as "coming up" before this test's bookings (seeded data may have some).
create temp table before as
select (select count(*) from public.bookings where status = 'confirmed' and lower(during) > now()) as n,
       (select coalesce(sum(total_amount), 0) from public.bookings where status = 'confirmed' and lower(during) > now()) as v;
grant select on before to authenticated;

-- Played hours on court 1: Monday 10–12 and Saturday's 1 AM (Sunday's calendar date) hour; a pending hold on
-- Tuesday doesn't count.
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status, expires_at) values
  ('b0000000-0000-0000-0000-0000000000a1', 'CB-ERNAA2', 'c0000000-0000-0000-0000-0000000000a1', 'Monday Pair',
   tstzrange(pg_temp.at(0, '10:00'), pg_temp.at(0, '12:00')), 1000, 'confirmed', null),
  ('b0000000-0000-0000-0000-0000000000a2', 'CB-ERNAB3', 'c0000000-0000-0000-0000-0000000000a1', 'Night Owl',
   tstzrange(pg_temp.at(6, '01:00'), pg_temp.at(6, '02:00')), 300, 'confirmed', null),
  ('b0000000-0000-0000-0000-0000000000a3', 'CB-ERNAC4', 'c0000000-0000-0000-0000-0000000000a1', 'Held',
   tstzrange(pg_temp.at(1, '18:00'), pg_temp.at(1, '19:00')), 500, 'pending_payment', now() + interval '20 minutes');

-- Payments hang on cancelled bookings on court 2 (they keep their money but hold no slot), one each, so several
-- can be approved. The 1 AM and 3 AM times are outside opening hours, so they add no sold hours either.
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status, cancelled_at)
select ('b0000000-0000-0000-0000-0000000000' || lpad(to_hex(16 + n), 2, '0'))::uuid, 'CB-ERNP' || chr(65 + n) || '2',
       'c0000000-0000-0000-0000-0000000000a2', 'Payer ' || n,
       tstzrange(pg_temp.at(n, '03:00'), pg_temp.at(n, '04:00')), 100, 'cancelled', now()
from generate_series(0, 6) as n;

insert into public.payments (booking_id, method, amount, provider_payment_id, review_status, reviewed_at, review_note) values
  -- This week: Monday 00:00 (first instant), Sunday 23:59:59 (last), and a PayMongo payment on Wednesday.
  ('b0000000-0000-0000-0000-000000000010', 'gcash',         400, null,       'approved', pg_temp.at(0, '00:00'),    null),
  ('b0000000-0000-0000-0000-000000000011', 'cash',          600, null,       'approved', pg_temp.at(6, '23:59:59'), null),
  ('b0000000-0000-0000-0000-000000000012', 'paymongo',      500, 'pay_ern1', 'approved', pg_temp.at(2, '15:00'),    null),
  -- Next Monday 00:00 (the next period) and the Sunday before (the previous period).
  ('b0000000-0000-0000-0000-000000000013', 'maya',          100, null,       'approved', pg_temp.at(7, '00:00'),    null),
  ('b0000000-0000-0000-0000-000000000014', 'bank_transfer', 250, null,       'approved', pg_temp.at(-1, '23:59'),   null),
  -- A PayMongo refund due and a rejected proof, both this week: neither is collected.
  ('b0000000-0000-0000-0000-000000000015', 'paymongo',      300, 'pay_ern2', 'rejected', pg_temp.at(1, '12:00'),    'Late payment.'),
  ('b0000000-0000-0000-0000-000000000016', 'gcash',         999, null,       'rejected', pg_temp.at(1, '12:00'),    'Wrong amount.');

-- Blackouts: court 1 Tuesday 10–14 and 12–16 (overlapping: 6 hours, not 8); every court Wednesday 08–10; court 2
-- Friday 20:00 to Saturday 08:00 (only Friday 20–22 is open, since Saturday opens at 18:00).
insert into public.blackouts (court_id, starts_at, ends_at, reason) values
  ('c0000000-0000-0000-0000-0000000000a1', pg_temp.at(1, '10:00'), pg_temp.at(1, '14:00'), 'Repair'),
  ('c0000000-0000-0000-0000-0000000000a1', pg_temp.at(1, '12:00'), pg_temp.at(1, '16:00'), 'More repair'),
  (null,                                   pg_temp.at(2, '08:00'), pg_temp.at(2, '10:00'), 'Venue event'),
  ('c0000000-0000-0000-0000-0000000000a2', pg_temp.at(4, '20:00'), pg_temp.at(5, '08:00'), 'Resurfacing');

-- Open play on court 2, Thursday 10–13.
insert into public.open_play_sessions (id, title, starts_at, ends_at) values
  ('a0000000-0000-0000-0000-0000000000a1', 'Earn open play', pg_temp.at(3, '10:00'), pg_temp.at(3, '13:00'));
insert into public.open_play_courts (session_id, court_id, during) values
  ('a0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a2', tstzrange(pg_temp.at(3, '10:00'), pg_temp.at(3, '13:00')));

-- ---------------------------------------------------------------------------
-- Who may call it
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.get_earnings(date, date)', 'EXECUTE'), 'anon cannot call get_earnings');
select ok(not has_function_privilege('public', 'public.get_earnings(date, date)', 'EXECUTE'), 'PUBLIC has no execute grant');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.get_earnings((select mon from fx), (select mon from fx) + 6) $$), 'forbidden',
  'a player is refused');

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.get_earnings((select mon from fx), (select mon from fx) - 1) $$), 'invalid_input',
  'an end before the start is refused');
select is(pg_temp.hint_of($$ select public.get_earnings((select mon from fx), (select mon from fx) + 366) $$), 'invalid_input',
  'more than 366 days is refused');
select is(pg_temp.hint_of($$ select public.get_earnings((select mon from fx), (select mon from fx) + 365) $$), null,
  '366 days is allowed');

-- The Monday–Sunday week.
create temp table e as select public.get_earnings((select mon from fx), (select mon from fx) + 6) as j;
create function pg_temp.court(p_id text) returns jsonb language sql as $$
  select c from e, jsonb_array_elements(e.j -> 'courts') c where c ->> 'court_id' = p_id
$$;
create function pg_temp.day(p_offset int) returns jsonb language sql as $$
  select d from e, jsonb_array_elements(e.j -> 'daily') d where (d ->> 'date')::date = (select mon from fx) + p_offset
$$;

-- ---------------------------------------------------------------------------
-- Money
-- ---------------------------------------------------------------------------
select is((select j -> 'collected' -> 'total' from e)::numeric, 1500::numeric,
  'collected: approved payments from Monday 00:00 to Sunday 23:59:59, nothing after');
select is((select j -> 'collected' -> 'count' from e)::int, 3, 'collected counts three payments');
select is(
  (select jsonb_agg(m order by m ->> 'method') from e, jsonb_array_elements(e.j -> 'collected' -> 'by_method') m),
  '[{"count": 1, "amount": 600, "method": "cash", "paid_with": null}, {"count": 1, "amount": 400, "method": "gcash", "paid_with": null}, {"count": 1, "amount": 500, "method": "paymongo", "paid_with": null}]'::jsonb,
  'collected per method (refunds due and rejected proofs left out)');
select is((select j -> 'refunds_due' from e), '{"count": 1, "total": 300}'::jsonb,
  'refunds due: the rejected PayMongo payment only, not the rejected proof');
select is(
  (select jsonb_build_object('from', j -> 'previous' -> 'from', 'to', j -> 'previous' -> 'to', 'total', j -> 'previous' -> 'total') from e),
  jsonb_build_object('from', (select mon from fx) - 7, 'to', (select mon from fx) - 1, 'total', 250),
  'the previous period is the week before, with its own payments');
select results_eq(
  $$ select (pg_temp.day(0) ->> 'collected')::numeric, (pg_temp.day(6) ->> 'collected')::numeric $$,
  $$ values (400::numeric, 600::numeric) $$,
  'each payment lands on its venue calendar date (Monday 00:00 on Monday, Sunday 23:59:59 on Sunday)');
select is((select jsonb_array_length(j -> 'daily') from e), 7, 'one daily entry per date');

-- ---------------------------------------------------------------------------
-- Hours, by operating day
-- ---------------------------------------------------------------------------
select is((pg_temp.court('c0000000-0000-0000-0000-0000000000a1') ->> 'open_hours')::numeric, 104::numeric,
  'open hours: six 16-hour days and an 8-hour overnight Saturday');
select is((pg_temp.court('c0000000-0000-0000-0000-0000000000a1') ->> 'sold_hours')::numeric, 3::numeric,
  'sold hours: confirmed bookings only (the pending hold and cancelled bookings are left out)');
select results_eq(
  $$ select (pg_temp.day(5) ->> 'sold_hours')::numeric, (pg_temp.day(6) ->> 'sold_hours')::numeric $$,
  $$ values (1::numeric, 0::numeric) $$,
  'the 1 AM booking counts toward Saturday, the operating day it belongs to, not Sunday');
select is((pg_temp.court('c0000000-0000-0000-0000-0000000000a1') ->> 'blackout_hours')::numeric, 8::numeric,
  'blackout hours: overlapping blackouts counted once (6) plus the all-courts one (2)');
select is((pg_temp.court('c0000000-0000-0000-0000-0000000000a2') ->> 'blackout_hours')::numeric, 4::numeric,
  'a blackout is clipped to opening hours (Friday 20–22 only) and the all-courts one applies to every court');
select results_eq(
  $$ select (c ->> 'open_play_hours')::numeric, (c ->> 'sold_hours')::numeric
     from (select pg_temp.court('c0000000-0000-0000-0000-0000000000a2') as c) x $$,
  $$ values (3::numeric, 0::numeric) $$,
  'open play hours are reported apart from sold hours');
select is(
  (select (s ->> 'sold_hours')::numeric from e, jsonb_array_elements(e.j -> 'sports') s where s ->> 'sport' = 'tennis'),
  (select sum((c ->> 'sold_hours')::numeric) from e, jsonb_array_elements(e.j -> 'courts') c where c ->> 'sport' = 'tennis'),
  'per-sport hours are the sum of that sport''s courts');

-- ---------------------------------------------------------------------------
-- Coming up
-- ---------------------------------------------------------------------------
select is(
  (select j -> 'coming_up' from e),
  jsonb_build_object('count', (select n from before) + 2, 'value', (select v from before) + 1300),
  'coming up: confirmed bookings that have not started (the two here), with their value');

select * from finish();
rollback;
