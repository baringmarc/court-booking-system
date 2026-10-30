-- T10.9: reschedule_booking, booking_changes, the moved-booking rules and their reads (SPEC §4, §6, §7, §10
-- "Rescheduling design"; RESEARCH M10). Fixtures are inserted directly, so they can sit in the hour in progress.
begin;
create extension if not exists pgtap with schema extensions;
select plan(78);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;

-- A local time on a day `p_days` from today, in the venue timezone.
create temp table today as select private.local_today(private.default_venue_id()) as d;
grant select on today to anon, authenticated;
create function pg_temp.t(p_days integer, p_hour integer) returns timestamptz language sql stable as $$
  select (((select d from today) + p_days) + make_time(p_hour, 0, 0)) at time zone 'Asia/Manila'
$$;

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.venue_settings set booking_window_days = 7, cancel_cutoff_hours = 1;
insert into auth.users (id, email, email_confirmed_at) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local', now()),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local', now()),
  ('33333333-3333-3333-3333-333333333333', 'olga@test.local', now()),
  ('44444444-4444-4444-4444-444444444444', 'claimer@example.com', now());
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';

insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-00000000000b', 'Target B', 'tennis', 500),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-00000000000c', 'Pickle C', 'pickleball', 500),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-00000000000d', 'Closed D', 'tennis', 500);
update public.courts set is_active = false where id = 'c0000000-0000-0000-0000-00000000000d';

create temp table b (label text primary key, id uuid, ref text, court uuid);
grant select, insert on b to anon, authenticated;
create temp table r (label text primary key, change_id uuid, continuation_id uuid, continuation_ref text);
grant select, insert on r to anon, authenticated;

-- One tennis court per fixture, so fixtures never collide with each other; the targets are all on court B.
-- A confirmed booking that isn't `moved` gets its one approved payment, as in real life.
create function pg_temp.mk(
  p_label text, p_during tstzrange, p_status public.booking_status default 'confirmed',
  p_source public.booking_source default 'online', p_parent text default null,
  p_user uuid default null, p_token text default null, p_email text default null
) returns void language plpgsql as $$
declare
  v_court uuid := gen_random_uuid();
  v_ref   text := 'CB-' || translate(upper(substr(md5(p_label), 1, 6)), '01', '23');
  v_id    uuid;
begin
  insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values (private.default_venue_id(), v_court, 'Court ' || p_label, 'tennis', 500);
  insert into public.bookings (reference_code, court_id, user_id, guest_name, guest_email, guest_phone, during,
                               total_amount, status, source, guest_token_hash, expires_at, parent_booking_id)
  values (v_ref, v_court, p_user, 'Name ' || p_label, p_email, '0917 000 0000', p_during,
          case when p_source = 'moved' then 0 else 500 end, p_status, p_source,
          case when p_token is null then null else sha256(convert_to(p_token, 'UTF8')) end,
          case when p_status = 'pending_payment' then now() + interval '1 hour' end,
          (select id from b where label = p_parent))
  returning id into v_id;
  insert into b values (p_label, v_id, v_ref, v_court);
  if p_status = 'confirmed' and p_source <> 'moved' then
    insert into public.payments (booking_id, method, amount, review_status, reviewed_at)
    values (v_id, 'cash', 500, 'approved', now());
  end if;
end $$;

create temp table fx as select date_trunc('hour', now()) as h;
grant select on fx to anon, authenticated;

select pg_temp.mk('whole',   tstzrange(pg_temp.t(5, 7), pg_temp.t(5, 9)), p_user => '11111111-1111-1111-1111-111111111111', p_email => 'whole@example.com');
select pg_temp.mk('shift',   tstzrange(pg_temp.t(5, 7), pg_temp.t(5, 9)));
select pg_temp.mk('live3',   tstzrange((select h from fx), (select h from fx) + interval '2 hours'), p_user => '11111111-1111-1111-1111-111111111111', p_email => 'live3@example.com');
select pg_temp.mk('live1',   tstzrange((select h from fx) - interval '1 hour', (select h from fx) + interval '2 hours'),
                  p_user => '11111111-1111-1111-1111-111111111111', p_token => 'tok-live1', p_email => 'live1@example.com');
select pg_temp.mk('live2',   tstzrange((select h from fx) - interval '1 hour', (select h from fx) + interval '2 hours'), p_email => 'live2@example.com');
select pg_temp.mk('rootx',   tstzrange((select h from fx) - interval '3 hours', (select h from fx) - interval '2 hours'), p_email => 'rootx@example.com');
select pg_temp.mk('contx',   tstzrange((select h from fx) - interval '1 hour', (select h from fx) + interval '2 hours'), 'confirmed', 'moved', 'rootx', p_email => 'rootx@example.com');
select pg_temp.mk('probe',   tstzrange(pg_temp.t(14, 7), pg_temp.t(14, 9)));
select pg_temp.mk('far',     tstzrange(pg_temp.t(5, 12), pg_temp.t(5, 13)));
select pg_temp.mk('pending', tstzrange(pg_temp.t(6, 7), pg_temp.t(6, 8)), 'pending_payment');
select pg_temp.mk('ended',   tstzrange((select h from fx) - interval '3 hours', (select h from fx) - interval '1 hour'));
select pg_temp.mk('walkin',  tstzrange((select h from fx) - interval '1 hour', (select h from fx) + interval '2 hours'), 'confirmed', 'walk_in', p_email => 'walkin@example.com');
select pg_temp.mk('claimroot', tstzrange((select h from fx) - interval '1 hour', (select h from fx) + interval '2 hours'),
                  p_token => 'tok-claim', p_email => 'claimer@example.com');
select pg_temp.mk('oldroot', tstzrange(now() - interval '40 days', now() - interval '40 days' + interval '1 hour'), p_token => 'tok-old', p_email => 'old@example.com');
select pg_temp.mk('oldcont', tstzrange((select h from fx) + interval '1 day', (select h from fx) + interval '1 day 1 hour'), 'confirmed', 'moved', 'oldroot', p_token => 'tok-old', p_email => 'old@example.com');
select pg_temp.mk('goneroot', tstzrange(now() - interval '40 days', now() - interval '40 days' + interval '1 hour'), p_token => 'tok-gone');

-- Targets that the clash cases need on court B
insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status, source)
values ('CB-BLKB22', 'c0000000-0000-0000-0000-00000000000b', 'Blocker', tstzrange(pg_temp.t(11, 7), pg_temp.t(11, 9)), 500, 'confirmed', 'walk_in');
insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
values (private.default_venue_id(), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(12, 7), pg_temp.t(12, 9), 'Maintenance');
insert into public.open_play_sessions (venue_id, id, title, starts_at, ends_at)
values (private.default_venue_id(), '0b000000-0000-0000-0000-000000000001', 'Open play', pg_temp.t(13, 7), pg_temp.t(13, 9));
insert into public.open_play_courts (session_id, court_id, during)
values ('0b000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-00000000000b', tstzrange(pg_temp.t(13, 7), pg_temp.t(13, 9)));

-- ---------------------------------------------------------------------------
-- Schema, grants, RLS
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.reschedule_booking(uuid, timestamptz, uuid, timestamptz, text)', 'execute'),
  'authenticated may call reschedule_booking (the admin check is inside)');
select ok(not has_function_privilege('anon', 'public.reschedule_booking(uuid, timestamptz, uuid, timestamptz, text)', 'execute'),
  'anon may not call reschedule_booking');
select ok((select relrowsecurity from pg_class where oid = 'public.booking_changes'::regclass), 'booking_changes has RLS enabled');
select ok(not has_table_privilege('anon', 'public.booking_changes', 'select'), 'anon has no access to booking_changes');
select ok(not has_table_privilege('authenticated', 'public.booking_changes', 'insert')
      and not has_table_privilege('authenticated', 'public.booking_changes', 'update')
      and not has_table_privilege('authenticated', 'public.booking_changes', 'delete'),
  'clients cannot write booking_changes');
select is(pg_temp.sqlstate_of($$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, source)
  values ('CB-NPARE2', (select court from b where label = 'probe'), 'X', tstzrange(now() + interval '60 days', now() + interval '60 days 1 hour'), 0, 'moved') $$),
  '23514', 'a moved booking needs a parent');
select is(pg_temp.sqlstate_of($$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, source, parent_booking_id)
  values ('CB-NTMOV2', (select court from b where label = 'probe'), 'X', tstzrange(now() + interval '60 days', now() + interval '60 days 1 hour'), 0, 'online', (select id from b where label = 'probe')) $$),
  '23514', 'only a moved booking has a parent');
select is(pg_temp.sqlstate_of($$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, source, parent_booking_id)
  values ('CB-PDMV22', (select court from b where label = 'probe'), 'X', tstzrange(now() + interval '60 days', now() + interval '60 days 1 hour'), 500, 'moved', (select id from b where label = 'probe')) $$),
  '23514', 'a moved booking is free');
select is(pg_temp.hint_of($$ insert into public.payments (booking_id, method, amount, review_status)
  values ((select id from b where label = 'contx'), 'cash', 500, 'approved') $$),
  'moved_booking', 'a moved booking cannot get a payment of its own');

-- ---------------------------------------------------------------------------
-- Who may call it, and the input rules
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'whole'),
  pg_temp.t(5, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(7, 7), 'Testing') $$),
  'forbidden', 'a player cannot reschedule, not even their own booking');

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 7), null) $$),
  'reason_required', 'the reason is required');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 7), '   ') $$),
  'reason_required', 'a blank reason is refused');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 7), repeat('x', 501)) $$),
  'invalid_input', 'a reason over 500 characters is refused');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), null, pg_temp.t(15, 7), 'Testing') $$),
  'invalid_input', 'a missing court is refused');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking('00000000-0000-0000-0000-000000000000',
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 7), 'Testing') $$),
  'not_found', 'an unknown booking is not_found');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'pending'),
  pg_temp.t(6, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 7), 'Testing') $$),
  'not_confirmed', 'only confirmed bookings can be rescheduled');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'ended'),
  (select h from fx) - interval '3 hours', 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 7), 'Testing') $$),
  'booking_ended', 'a booking that has ended cannot be rescheduled');

-- The hour to move from
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 9), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 7), 'Testing') $$),
  'invalid_input', 'from_start at the end of the booking is outside it');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 6), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 7), 'Testing') $$),
  'invalid_input', 'from_start before the booking is outside it');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7) + interval '30 minutes', 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 7), 'Testing') $$),
  'not_aligned', 'from_start must be on the hour');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'live1'),
  (select h from fx) - interval '1 hour', 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(9, 7), 'Testing') $$),
  'from_past', 'an hour that has already passed cannot be moved');

-- The new range
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000c', pg_temp.t(15, 7), 'Testing') $$),
  'different_sport', 'the new court must be the same sport');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000d', pg_temp.t(15, 7), 'Testing') $$),
  'court_inactive', 'the new court must be active');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-0000000000ff', pg_temp.t(15, 7), 'Testing') $$),
  'invalid_input', 'an unknown new court is refused');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(11, 7), 'Testing') $$),
  'slot_unavailable', 'a clash with another booking is refused');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(11, 8), 'Testing') $$),
  'slot_unavailable', 'a partial overlap is refused too');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(12, 7), 'Testing') $$),
  'blackout', 'a blackout is refused');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(13, 7), 'Testing') $$),
  'open_play', 'open play is refused');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 21), 'Testing') $$),
  'outside_hours', 'the whole length must fit before closing (2 hours from 9 PM)');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 5), 'Testing') $$),
  'outside_hours', 'a start before opening is refused');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(15, 7) + interval '30 minutes', 'Testing') $$),
  'not_aligned', 'the new start must be on the hour');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'probe'),
  pg_temp.t(14, 7), 'c0000000-0000-0000-0000-00000000000b', (select h from fx) - interval '3 hours', 'Testing') $$),
  'slot_started', 'a new range that has already passed is refused');
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'shift'),
  pg_temp.t(5, 7), (select court from b where label = 'shift'), pg_temp.t(5, 7), 'Testing') $$),
  'no_change', 'moving to where it already is is refused');
select is((select count(*)::int from public.booking_changes), 0, 'every refusal left no change row behind');

-- ---------------------------------------------------------------------------
-- A whole move
-- ---------------------------------------------------------------------------
insert into r select 'whole', x.* from public.reschedule_booking((select id from b where label = 'whole'),
  pg_temp.t(5, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(7, 7), '  Court resurfacing  ') x;
reset role;
select results_eq(
  $$ select bk.court_id, bk.during, bk.reference_code, bk.status::text, bk.source::text, bk.total_amount
     from public.bookings bk where bk.id = (select id from b where label = 'whole') $$,
  $$ select 'c0000000-0000-0000-0000-00000000000b'::uuid, tstzrange(pg_temp.t(7, 7), pg_temp.t(7, 9)),
            (select ref from b where label = 'whole'), 'confirmed', 'online', 500::numeric $$,
  'a whole move changes the court and range of the same row (same reference, still confirmed, same price)');
select is((select continuation_id from r where label = 'whole'), null, 'a whole move creates no continuation');
select results_eq(
  $$ select count(*)::int, count(*) filter (where review_status = 'approved')::int from public.payments
     where booking_id = (select id from b where label = 'whole') $$,
  $$ values (1, 1) $$, 'payments are untouched by a move');
select results_eq(
  $$ select old_court_id = (select court from b where label = 'whole'), old_during, new_court_id, new_during, continuation_id,
            reason, changed_by
     from public.booking_changes where id = (select change_id from r where label = 'whole') $$,
  $$ select true, tstzrange(pg_temp.t(5, 7), pg_temp.t(5, 9)), 'c0000000-0000-0000-0000-00000000000b'::uuid,
            tstzrange(pg_temp.t(7, 7), pg_temp.t(7, 9)), null::uuid, 'Court resurfacing', '22222222-2222-2222-2222-222222222222'::uuid $$,
  'the change row records the old and new court and range, the trimmed reason and the admin');
select results_eq(
  $$ select booking_id, kind::text, to_email, data->>'old_court_name', data->>'new_court_name', data->>'reason',
            data->'continuation_reference' = 'null'::jsonb
     from public.email_outbox where change_id = (select change_id from r where label = 'whole') $$,
  $$ select (select id from b where label = 'whole'), 'booking_rescheduled', 'whole@example.com',
            'Court whole', 'Target B', 'Court resurfacing', true $$,
  'one booking_rescheduled email is queued for the booking''s contact');

-- Within the same court, onto its own old hours (the row doesn't clash with itself)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
insert into r select 'shift', x.* from public.reschedule_booking((select id from b where label = 'shift'),
  pg_temp.t(5, 7), (select court from b where label = 'shift'), pg_temp.t(5, 8), 'Moved an hour') x;
reset role;
select is((select during from public.bookings where id = (select id from b where label = 'shift')),
  tstzrange(pg_temp.t(5, 8), pg_temp.t(5, 10)), 'a booking can move within its own court onto some of its own hours');

-- The booking window doesn't apply to staff (booking_window_days = 7)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
insert into r select 'far', x.* from public.reschedule_booking((select id from b where label = 'far'),
  pg_temp.t(5, 12), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(40, 12), 'Rescheduled for the tournament') x;
reset role;
select is((select lower(during) from public.bookings where id = (select id from b where label = 'far')),
  pg_temp.t(40, 12), 'staff can move a booking beyond the booking window');

-- A started booking whose first hour is the hour in progress moves whole, into the hour in progress too
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
insert into r select 'live3', x.* from public.reschedule_booking((select id from b where label = 'live3'),
  (select h from fx), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(8, 7), 'Wrong court') x;
reset role;
select results_eq(
  $$ select court_id, during from public.bookings where id = (select id from b where label = 'live3') $$,
  $$ select 'c0000000-0000-0000-0000-00000000000b'::uuid, tstzrange(pg_temp.t(8, 7), pg_temp.t(8, 9)) $$,
  'a booking in its first hour moves whole');
select is((select continuation_id from r where label = 'live3'), null, 'no continuation for it either');

-- ---------------------------------------------------------------------------
-- A split during play
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
insert into r select 'live1', x.* from public.reschedule_booking((select id from b where label = 'live1'),
  (select h from fx), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(9, 7), 'Lights failed') x;
insert into r select 'live2', x.* from public.reschedule_booking((select id from b where label = 'live2'),
  (select h from fx) + interval '1 hour', 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(9, 10), 'Lights failed') x;
reset role;

select is((select during from public.bookings where id = (select id from b where label = 'live1')),
  tstzrange((select h from fx) - interval '1 hour', (select h from fx)), 'split from the hour in progress: the original keeps the hours before it');
select is((select during from public.bookings where id = (select id from b where label = 'live2')),
  tstzrange((select h from fx) - interval '1 hour', (select h from fx) + interval '1 hour'), 'split from a later hour: the original keeps the hours before it');
select results_eq(
  $$ select c.court_id, c.during, c.status::text, c.source::text, c.total_amount, c.parent_booking_id, c.user_id, c.guest_name,
            c.guest_email, c.guest_phone, c.guest_token_hash = p.guest_token_hash, c.created_by,
            c.reference_code = (select continuation_ref from r where label = 'live1'), c.reference_code <> p.reference_code
     from public.bookings c join public.bookings p on p.id = c.parent_booking_id
     where c.id = (select continuation_id from r where label = 'live1') $$,
  $$ select 'c0000000-0000-0000-0000-00000000000b'::uuid, tstzrange(pg_temp.t(9, 7), pg_temp.t(9, 9)), 'confirmed', 'moved', 0::numeric,
            (select id from b where label = 'live1'), '11111111-1111-1111-1111-111111111111'::uuid, 'Name live1',
            'live1@example.com', '09170000000', true, '22222222-2222-2222-2222-222222222222'::uuid, true, true $$,
  'the continuation is a confirmed, free, moved booking on the new court, with the parent''s contact, link and a new reference');
select is((select lower(during) from public.bookings where id = (select continuation_id from r where label = 'live2')),
  pg_temp.t(9, 10), 'the later split moves only the hours from it');
select is((select upper(during) from public.bookings where id = (select continuation_id from r where label = 'live2')),
  pg_temp.t(9, 11), 'the later split moves one hour');
select results_eq(
  $$ select count(*)::int, count(*) filter (where review_status = 'approved')::int from public.payments
     where booking_id in (select id from b where label in ('live1', 'live2')) $$,
  $$ values (2, 2) $$, 'payments stay on the originals');
select is((select count(*)::int from public.payments where booking_id in (select continuation_id from r where label in ('live1', 'live2'))),
  0, 'continuations have no payments');
select results_eq(
  $$ select old_during, new_during, continuation_id from public.booking_changes where id = (select change_id from r where label = 'live1') $$,
  $$ select tstzrange((select h from fx), (select h from fx) + interval '2 hours'), tstzrange(pg_temp.t(9, 7), pg_temp.t(9, 9)),
            (select continuation_id from r where label = 'live1') $$,
  'the change row records the moved part and the continuation');
select results_eq(
  $$ select booking_id, kind::text, to_email, data->>'continuation_reference' = (select continuation_ref from r where label = 'live1')
     from public.email_outbox where change_id = (select change_id from r where label = 'live1') $$,
  $$ select (select id from b where label = 'live1'), 'booking_rescheduled', 'live1@example.com', true $$,
  'one email for the split, naming the continuation, with no booking_created for it');
select is((select count(*)::int from public.email_outbox where booking_id = (select continuation_id from r where label = 'live1')),
  0, 'the continuation itself queues no email');

-- Splitting a continuation points the new one at the root
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
insert into r select 'contx', x.* from public.reschedule_booking((select id from b where label = 'contx'),
  (select h from fx), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(10, 7), 'Moved again') x;
reset role;
select is((select parent_booking_id from public.bookings where id = (select continuation_id from r where label = 'contx')),
  (select id from b where label = 'rootx'), 'a continuation of a continuation points to the root booking');
select is((select booking_id from public.email_outbox where change_id = (select change_id from r where label = 'contx')),
  (select id from b where label = 'rootx'), 'its email is queued on the root booking');

-- A continuation moves whole like any booking; the parent doesn't change
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
insert into r select 'cont1', x.* from public.reschedule_booking((select continuation_id from r where label = 'live1'),
  pg_temp.t(9, 7), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(16, 7), 'Moved once more') x;
reset role;
select results_eq(
  $$ select parent_booking_id, lower(during) from public.bookings where id = (select continuation_id from r where label = 'live1') $$,
  $$ select (select id from b where label = 'live1'), pg_temp.t(16, 7) $$,
  'moving a continuation whole keeps its root');
select is((select count(*)::int from public.email_outbox where booking_id = (select id from b where label = 'live1') and kind = 'booking_rescheduled'),
  2, 'a booking can be rescheduled more than once: one email per change');

-- Walk-ins and their continuations are never emailed (the walk-in here has an email on file to prove the gate)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
insert into r select 'walkin', x.* from public.reschedule_booking((select id from b where label = 'walkin'),
  (select h from fx), 'c0000000-0000-0000-0000-00000000000b', pg_temp.t(17, 7), 'Wrong court') x;
select is(public.cancel_booking((select continuation_id from r where label = 'walkin'), p_reason => 'No show'),
  'cancelled'::public.booking_status, 'staff can cancel a walk-in''s continuation');
reset role;
select is((select count(*)::int from public.email_outbox where booking_id in (select id from b where label = 'walkin')
  or booking_id = (select continuation_id from r where label = 'walkin')), 0, 'a walk-in and its continuation queue no email');

-- ---------------------------------------------------------------------------
-- The invariant
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.bookings bk
   where bk.status = 'confirmed' and bk.source <> 'moved' and bk.id in (select id from b)
     and (select count(*) from public.payments p where p.booking_id = bk.id and p.review_status = 'approved') <> 1),
  0, 'every confirmed booking that isn''t moved still has exactly one approved payment');
select is(
  (select count(*)::int from public.bookings bk
   where bk.source = 'moved'
     and (bk.parent_booking_id is null or bk.total_amount <> 0 or exists (select 1 from public.payments p where p.booking_id = bk.id))),
  0, 'every moved booking has a root, costs nothing and has no payments');

-- ---------------------------------------------------------------------------
-- Reads: RLS, the guest link, claims, cancel
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select cmp_ok((select count(*)::int from public.booking_changes), '>=', 8, 'an admin reads every change');
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is((select count(*)::int from public.booking_changes), 4,
  'a player reads the changes of their own bookings (a booking, its split and the continuation moved later)');
select is((select count(*)::int from public.booking_changes where booking_id not in
  (select id from b where label in ('whole', 'live3', 'live1') union select continuation_id from r where label = 'live1')),
  0, 'and nobody else''s');
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is((select count(*)::int from public.booking_changes), 0, 'another player reads none');

-- The guest link shows the continuations and the history
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select results_eq(
  $$ select parent_reference_code, jsonb_array_length(continuations), jsonb_array_length(changes),
            continuations->0->>'reference_code' = (select continuation_ref from r where label = 'live1'),
            continuations->0->>'court_name', changes->0->>'reason', changes->0->>'new_court_name',
            changes->0->>'continuation_reference' = (select continuation_ref from r where label = 'live1')
     from public.get_guest_booking((select ref from b where label = 'live1'), 'tok-live1') $$,
  $$ values (null::text, 1, 2, true, 'Target B', 'Lights failed', 'Target B', true) $$,
  'the guest link lists the continuation and the change history, including later moves of the continuation');
select results_eq(
  $$ select parent_reference_code, jsonb_array_length(continuations), jsonb_array_length(changes)
     from public.get_guest_booking((select continuation_ref from r where label = 'live1'), 'tok-live1') $$,
  $$ select (select ref from b where label = 'live1'), 0, 2 $$,
  'a continuation''s own reference opens through the same link and names its root');
select is((select count(*)::int from public.get_guest_booking((select ref from b where label = 'oldroot'), 'tok-old')),
  1, 'a root that ended long ago still opens while its continuation is recent (the expiry follows the latest end)');
select is(pg_temp.hint_of($$ select * from public.get_guest_booking((select ref from b where label = 'goneroot'), 'tok-gone') $$),
  'not_found', 'a root with no continuation still expires 30 days after its end');
select is(pg_temp.hint_of($$ select * from public.get_guest_booking((select ref from b where label = 'live1'), 'wrong') $$),
  'not_found', 'a wrong token is still not_found');

-- A guest cancels a continuation with the same link; the parent is untouched (no cascade)
reset role;

select pg_temp.mk('guestcont_root', tstzrange(pg_temp.t(18, 7), pg_temp.t(18, 9)), p_token => 'tok-gc', p_email => 'gc@example.com');
select pg_temp.mk('guestcont', tstzrange(pg_temp.t(19, 7), pg_temp.t(19, 9)), 'confirmed', 'moved', 'guestcont_root', p_token => 'tok-gc', p_email => 'gc@example.com');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(public.cancel_booking(p_reference_code => (select ref from b where label = 'guestcont'), p_token => 'tok-gc'),
  'cancelled'::public.booking_status, 'a guest cancels a continuation with the link');
reset role;
select is((select status::text from public.bookings where id = (select id from b where label = 'guestcont_root')),
  'confirmed', 'cancelling a continuation leaves its parent confirmed');
select results_eq(
  $$ select booking_id, kind::text, to_email from public.email_outbox where booking_id = (select id from b where label = 'guestcont') $$,
  $$ select (select id from b where label = 'guestcont'), 'booking_cancelled', 'gc@example.com' $$,
  'cancelling a continuation of an online booking tells the root''s contact');

-- Cancelling the parent doesn't cascade
select pg_temp.mk('ncroot', tstzrange((select h from fx) - interval '1 hour', (select h from fx) + interval '1 hour'), p_token => 'tok-nc', p_email => 'nc@example.com');
select pg_temp.mk('nccont', tstzrange(pg_temp.t(21, 7), pg_temp.t(21, 9)), 'confirmed', 'moved', 'ncroot', p_token => 'tok-nc', p_email => 'nc@example.com');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(public.cancel_booking((select id from b where label = 'ncroot'), p_reason => 'Closed'),
  'cancelled'::public.booking_status, 'staff cancel a parent that has a live continuation');
reset role;
select is((select status::text from public.bookings where id = (select id from b where label = 'nccont')),
  'confirmed', 'cancelling a parent leaves its continuation booked');
select is((select count(*)::int from public.email_outbox where booking_id = (select id from b where label = 'nccont')),
  0, 'and sends nothing about the continuation');

-- Claims: a signed-in player picks up the continuation with the booking
select pg_temp.mk('claimcont', tstzrange(pg_temp.t(20, 7), pg_temp.t(20, 9)), 'confirmed', 'moved', 'claimroot', p_token => 'tok-claim', p_email => 'claimer@example.com');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(public.claim_guest_bookings(), 2, 'claiming takes the booking and its continuation');
reset role;
select is((select count(*)::int from public.bookings where user_id = '44444444-4444-4444-4444-444444444444'
  and id in (select id from b where label in ('claimroot', 'claimcont'))), 2, 'both now belong to the player');

select * from finish();
rollback;
