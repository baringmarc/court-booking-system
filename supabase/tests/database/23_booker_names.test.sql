-- T9.8: get_availability.booker_first_name — the first word of an active booking's contact name, nothing else.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000001', 'Names Court', 'tennis', 300);

create temp table fx as select private.local_today(private.default_venue_id()) + 3 as d, private.venue_tz(private.default_venue_id()) as tz;
grant select on fx to anon;

-- One booking per hour on Names Court, day d (Manila).
insert into public.bookings (reference_code, court_id, guest_name, guest_email, guest_phone, during, total_amount, status, expires_at, source)
select v.ref, 'c0000000-0000-0000-0000-000000000001', v.name, 'secret@example.com', '0917 555 0000',
       tstzrange((fx.d + v.s) at time zone fx.tz, (fx.d + v.s + interval '1 hour') at time zone fx.tz), 300,
       v.st::public.booking_status, v.exp, v.src::public.booking_source
from fx, (values
  ('CB-BKNAAA', 'Ana Maria Santos',               time '10:00', 'confirmed',         null::timestamptz,              'online'),
  ('CB-BKNAAB', '  Ben   Cruz ',                  time '11:00', 'pending_payment',   now() + interval '30 minutes', 'online'),
  ('CB-BKNAAC', 'Expired Hold',                   time '12:00', 'pending_payment',   now() - interval '1 minute',   'online'),
  ('CB-BKNAAD', 'Cancelled Person',               time '13:00', 'cancelled',         null::timestamptz,              'online'),
  ('CB-BKNAAE', 'Carla Walkin',                   time '14:00', 'confirmed',         null::timestamptz,              'walk_in'),
  ('CB-BKNAAF', 'Bartholomewwwwwwwwwwwwww Smith', time '15:00', 'payment_submitted', null::timestamptz,              'online'),
  ('CB-BKNAAG', 'Rejected Person',                time '19:00', 'rejected',          null::timestamptz,              'online')
) as v(ref, name, s, st, exp, src);

insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
select private.default_venue_id(), 'c0000000-0000-0000-0000-000000000001', (fx.d + time '17:00') at time zone fx.tz, (fx.d + time '18:00') at time zone fx.tz, 'test'
from fx;

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------
select is(
  pg_get_function_result('public.get_availability(date, uuid, text)'::regprocedure),
  'TABLE(court_id uuid, slot_start timestamp with time zone, slot_end timestamp with time zone, price numeric, status text, booker_first_name text, open_play_session_id uuid, block_key text)',
  'get_availability returns the slot columns plus booker_first_name, and no other personal field (block_key is an opaque hash, T10.4)'
);
select ok(has_function_privilege('anon', 'public.get_availability(date, uuid, text)', 'EXECUTE'), 'anon can still call get_availability');
select ok(has_function_privilege('authenticated', 'public.get_availability(date, uuid, text)', 'EXECUTE'), 'authenticated can still call it');
select ok(not has_function_privilege('public', 'public.get_availability(date, uuid, text)', 'EXECUTE'), 'PUBLIC has no execute grant');

-- ---------------------------------------------------------------------------
-- As anon, the way /book calls it
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

create temp view names as
select extract(hour from slot_start at time zone 'Asia/Manila')::int as h, status, booker_first_name
from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-000000000001');

select results_eq($$ select status, booker_first_name from names where h = 10 $$, $$ values ('booked', 'Ana') $$,
  'a confirmed booking shows only the first word of the name');
select results_eq($$ select status, booker_first_name from names where h = 11 $$, $$ values ('booked', 'Ben') $$,
  'a pending hold shows the trimmed first name');
select results_eq($$ select status, booker_first_name from names where h = 12 $$, $$ values ('free', null::text) $$,
  'an expired hold shows no name (the slot is free)');
select results_eq($$ select status, booker_first_name from names where h = 13 $$, $$ values ('free', null::text) $$,
  'a cancelled booking shows no name');
select results_eq($$ select status, booker_first_name from names where h = 14 $$, $$ values ('booked', 'Carla') $$,
  'a walk-in shows its first name too');
select results_eq($$ select status, booker_first_name from names where h = 15 $$, $$ values ('booked', 'Bartholomewwwwwwwwww') $$,
  'a long first word is cut to 20 characters');
select results_eq($$ select status, booker_first_name from names where h = 17 $$, $$ values ('blackout', null::text) $$,
  'a blackout shows no name');
select results_eq($$ select status, booker_first_name from names where h = 18 $$, $$ values ('free', null::text) $$,
  'a free slot shows no name');
select results_eq($$ select status, booker_first_name from names where h = 19 $$, $$ values ('free', null::text) $$,
  'a rejected booking shows no name');
select is(
  (select count(*)::int from names where booker_first_name ~ '(@|Santos|Cruz|Smith|0917|CB-)'), 0,
  'no email, surname, phone or reference ever appears'
);
select is((select count(*)::int from names), 16, 'still one row per hour of the day (06:00–22:00)');

-- Every other column is unchanged (same as status/price before T9.8).
reset role;
select ok(
  (select bool_and(price = private.slot_price('c0000000-0000-0000-0000-000000000001', slot_start))
   from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-000000000001')),
  'prices are unchanged'
);

select * from finish();
rollback;
