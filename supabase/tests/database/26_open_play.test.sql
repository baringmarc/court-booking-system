-- T9.11c: one-off open play sessions. RLS, the admin RPCs and their rules, the clash rules both ways
-- (bookings, walk-ins, the PayMongo revival) and get_availability's open_play status.
begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

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
update public.profiles set full_name = 'Pat Player' where id = '11111111-1111-1111-1111-111111111111';
insert into public.venue_members (venue_id, user_id, role)
select id, '22222222-2222-2222-2222-222222222222', 'staff' from public.venues where slug = 'claudex-courts';
insert into public.courts (venue_id, id, name, sport, default_hourly_rate, is_active) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000f1', 'OP Court 1', 'pickleball', 300, true),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000f2', 'OP Court 2', 'pickleball', 300, true),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000f3', 'OP Court Off', 'pickleball', 300, false),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000f4', 'OP Court 4', 'pickleball', 300, true);

-- Every day 06:00–22:00; d is three days ahead, inside the booking window.
update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
create temp table fx as select private.local_today(private.default_venue_id()) + 3 as d;
grant select on fx to anon, authenticated;

create function pg_temp.at(p_time time) returns timestamptz language sql as $$
  select ((select d from fx) + p_time) at time zone 'Asia/Manila'
$$;
grant execute on function pg_temp.at(time) to anon, authenticated;

-- An active booking on court 1 at 10:00, and a lapsed hold on court 2 at 15:00 with a PayMongo checkout.
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status, expires_at) values
  ('b0000000-0000-0000-0000-0000000000f1', 'CB-QPAAA2', 'c0000000-0000-0000-0000-0000000000f1', 'Ana Active',
   tstzrange(pg_temp.at('10:00'), pg_temp.at('11:00')), 300, 'confirmed', null),
  ('b0000000-0000-0000-0000-0000000000f2', 'CB-QPAAB3', 'c0000000-0000-0000-0000-0000000000f2', 'Lee Lapsed',
   tstzrange(pg_temp.at('15:00'), pg_temp.at('16:00')), 300, 'pending_payment', now() - interval '5 minutes'),
  -- A live hold and a proof waiting for review on court 4: both active.
  ('b0000000-0000-0000-0000-0000000000f3', 'CB-QPAAC4', 'c0000000-0000-0000-0000-0000000000f4', 'Hal Held',
   tstzrange(pg_temp.at('18:00'), pg_temp.at('19:00')), 300, 'pending_payment', now() + interval '20 minutes'),
  ('b0000000-0000-0000-0000-0000000000f4', 'CB-QPAAD5', 'c0000000-0000-0000-0000-0000000000f4', 'Sue Submitted',
   tstzrange(pg_temp.at('19:00'), pg_temp.at('20:00')), 300, 'payment_submitted', now() - interval '5 minutes');
insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos)
values ('b0000000-0000-0000-0000-0000000000f2', 'cs_open_play', 'https://checkout.paymongo.test/op', 30000);

-- A session that has already started (written directly, as the RPCs refuse a past start).
insert into public.open_play_sessions (venue_id, id, title, starts_at, ends_at) values
  (private.default_venue_id(), 'a0000000-0000-0000-0000-0000000000f9', 'Running now', now() - interval '1 hour', now() + interval '1 hour');

-- ---------------------------------------------------------------------------
-- Grants and RLS: anyone reads, nobody writes the tables directly
-- ---------------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'public.open_play_sessions', 'insert')
      and not has_table_privilege('authenticated', 'public.open_play_courts', 'insert')
      and not has_table_privilege('authenticated', 'public.open_play_sessions', 'update')
      and not has_table_privilege('authenticated', 'public.open_play_sessions', 'delete'),
  'signed-in users have no write grants on the open play tables');
select ok(not has_function_privilege('anon', 'public.create_open_play(uuid[], timestamptz, timestamptz, text, text, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.update_open_play(uuid, uuid[], timestamptz, timestamptz, text, text, jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.delete_open_play(uuid)', 'execute'),
  'anon cannot call the open play RPCs');
select throws_ok(
  $$ insert into public.open_play_sessions (venue_id, title, starts_at, ends_at, links)
     values (private.default_venue_id(), 'Bad', now() + interval '1 day', now() + interval '1 day 1 hour', '[{"label": "x", "url": "http://a.test"}]') $$,
  '23514', null, 'the table itself refuses a link that is not https');

-- Player: can't write, can't call the RPCs.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into public.open_play_sessions (venue_id, title, starts_at, ends_at) values (private.default_venue_id(), 'Mine', now() + interval '1 day', now() + interval '1 day 1 hour') $$,
  '42501', null, 'players cannot insert sessions directly');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f1']::uuid[],
  pg_temp.at('12:00'), pg_temp.at('13:00'), 'Mine') $$), 'forbidden', 'players cannot create sessions');
select is(pg_temp.hint_of($$ select public.delete_open_play('a0000000-0000-0000-0000-0000000000f9') $$), 'forbidden',
  'players cannot delete sessions');

-- ---------------------------------------------------------------------------
-- Admin: create
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
create temp table s1 as
select public.create_open_play(
  array['c0000000-0000-0000-0000-0000000000f2', 'c0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000f1']::uuid[],
  pg_temp.at('12:00'), pg_temp.at('14:00'), '  Saturday open play  ', 'Bring your own paddle. ₱150 per head.',
  '[{"label": "RSVP", "url": "https://forms.gle/abc123"}, {"label": "Reclub", "url": "https://reclub.co/m/xyz?ref=1"}]') as id;
grant select on s1 to anon, authenticated;
select isnt((select id from s1), null, 'an admin creates a session on several courts');
select results_eq(
  $$ select court_id, during from public.open_play_courts where session_id = (select id from s1) order by court_id $$,
  $$ values ('c0000000-0000-0000-0000-0000000000f1'::uuid, tstzrange(pg_temp.at('12:00'), pg_temp.at('14:00'))),
            ('c0000000-0000-0000-0000-0000000000f2'::uuid, tstzrange(pg_temp.at('12:00'), pg_temp.at('14:00'))) $$,
  'each court is stored once with the session range');
select is((select title from public.open_play_sessions where id = (select id from s1)), 'Saturday open play',
  'the title is trimmed');

select throws_ok(
  $$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f2', 'c0000000-0000-0000-0000-0000000000f1']::uuid[],
       pg_temp.at('09:00'), pg_temp.at('11:00'), 'Morning') $$,
  'P0001', 'There are bookings on OP Court 1 at that time. Cancel or move them first.',
  'a session over an active booking is refused, naming the court');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f2']::uuid[],
  pg_temp.at('13:00'), pg_temp.at('15:00'), 'Overlap') $$), 'session_overlap',
  'two sessions cannot overlap on a court');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f4']::uuid[],
  pg_temp.at('08:00'), pg_temp.at('09:00'), 'Plain http', '', '[{"label": "RSVP", "url": "http://forms.gle/abc"}]') $$),
  'invalid_links', 'a link that is not https is refused');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f4']::uuid[],
  pg_temp.at('08:00'), pg_temp.at('09:00'), 'Script', '', '[{"label": "RSVP", "url": "javascript:alert(1)"}]') $$),
  'invalid_links', 'a javascript: link is refused');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f4']::uuid[],
  pg_temp.at('08:00'), pg_temp.at('09:00'), 'Unlabelled', '', '[{"label": " ", "url": "https://a.test"}]') $$),
  'invalid_links', 'a link needs a label');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f4']::uuid[],
  pg_temp.at('08:00'), pg_temp.at('09:00'), 'Too many', '',
  '[{"label": "a", "url": "https://a.test"}, {"label": "b", "url": "https://b.test"},
    {"label": "c", "url": "https://c.test"}, {"label": "d", "url": "https://d.test"}]') $$),
  'invalid_links', 'at most 3 links');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f4']::uuid[],
  pg_temp.at('08:30'), pg_temp.at('09:30'), 'Half past') $$), 'not_aligned', 'sessions start and end on the hour');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f4']::uuid[],
  pg_temp.at('21:00'), pg_temp.at('23:00'), 'Late') $$), 'outside_hours', 'a session must fit in opening hours');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f4']::uuid[],
  date_trunc('hour', now()) - interval '2 hours', date_trunc('hour', now()) - interval '1 hour', 'Past') $$),
  'slot_started', 'a session cannot start in the past');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f3']::uuid[],
  pg_temp.at('08:00'), pg_temp.at('09:00'), 'Archived') $$), 'court_inactive', 'archived courts cannot be used');
select is(pg_temp.hint_of($$ select public.create_open_play(array[]::uuid[], pg_temp.at('08:00'), pg_temp.at('09:00'), 'None') $$),
  'invalid_input', 'at least one court');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f4']::uuid[],
  pg_temp.at('08:00'), pg_temp.at('09:00'), '   ') $$), 'invalid_input', 'a title is required');

select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f4']::uuid[],
  pg_temp.at('18:00'), pg_temp.at('19:00'), 'Over a hold') $$), 'slot_unavailable', 'a session over a live hold is refused');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f4']::uuid[],
  pg_temp.at('19:00'), pg_temp.at('20:00'), 'Over a proof') $$), 'slot_unavailable',
  'a session over a booking waiting for review is refused');

-- A lapsed hold doesn't block a session (it isn't active); its revival re-checks below.
create temp table s2 as
select public.create_open_play(array['c0000000-0000-0000-0000-0000000000f2']::uuid[],
  pg_temp.at('15:00'), pg_temp.at('16:00'), 'Afternoon') as id;
grant select on s2 to anon, authenticated;
select isnt((select id from s2), null, 'a lapsed hold does not block a session');

-- ---------------------------------------------------------------------------
-- Bookings, walk-ins and the PayMongo revival are refused inside a session
-- ---------------------------------------------------------------------------
select is(pg_temp.hint_of($$ select public.create_walk_in('c0000000-0000-0000-0000-0000000000f2', pg_temp.at('12:00'), 1, 'Walter') $$),
  'open_play', 'a walk-in into a session is refused');

select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000000f1', pg_temp.at('12:00'), 1) $$),
  'open_play', 'a player booking into a session is refused');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000000f1', pg_temp.at('11:00'), 2) $$),
  'open_play', 'a booking that runs into a session is refused');
select throws_ok($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000000f1', pg_temp.at('12:00'), 1) $$,
  'P0001', 'That time is reserved for open play.', 'with a readable message');
select is((select count(*)::int from public.open_play_sessions where id = (select id from s1)), 1, 'players read sessions');
select is((select count(*)::int from public.open_play_courts where session_id = (select id from s1)), 2, 'players read session courts');

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000000f2', pg_temp.at('13:00'), 1,
  'Gus Guest', 'gus@example.com', '0917 000 0000') $$), 'open_play', 'a guest booking into a session is refused');

reset role;
set local role service_role;
select is(
  (select outcome from public.record_paymongo_payment('cs_open_play', 'pay_open_play', 'evt_open_play', 30000, 'PHP', 'qrph')),
  'late', 'a PayMongo payment for a lapsed hold now inside a session is not revived');
reset role;
select is((select status::text from public.bookings where id = 'b0000000-0000-0000-0000-0000000000f2'), 'pending_payment',
  'that booking stays unconfirmed');

-- A successful booking holds its court's lock until commit (the serialization with session RPCs).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select lives_ok($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000000f4', pg_temp.at('08:00'), 1) $$,
  'a booking outside any session still works');
reset role;
select ok(exists (
  select 1 from pg_locks l
  where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
    and ((l.classid::bigint << 32) | l.objid::bigint) = hashtextextended('court_slots:c0000000-0000-0000-0000-0000000000f4', 0)
), 'create_booking takes the court lock');

-- ---------------------------------------------------------------------------
-- get_availability reports open play
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select results_eq(
  $$ select status, open_play_session_id, booker_first_name from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-0000000000f1')
     where slot_start in (pg_temp.at('10:00'), pg_temp.at('11:00'), pg_temp.at('12:00'), pg_temp.at('13:00'), pg_temp.at('14:00'))
     order by slot_start $$,
  $$ values ('booked', null::uuid, 'Ana'), ('free', null, null), ('open_play', (select id from s1), null),
            ('open_play', (select id from s1), null), ('free', null, null) $$,
  'get_availability marks the session''s slots open_play with the session id, and only those');
select is((select count(*)::int from public.open_play_sessions where id = (select id from s1)), 1, 'anon reads sessions');
select is((select count(*)::int from public.open_play_courts where session_id = (select id from s1)), 2, 'anon reads session courts');

-- ---------------------------------------------------------------------------
-- Admin: update and delete
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select lives_ok(
  $$ select public.update_open_play((select id from s1), array['c0000000-0000-0000-0000-0000000000f1']::uuid[],
       pg_temp.at('16:00'), pg_temp.at('18:00'), 'Moved', '', '[]') $$,
  'an admin moves a session that has not started');
select results_eq(
  $$ select court_id, during from public.open_play_courts where session_id = (select id from s1) $$,
  $$ values ('c0000000-0000-0000-0000-0000000000f1'::uuid, tstzrange(pg_temp.at('16:00'), pg_temp.at('18:00'))) $$,
  'the moved session blocks only its new courts and time');
select is(
  (select status from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-0000000000f2') where slot_start = pg_temp.at('12:00')),
  'free', 'the old slots are free again');
select is(pg_temp.hint_of($$ select public.update_open_play((select id from s1), array['c0000000-0000-0000-0000-0000000000f1']::uuid[],
  pg_temp.at('10:00'), pg_temp.at('11:00'), 'Onto a booking') $$), 'slot_unavailable',
  'moving a session onto an active booking is refused');
select is(pg_temp.hint_of($$ select public.update_open_play('a0000000-0000-0000-0000-0000000000f9',
  array['c0000000-0000-0000-0000-0000000000f4']::uuid[], pg_temp.at('19:00'), pg_temp.at('20:00'), 'Later') $$),
  'session_started', 'a session that has started cannot be edited');
select is(pg_temp.hint_of($$ select public.update_open_play('a0000000-0000-0000-0000-00000000dead',
  array['c0000000-0000-0000-0000-0000000000f4']::uuid[], pg_temp.at('19:00'), pg_temp.at('20:00'), 'Ghost') $$),
  'not_found', 'updating a missing session is refused');

select lives_ok($$ select public.delete_open_play((select id from s1)) $$, 'an admin deletes a session');
select is((select count(*)::int from public.open_play_courts where session_id = (select id from s1)), 0,
  'its courts go with it');
select is(pg_temp.hint_of($$ select public.delete_open_play('a0000000-0000-0000-0000-00000000dead') $$), 'not_found',
  'deleting a missing session is refused');

select * from finish();
rollback;
