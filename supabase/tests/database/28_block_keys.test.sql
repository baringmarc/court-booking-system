-- T10.4: get_availability.block_key — one key per booking (an opaque hash), open play session (its id) or blackout
-- ('blackout:' || id, shared across courts for an all-courts blackout); none for free and past slots.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000000e1', 'Key Court 1', 'tennis', 300),
  ('c0000000-0000-0000-0000-0000000000e2', 'Key Court 2', 'tennis', 300);

-- Open around the clock, so today has slots that are already over; d is three days ahead.
update public.operating_hours set open_time = '00:00', close_time = '24:00', is_closed = false;
create temp table fx as select private.local_today() + 3 as d, private.local_today() as t;
grant select on fx to anon, authenticated;

create function pg_temp.at(p_day date, p_time time) returns timestamptz language sql as $$
  select (p_day + p_time) at time zone 'Asia/Manila'
$$;
grant execute on function pg_temp.at(date, time) to anon, authenticated;

-- Court 1 on day d: a two-hour booking (10–12), a live hold (12–13), an expired hold (13–14), a blackout
-- (15–17) and a second one overlapping its last hour (16–18), and an all-courts blackout (20–21).
-- Court 2 on day d: an open play session (10–12) and a booking (14–15). Today, 00–01 on court 1: a booking.
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status, expires_at) values
  ('b0000000-0000-0000-0000-0000000000e1', 'CB-KEYAA2', 'c0000000-0000-0000-0000-0000000000e1', 'Ana Two Hours',
   tstzrange(pg_temp.at((select d from fx), '10:00'), pg_temp.at((select d from fx), '12:00')), 600, 'confirmed', null),
  ('b0000000-0000-0000-0000-0000000000e2', 'CB-KEYAB3', 'c0000000-0000-0000-0000-0000000000e1', 'Ben Held',
   tstzrange(pg_temp.at((select d from fx), '12:00'), pg_temp.at((select d from fx), '13:00')), 300, 'pending_payment', now() + interval '20 minutes'),
  ('b0000000-0000-0000-0000-0000000000e3', 'CB-KEYAC4', 'c0000000-0000-0000-0000-0000000000e1', 'Eve Expired',
   tstzrange(pg_temp.at((select d from fx), '13:00'), pg_temp.at((select d from fx), '14:00')), 300, 'pending_payment', now() - interval '1 minute'),
  ('b0000000-0000-0000-0000-0000000000e4', 'CB-KEYAD5', 'c0000000-0000-0000-0000-0000000000e2', 'Cy Court Two',
   tstzrange(pg_temp.at((select d from fx), '14:00'), pg_temp.at((select d from fx), '15:00')), 300, 'confirmed', null),
  ('b0000000-0000-0000-0000-0000000000e5', 'CB-KEYAE6', 'c0000000-0000-0000-0000-0000000000e1', 'Mo Midnight',
   tstzrange(pg_temp.at(private.local_today(), '00:00'), pg_temp.at(private.local_today(), '01:00')), 300, 'confirmed', null);

insert into public.blackouts (id, court_id, starts_at, ends_at, reason) values
  ('d0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000e1',
   pg_temp.at((select d from fx), '15:00'), pg_temp.at((select d from fx), '17:00'), 'Repair'),
  ('d0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000e1',
   pg_temp.at((select d from fx), '16:00'), pg_temp.at((select d from fx), '18:00'), 'Overlapping repair'),
  ('d0000000-0000-0000-0000-0000000000a3', null,
   pg_temp.at((select d from fx), '20:00'), pg_temp.at((select d from fx), '21:00'), 'Venue event');

insert into public.open_play_sessions (id, title, starts_at, ends_at) values
  ('a0000000-0000-0000-0000-0000000000e1', 'Key open play', pg_temp.at((select d from fx), '10:00'), pg_temp.at((select d from fx), '12:00'));
insert into public.open_play_courts (session_id, court_id, during) values
  ('a0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-0000000000e2',
   tstzrange(pg_temp.at((select d from fx), '10:00'), pg_temp.at((select d from fx), '12:00')));

-- ---------------------------------------------------------------------------
-- Shape and grants (expand only: the earlier columns are unchanged)
-- ---------------------------------------------------------------------------
select is(
  pg_get_function_result('public.get_availability(date, uuid)'::regprocedure),
  'TABLE(court_id uuid, slot_start timestamp with time zone, slot_end timestamp with time zone, price numeric, status text, booker_first_name text, open_play_session_id uuid, block_key text)',
  'get_availability gains block_key after its earlier columns'
);
select ok(has_function_privilege('anon', 'public.get_availability(date, uuid)', 'EXECUTE'), 'anon can still call it');
select ok(not has_function_privilege('public', 'public.get_availability(date, uuid)', 'EXECUTE'), 'PUBLIC still has no execute grant');

-- ---------------------------------------------------------------------------
-- As anon, the way /book calls it
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

create temp view keys as
select court_id, extract(hour from slot_start at time zone 'Asia/Manila')::int as h, status, block_key
from public.get_availability((select d from fx))
where court_id in ('c0000000-0000-0000-0000-0000000000e1', 'c0000000-0000-0000-0000-0000000000e2');

create function pg_temp.key_at(p_court text, p_hour int) returns text language sql as $$
  select block_key from keys where court_id = ('c0000000-0000-0000-0000-0000000000' || p_court)::uuid and h = p_hour
$$;

-- Bookings
select results_eq(
  $$ select status, block_key is not null from keys where court_id = 'c0000000-0000-0000-0000-0000000000e1' and h in (10, 11) $$,
  $$ values ('booked', true), ('booked', true) $$,
  'both hours of a booking are booked and keyed');
select is(pg_temp.key_at('e1', 10), pg_temp.key_at('e1', 11), 'the same booking''s slots share one key');
select isnt(pg_temp.key_at('e1', 12), pg_temp.key_at('e1', 11), 'the next booking (a live hold) has a different key');
select isnt(pg_temp.key_at('e2', 14), pg_temp.key_at('e1', 10), 'a booking on another court has a different key');
select ok(pg_temp.key_at('e1', 10) ~ '^[0-9a-f]{16}$', 'a booking key is 16 hex characters');

reset role;
select ok(
  (select bool_and(
     k.block_key <> b.id::text
     and position(k.block_key in replace(b.id::text, '-', '')) = 0
     and position(k.block_key in b.reference_code) = 0)
   from public.get_availability((select d from fx)) k
   join public.bookings b on b.court_id = k.court_id and b.during @> k.slot_start
   where k.status = 'booked'),
  'no booking key is, or contains part of, the booking id or reference'
);
select is(
  pg_temp.key_at('e1', 10), left(encode(sha256(convert_to('booking:b0000000-0000-0000-0000-0000000000e1', 'UTF8')), 'hex'), 16),
  'the key is the sha256 of the booking id, cut to 16 characters'
);
set local role anon;

select results_eq(
  $$ select status, block_key from keys where court_id = 'c0000000-0000-0000-0000-0000000000e1' and h = 13 $$,
  $$ values ('free', null::text) $$,
  'an expired hold is free and unkeyed');

-- Open play and blackouts
select results_eq(
  $$ select status, block_key from keys where court_id = 'c0000000-0000-0000-0000-0000000000e2' and h in (10, 11) $$,
  $$ values ('open_play', 'a0000000-0000-0000-0000-0000000000e1'), ('open_play', 'a0000000-0000-0000-0000-0000000000e1') $$,
  'open play slots are keyed by their session id');
select results_eq(
  $$ select h, status, block_key from keys where court_id = 'c0000000-0000-0000-0000-0000000000e1' and h between 15 and 17 order by h $$,
  $$ values (15, 'blackout', 'blackout:d0000000-0000-0000-0000-0000000000a1'),
            (16, 'blackout', 'blackout:d0000000-0000-0000-0000-0000000000a1'),
            (17, 'blackout', 'blackout:d0000000-0000-0000-0000-0000000000a2') $$,
  'blackout slots are keyed by the blackout id, the lowest one where two overlap');
select results_eq(
  $$ select distinct status, block_key from keys where h = 20 $$,
  $$ values ('blackout', 'blackout:d0000000-0000-0000-0000-0000000000a3') $$,
  'an all-courts blackout gives every court the same key');

-- Free and past slots
select is(
  (select count(*)::int from keys where status = 'free' and block_key is not null), 0,
  'free slots have no key'
);
select cmp_ok((select count(*)::int from keys where status = 'free'), '>', 0, 'there are free slots to check (guards the test above)');
-- The booked 00–01 slot today is over only after 01:00 Manila; before that there's nothing to check, so skip.
select case
  when exists (select 1 from public.get_availability((select t from fx), 'c0000000-0000-0000-0000-0000000000e1')
               where status = 'past' and extract(hour from slot_start at time zone 'Asia/Manila') = 0)
  then is(
    (select count(*)::int from public.get_availability((select t from fx), 'c0000000-0000-0000-0000-0000000000e1')
     where status = 'past' and block_key is not null), 0,
    'past slots have no key, even where a booking was (today 00–01)')
  else skip('before 01:00 Manila no slot has ended yet', 1)
end;
select is(
  (select count(*)::int from keys where status in ('booked', 'open_play', 'blackout') and block_key is null), 0,
  'every booked, open play and blackout slot has a key'
);

select * from finish();
rollback;
