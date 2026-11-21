-- T30.2: booking reminders and "same time next week" data (TASKS T30.2; RESEARCH "Milestone 30").
--   * private.queue_booking_reminders(p_now) and the 'booking-reminders' pg_cron job: one booking_reminder outbox row per
--     confirmed online booking that starts on the venue's next local day, once the venue's local time has reached 18:00,
--     only for bookings confirmed before 18:00 local that day; venues judged in their own timezones; never twice
--   * private.booking_email_data gains court_id, slots, address, maps_url (payment_confirmed, booking_rescheduled with the
--     NEW court and range)
--   * public.claim_email_outbox returns booking_starts_at
--   * bookings.rebooked_from (FK, on delete set null, not client-writable) and create_booking's 8th argument
--   * get_earnings 'rebooked' {count}
-- Calls that touch a not-yet-existing object go through dynamic SQL, so a missing object fails its own assertions
-- instead of aborting the transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(138);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
grant execute on function pg_temp.hint_of(text) to anon, authenticated, service_role;

create function pg_temp.state_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return 'sqlstate ' || sqlstate;
end $$;
grant execute on function pg_temp.state_of(text) to anon, authenticated, service_role;

-- 'ok' when the statement returns (id, reference_code, guest_token), recorded in b under p_label; else the hint or message.
create temp table b (label text primary key, id uuid, ref text, token text, court uuid);
grant select, insert on b to anon, authenticated, service_role;
create function pg_temp.bk(p_label text, p_sql text) returns text language plpgsql as $$
declare v_id uuid; v_ref text; v_tok text; h text;
begin
  execute p_sql into v_id, v_ref, v_tok;
  insert into b (label, id, ref, token) values (p_label, v_id, v_ref, v_tok);
  return 'ok';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), sqlerrm);
end $$;
grant execute on function pg_temp.bk(text, text) to anon, authenticated, service_role;

-- The booking's rebooked_from as text ('<null>' when null, 'ERR ...' when the column is missing). Run as postgres.
create function pg_temp.rf(p_label text) returns text language plpgsql as $$
declare r text;
begin
  execute format('select rebooked_from::text from public.bookings where id = %L', (select id from b where label = p_label)) into r;
  return coalesce(r, '<null>');
exception when others then
  return 'ERR ' || sqlerrm;
end $$;

-- Sets child.rebooked_from = parent.id as postgres ('ok' or the error).
create function pg_temp.link(p_child text, p_parent text) returns text language plpgsql as $$
begin
  execute format('update public.bookings set rebooked_from = %L where id = %L',
                 (select id from b where label = p_parent), (select id from b where label = p_child));
  return 'ok';
exception when others then
  return 'ERR ' || sqlerrm;
end $$;

-- Runs the reminder job as postgres with a faked clock: 'returned/new rows' or 'ERR ...'.
create function pg_temp.rj(p_now timestamptz) returns text language plpgsql as $$
declare v_before bigint; v_ret integer;
begin
  select count(*) into v_before from public.email_outbox where kind::text = 'booking_reminder';
  begin
    execute 'select private.queue_booking_reminders($1)' into v_ret using p_now;
  exception when others then
    return 'ERR ' || sqlerrm;
  end;
  return v_ret::text || '/' || ((select count(*) from public.email_outbox where kind::text = 'booking_reminder') - v_before)::text;
end $$;

create function pg_temp.rj0() returns text language plpgsql as $$
declare v_ret integer;
begin
  execute 'select private.queue_booking_reminders()' into v_ret;
  return 'ok';
exception when others then
  return 'ERR ' || sqlerrm;
end $$;

-- Labels (from b) that have a booking_reminder row, sorted; and one such row as jsonb.
create function pg_temp.rem_labels() returns text language sql as $$
  select coalesce(string_agg(b.label, ',' order by b.label), '')
  from b join public.email_outbox o on o.booking_id = b.id where o.kind::text = 'booking_reminder'
$$;
create function pg_temp.rem(p_label text) returns jsonb language sql as $$
  select to_jsonb(o) from public.email_outbox o join b on b.id = o.booking_id
  where b.label = p_label and o.kind::text = 'booking_reminder'
$$;
create function pg_temp.nrem(p_label text) returns integer language sql as $$
  select count(*)::int from public.email_outbox o join b on b.id = o.booking_id
  where b.label = p_label and o.kind::text = 'booking_reminder'
$$;

-- ---------------------------------------------------------------------------
-- Fixture: venue A (Claudex Courts, Asia/Manila, UTC+8) and venue B (Pacific/Honolulu, UTC-10)
-- ---------------------------------------------------------------------------
-- The seeded demo bookings start tomorrow and would be eligible; this file counts only its own.
delete from public.bookings where reference_code like 'CB-DEMQ%';

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.venue_settings set booking_window_days = 30, waiver_text = '', address = '12 Rizal Ave, Manila',
  maps_url = 'https://maps.app.goo.gl/claudex1';
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin-a@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'admin-b@test.local');
insert into public.venue_members (venue_id, user_id, role)
select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';
insert into public.venues (id, slug, status) values ('b0000000-0000-0000-0000-00000000000b', 'e2e-rem-b', 'active');
insert into public.venue_members (venue_id, user_id, role) values
  ('b0000000-0000-0000-0000-00000000000b', '77777777-7777-7777-7777-777777777777', 'staff');
insert into public.venue_settings (venue_id, name, timezone, booking_window_days, waiver_text) values
  ('b0000000-0000-0000-0000-00000000000b', 'E2E Rem B', 'Pacific/Honolulu', 30, 'B waiver');
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select 'b0000000-0000-0000-0000-00000000000b', d, time '06:00', time '22:00' from generate_series(0, 6) d;
insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000001', 'Rebook Court', 'tennis', 500),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000002', 'Rebook Court 2', 'tennis', 500),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000003', 'Move Target', 'tennis', 500),
  ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b1', 'Rebook B Court', 'tennis', 600);

-- D is today in venue A (Asia/Manila); every fake clock and fixture hangs off it. DB is today in venue B.
create temp table today as select private.local_today(private.default_venue_id()) as d;
create temp table today_b as select private.local_today('b0000000-0000-0000-0000-00000000000b'::uuid) as d;
grant select on today, today_b to anon, authenticated, service_role;
-- A local time on day D + p_days in timezone p_tz
create function pg_temp.at(p_tz text, p_days integer, p_time time) returns timestamptz language sql stable as $$
  select (((select d from today) + p_days) + p_time) at time zone p_tz
$$;
create function pg_temp.atb(p_days integer, p_time time) returns timestamptz language sql stable as $$
  select (((select d from today_b) + p_days) + p_time) at time zone 'Pacific/Honolulu'
$$;
grant execute on function pg_temp.at(text, integer, time), pg_temp.atb(integer, time) to anon, authenticated, service_role;

-- A booking inserted directly (as postgres) on its own tennis court of p_venue, with confirmed_at placed by hand.
create function pg_temp.mk(
  p_label text, p_venue uuid, p_during tstzrange, p_status public.booking_status default 'confirmed',
  p_source public.booking_source default 'online', p_parent text default null,
  p_user uuid default null, p_token text default null, p_email text default 'x@example.com',
  p_conf timestamptz default null
) returns void language plpgsql as $$
declare
  v_court uuid := gen_random_uuid();
  v_ref   text := 'CB-' || translate(upper(substr(md5(p_label), 1, 6)), '01', '23');
  v_id    uuid;
begin
  insert into public.courts (venue_id, id, name, sport, default_hourly_rate)
  values (p_venue, v_court, 'Court ' || p_label, 'tennis', 500);
  insert into public.bookings (reference_code, court_id, user_id, guest_name, guest_email, during, total_amount, status,
                               source, guest_token_hash, expires_at, parent_booking_id)
  values (v_ref, v_court, p_user, 'Name ' || p_label, p_email, p_during,
          case when p_source = 'moved' then 0 else 500 end, p_status, p_source,
          case when p_token is null then null else sha256(convert_to(p_token, 'UTF8')) end,
          case when p_status = 'pending_payment' then now() + interval '1 hour' end,
          (select id from b where label = p_parent))
  returning id into v_id;
  insert into b (label, id, ref, token, court) values (p_label, v_id, v_ref, p_token, v_court);
  -- confirmed_at is set by a trigger that fires only on insert and on update of status; this statement fires neither.
  if p_conf is not null then
    update public.bookings set confirmed_at = p_conf where id = v_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Schema, grants, cron job
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_enum e where e.enumtypid = 'public.email_kind'::regtype and e.enumlabel = 'booking_reminder'),
  'email_kind has the booking_reminder value');
select ok(
  exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'queue_booking_reminders'
          and p.prosecdef and p.prorettype = 'integer'::regtype and p.pronargs = 1
          and p.proargtypes[0] = 'timestamptz'::regtype and p.pronargdefaults = 1),
  'private.queue_booking_reminders(p_now timestamptz default now()) is a security definer function returning integer');
select is(
  (select bool_and(not (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                        or has_function_privilege('service_role', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute')))
   from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'queue_booking_reminders'),
  true, 'no client role, service_role or PUBLIC can run the reminder job');
select results_eq(
  $$ select schedule, command, active from cron.job where jobname = 'booking-reminders' $$,
  $$ values ('*/15 * * * *'::text, 'select private.queue_booking_reminders()'::text, true) $$,
  'the booking-reminders job runs every 15 minutes');
select is((select count(*)::int from cron.job where jobname = 'booking-reminders'), 1, 'there is exactly one booking-reminders job');
select is(pg_temp.rj0(), 'ok', 'the job function runs with no argument (the cron call)');

select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_booking'), 1,
  'there is one create_booking function');
select ok(
  exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_booking'
          and p.pronargs = 8 and p.pronargdefaults = 5
          and string_to_array(p.proargtypes::text, ' ') = array['uuid'::regtype::oid::text, 'timestamptz'::regtype::oid::text, 'integer'::regtype::oid::text,
                                           'text'::regtype::oid::text, 'text'::regtype::oid::text, 'text'::regtype::oid::text,
                                           'boolean'::regtype::oid::text, 'text'::regtype::oid::text]
          and p.proargnames[8] = 'p_rebook_of_reference'),
  'create_booking(uuid, timestamptz, integer, text, text, text, boolean, p_rebook_of_reference text) has 8 arguments, 5 with defaults');
select is(
  (select bool_and(has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
                   and not has_function_privilege('public', p.oid, 'execute') and p.pronargs = 8)
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'create_booking'),
  true, 'anon and authenticated can still call create_booking (8 arguments), PUBLIC cannot');
select ok(
  not has_function_privilege('anon', 'public.claim_email_outbox(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_email_outbox(integer)', 'execute')
  and has_function_privilege('service_role', 'public.claim_email_outbox(integer)', 'execute'),
  'claim_email_outbox is still service_role only');
select ok(not has_function_privilege('anon', 'public.get_earnings(date, date, uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.get_earnings(date, date, uuid)', 'execute')
      and has_function_privilege('service_role', 'public.get_earnings(date, date, uuid)', 'execute'),
  'get_earnings keeps its grants: staff and service_role, not anon');

select has_column('public', 'bookings', 'rebooked_from', 'bookings has rebooked_from');
select col_type_is('public', 'bookings', 'rebooked_from', 'uuid', 'rebooked_from is a uuid');
select col_is_null('public', 'bookings', 'rebooked_from', 'rebooked_from is nullable');
select is(
  (select c.confdeltype::text from pg_constraint c
   where c.conrelid = 'public.bookings'::regclass and c.contype = 'f' and c.confrelid = 'public.bookings'::regclass
     and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = 'public.bookings'::regclass and a.attname = 'rebooked_from')]),
  'n', 'rebooked_from references bookings and is set null when the original is deleted');
select is(
  (select bool_or(has_column_privilege(r, 'public.bookings'::regclass, a.attnum, p))
   from pg_attribute a, unnest(array['anon', 'authenticated']) r, unnest(array['insert', 'update']) p
   where a.attrelid = 'public.bookings'::regclass and a.attname = 'rebooked_from'),
  false, 'anon and authenticated have no insert or update privilege on rebooked_from');

-- ---------------------------------------------------------------------------
-- The reminder job: fixtures (every booking starts on its own court; times are venue A / venue B local, relative to D)
-- ---------------------------------------------------------------------------
select pg_temp.mk('ok_guest', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '10:00'), pg_temp.at('Asia/Manila', 1, '11:00')),
  p_token => 'tok-g', p_email => ' gina.rem@example.com ', p_conf => pg_temp.at('Asia/Manila', 0, '09:00'));
select pg_temp.mk('ok_player', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '12:00'), pg_temp.at('Asia/Manila', 1, '13:00')),
  p_user => '11111111-1111-1111-1111-111111111111', p_email => 'pat@test.local', p_conf => pg_temp.at('Asia/Manila', 0, '17:59:59'));
-- 00:00-02:00 local is 16:00 UTC the day before: "tomorrow" is the venue's calendar day, not the UTC one
select pg_temp.mk('early', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '00:00'), pg_temp.at('Asia/Manila', 1, '02:00')),
  p_token => 'tok-e', p_email => 'early@example.com', p_conf => pg_temp.at('Asia/Manila', -1, '20:00'));
select pg_temp.mk('late', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '23:00'), pg_temp.at('Asia/Manila', 2, '00:00')),
  p_token => 'tok-l', p_email => 'late@example.com', p_conf => pg_temp.at('Asia/Manila', 0, '09:30'));
select pg_temp.mk('prevconf', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '17:00'), pg_temp.at('Asia/Manila', 1, '18:00')),
  p_token => 'tok-p', p_email => 'prev@example.com', p_conf => pg_temp.at('Asia/Manila', -3, '12:00'));
select pg_temp.mk('rootm', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', -1, '10:00'), pg_temp.at('Asia/Manila', -1, '11:00')),
  p_token => 'tok-m', p_email => 'moved@example.com', p_conf => pg_temp.at('Asia/Manila', -2, '10:00'));
select pg_temp.mk('contm', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '15:00'), pg_temp.at('Asia/Manila', 1, '16:00')),
  'confirmed', 'moved', 'rootm', p_token => 'tok-m', p_email => 'moved@example.com', p_conf => pg_temp.at('Asia/Manila', 0, '09:00'));
select pg_temp.mk('rootw', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', -1, '12:00'), pg_temp.at('Asia/Manila', -1, '13:00')),
  'confirmed', 'walk_in', p_email => 'walkroot@example.com', p_conf => pg_temp.at('Asia/Manila', -2, '10:00'));
select pg_temp.mk('contw', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '16:00'), pg_temp.at('Asia/Manila', 1, '17:00')),
  'confirmed', 'moved', 'rootw', p_email => 'walkroot@example.com', p_conf => pg_temp.at('Asia/Manila', 0, '09:00'));
select pg_temp.mk('walkin', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '09:00'), pg_temp.at('Asia/Manila', 1, '10:00')),
  'confirmed', 'walk_in', p_email => 'walkin@example.com', p_conf => pg_temp.at('Asia/Manila', 0, '09:00'));
select pg_temp.mk('pending', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '08:00'), pg_temp.at('Asia/Manila', 1, '09:00')),
  'pending_payment', p_email => 'pending@example.com');
select pg_temp.mk('submitted', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '07:00'), pg_temp.at('Asia/Manila', 1, '08:00')),
  'payment_submitted', p_email => 'submitted@example.com');
select pg_temp.mk('cancelled', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '06:00'), pg_temp.at('Asia/Manila', 1, '07:00')),
  'cancelled', p_email => 'cancelled@example.com', p_conf => pg_temp.at('Asia/Manila', 0, '09:00'));
select pg_temp.mk('rejected', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '18:00'), pg_temp.at('Asia/Manila', 1, '19:00')),
  'rejected', p_email => 'rejected@example.com');
select pg_temp.mk('expired', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '19:00'), pg_temp.at('Asia/Manila', 1, '20:00')),
  'expired', p_email => 'expired@example.com');
select pg_temp.mk('today', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 0, '20:00'), pg_temp.at('Asia/Manila', 0, '21:00')),
  p_email => 'today@example.com', p_conf => pg_temp.at('Asia/Manila', -1, '10:00'));
select pg_temp.mk('d2', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 2, '10:00'), pg_temp.at('Asia/Manila', 2, '11:00')),
  p_token => 'tok-d2', p_email => 'd2@example.com', p_conf => pg_temp.at('Asia/Manila', 0, '12:00'));
-- confirmed at or after 18:00 local on the current day: no reminder
select pg_temp.mk('after18', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '13:00'), pg_temp.at('Asia/Manila', 1, '14:00')),
  p_email => 'after18@example.com', p_conf => pg_temp.at('Asia/Manila', 0, '18:00'));
select pg_temp.mk('after18b', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '14:00'), pg_temp.at('Asia/Manila', 1, '15:00')),
  p_email => 'after18b@example.com', p_conf => pg_temp.at('Asia/Manila', 0, '18:20'));
select pg_temp.mk('blank', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '20:00'), pg_temp.at('Asia/Manila', 1, '21:00')),
  p_email => '   ', p_conf => pg_temp.at('Asia/Manila', 0, '09:00'));
select pg_temp.mk('nomail', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 1, '21:00'), pg_temp.at('Asia/Manila', 1, '22:00')),
  p_email => null, p_conf => pg_temp.at('Asia/Manila', 0, '09:00'));
-- venue B (Honolulu): one booking on B's local D (its "tomorrow" while Manila is at D 17:59:59), one on D+1
select pg_temp.mk('b_d0', 'b0000000-0000-0000-0000-00000000000b', tstzrange(pg_temp.at('Pacific/Honolulu', 0, '10:00'), pg_temp.at('Pacific/Honolulu', 0, '11:00')),
  p_token => 'tok-b0', p_email => 'b0@example.com', p_conf => pg_temp.at('Pacific/Honolulu', -1, '12:00'));
select pg_temp.mk('b_d1', 'b0000000-0000-0000-0000-00000000000b', tstzrange(pg_temp.at('Pacific/Honolulu', 1, '10:00'), pg_temp.at('Pacific/Honolulu', 1, '11:00')),
  p_user => '11111111-1111-1111-1111-111111111111', p_email => 'b1@example.com', p_conf => pg_temp.at('Pacific/Honolulu', -1, '12:00'));

select is((select count(*)::int from b), 23, 'all 23 reminder fixtures were inserted (a refused fixture would make later counts meaningless)');
select is((select count(*)::int from public.email_outbox o join b on b.id = o.booking_id where o.kind::text = 'booking_reminder'), 0,
  'fixtures alone queue no reminder: only the job does');

-- ---------------------------------------------------------------------------
-- Timezones: the same instant (Manila D 17:59:59 = Honolulu D-1 23:59:59). Manila is not at 18:00 yet, Honolulu is.
-- ---------------------------------------------------------------------------
select is(pg_temp.rj(pg_temp.at('Asia/Manila', 0, '17:59:59')), '1/1',
  'at Manila 17:59:59 only the venue past 18:00 (Honolulu 23:59:59) queues: one row');
select is(pg_temp.rem_labels(), 'b_d0',
  'that row is the Honolulu booking on Honolulu''s next local day; Manila (17:59:59) queued nothing');

-- ---------------------------------------------------------------------------
-- Manila at 18:00 exactly (Honolulu is at 00:00 the same date)
-- ---------------------------------------------------------------------------
select is(pg_temp.rj(pg_temp.at('Asia/Manila', 0, '18:00')), '6/6',
  'at Manila 18:00 sharp the job queues six reminders and returns that number');
select is(pg_temp.rem_labels(), 'b_d0,contm,early,late,ok_guest,ok_player,prevconf',
  'exactly: guest, player, 00:00 start, 23:00 start, a booking confirmed days ago, and a moved continuation of an online booking');
select is(pg_temp.nrem('ok_guest') + pg_temp.nrem('ok_player'), 2, 'a confirmed online booking tomorrow gets a reminder');
select is(pg_temp.nrem('early'), 1, 'a booking starting 00:00 tomorrow gets one (16:00 UTC today)');
select is(pg_temp.nrem('late'), 1, 'a booking starting 23:00 tomorrow gets one');
select is(pg_temp.nrem('prevconf'), 1, 'a booking confirmed days earlier gets one');
select is(pg_temp.nrem('ok_player'), 1, 'a booking confirmed at 17:59:59 gets one');
select is(pg_temp.nrem('contm') + pg_temp.nrem('rootm'), 1, 'a moved continuation of an online booking gets one (and its root, which started yesterday, none)');
select is(pg_temp.nrem('contm'), 1, 'the reminder is on the continuation, the booking that starts tomorrow');
select is(pg_temp.nrem('contw'), 0, 'a moved continuation of a walk-in gets none');
select is(pg_temp.nrem('walkin'), 0, 'a walk-in gets none, even with an email');
select is(pg_temp.nrem('pending'), 0, 'pending_payment gets none');
select is(pg_temp.nrem('submitted'), 0, 'payment_submitted gets none');
select is(pg_temp.nrem('cancelled'), 0, 'cancelled gets none');
select is(pg_temp.nrem('rejected'), 0, 'rejected gets none');
select is(pg_temp.nrem('expired'), 0, 'expired gets none');
select is(pg_temp.nrem('today'), 0, 'a booking starting today gets none');
select is(pg_temp.nrem('d2'), 0, 'a booking in two days gets none yet');
select is(pg_temp.nrem('after18'), 0, 'a booking confirmed at exactly 18:00 local gets none');
select is(pg_temp.nrem('after18b'), 0, 'a booking confirmed at 18:20 local gets none');
select is(pg_temp.nrem('blank'), 0, 'a blank guest email gets none');
select is(pg_temp.nrem('nomail'), 0, 'no guest email gets none');
select is(pg_temp.nrem('b_d1'), 0, 'Honolulu is at 00:00 then: its D+1 booking waits');

-- The row
select is(pg_temp.rem('ok_player') ->> 'to_email', 'pat@test.local', 'the row goes to the booking''s email');
select is(pg_temp.rem('ok_guest') ->> 'to_email', 'gina.rem@example.com', 'the recipient is trimmed');
select is((pg_temp.rem('ok_guest') ->> 'for_guest')::boolean, true, 'a guest booking (no user, a token hash) is for_guest');
select is((pg_temp.rem('ok_player') ->> 'for_guest')::boolean, false, 'a signed-in player''s booking is not for_guest');
select ok(
  (pg_temp.rem('ok_player') ->> 'status') = 'pending'
  and (pg_temp.rem('ok_player') ->> 'payment_id') is null and (pg_temp.rem('ok_player') ->> 'change_id') is null
  and (pg_temp.rem('ok_player') ->> 'next_attempt_at')::timestamptz <= now()
  and (pg_temp.rem('ok_player') ->> 'attempts')::int = 0,
  'the row is pending, due now, with no payment or change');
select is((pg_temp.rem('contm') ->> 'to_email'), 'moved@example.com', 'the continuation''s reminder goes to the contact it copied');
select is((pg_temp.rem('contm') ->> 'for_guest')::boolean, true, 'and is for_guest like the root');
select is((pg_temp.rem('contm') -> 'data' ->> 'reference_code'), (select ref from b where label = 'contm'),
  'its snapshot is the continuation''s own');
select is((pg_temp.rem('ok_player') ->> 'venue_id')::uuid, private.default_venue_id(), 'the row carries its booking''s venue');
select is((pg_temp.rem('b_d0') ->> 'venue_id')::uuid, 'b0000000-0000-0000-0000-00000000000b'::uuid, 'a venue B booking''s row carries venue B');

select ok(
  (pg_temp.rem('ok_player') -> 'data') ?& array['reference_code', 'venue_name', 'timezone', 'court_name', 'sport', 'starts_at', 'ends_at',
    'total_amount', 'booking_fee', 'amount_due', 'status', 'expires_at', 'name', 'waiver_text', 'waiver_accepted_at',
    'court_id', 'slots', 'address', 'maps_url'],
  'the snapshot has every EmailData key plus court_id, slots, address and maps_url');
select ok(
  (select d ->> 'reference_code' = b.ref and d ->> 'venue_name' = (select name from public.venue_settings where venue_id = private.default_venue_id())
          and d ->> 'timezone' = 'Asia/Manila' and d ->> 'court_name' = 'Court ok_player' and d ->> 'sport' = 'tennis'
          and (d ->> 'starts_at')::timestamptz = pg_temp.at('Asia/Manila', 1, '12:00')
          and (d ->> 'ends_at')::timestamptz = pg_temp.at('Asia/Manila', 1, '13:00')
          and (d ->> 'total_amount')::numeric = 500 and d ->> 'status' = 'confirmed' and d ->> 'name' = 'Name ok_player'
   from b, lateral (select pg_temp.rem('ok_player') -> 'data' as d) x where b.label = 'ok_player'),
  'the snapshot values are the booking''s');
select is((pg_temp.rem('ok_player') -> 'data' ->> 'court_id'), (select court::text from b where label = 'ok_player'), 'court_id is the court''s uuid as text');
select is(jsonb_typeof(pg_temp.rem('ok_player') -> 'data' -> 'court_id'), 'string', 'court_id is a JSON string');
select is((pg_temp.rem('ok_player') -> 'data' ->> 'slots')::int, 1, 'a one-hour booking has slots = 1');
select is(jsonb_typeof(pg_temp.rem('ok_player') -> 'data' -> 'slots'), 'number', 'slots is a JSON number');
select is((pg_temp.rem('early') -> 'data' ->> 'slots')::int, 2, 'a two-hour booking has slots = 2');
select is((pg_temp.rem('late') -> 'data' ->> 'slots')::int, 1, 'the 23:00-00:00 booking has slots = 1');
select is(pg_temp.rem('ok_player') -> 'data' ->> 'address', '12 Rizal Ave, Manila', 'the snapshot has the venue address');
select is(pg_temp.rem('ok_player') -> 'data' ->> 'maps_url', 'https://maps.app.goo.gl/claudex1', 'the snapshot has the venue maps link');
select is(
  (pg_temp.rem('b_d0') -> 'data' ->> 'address') || '|' || (pg_temp.rem('b_d0') -> 'data' ->> 'maps_url') || '|' || (pg_temp.rem('b_d0') -> 'data' ->> 'timezone'),
  '||Pacific/Honolulu', 'a venue without an address has address and maps_url as empty strings (keys present), and its own timezone');

-- Never twice
select is(pg_temp.hint_of($$ insert into public.email_outbox (booking_id, kind, to_email, for_guest, data)
    values ((select id from b where label = 'ok_player'), 'booking_reminder', 'pat@test.local', false, '{}'::jsonb) $$),
  'sqlstate 23505', 'the database refuses a second reminder row for one booking');

-- A wholesale move (the booking changes court and hour, but is still tomorrow) must not get a second one
update public.bookings set during = tstzrange(pg_temp.at('Asia/Manila', 1, '11:00'), pg_temp.at('Asia/Manila', 1, '12:00'))
  where id = (select id from b where label = 'ok_guest');
select is(pg_temp.rj(pg_temp.at('Asia/Manila', 0, '18:00')), '0/0', 'running the job again at the same time queues nothing');
select is(pg_temp.rj(pg_temp.at('Asia/Manila', 0, '20:00')), '0/0', 'running it two hours later queues nothing: a moved booking gets no second reminder');
select is(pg_temp.rem_labels(), 'b_d0,contm,early,late,ok_guest,ok_player,prevconf', 'the set is unchanged');
select is((select max(n)::int from (select count(*) n from public.email_outbox where kind::text = 'booking_reminder' group by booking_id) x), 1,
  'no booking has more than one reminder row');

-- ---------------------------------------------------------------------------
-- claim_email_outbox: booking_starts_at
-- ---------------------------------------------------------------------------
create temp table claimed (j jsonb);
grant select, insert on claimed to service_role;
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
insert into claimed select to_jsonb(c) from public.claim_email_outbox(100) c;
reset role;

select is(
  (select array_agg(k order by k) from (select distinct jsonb_object_keys(j) k from claimed) x),
  array['attempts', 'booking_id', 'booking_starts_at', 'booking_status', 'data', 'for_guest', 'id', 'kind', 'to_email'],
  'claim_email_outbox returns its existing columns plus booking_starts_at');
select is(
  (select (c.j ->> 'booking_starts_at')::timestamptz from claimed c where (c.j ->> 'booking_id')::uuid = (select id from b where label = 'ok_player')
     and c.j ->> 'kind' = 'booking_reminder'),
  pg_temp.at('Asia/Manila', 1, '12:00'), 'the claimed reminder carries the booking''s start');
select is(
  (select c.j ->> 'booking_status' from claimed c where (c.j ->> 'booking_id')::uuid = (select id from b where label = 'ok_player')
     and c.j ->> 'kind' = 'booking_reminder'),
  'confirmed', 'and the booking''s status now');
select is(
  (select (c.j ->> 'booking_starts_at')::timestamptz from claimed c where (c.j ->> 'booking_id')::uuid = (select id from b where label = 'ok_guest')
     and c.j ->> 'kind' = 'booking_reminder'),
  pg_temp.at('Asia/Manila', 1, '11:00'), 'after the booking moved, booking_starts_at is the NEW start');
select is(
  (select (c.j -> 'data' ->> 'starts_at')::timestamptz from claimed c where (c.j ->> 'booking_id')::uuid = (select id from b where label = 'ok_guest')
     and c.j ->> 'kind' = 'booking_reminder'),
  pg_temp.at('Asia/Manila', 1, '10:00'), 'while the snapshot still shows the old start');

-- ---------------------------------------------------------------------------
-- Venue B past 18:00 (Honolulu D 18:00 = Manila D+1 12:00); then the clock-suppression switch
-- ---------------------------------------------------------------------------
select is(pg_temp.rj(pg_temp.at('Pacific/Honolulu', 0, '18:00')), '1/1', 'at Honolulu 18:00 (Manila still before 18:00) only Honolulu queues');
select is(pg_temp.rem_labels(), 'b_d0,b_d1,contm,early,late,ok_guest,ok_player,prevconf', 'it is the Honolulu booking on Honolulu''s next day');
select is((pg_temp.rem('b_d1') ->> 'for_guest')::boolean, false, 'a signed-in player''s Honolulu booking is not for_guest');

select set_config('app.suppress_booking_emails', 'on', true);
select is(pg_temp.rj(pg_temp.at('Asia/Manila', 1, '18:00')), '0/0', 'app.suppress_booking_emails = on queues nothing');
select is(pg_temp.nrem('d2'), 0, 'not even the booking that would be due');
select set_config('app.suppress_booking_emails', '', true);
select is(pg_temp.rj(pg_temp.at('Asia/Manila', 1, '18:00')), '1/1', 'with the switch off, the next day''s booking is queued');
select is(pg_temp.rem_labels(), 'b_d0,b_d1,contm,d2,early,late,ok_guest,ok_player,prevconf', 'it is the booking two days out, now due tomorrow');
select is(pg_temp.rj(pg_temp.at('Asia/Manila', 1, '18:15')), '0/0', 'and a later run does not repeat it');

-- ---------------------------------------------------------------------------
-- create_booking and rebooked_from
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.bk('orig', $$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 3, '10:00'), 1, 'Gina Original', 'gina.orig@example.com') $$), 'ok', 'a guest books without the new argument');
select is(pg_temp.bk('orig_b', $$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-0000000000b1',
  pg_temp.atb(3, '10:00'), 1, 'Bea Original', 'bea.orig@example.com', null, true) $$), 'ok', 'a guest books at venue B without the new argument');
select is(pg_temp.bk('rb_valid', format($$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '10:00'), 1, 'Hank Other', 'hank@example.com', null, false, %L) $$, (select ref from b where label = 'orig'))),
  'ok', 'a guest rebooks with the original''s reference code (someone else''s booking: the code is no secret)');
select is(pg_temp.bk('rb_pad', format($$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '11:00'), 1, 'Pad Guest', 'pad@example.com', null, false, p_rebook_of_reference => %L) $$,
  '  ' || lower((select ref from b where label = 'orig')) || ' ')),
  'ok', 'a lower-case, padded code books');
select is(pg_temp.bk('rb_unknown', $$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '12:00'), 1, 'Una Known', 'una@example.com', null, false, 'CB-ZZZZZZ') $$),
  'ok', 'an unknown code is no error: the booking succeeds');
select is(pg_temp.bk('rb_blank', $$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '13:00'), 1, 'Blake Blank', 'blake@example.com', null, false, '   ') $$),
  'ok', 'a blank code is no error');
select is(pg_temp.bk('rb_empty', $$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '14:00'), 1, 'Emma Empty', 'emma@example.com', null, false, '') $$),
  'ok', 'an empty code is no error');
select is(pg_temp.bk('rb_foreign', format($$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '15:00'), 1, 'Fran Foreign', 'fran@example.com', null, false, %L) $$, (select ref from b where label = 'orig_b'))),
  'ok', 'a code of a booking at another venue is no error');
select is(pg_temp.bk('rb_b_valid', format($$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-0000000000b1',
  pg_temp.atb(4, '10:00'), 1, 'Bo Rebook', 'bo@example.com', null, true, %L) $$, (select ref from b where label = 'orig_b'))),
  'ok', 'a guest rebooks at venue B with a venue B code');
select is(pg_temp.bk('rb_b_foreign', format($$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-0000000000b1',
  pg_temp.atb(4, '11:00'), 1, 'Bix Foreign', 'bix@example.com', null, true, %L) $$, (select ref from b where label = 'orig'))),
  'ok', 'a venue A code at venue B is no error either');
select is(pg_temp.bk('noarg_guest', $$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '17:00'), 1, 'Nora Noarg', 'nora@example.com') $$), 'ok', 'a guest books with 5 arguments as before');
select is((select token is not null and ref ~ '^CB-' from b where label = 'noarg_guest'), true, 'a guest still gets a token and a reference code');

select is(pg_temp.hint_of(format($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '10:00'), 1, 'Dup Guest', 'dup@example.com', null, false, %L) $$, (select ref from b where label = 'orig'))),
  'slot_unavailable', 'a taken slot is still slot_unavailable with a code present');
select is(pg_temp.hint_of(format($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '18:00'), 1, null, null, null, false, %L) $$, (select ref from b where label = 'orig'))),
  'invalid_guest', 'a missing name and email is still invalid_guest with a code present');
select is(pg_temp.hint_of(format($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '18:00'), 1, 'Bad Mail', 'not-an-email', null, false, %L) $$, (select ref from b where label = 'orig'))),
  'invalid_guest', 'a bad email is still invalid_guest with a code present');
select is(pg_temp.hint_of(format($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000000b1',
  pg_temp.atb(4, '12:00'), 1, 'No Waiver', 'nowaiver@example.com', null, false, %L) $$, (select ref from b where label = 'orig_b'))),
  'waiver_required', 'a venue with a waiver still asks for it with a code present');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.bk('rb_player', format($$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '16:00'), 1, null, null, null, false, %L) $$, (select ref from b where label = 'orig'))),
  'ok', 'a signed-in player rebooks with a code');
select is(pg_temp.bk('noarg_player', $$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000001',
  pg_temp.at('Asia/Manila', 4, '19:00'), 1) $$), 'ok', 'a signed-in player books with 3 arguments as before');
select is(pg_temp.state_of($$ update public.bookings set rebooked_from = null $$), 'sqlstate 42501',
  'a signed-in player cannot write rebooked_from directly');
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.state_of($$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, rebooked_from)
  values ('CB-ANONRB', 'c0000000-0000-0000-0000-000000000001', 'X', tstzrange(now() + interval '90 days', now() + interval '90 days 1 hour'),
          500, (select id from b where label = 'orig')) $$), 'sqlstate 42501', 'anon cannot insert a booking with rebooked_from');
reset role;

select is(pg_temp.rf('rb_valid'), (select id::text from b where label = 'orig'), 'a valid code sets rebooked_from to that booking');
select is(pg_temp.rf('rb_pad'), (select id::text from b where label = 'orig'), 'the code is matched with upper(trim())');
select is(pg_temp.rf('rb_player'), (select id::text from b where label = 'orig'), 'a signed-in player''s rebooking is recorded');
select is(pg_temp.rf('rb_b_valid'), (select id::text from b where label = 'orig_b'), 'a venue B rebooking points at its venue B original');
select is(pg_temp.rf('rb_unknown'), '<null>', 'an unknown code leaves rebooked_from null');
select is(pg_temp.rf('rb_blank'), '<null>', 'a blank code leaves it null');
select is(pg_temp.rf('rb_empty'), '<null>', 'an empty code leaves it null');
select is(pg_temp.rf('rb_foreign'), '<null>', 'a code from venue B never links at venue A');
select is(pg_temp.rf('rb_b_foreign'), '<null>', 'a code from venue A never links at venue B');
select is(pg_temp.rf('noarg_guest'), '<null>', 'a booking without the argument has rebooked_from null (guest)');
select is(pg_temp.rf('noarg_player'), '<null>', 'a booking without the argument has rebooked_from null (player)');
select is(pg_temp.rf('orig'), '<null>', 'the original itself is not a rebooking');
select is((select count(*)::int from public.bookings where id in (select id from b where label in ('rb_foreign', 'rb_b_foreign'))), 2,
  'the bookings with a foreign code exist');

-- FK: deleting the original sets rebooked_from null
select pg_temp.mk('fk_orig', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 9, '10:00'), pg_temp.at('Asia/Manila', 9, '11:00')),
  'pending_payment', p_email => 'fk-orig@example.com');
select pg_temp.mk('fk_re', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 9, '12:00'), pg_temp.at('Asia/Manila', 9, '13:00')),
  'pending_payment', p_email => 'fk-re@example.com');
select is(pg_temp.link('fk_re', 'fk_orig'), 'ok', 'postgres can set rebooked_from');
select is(pg_temp.rf('fk_re'), (select id::text from b where label = 'fk_orig'), 'it points at the original');
delete from public.bookings where id = (select id from b where label = 'fk_orig');
select is(pg_temp.rf('fk_re'), '<null>', 'deleting the original sets rebooked_from to null');
select is((select count(*)::int from public.bookings where id = (select id from b where label = 'fk_re')), 1, 'and keeps the rebooking');

-- ---------------------------------------------------------------------------
-- Snapshot keys on the existing emails: payment_confirmed, booking_created, booking_rescheduled (new court and range)
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.bk('pc', $$ select id, reference_code, guest_token from public.create_booking('c0000000-0000-0000-0000-000000000002',
  pg_temp.at('Asia/Manila', 5, '08:00'), 3, 'Pam Confirmed', 'pam@example.com') $$), 'ok', 'a guest books three hours');
reset role;
update public.bookings set status = 'confirmed' where id = (select id from b where label = 'pc');

create function pg_temp.mail(p_label text, p_kind text) returns jsonb language sql as $$
  select o.data from public.email_outbox o join b on b.id = o.booking_id where b.label = p_label and o.kind::text = p_kind
$$;
select is((pg_temp.mail('pc', 'payment_confirmed') ->> 'court_id'), 'c0000000-0000-0000-0000-000000000002', 'payment_confirmed has court_id');
select is((pg_temp.mail('pc', 'payment_confirmed') ->> 'slots')::int, 3, 'payment_confirmed has slots = 3 for a three-hour booking');
select is(pg_temp.mail('pc', 'payment_confirmed') ->> 'address', '12 Rizal Ave, Manila', 'payment_confirmed has the address');
select is(pg_temp.mail('pc', 'payment_confirmed') ->> 'maps_url', 'https://maps.app.goo.gl/claudex1', 'payment_confirmed has the maps link');
select is((pg_temp.mail('pc', 'booking_created') ->> 'court_id') || '/' || (pg_temp.mail('pc', 'booking_created') ->> 'slots'),
  'c0000000-0000-0000-0000-000000000002/3', 'booking_created (built by the same function) has them too');

-- Reschedule: a 3-hour booking, the last two hours move to another court. Its root keeps one hour on the old court.
select pg_temp.mk('rs', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 6, '08:00'), pg_temp.at('Asia/Manila', 6, '11:00')),
  p_token => 'tok-rs', p_email => 'rs@example.com');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select * from public.reschedule_booking((select id from b where label = 'rs'), pg_temp.at('Asia/Manila', 6, '09:00'),
  'c0000000-0000-0000-0000-000000000003', pg_temp.at('Asia/Manila', 7, '14:00'), 'Testing') $$), null, 'staff reschedule the last two hours to another court');
reset role;
select is(
  (select o.data ->> 'court_id' from public.email_outbox o join b on b.id = o.booking_id where b.label = 'rs' and o.kind::text = 'booking_rescheduled'),
  'c0000000-0000-0000-0000-000000000003', 'booking_rescheduled has the NEW court id, not the root''s old court');
select is(
  (select (o.data ->> 'slots')::int from public.email_outbox o join b on b.id = o.booking_id where b.label = 'rs' and o.kind::text = 'booking_rescheduled'),
  2, 'and the NEW range''s slots (2), not the trimmed root''s one hour');

-- ---------------------------------------------------------------------------
-- get_earnings: rebooked {count}
-- ---------------------------------------------------------------------------
select pg_temp.mk('e_orig', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 15, '10:00'), pg_temp.at('Asia/Manila', 15, '11:00')), p_email => 'eo@example.com');
select pg_temp.mk('e1', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 20, '10:00'), pg_temp.at('Asia/Manila', 20, '11:00')), p_email => 'e1@example.com');
select pg_temp.mk('e2', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 22, '10:00'), pg_temp.at('Asia/Manila', 22, '11:00')), p_email => 'e2@example.com');
-- 00:00 local is 16:00 UTC the day before; 23:00 local is still the same UTC date
select pg_temp.mk('e_early', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 20, '00:00'), pg_temp.at('Asia/Manila', 20, '01:00')), p_email => 'ee@example.com');
select pg_temp.mk('e_late', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 22, '23:00'), pg_temp.at('Asia/Manila', 23, '00:00')), p_email => 'el@example.com');
select pg_temp.mk('e_out1', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 23, '00:00'), pg_temp.at('Asia/Manila', 23, '01:00')), p_email => 'eout1@example.com');
select pg_temp.mk('e_out2', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 19, '23:00'), pg_temp.at('Asia/Manila', 20, '00:00')), p_email => 'eout2@example.com');
select pg_temp.mk('e_cancel', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 21, '10:00'), pg_temp.at('Asia/Manila', 21, '11:00')), 'cancelled', p_email => 'ec@example.com');
select pg_temp.mk('e_pending', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 21, '12:00'), pg_temp.at('Asia/Manila', 21, '13:00')), 'pending_payment', p_email => 'ep@example.com');
select pg_temp.mk('e_plain', private.default_venue_id(), tstzrange(pg_temp.at('Asia/Manila', 21, '14:00'), pg_temp.at('Asia/Manila', 21, '15:00')), p_email => 'epl@example.com');
select pg_temp.mk('bb_orig', 'b0000000-0000-0000-0000-00000000000b', tstzrange(pg_temp.at('Pacific/Honolulu', 15, '10:00'), pg_temp.at('Pacific/Honolulu', 15, '11:00')), p_email => 'bbo@example.com');
select pg_temp.mk('bb1', 'b0000000-0000-0000-0000-00000000000b', tstzrange(pg_temp.at('Pacific/Honolulu', 21, '10:00'), pg_temp.at('Pacific/Honolulu', 21, '11:00')), p_email => 'bb1@example.com');
do $$ declare c text; begin
  foreach c in array array['e1', 'e2', 'e_early', 'e_late', 'e_out1', 'e_out2', 'e_cancel', 'e_pending'] loop
    perform pg_temp.link(c, 'e_orig');
  end loop;
  perform pg_temp.link('bb1', 'bb_orig');
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is((public.get_earnings((select d from today) + 20, (select d from today) + 22) -> 'rebooked')::text, '{"count": 4}',
  'rebooked counts confirmed rebookings by play date: both ends of the range inclusive, a 00:00 and a 23:00 start in, others out (cancelled, pending, plain, other venue)');
select is((public.get_earnings((select d from today) + 20, (select d from today) + 20) -> 'rebooked')::text, '{"count": 2}',
  'one day: the 10:00 and the 00:00 starts of that venue day');
select is((public.get_earnings((select d from today) + 23, (select d from today) + 23) -> 'rebooked')::text, '{"count": 1}',
  'the booking at 00:00 on D+23 local counts on D+23, not on D+22');
select is((public.get_earnings((select d from today) + 19, (select d from today) + 19) -> 'rebooked')::text, '{"count": 1}',
  'the 23:00 booking on D+19 counts on D+19');
select is((public.get_earnings((select d from today) + 40, (select d from today) + 40) -> 'rebooked')::text, '{"count": 0}',
  'a period with no rebookings says count 0');
select ok(not ((public.get_earnings((select d from today) + 20, (select d from today) + 22) -> 'previous') ? 'rebooked'),
  'the previous-period block has no rebooked key');
select ok(
  (public.get_earnings((select d from today) + 20, (select d from today) + 22)) ?& array['from', 'to', 'timezone', 'collected', 'previous', 'refunds_due',
    'daily', 'courts', 'sports', 'split', 'coming_up', 'rebooked'],
  'every existing key is still there beside rebooked');
select is(pg_temp.hint_of($$ select public.get_earnings(current_date, current_date, 'b0000000-0000-0000-0000-00000000000b') $$), 'forbidden',
  'venue A''s admin still cannot ask for venue B''s earnings');

select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is((public.get_earnings((select d from today) + 20, (select d from today) + 22) -> 'rebooked')::text, '{"count": 1}',
  'venue B''s admin sees only venue B''s rebooking');
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.get_earnings(current_date, current_date) $$), 'forbidden', 'a player still cannot call get_earnings');
reset role;

select * from finish();
rollback;
