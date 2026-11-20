-- T30.3: public.finish_email accepts a fourth outcome, 'deferred' (Resend's daily or monthly quota answered 429).
-- The row goes back to pending without spending one of its 5 attempts, and waits until 5 minutes past the next UTC
-- midnight (when Resend's daily quota resets). The other outcomes behave as before (T8.2, 19_email_outbox.test.sql).
-- Calls go through a helper that returns the status or the hint, so a missing behavior fails its own assertion
-- instead of aborting the transaction.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

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

-- A valid reference code (no I, O, 0 or 1) per fixture number.
create function pg_temp.ref(n int) returns text language sql immutable as $$ select 'CB-DFR' || substr('ABCDEFGH', n, 1) || 'XY' $$;

create temp table o (label text primary key, id uuid, booking_id uuid);
grant select on o to anon, authenticated, service_role;

-- finish_email for a labelled row: the returned status, or the hint of the error it raised.
create function pg_temp.fin(p_label text, p_outcome text, p_error text default null) returns text language plpgsql as $$
declare r text; h text;
begin
  select public.finish_email(o.id, p_outcome, p_error)::text into r from o where o.label = p_label;
  return r;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
grant execute on function pg_temp.fin(text, text, text) to anon, authenticated, service_role;

-- The labelled row as 'status|attempts|locked_until is null|sent_at is null'.
create function pg_temp.row_of(p_label text) returns text language sql stable as $$
  select e.status::text || '|' || e.attempts::text || '|' || (e.locked_until is null)::text || '|' || (e.sent_at is null)::text
  from public.email_outbox e join o on o.id = e.id where o.label = p_label
$$;
grant execute on function pg_temp.row_of(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures: one booking and one outbox row per scenario (a booking has one row per kind)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values ('89000000-0000-0000-0000-000000000001', 'defer@test.local');
insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000089', 'Defer Court', 'tennis', 500);

select set_config('app.suppress_booking_emails', 'on', true);
insert into public.bookings (id, reference_code, court_id, guest_name, guest_email, during, total_amount, status, expires_at)
select ('b0000000-0000-0000-0000-0000000089' || lpad(n::text, 2, '0'))::uuid,
       pg_temp.ref(n), 'c0000000-0000-0000-0000-000000000089', 'Defer ' || n, 'defer' || n || '@example.com',
       tstzrange(timestamptz '2031-02-03 06:00+08' + (n || ' hours')::interval, timestamptz '2031-02-03 07:00+08' + (n || ' hours')::interval),
       500, 'pending_payment', now() + interval '1 hour'
from generate_series(1, 8) n;
select set_config('app.suppress_booking_emails', '', true);

-- Everything else in the queue is parked, so claim_email_outbox only sees these rows.
update public.email_outbox set status = 'pending', locked_until = null, next_attempt_at = now() + interval '30 days'
where status in ('pending', 'sending')
  and booking_id not in (select b.id from public.bookings b where b.reference_code like 'CB-DFR_XY');

-- label, booking number, status, attempts. Sending rows hold a lease; the pending one is far in the future.
insert into public.email_outbox (booking_id, kind, to_email, for_guest, data, status, attempts, next_attempt_at, locked_until)
select b.id, 'booking_reminder', 'defer' || v.n || '@example.com', true, '{}'::jsonb, v.status::public.email_status, v.attempts,
       case when v.status = 'pending' then now() + interval '30 days' else now() end,
       case when v.status = 'sending' then now() + interval '5 minutes' end
from (values (1, 'sending', 2), (2, 'sending', 0), (3, 'sending', 5), (4, 'pending', 0), (5, 'sending', 1),
             (6, 'sending', 1), (7, 'sending', 1), (8, 'sending', 5)) as v(n, status, attempts)
join public.bookings b on b.reference_code = pg_temp.ref(v.n);

insert into o (label, id, booking_id)
select v.label, e.id, e.booking_id
from (values ('a', 1), ('zero', 2), ('five', 3), ('pending', 4), ('sent', 5), ('skipped', 6), ('failed1', 7), ('failed5', 8)) v(label, n)
join public.bookings b on b.reference_code = pg_temp.ref(v.n)
join public.email_outbox e on e.booking_id = b.id;

select is((select count(*)::int from o), 8, 'fixture: eight labelled outbox rows');

-- ---------------------------------------------------------------------------
-- Signature and grants (unchanged)
-- ---------------------------------------------------------------------------
select has_function('public', 'finish_email', array['uuid', 'text', 'text'], 'finish_email keeps its signature (uuid, text, text)');
select ok(has_function_privilege('service_role', 'public.finish_email(uuid, text, text)', 'execute'), 'service_role can call finish_email');
select ok(not has_function_privilege('anon', 'public.finish_email(uuid, text, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.finish_email(uuid, text, text)', 'execute'),
  'anon and authenticated cannot execute finish_email');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "89000000-0000-0000-0000-000000000001", "role": "authenticated"}', true);
select is(pg_temp.state_of($$ select public.finish_email(gen_random_uuid(), 'deferred', 'x') $$), 'sqlstate 42501',
  'a signed-in user cannot defer an email (permission denied)');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.state_of($$ select public.finish_email(gen_random_uuid(), 'deferred', 'x') $$), 'sqlstate 42501',
  'anon cannot defer an email (permission denied)');
reset role;

-- ---------------------------------------------------------------------------
-- Rejections
-- ---------------------------------------------------------------------------
set local role service_role;
select is(pg_temp.hint_of($$ select public.finish_email(gen_random_uuid(), 'bounced') $$), 'invalid_input', 'an unknown outcome is still invalid_input');
select is(pg_temp.hint_of($$ select public.finish_email(gen_random_uuid(), null) $$), 'invalid_input', 'a null outcome is still invalid_input');
select is(pg_temp.hint_of($$ select public.finish_email(gen_random_uuid(), 'deferred', 'x') $$), 'not_found', 'deferring an unknown email is not_found');
select is(pg_temp.fin('pending', 'deferred', 'Resend 429: daily_quota_exceeded'), 'invalid_state', 'deferring a row that is not being sent is invalid_state');
reset role;
select is(pg_temp.row_of('pending'), 'pending|0|true|true', 'a refused deferral leaves the row as it was');

-- ---------------------------------------------------------------------------
-- deferred
-- ---------------------------------------------------------------------------
set local role service_role;
select is(pg_temp.fin('a', 'deferred', 'Resend 429: {"name":"daily_quota_exceeded"}'), 'pending', 'deferred returns pending');
select is(pg_temp.fin('zero', 'deferred', repeat('x', 1500)), 'pending', 'deferring a row with no attempts returns pending');
select is(pg_temp.fin('five', 'deferred', 'Resend 429: monthly_quota_exceeded'), 'pending', 'deferring the 5th attempt returns pending, never failed');
reset role;

select is(pg_temp.row_of('a'), 'pending|1|true|true', 'deferred: back to pending, lease released, one attempt given back (2 -> 1)');
select is(pg_temp.row_of('zero'), 'pending|0|true|true', 'deferred: attempts never go below 0');
select is(pg_temp.row_of('five'), 'pending|4|true|true', 'deferred at 5 attempts ends pending with 4, not failed');
select is(
  (select e.next_attempt_at from public.email_outbox e join o on o.id = e.id where o.label = 'a'),
  (date_trunc('day', now() at time zone 'utc') + interval '1 day' + interval '5 minutes') at time zone 'utc',
  'deferred: next_attempt_at is the next UTC midnight plus 5 minutes');
select ok(
  (select bool_and(e.next_attempt_at = (date_trunc('day', now() at time zone 'utc') + interval '1 day' + interval '5 minutes') at time zone 'utc')
   from public.email_outbox e join o on o.id = e.id where o.label in ('a', 'zero', 'five')),
  'every deferred row waits for the same moment');
select ok(
  (select e.next_attempt_at > now() and e.next_attempt_at <= now() + interval '1 day 5 minutes 1 second'
   from public.email_outbox e join o on o.id = e.id where o.label = 'a'),
  'the deferral is in the future and no more than a day and 5 minutes away');
select is(
  (select e.last_error from public.email_outbox e join o on o.id = e.id where o.label = 'a'),
  'Resend 429: {"name":"daily_quota_exceeded"}', 'deferred: the error text is kept in last_error');
select is(
  (select length(e.last_error) from public.email_outbox e join o on o.id = e.id where o.label = 'zero'),
  1000, 'deferred: last_error is cut to 1000 characters');

-- A deferred row is not claimable until its time comes, and then costs one attempt like any other.
set local role service_role;
select is((select count(*)::int from public.claim_email_outbox(100) c join o on o.id = c.id), 0, 'a deferred row is not claimed before its time');
reset role;
update public.email_outbox set next_attempt_at = now() - interval '1 second' where id = (select id from o where label = 'a');
set local role service_role;
create temp table reclaimed as select c.id, c.attempts::int as attempts, c.kind::text as kind from public.claim_email_outbox(100) c join o on o.id = c.id;
reset role;
select is((select attempts from reclaimed where id = (select id from o where label = 'a')), 2, 'after its time the row is claimed again, back to its earlier attempts plus one');
select is((select count(*)::int from reclaimed), 1, 'only the due row was claimed (the other deferred rows still wait)');
select is(pg_temp.row_of('a'), 'sending|2|false|true', 'the reclaimed row is leased again');

-- Deferring again keeps giving the attempt back, so a quota that lasts days never runs the row out of attempts.
set local role service_role;
select is(pg_temp.fin('a', 'deferred', 'Resend 429: daily_quota_exceeded'), 'pending', 'a second deferral returns pending');
reset role;
select is(pg_temp.row_of('a'), 'pending|1|true|true', 'a second deferral gives the attempt back again');

-- ---------------------------------------------------------------------------
-- The other outcomes behave as before
-- ---------------------------------------------------------------------------
set local role service_role;
select is(pg_temp.fin('sent', 'sent'), 'sent', 'sent still returns sent');
select is(pg_temp.fin('skipped', 'skipped', 'Overtaken: the booking is cancelled.'), 'skipped', 'skipped still returns skipped');
select is(pg_temp.fin('failed1', 'failed', 'Resend 500'), 'pending', 'a first failed attempt is still retried');
select is(pg_temp.fin('failed5', 'failed', 'Resend 500'), 'failed', 'the 5th failed attempt still marks the email failed');
reset role;
select is(pg_temp.row_of('sent'), 'sent|1|true|false', 'sent still records when (sent_at set, lease released)');
select ok(
  (select e.next_attempt_at between now() + interval '55 seconds' and now() + interval '65 seconds' and e.attempts = 1
   from public.email_outbox e join o on o.id = e.id where o.label = 'failed1'),
  'a failed attempt still retries in 1 minute and keeps its attempt');

select * from finish();
rollback;
