-- T12.5: RPC rewrite, booking path. The venue always comes from the row an RPC touches, never from the client.
--   * private overloads take the venue first: venue_tz, local_today, operating_today, operating_day_of,
--     operating_day_range, in_booking_window (the old ones stay)
--   * private.resolve_public_venue(slug): venue_not_found / venue_unavailable / venue_required
--   * create_booking, cancel_booking, review_payment, get_availability, get_guest_booking, issue_guest_link
-- Fixture: venue A (Asia/Manila, 06-22, hold 60, cutoff 1h, max rejections 3, window 30, no waiver, "PAY A"),
-- venue B (Pacific/Honolulu, 09-12, hold 15, cutoff 48h, max rejections 2, window 5, waiver, "PAY B"),
-- C draft, D suspended, E closed. Claudex Courts (the migration's venue) stays active throughout.
-- Honolulu is UTC-10: 10:00 there is 04:00 the next day in Manila, so any code that reads the wrong venue's
-- timezone or hours gives the wrong answer.
begin;
create extension if not exists pgtap with schema extensions;
select plan(127);

-- ---------------------------------------------------------------- helpers
-- The HINT raised by a statement, or null when it succeeds.
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

-- The single value of a query as text ('<null>' for null, 'ERR <hint or message>' when it raises), so one missing
-- function fails one test instead of aborting the whole transaction.
create function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare r text; h text;
begin
  execute p_sql into r;
  return coalesce(r, '<null>');
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || coalesce(nullif(h, ''), sqlerrm);
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player-p1@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'staff-a@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'staff-b@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'platform@test.local');

insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'e2e-vbr-a', 'draft'),
  ('b0000000-0000-0000-0000-00000000000b', 'e2e-vbr-b', 'draft'),
  ('c0000000-0000-0000-0000-00000000000c', 'e2e-vbr-c', 'draft'),
  ('d0000000-0000-0000-0000-00000000000d', 'e2e-vbr-d', 'suspended'),
  ('e0000000-0000-0000-0000-00000000000e', 'e2e-vbr-e', 'closed');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', '77777777-7777-7777-7777-777777777777', 'staff');
insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');

insert into public.venue_settings (venue_id, name, timezone, payment_hold_minutes, cancel_cutoff_hours, max_rejections,
                                   booking_window_days, payment_instructions, waiver_text, sport_order) values
  ('a0000000-0000-0000-0000-00000000000a', 'E2E VBR A', 'Asia/Manila', 60, 1, 3, 30, 'PAY A', '',
   array['tennis', 'basketball', 'pickleball', 'badminton']::public.sport[]),
  ('b0000000-0000-0000-0000-00000000000b', 'E2E VBR B', 'Pacific/Honolulu', 15, 48, 2, 5, 'PAY B', 'B waiver',
   enum_range(null::public.sport));
insert into public.venue_settings (venue_id, name) values
  ('c0000000-0000-0000-0000-00000000000c', 'E2E VBR C'),
  ('d0000000-0000-0000-0000-00000000000d', 'E2E VBR D'),
  ('e0000000-0000-0000-0000-00000000000e', 'E2E VBR E');

insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v, d, case when v = 'b0000000-0000-0000-0000-00000000000b' then time '09:00' else time '06:00' end,
             case when v = 'b0000000-0000-0000-0000-00000000000b' then time '12:00' else time '22:00' end
from unnest(array['a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b',
                  'c0000000-0000-0000-0000-00000000000c', 'd0000000-0000-0000-0000-00000000000d',
                  'e0000000-0000-0000-0000-00000000000e']::uuid[]) v,
     generate_series(0, 6) d;

insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'E2E VBR A1', 'tennis', 500, true),
  ('c0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-00000000000a', 'E2E VBR A3', 'badminton', 500, true),
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E VBR B1', 'tennis', 600, true),
  ('c0000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-00000000000b', 'E2E VBR B3', 'badminton', 600, true),
  ('c0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-00000000000c', 'E2E VBR C1', 'tennis', 700, true),
  ('c0000000-0000-0000-0000-0000000000d1', 'd0000000-0000-0000-0000-00000000000d', 'E2E VBR D1', 'tennis', 700, true),
  ('c0000000-0000-0000-0000-0000000000e1', 'e0000000-0000-0000-0000-00000000000e', 'E2E VBR E1', 'tennis', 700, true);

-- Instants in each venue's own clock. Computed without the code under test.
create temp table fx as
with d as (select (now() at time zone 'Asia/Manila')::date as ma, (now() at time zone 'Pacific/Honolulu')::date as hn)
select ma, hn,
  ma + 2 as da, hn + 2 as db, ma + 6 as da6, hn + 5 as db5, hn + 6 as db6,
  ((ma + 2) + time '04:00') at time zone 'Asia/Manila' as ta04,
  ((ma + 2) + time '06:00') at time zone 'Asia/Manila' as ta06,
  ((ma + 2) + time '10:00') at time zone 'Asia/Manila' as ta10,
  ((ma + 2) + time '21:00') at time zone 'Asia/Manila' as ta21,
  ((ma + 2) + time '22:00') at time zone 'Asia/Manila' as ta22,
  ((ma + 6) + time '10:00') at time zone 'Asia/Manila' as ta6,
  ((hn + 2) + time '09:00') at time zone 'Pacific/Honolulu' as tb09,
  ((hn + 2) + time '10:00') at time zone 'Pacific/Honolulu' as tb10,
  ((hn + 2) + time '11:00') at time zone 'Pacific/Honolulu' as tb11,
  ((hn + 2) + time '12:00') at time zone 'Pacific/Honolulu' as tb12,
  ((hn + 2) + time '13:00') at time zone 'Pacific/Honolulu' as tb13,
  ((hn + 5) + time '10:00') at time zone 'Pacific/Honolulu' as tb5,
  ((hn + 6) + time '10:00') at time zone 'Pacific/Honolulu' as tb6
from d;
create temp table results (label text primary key, id uuid, ref text, token text);
create temp table b (label text primary key, id uuid, ref text);
grant select on fx to anon, authenticated, service_role;
grant select, insert on results to anon, authenticated, service_role;
grant select on b to anon, authenticated, service_role;

-- blackouts and open play: B's venue-wide blackout covers A's 10:00 slot, A's venue-wide blackout covers B's 11:00
-- slot, B3 is blacked out at 09:00, and B1 has open play at 11:00
insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
select 'b0000000-0000-0000-0000-00000000000b', null, ta10, ta10 + interval '1 hour', 'E2E B wide' from fx;
insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
select 'a0000000-0000-0000-0000-00000000000a', null, tb11, tb11 + interval '1 hour', 'E2E A wide' from fx;
insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
select 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b3', tb09, tb09 + interval '1 hour', 'E2E B3' from fx;
insert into public.open_play_sessions (id, venue_id, title, starts_at, ends_at)
select 'e1000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E Open Play B', tb11, tb12 from fx;
insert into public.open_play_courts (session_id, court_id, during)
select 'e1000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', tstzrange(tb11, tb12) from fx;

-- ---------------------------------------------------------------- resolve_public_venue, before A and B are active
-- (only Claudex Courts is active here)
select is(pg_temp.hint_of($$ select private.resolve_public_venue(null) $$), 'venue_required',
  'resolve: no slug is venue_required even while Claudex Courts is the only active venue (T13.5)');
select is(pg_temp.val($$ select private.resolve_public_venue('claudex-courts') $$),
  (select id::text from public.venues where slug = 'claudex-courts'),
  'resolve: an explicit active slug resolves to its venue id');
select is(pg_temp.hint_of($$ select private.resolve_public_venue('e2e-vbr-a') $$), 'venue_unavailable',
  'resolve: a draft venue is venue_unavailable');
select is(pg_temp.hint_of($$ select private.resolve_public_venue('e2e-vbr-c') $$), 'venue_unavailable',
  'resolve: another draft venue is venue_unavailable');
select is(pg_temp.hint_of($$ select private.resolve_public_venue('e2e-vbr-d') $$), 'venue_unavailable',
  'resolve: a suspended venue is venue_unavailable');
select is(pg_temp.hint_of($$ select private.resolve_public_venue('e2e-vbr-e') $$), 'venue_unavailable',
  'resolve: a closed venue is venue_unavailable');
select is(pg_temp.hint_of($$ select private.resolve_public_venue('e2e-vbr-nope') $$), 'venue_not_found',
  'resolve: an unknown slug is venue_not_found');
select throws_ok($$ select private.resolve_public_venue('e2e-vbr-nope') $$, 'P0001', null,
  'resolve: refusals are P0001');

update public.venues set status = 'active'
where id in ('a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b');

select is(pg_temp.val($$ select private.resolve_public_venue('e2e-vbr-a') $$), 'a0000000-0000-0000-0000-00000000000a',
  'resolve: venue A by slug');
select is(pg_temp.val($$ select private.resolve_public_venue('e2e-vbr-b') $$), 'b0000000-0000-0000-0000-00000000000b',
  'resolve: venue B by slug');
select is(pg_temp.hint_of($$ select private.resolve_public_venue(null) $$), 'venue_required',
  'resolve: no slug is still venue_required with several venues active');
select is(pg_temp.val($$ select private.resolve_public_venue('claudex-courts') $$),
  (select id::text from public.venues where slug = 'claudex-courts'),
  'resolve: naming Claudex Courts still works with several venues active');
select is(pg_temp.hint_of($$ select private.resolve_public_venue('e2e-vbr-c') $$), 'venue_unavailable',
  'resolve: a draft venue stays unavailable next to active ones');

-- ---------------------------------------------------------------- private overloads (venue first)
select hasnt_function('private', 'venue_tz', array[]::name[], 'the zero-argument venue_tz is dropped (T12.11)');
select hasnt_function('private', 'local_today', array[]::name[], 'the zero-argument local_today is dropped (T12.11)');
select hasnt_function('private', 'operating_today', array[]::name[], 'the zero-argument operating_today is dropped (T12.11)');
select hasnt_function('private', 'operating_day_of', array['timestamp with time zone'], 'operating_day_of(timestamptz) is dropped (T12.11)');
select hasnt_function('private', 'operating_day_range', array['date'], 'operating_day_range(date) is dropped (T12.11)');
select hasnt_function('private', 'in_booking_window', array['date'], 'in_booking_window(date) is dropped (T12.11)');

select is(pg_temp.val($$ select private.venue_tz('a0000000-0000-0000-0000-00000000000a') $$), 'Asia/Manila', 'venue_tz(A)');
select is(pg_temp.val($$ select private.venue_tz('b0000000-0000-0000-0000-00000000000b') $$), 'Pacific/Honolulu', 'venue_tz(B)');
select is(pg_temp.val($$ select private.local_today('a0000000-0000-0000-0000-00000000000a') $$), (select ma::text from fx),
  'local_today(A) is the date in Manila');
select is(pg_temp.val($$ select private.local_today('b0000000-0000-0000-0000-00000000000b') $$), (select hn::text from fx),
  'local_today(B) is the date in Honolulu');
select is(pg_temp.val($$ select private.operating_today('a0000000-0000-0000-0000-00000000000a') $$), (select ma::text from fx),
  'operating_today(A) is the operating day in Manila');
select is(pg_temp.val($$ select private.operating_today('b0000000-0000-0000-0000-00000000000b') $$), (select hn::text from fx),
  'operating_today(B) is the operating day in Honolulu');

-- 20:00 UTC on 2 March is 10:00 in Honolulu (open) and 04:00 on 3 March in Manila (before 06:00, closed)
select is(pg_temp.val($$ select private.operating_day_of('b0000000-0000-0000-0000-00000000000b', '2026-03-02 20:00+00') $$), '2026-03-02',
  'operating_day_of(B): 10:00 Honolulu belongs to that day');
select is(pg_temp.val($$ select private.operating_day_of('a0000000-0000-0000-0000-00000000000a', '2026-03-02 20:00+00') $$), '<null>',
  'operating_day_of(A): the same instant is 04:00 in Manila, closed (early morning)');
select is(pg_temp.val($$ select private.operating_day_of('a0000000-0000-0000-0000-00000000000a', '2026-03-02 15:30+00') $$), '<null>',
  'operating_day_of(A): 23:30 in Manila is after closing (late night)');
select is(pg_temp.val($$ select private.operating_day_of('a0000000-0000-0000-0000-00000000000a', '2026-03-01 22:30+00') $$), '2026-03-02',
  'operating_day_of(A): 06:30 on 2 March in Manila is the 2 March day (UTC is still 1 March)');
select is(pg_temp.val($$ select private.operating_day_of('b0000000-0000-0000-0000-00000000000b', '2026-03-03 06:30+00') $$), '<null>',
  'operating_day_of(B): 20:30 on 2 March in Honolulu is closed');
select is(pg_temp.val($$ select private.operating_day_of('b0000000-0000-0000-0000-00000000000b', '2026-03-02 19:00+00') $$), '2026-03-02',
  'operating_day_of(B): opening time 09:00 is inside');
select is(pg_temp.val($$ select private.operating_day_of('b0000000-0000-0000-0000-00000000000b', '2026-03-02 22:00+00') $$), '<null>',
  'operating_day_of(B): closing time 12:00 is outside');
select is(pg_temp.val($$ select private.operating_day_range('b0000000-0000-0000-0000-00000000000b', '2026-03-02') $$),
  (select tstzrange('2026-03-02 19:00+00', '2026-03-02 22:00+00')::text),
  'operating_day_range(B): 09:00-12:00 Honolulu');
select is(pg_temp.val($$ select private.operating_day_range('a0000000-0000-0000-0000-00000000000a', '2026-03-02') $$),
  (select tstzrange('2026-03-01 22:00+00', '2026-03-02 14:00+00')::text),
  'operating_day_range(A): 06:00-22:00 Manila');

select is(pg_temp.val($$ select private.in_booking_window('b0000000-0000-0000-0000-00000000000b', (select hn + 5 from fx)) $$), 'true',
  'in_booking_window(B): the 5th day ahead is inside B''s 5-day window');
select is(pg_temp.val($$ select private.in_booking_window('b0000000-0000-0000-0000-00000000000b', (select hn + 6 from fx)) $$), 'false',
  'in_booking_window(B): the 6th day ahead is outside');
select is(pg_temp.val($$ select private.in_booking_window('b0000000-0000-0000-0000-00000000000b', (select hn - 1 from fx)) $$), 'false',
  'in_booking_window(B): yesterday is outside');
select is(pg_temp.val($$ select private.in_booking_window('a0000000-0000-0000-0000-00000000000a', (select ma + 30 from fx)) $$), 'true',
  'in_booking_window(A): the 30th day ahead is inside A''s 30-day window');
select is(pg_temp.val($$ select private.in_booking_window('a0000000-0000-0000-0000-00000000000a', (select ma + 31 from fx)) $$), 'false',
  'in_booking_window(A): the 31st day ahead is outside');

-- ---------------------------------------------------------------- get_availability (anon)
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(pg_temp.val($$ select count(*) || '/' || count(*) filter (where court_id in ('c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a3'))
  from public.get_availability((select da from fx), null, 'e2e-vbr-a') $$), '32/32',
  'availability A: 16 slots on each of A''s two courts, none of B''s');
select is(pg_temp.val($$ select count(*) || '/' || count(*) filter (where court_id in ('c0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b3'))
  from public.get_availability((select db from fx), null, 'e2e-vbr-b') $$), '6/6',
  'availability B: 3 slots (09-12) on each of B''s two courts, none of A''s');
select is(pg_temp.val($$ select (min(slot_start) = (select tb09 from fx) and max(slot_start) = (select tb11 from fx))::text
  from public.get_availability((select db from fx), null, 'e2e-vbr-b') $$), 'true',
  'availability B: slots run 09:00-11:00 Honolulu time');
select is(pg_temp.val($$ select (min(slot_start) = (select ta06 from fx) and max(slot_start) = (select ta21 from fx))::text
  from public.get_availability((select da from fx), null, 'e2e-vbr-a') $$), 'true',
  'availability A: slots run 06:00-21:00 Manila time');
select is(pg_temp.val($$ select count(*) from public.get_availability((select db5 from fx), null, 'e2e-vbr-b') $$), '6',
  'availability B: the last day of the 5-day window is listed');
select is(pg_temp.val($$ select count(*) from public.get_availability((select db6 from fx), null, 'e2e-vbr-b') $$), '0',
  'availability B: the day after B''s window is empty');
select is(pg_temp.val($$ select count(*) from public.get_availability((select da6 from fx), null, 'e2e-vbr-a') $$), '32',
  'availability A: day 6 is inside A''s 30-day window');
select is(pg_temp.val($$ select count(*) from public.get_availability((select db from fx), 'c0000000-0000-0000-0000-0000000000b1', 'e2e-vbr-a') $$), '3',
  'availability: a court id picks the venue from the court (the slug is ignored)');
select is(pg_temp.val($$ select count(*) from public.get_availability((select db from fx), 'c0000000-0000-0000-0000-0000000000b1') $$), '3',
  'availability: a court id alone is enough even with several venues active');
select is(pg_temp.hint_of($$ select * from public.get_availability((select da from fx)) $$), 'venue_required',
  'availability: no court and no slug is venue_required (T13.5)');
select is(pg_temp.hint_of($$ select * from public.get_availability((select da from fx), null) $$), 'venue_required',
  'availability: a null court and no slug is venue_required too');
select is(pg_temp.hint_of($$ select * from public.get_availability((select da from fx), 'c0000000-0000-0000-0000-0000000000a1') $$), null,
  'availability: the old two-argument call with a court still works');
select is(pg_temp.hint_of($$ select * from public.get_availability((select da from fx), null, 'e2e-vbr-c') $$), 'venue_unavailable',
  'availability: a draft venue is venue_unavailable');
select is(pg_temp.hint_of($$ select * from public.get_availability((select da from fx), null, 'e2e-vbr-d') $$), 'venue_unavailable',
  'availability: a suspended venue is venue_unavailable');
select is(pg_temp.hint_of($$ select * from public.get_availability((select da from fx), null, 'e2e-vbr-e') $$), 'venue_unavailable',
  'availability: a closed venue is venue_unavailable');
select is(pg_temp.hint_of($$ select * from public.get_availability((select da from fx), null, 'e2e-vbr-nope') $$), 'venue_not_found',
  'availability: an unknown slug is venue_not_found');
select is(pg_temp.hint_of($$ select * from public.get_availability((select da from fx), 'c0000000-0000-0000-0000-0000000000c1', 'e2e-vbr-a') $$), 'venue_unavailable',
  'availability: a draft venue''s court is venue_unavailable even with an active slug');
select is(pg_temp.hint_of($$ select * from public.get_availability((select da from fx), 'c0000000-0000-0000-0000-0000000000d1') $$), 'venue_unavailable',
  'availability: a suspended venue''s court is venue_unavailable');
select is(pg_temp.val($$ select t.cid::text from public.get_availability((select da from fx), null, 'e2e-vbr-a')
  with ordinality as t(cid, ss, se, pr, st, bn, os, n) order by n limit 1 $$), 'c0000000-0000-0000-0000-0000000000a1',
  'availability A: A''s own sport_order puts tennis first');
select is(pg_temp.val($$ select t.cid::text from public.get_availability((select db from fx), null, 'e2e-vbr-b')
  with ordinality as t(cid, ss, se, pr, st, bn, os, n) order by n limit 1 $$), 'c0000000-0000-0000-0000-0000000000b3',
  'availability B: B''s sport_order (the default) puts badminton first');
select is(pg_temp.val($$ select status from public.get_availability((select da from fx), null, 'e2e-vbr-a')
  where court_id = 'c0000000-0000-0000-0000-0000000000a1' and slot_start = (select ta10 from fx) $$), 'free',
  'availability A: B''s venue-wide blackout does not block A''s slot');
select is(pg_temp.val($$ select status from public.get_availability((select db from fx), null, 'e2e-vbr-b')
  where court_id = 'c0000000-0000-0000-0000-0000000000b3' and slot_start = (select tb11 from fx) $$), 'free',
  'availability B: A''s venue-wide blackout does not block B''s slot');
select is(pg_temp.val($$ select status from public.get_availability((select db from fx), null, 'e2e-vbr-b')
  where court_id = 'c0000000-0000-0000-0000-0000000000b3' and slot_start = (select tb09 from fx) $$), 'blackout',
  'availability B: B''s own court blackout shows');
select is(pg_temp.val($$ select status || '/' || open_play_session_id from public.get_availability((select db from fx), null, 'e2e-vbr-b')
  where court_id = 'c0000000-0000-0000-0000-0000000000b1' and slot_start = (select tb11 from fx) $$),
  'open_play/e1000000-0000-0000-0000-0000000000b1',
  'availability B: B''s open play session shows with its id');
select is(pg_temp.val($$ select count(*) from public.get_availability((select da from fx), null, 'e2e-vbr-a') where status in ('open_play', 'blackout') $$), '0',
  'availability A: none of B''s open play or blackouts leak in');

-- ---------------------------------------------------------------- create_booking
reset role;
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_booking'), 1::bigint,
  'create_booking has one signature, so there is no client-supplied venue argument');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(pg_temp.hint_of($$ insert into results select 'a', r.id, r.reference_code, r.guest_token
  from fx, public.create_booking('c0000000-0000-0000-0000-0000000000a1', fx.ta10, 1, 'Gina Guest', 'gina@example.com', '0917 222 2222') r $$), null,
  'A: a guest books 10:00 Manila time with no waiver (A has none)');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000b1', fx.tb10, 1, 'Gina Guest', 'gina@example.com', '0917 222 2222') $$),
  'waiver_required', 'B: B''s waiver is required');
select is(pg_temp.hint_of($$ insert into results select 'b', r.id, r.reference_code, r.guest_token
  from fx, public.create_booking('c0000000-0000-0000-0000-0000000000b1', fx.tb10, 1, 'Gina Guest', 'gina@example.com', '0917 222 2222', true) r $$), null,
  'B: a guest books 10:00 Honolulu time once the waiver is accepted (04:00 Manila would be closed)');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000b1', fx.tb09, 1, 'Gina Guest', 'gina@example.com', null, true) $$), null,
  'B: the opening slot 09:00 Honolulu is bookable');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000b1', fx.tb12, 1, 'Gina Guest', 'gina@example.com', null, true) $$),
  'outside_hours', 'B: 12:00 Honolulu is at closing time, outside B''s hours');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000b1', fx.tb13, 1, 'Gina Guest', 'gina@example.com', null, true) $$),
  'outside_hours', 'B: 13:00 Honolulu is outside B''s hours (07:00 Manila would be open)');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000b1', fx.tb5, 1, 'Gina Guest', 'gina@example.com', null, true) $$), null,
  'B: the 5th day ahead is inside B''s window');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000b1', fx.tb6, 1, 'Gina Guest', 'gina@example.com', null, true) $$),
  'outside_window', 'B: the 6th day ahead is outside B''s 5-day window');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000a1', fx.ta6, 1, 'Gina Guest', 'gina@example.com', null) $$), null,
  'A: the 6th day ahead is inside A''s 30-day window');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000a1', fx.ta04, 1, 'Gina Guest', 'gina@example.com', null) $$),
  'outside_hours', 'A: 04:00 Manila is before A''s opening (early morning)');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000a1', fx.ta22, 1, 'Gina Guest', 'gina@example.com', null) $$),
  'outside_hours', 'A: 22:00 Manila is at A''s closing (late night)');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000a1', fx.tb10, 1, 'Gina Guest', 'gina@example.com', null) $$),
  'outside_hours', 'A: B''s 10:00 slot is 04:00 in Manila, so A''s court is closed then');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000c1', fx.ta10, 1, 'Gina Guest', 'gina@example.com', null) $$),
  'venue_unavailable', 'a draft venue refuses a guest booking');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000d1', fx.ta10, 1, 'Gina Guest', 'gina@example.com', null) $$),
  'venue_unavailable', 'a suspended venue refuses a guest booking');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000e1', fx.ta10, 1, 'Gina Guest', 'gina@example.com', null) $$),
  'venue_unavailable', 'a closed venue refuses a guest booking');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000c1', fx.ta10, 1) $$),
  'venue_unavailable', 'a draft venue refuses a signed-in player too');
select is(pg_temp.hint_of($$ select * from fx, public.create_booking('c0000000-0000-0000-0000-0000000000d1', fx.ta10, 1) $$),
  'venue_unavailable', 'a suspended venue refuses a signed-in player too');

reset role;
select is((select venue_id::text from public.bookings where id = (select id from results where label = 'a')),
  'a0000000-0000-0000-0000-00000000000a', 'A: the booking carries court A''s venue_id');
select is((select venue_id::text from public.bookings where id = (select id from results where label = 'b')),
  'b0000000-0000-0000-0000-00000000000b', 'B: the booking carries court B''s venue_id');
select is((select (expires_at = now() + interval '60 minutes')::text from public.bookings where id = (select id from results where label = 'a')),
  'true', 'A: the hold is A''s 60 minutes');
select is((select (expires_at = now() + interval '15 minutes')::text from public.bookings where id = (select id from results where label = 'b')),
  'true', 'B: the hold is B''s 15 minutes');
select is((select coalesce(waiver_text, '<null>') from public.bookings where id = (select id from results where label = 'a')),
  '<null>', 'A: no waiver copy is kept');
select is((select coalesce(waiver_text, '<null>') from public.bookings where id = (select id from results where label = 'b')),
  'B waiver', 'B: the booking keeps B''s waiver text');
select is((select total_amount::int::text from public.bookings where id = (select id from results where label = 'a')), '500',
  'A: priced from court A');
select is((select total_amount::int::text from public.bookings where id = (select id from results where label = 'b')), '600',
  'B: priced from court B');

-- ---------------------------------------------------------------- get_guest_booking and issue_guest_link
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.val($$ select string_agg(payment_instructions, ',') from public.get_guest_booking(
  (select ref from results where label = 'a'), (select token from results where label = 'a')) $$), 'PAY A',
  'guest booking A shows venue A''s payment instructions, once');
select is(pg_temp.val($$ select string_agg(payment_instructions, ',') from public.get_guest_booking(
  (select ref from results where label = 'b'), (select token from results where label = 'b')) $$), 'PAY B',
  'guest booking B shows venue B''s payment instructions, once');

reset role;
set local role service_role;
select is(pg_temp.hint_of($$ insert into results select 'b_link', null::uuid, null, public.issue_guest_link(id) from results where label = 'b' $$), null,
  'issue_guest_link works for a venue B guest booking');
select is(pg_temp.hint_of($$ insert into results select 'a_link', null::uuid, null, public.issue_guest_link(id) from results where label = 'a' $$), null,
  'issue_guest_link works for a venue A guest booking');
select is(pg_temp.hint_of($$ select public.issue_guest_link('00000000-0000-0000-0000-000000000000') $$), 'not_found',
  'issue_guest_link: an unknown booking is not_found');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.val($$ select string_agg(payment_instructions, ',') from public.get_guest_booking(
  (select ref from results where label = 'b'), (select token from results where label = 'b_link')) $$), 'PAY B',
  'the reissued link for B shows B''s instructions');
select is(pg_temp.val($$ select string_agg(payment_instructions, ',') from public.get_guest_booking(
  (select ref from results where label = 'a'), (select token from results where label = 'a_link')) $$), 'PAY A',
  'the reissued link for A shows A''s instructions');
select is(pg_temp.hint_of($$ select count(*) from public.get_guest_booking(
  (select ref from results where label = 'a'), (select token from results where label = 'b_link')) $$), 'not_found',
  'a venue B token does not open a venue A booking');

-- ---------------------------------------------------------------- cancel_booking
reset role;
create function pg_temp.mk(p_label text, p_court uuid, p_user uuid, p_status public.booking_status, p_from timestamptz,
                           p_token text default null, p_rej smallint default 0) returns void language plpgsql as $$
declare
  v_ref text := 'CB-' || translate(upper(substr(md5(p_label), 1, 6)), '01', '23');
  v_id  uuid;
begin
  insert into public.bookings (reference_code, court_id, user_id, guest_name, guest_email, during, total_amount,
                               status, source, guest_token_hash, rejection_count)
  values (v_ref, p_court, p_user, 'Test ' || p_label, 'guest@test.local', tstzrange(p_from, p_from + interval '1 hour'), 500,
          p_status, 'online', case when p_token is null then null else sha256(convert_to(p_token, 'UTF8')) end, p_rej)
  returning id into v_id;
  insert into b values (p_label, v_id, v_ref);
end $$;

select pg_temp.mk('cA_own_ok',   'c0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'confirmed', now() + interval '2 hours');
select pg_temp.mk('cA_sb_own',   'c0000000-0000-0000-0000-0000000000a3', '77777777-7777-7777-7777-777777777777', 'confirmed', now() + interval '4 hours');
select pg_temp.mk('cA_guest',    'c0000000-0000-0000-0000-0000000000a3', null, 'confirmed', now() + interval '10 hours', 'tok-a');
select pg_temp.mk('cA_sa',       'c0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'confirmed', now() + interval '5 days');
select pg_temp.mk('cA_noreason', 'c0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'confirmed', now() + interval '6 days');
select pg_temp.mk('cA_sbadmin',  'c0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'confirmed', now() + interval '7 days');
select pg_temp.mk('cA_pa',       'c0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'confirmed', now() + interval '8 days');
select pg_temp.mk('cB_own_late', 'c0000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'confirmed', now() + interval '2 hours');
select pg_temp.mk('cB_own_ok',   'c0000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'confirmed', now() + interval '60 hours');
select pg_temp.mk('cB_guest',    'c0000000-0000-0000-0000-0000000000b3', null, 'confirmed', now() + interval '10 hours', 'tok-b');
select pg_temp.mk('cB_sa',       'c0000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'confirmed', now() + interval '5 days');
select pg_temp.mk('cB_sb',       'c0000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'confirmed', now() + interval '10 minutes');
select pg_temp.mk('cB_pa',       'c0000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'confirmed', now() + interval '6 days');

-- player P1: A's cutoff is 1 hour, B's is 48 hours
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.val($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cA_own_ok'))::text $$), 'cancelled',
  'A: a player cancels 2 hours ahead (A''s cutoff is 1 hour)');
select is(pg_temp.hint_of($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cB_own_late')) $$), 'cutoff_passed',
  'B: the same 2 hours ahead is past B''s 48-hour cutoff');
select is(pg_temp.val($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cB_own_ok'))::text $$), 'cancelled',
  'B: a player cancels 60 hours ahead (past B''s 48-hour cutoff)');

-- staff B: a normal player at venue A, an admin at venue B
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cA_sbadmin'), p_reason => 'Not mine') $$), 'not_found',
  'staff of B cannot cancel a venue A booking (treated as a normal player)');
select is(pg_temp.val($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cA_sb_own'))::text $$), 'cancelled',
  'staff of B cancel their own venue A booking as a player, without a reason');
select is(pg_temp.val($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cB_sb'), p_reason => 'Court flooded')::text $$), 'cancelled',
  'staff of B cancel a venue B booking 10 minutes before it starts (admins skip the cutoff)');

-- staff A
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cB_sa'), p_reason => 'Not mine') $$), 'not_found',
  'staff of A cannot cancel a venue B booking');
select is(pg_temp.hint_of($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cA_noreason')) $$), 'reason_required',
  'staff of A must give a reason on a venue A booking');
select is(pg_temp.val($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cA_sa'), p_reason => 'Court closed')::text $$), 'cancelled',
  'staff of A cancel a venue A booking they do not own');

-- platform admin
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(pg_temp.val($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cA_pa'), p_reason => 'Platform')::text $$), 'cancelled',
  'a platform admin cancels a venue A booking');
select is(pg_temp.val($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'cB_pa'), p_reason => 'Platform')::text $$), 'cancelled',
  'a platform admin cancels a venue B booking');

-- guests with a token: the cutoff is the booking's venue's
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select public.cancel_booking(p_reference_code => (select ref from b where label = 'cB_guest'), p_token => 'tok-b') $$), 'cutoff_passed',
  'B: a guest 10 hours ahead is inside B''s 48-hour cutoff');
select is(pg_temp.val($$ select public.cancel_booking(p_reference_code => (select ref from b where label = 'cA_guest'), p_token => 'tok-a')::text $$), 'cancelled',
  'A: a guest 10 hours ahead is outside A''s 1-hour cutoff');

reset role;
select is((select cancelled_by_venue::text from public.bookings where id = (select id from b where label = 'cA_sa')), 'true',
  'a venue admin''s cancellation is marked as by the venue');
select is((select cancelled_by_venue::text from public.bookings where id = (select id from b where label = 'cA_sb_own')), 'false',
  'staff of B cancelling their own venue A booking is not marked as by the venue');
select is((select status::text from public.bookings where id = (select id from b where label = 'cB_sa')), 'confirmed',
  'the refused cross-venue cancellation left the booking confirmed');

-- ---------------------------------------------------------------- review_payment
select pg_temp.mk('rA1', 'c0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'payment_submitted', now() + interval '11 days');
select pg_temp.mk('rA2', 'c0000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'payment_submitted', now() + interval '12 days', null, 1::smallint);
select pg_temp.mk('rB1', 'c0000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'payment_submitted', now() + interval '11 days');
select pg_temp.mk('rB2', 'c0000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'payment_submitted', now() + interval '12 days', null, 1::smallint);
select pg_temp.mk('rB3', 'c0000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'payment_submitted', now() + interval '13 days');
select pg_temp.mk('rB4', 'c0000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'payment_submitted', now() + interval '14 days');
insert into public.payments (booking_id, method, amount)
select id, 'gcash', 500 from b where label in ('rA1', 'rA2', 'rB1', 'rB2', 'rB3', 'rB4');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.review_payment((select id from b where label = 'rA1'), true) $$), 'forbidden',
  'staff of B cannot approve a venue A payment');
select is(pg_temp.hint_of($$ select * from public.review_payment((select id from b where label = 'rA1'), false, 'No') $$), 'forbidden',
  'staff of B cannot reject a venue A payment');
select is(pg_temp.val($$ select status::text from public.review_payment((select id from b where label = 'rB1'), true) $$), 'confirmed',
  'staff of B approve a venue B payment');
select is(pg_temp.val($$ select status::text from public.review_payment((select id from b where label = 'rB2'), false, 'Blurry proof') $$), 'rejected',
  'B: the second rejection reaches B''s max_rejections of 2 (A''s 3 would hold the slot)');
select is(pg_temp.val($$ select status::text from public.review_payment((select id from b where label = 'rB3'), false, 'Blurry proof') $$), 'pending_payment',
  'B: the first rejection gives the booking another go');

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.review_payment((select id from b where label = 'rB4'), true) $$), 'forbidden',
  'staff of A cannot approve a venue B payment');
select is(pg_temp.val($$ select status::text from public.review_payment((select id from b where label = 'rA1'), true) $$), 'confirmed',
  'staff of A approve a venue A payment');
select is(pg_temp.val($$ select status::text from public.review_payment((select id from b where label = 'rA2'), false, 'Blurry proof') $$), 'pending_payment',
  'A: the second rejection is still under A''s max_rejections of 3');

select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(pg_temp.val($$ select status::text from public.review_payment((select id from b where label = 'rB4'), true) $$), 'confirmed',
  'a platform admin approves a venue B payment');

reset role;
select is((select (status::text || '/' || (expires_at = now() + interval '60 minutes')::text) from public.bookings where id = (select id from b where label = 'rA2')),
  'pending_payment/true', 'A: the fresh hold after a rejection is A''s 60 minutes');
select is((select (status::text || '/' || (expires_at = now() + interval '15 minutes')::text) from public.bookings where id = (select id from b where label = 'rB3')),
  'pending_payment/true', 'B: the fresh hold after a rejection is B''s 15 minutes');
select is((select status::text from public.bookings where id = (select id from b where label = 'rB4')), 'confirmed',
  'the booking is confirmed after the platform admin''s approval');
select is((select review_status::text from public.payments where booking_id = (select id from b where label = 'rA1')), 'approved',
  'the refused attempts on venue A left no trace; the right approval stands');

select * from finish();
rollback;
