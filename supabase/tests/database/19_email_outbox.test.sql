-- T8.2: email outbox, its queueing trigger, the worker RPCs and scheduling (SPEC §8, RESEARCH M8 plan items 1 and 5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.venue_settings set max_rejections = 2, payment_hold_minutes = 60;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';
insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000001', 'Mail Court', 'tennis', 500);

create temp table fx as select (private.local_today(private.default_venue_id()) + 3 + time '07:00') at time zone 'Asia/Manila' as t0;
create temp table b (label text primary key, id uuid, ref text, token text);
grant select on fx to anon, authenticated, service_role;
grant select, insert on b to anon, authenticated, service_role;

-- Bookings: a guest, a player, and a guest booking per later event
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
insert into b select 'guest', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t0, 1, 'Gina Guest', 'gina@example.com', '0917 000 0000') r;
insert into b select 'reject', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t0 + interval '2 hours', 1, 'Rita', 'rita@example.com', '0917 000 0000') r;
insert into b select 'paid', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t0 + interval '4 hours', 1, 'Paolo', 'paolo@example.com', '0917 000 0000') r;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
insert into b select 'player', r.id, r.reference_code, null
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t0 + interval '6 hours', 1) r;

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
insert into b select 'walkin', r.id, r.reference_code, null
from fx, public.create_walk_in('c0000000-0000-0000-0000-000000000001', fx.t0 + interval '8 hours', 1, 'Walker') r;
reset role;

-- ---------------------------------------------------------------------------
-- Schema, grants, RLS
-- ---------------------------------------------------------------------------
select has_index('public', 'payments', 'payments_provider_checkout_id_idx', 'payments has the provider_checkout_id index (M7 follow-up)');
select ok((select relrowsecurity from pg_class where oid = 'public.email_outbox'::regclass), 'email_outbox has RLS enabled');
select ok(not has_table_privilege('anon', 'public.email_outbox', 'select'), 'anon has no access to the outbox');
select ok(not has_table_privilege('authenticated', 'public.email_outbox', 'insert')
      and not has_table_privilege('authenticated', 'public.email_outbox', 'update')
      and not has_table_privilege('authenticated', 'public.email_outbox', 'delete'), 'clients cannot write the outbox');
select ok(
  not has_function_privilege('anon', 'public.claim_email_outbox(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_email_outbox(integer)', 'execute')
  and not has_function_privilege('anon', 'public.finish_email(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.finish_email(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.claim_guest_link_email(text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.claim_guest_link_email(text, text)', 'execute'),
  'the outbox RPCs are not callable by clients');
select ok(
  has_function_privilege('service_role', 'public.claim_email_outbox(integer)', 'execute')
  and has_function_privilege('service_role', 'public.finish_email(uuid, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.claim_guest_link_email(text, text)', 'execute'),
  'service_role can call the outbox RPCs');
select ok(not has_function_privilege('authenticated', 'private.kick_email_worker()', 'execute')
      and not has_function_privilege('authenticated', 'private.purge_email_outbox()', 'execute'),
  'clients cannot run the scheduling helpers');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is((select count(*)::int from public.email_outbox), 0, 'a player cannot read the outbox, not even their own emails');
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select ok((select count(*) from public.email_outbox) >= 4, 'admins can read the outbox');
reset role;

-- ---------------------------------------------------------------------------
-- Queueing: booking_created
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.email_outbox o join b on b.id = o.booking_id where b.label = 'guest'), 1,
  'a guest booking queues exactly one email');
select ok(
  (select o.kind = 'booking_created' and o.for_guest and o.to_email = 'gina@example.com' and o.status = 'pending'
          and o.next_attempt_at > now() + interval '9 minutes'
   from public.email_outbox o join b on b.id = o.booking_id where b.label = 'guest'),
  'a guest booking_created waits 10 minutes for the guest link');
select ok(
  (select position(b.token in o.data::text) = 0 and position(b.token in o.to_email) = 0
   from public.email_outbox o join b on b.id = o.booking_id where b.label = 'guest'),
  'the guest token is never stored in the outbox');
select ok(
  (select o.data ->> 'reference_code' = b.ref and o.data ->> 'court_name' = 'Mail Court'
          and (o.data ->> 'total_amount')::numeric = 500 and o.data ->> 'timezone' = 'Asia/Manila'
          and (o.data ->> 'starts_at')::timestamptz = (select t0 from fx)
          and o.data ->> 'name' = 'Gina Guest' and o.data ? 'expires_at'
   from public.email_outbox o join b on b.id = o.booking_id where b.label = 'guest'),
  'the snapshot has what the template needs');
select ok(
  (select o.kind = 'booking_created' and not o.for_guest and o.to_email = 'pat@test.local' and o.next_attempt_at <= now()
   from public.email_outbox o join b on b.id = o.booking_id where b.label = 'player'),
  'a player booking_created is due at once, to the snapshot email');
select is(
  (select count(*)::int from public.email_outbox o join b on b.id = o.booking_id where b.label = 'walkin'), 0,
  'walk-ins never queue an email');

insert into public.bookings (id, reference_code, court_id, guest_name, guest_email, during, total_amount, status, source)
values ('b0000000-0000-0000-0000-0000000000e1', 'CB-MXQW22', 'c0000000-0000-0000-0000-000000000001', 'Wanda', 'wanda@example.com',
        tstzrange('2031-01-06 08:00+08', '2031-01-06 09:00+08'), 500, 'confirmed', 'walk_in');
select is((select count(*)::int from public.email_outbox where booking_id = 'b0000000-0000-0000-0000-0000000000e1'), 0,
  'a walk-in with an email still queues nothing');

select set_config('app.suppress_booking_emails', 'on', true);
insert into public.bookings (id, reference_code, court_id, guest_name, guest_email, during, total_amount, status, expires_at)
values ('b0000000-0000-0000-0000-0000000000e2', 'CB-MXQS33', 'c0000000-0000-0000-0000-000000000001', 'Seed', 'seed@example.com',
        tstzrange('2031-01-06 10:00+08', '2031-01-06 11:00+08'), 500, 'pending_payment', now() + interval '1 hour');
select is((select count(*)::int from public.email_outbox where booking_id = 'b0000000-0000-0000-0000-0000000000e2'), 0,
  'app.suppress_booking_emails (seed.sql) queues nothing');
select set_config('app.suppress_booking_emails', '', true);

-- ---------------------------------------------------------------------------
-- Queueing: proof_rejected, payment_confirmed, booking_cancelled
-- ---------------------------------------------------------------------------
set local role service_role;
select public.record_payment_proof(id, id::text || '/1.png', 'gcash', 500) from b where label in ('reject', 'paid');
reset role;
select is((select count(*)::int from public.email_outbox o join b on b.id = o.booking_id where b.label = 'reject'), 1,
  'submitting a proof queues nothing');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select public.review_payment((select id from b where label = 'reject'), false, 'Blurry screenshot');
reset role;
select ok(
  (select o.data ->> 'note' = 'Blurry screenshot' and o.data -> 'final' = 'false'::jsonb and o.payment_id is not null
          and o.for_guest and o.next_attempt_at <= now()
   from public.email_outbox o join b on b.id = o.booking_id where b.label = 'reject' and o.kind = 'proof_rejected'),
  'an admin rejection queues proof_rejected with the note, due at once');

set local role service_role;
select public.record_payment_proof(id, id::text || '/2.png', 'gcash', 500) from b where label = 'reject';
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select public.review_payment((select id from b where label = 'reject'), false, 'Wrong amount');
reset role;
select is(
  (select array_agg(o.data ->> 'final' order by o.created_at, o.data ->> 'final')
   from public.email_outbox o join b on b.id = o.booking_id where b.label = 'reject' and o.kind = 'proof_rejected'),
  array['false', 'true'], 'each rejection gets its own email, and the last one says it was final');
select is((select count(distinct o.payment_id)::int from public.email_outbox o join b on b.id = o.booking_id
           where b.label = 'reject' and o.kind = 'proof_rejected'), 2, 'each rejection email points at its own proof');

-- A proof superseded by a PayMongo payment: payment_confirmed only, no rejection email.
-- (stored directly: record_paymongo_checkout only accepts a booking still waiting for a payment)
insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos)
select id, 'cs_mail_paid', 'https://checkout.paymongo.test/x', 50000 from b where label = 'paid';
set local role service_role;
select is(
  (select r.outcome from b, public.record_paymongo_payment('cs_mail_paid', 'pay_mail_paid', 'evt_mail_1', 50000, 'PHP', 'gcash', b.id) r
   where b.label = 'paid'),
  'superseded_proof', 'the webhook confirms a booking whose proof was waiting');
select is(
  (select r.outcome from b, public.record_paymongo_payment('cs_mail_paid', 'pay_mail_paid', 'evt_mail_2', 50000, 'PHP', 'gcash', b.id) r
   where b.label = 'paid'),
  'duplicate', 'a replayed webhook still succeeds with the email already queued');
reset role;
select is(
  (select array_agg(o.kind::text order by o.kind) from public.email_outbox o join b on b.id = o.booking_id where b.label = 'paid'),
  array['booking_created', 'payment_confirmed'], 'an auto-closed proof never reads as a rejection, and confirmation is queued once');

-- Approve path (player)
set local role service_role;
select public.record_payment_proof(id, id::text || '/1.png', 'gcash', 500) from b where label = 'player';
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select public.review_payment((select id from b where label = 'player'), true);
reset role;
select ok(exists (select 1 from public.email_outbox o join b on b.id = o.booking_id
                  where b.label = 'player' and o.kind = 'payment_confirmed' and not o.for_guest),
  'approving a proof queues payment_confirmed');

-- Same status again, and a repeated transition: no new row and no error
update public.bookings set status = 'confirmed' where id = (select id from b where label = 'player');
select lives_ok(
  $$ update public.bookings set status = 'payment_submitted' where id = (select id from b where label = 'player');
     update public.bookings set status = 'confirmed' where id = (select id from b where label = 'player') $$,
  'a repeated event does not fail the booking change');
select is((select count(*)::int from public.email_outbox o join b on b.id = o.booking_id
           where b.label = 'player' and o.kind = 'payment_confirmed'), 1, 'a repeated event queues nothing new');

-- Guest cancellation
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select public.cancel_booking(p_reference_code => (select ref from b where label = 'guest'), p_token => (select token from b where label = 'guest'));
reset role;
select ok(
  (select o.data -> 'cancelled_by_venue' = 'false'::jsonb and o.for_guest and o.data ->> 'status' = 'cancelled'
   from public.email_outbox o join b on b.id = o.booking_id where b.label = 'guest' and o.kind = 'booking_cancelled'),
  'cancelling queues booking_cancelled, saying who cancelled');

-- An error while queueing never fails the booking change
alter table public.email_outbox add constraint email_outbox_test_block check (false) not valid;
select lives_ok(
  $$ update public.bookings set status = 'cancelled', cancelled_at = now() where id = (select id from b where label = 'player') $$,
  'the booking change commits even when queueing its email fails');
select is((select status::text from public.bookings where id = (select id from b where label = 'player')), 'cancelled',
  'the booking status changed');
alter table public.email_outbox drop constraint email_outbox_test_block;

-- ---------------------------------------------------------------------------
-- claim_guest_link_email
-- ---------------------------------------------------------------------------
insert into b select 'guest2', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000001', fx.t0 + interval '10 hours', 1, 'Gabe', 'gabe@example.com', '0917 000 0000') r;

set local role service_role;
select is(pg_temp.hint_of($$ select * from public.claim_guest_link_email((select ref from b where label = 'guest2'), 'wrong') $$),
  'not_found', 'a wrong token claims nothing');
select is(pg_temp.hint_of($$ select * from public.claim_guest_link_email('CB-ZZZZZZ', 'x') $$),
  'not_found', 'an unknown reference gives the same answer');
select is(pg_temp.hint_of($$ select * from public.claim_guest_link_email((select ref from b where label = 'player'), '') $$),
  'not_found', 'a player booking has no guest link email');
select is(pg_temp.hint_of($$ select * from public.claim_guest_link_email((select ref from b where label = 'guest'), (select token from b where label = 'guest')) $$),
  null, 'a guest booking whose email is still pending can be claimed with its token');
select ok(
  (select r.reference_code = b.ref and r.to_email = 'gabe@example.com' and r.attempts = 1 and r.data ->> 'name' = 'Gabe'
   from b, public.claim_guest_link_email(lower(b.ref), b.token) r where b.label = 'guest2'),
  'the right token leases the booking_created row (reference matched case-insensitively)');
reset role;
select ok((select o.status = 'sending' and o.locked_until > now()
           from public.email_outbox o join b on b.id = o.booking_id where b.label = 'guest2' and o.kind = 'booking_created'),
  'the claimed row is leased');
set local role service_role;
select is(pg_temp.hint_of($$ select * from public.claim_guest_link_email((select ref from b where label = 'guest2'), (select token from b where label = 'guest2')) $$),
  'not_found', 'a second call claims nothing (one link email per booking)');

-- ---------------------------------------------------------------------------
-- claim_email_outbox / finish_email
-- ---------------------------------------------------------------------------
reset role;
-- Isolate the queue: everything from other tests in this transaction is parked far in the future.
-- (only unsent rows: the local database may also hold real rows from smoke runs)
update public.email_outbox set status = 'pending', locked_until = null, next_attempt_at = now() + interval '1 day'
where status in ('pending', 'sending') and booking_id not in (select id from b where label in ('player', 'reject'));
update public.email_outbox set next_attempt_at = now() + interval '1 day'
where booking_id = (select id from b where label = 'reject') and kind <> 'booking_created';
update public.email_outbox set next_attempt_at = now() - interval '1 second'
where booking_id = (select id from b where label = 'reject') and kind = 'booking_created';

set local role service_role;
create temp table claimed as select * from public.claim_email_outbox(10);
reset role;
select is(
  (select array_agg(c.kind::text order by c.kind) from claimed c),
  array['booking_created', 'booking_created', 'payment_confirmed'], 'claim returns the due rows only');
select ok(
  (select bool_and(o.status = 'sending' and o.attempts = 1 and o.locked_until > now())
   from public.email_outbox o where o.id in (select id from claimed)),
  'claimed rows are leased with one attempt counted');
select is(
  (select c.booking_status::text from claimed c join b on b.id = c.booking_id where b.label = 'reject' and c.kind = 'booking_created'),
  'rejected', 'claim reports the booking status now, so the worker can drop an overtaken booking_created');
set local role service_role;
select is((select count(*)::int from public.claim_email_outbox(10)), 0, 'leased rows are not claimed twice');

select is(public.finish_email((select c.id from claimed c join b on b.id = c.booking_id where b.label = 'player' and c.kind = 'booking_created'), 'sent'),
  'sent'::public.email_status, 'finish sent');
select is(pg_temp.hint_of($$ select public.finish_email((select c.id from claimed c join b on b.id = c.booking_id where b.label = 'player' and c.kind = 'booking_created'), 'sent') $$),
  'invalid_state', 'a finished email cannot be finished again');
select is(public.finish_email((select c.id from claimed c join b on b.id = c.booking_id where b.label = 'reject'), 'skipped', 'overtaken'),
  'skipped'::public.email_status, 'finish skipped');
select is(public.finish_email((select c.id from claimed c where c.kind = 'payment_confirmed'), 'failed', 'Resend 500'),
  'pending'::public.email_status, 'a failed first attempt is retried');
reset role;
select ok(
  (select o.next_attempt_at between now() + interval '55 seconds' and now() + interval '65 seconds' and o.last_error = 'Resend 500'
   from public.email_outbox o where o.id = (select c.id from claimed c where c.kind = 'payment_confirmed')),
  'the first retry is in 1 minute');
select ok(
  (select o.sent_at is not null from public.email_outbox o
   where o.id = (select c.id from claimed c join b on b.id = c.booking_id where b.label = 'player' and c.kind = 'booking_created')),
  'a sent email records when');

-- Fifth attempt fails for good; an expired lease is claimed again, or fails once out of attempts
update public.email_outbox set status = 'sending', attempts = 5, locked_until = now() + interval '5 minutes'
where id = (select c.id from claimed c where c.kind = 'payment_confirmed');
set local role service_role;
select is(public.finish_email((select c.id from claimed c where c.kind = 'payment_confirmed'), 'failed', 'Resend 500'),
  'failed'::public.email_status, 'the 5th failed attempt marks the email failed');
reset role;
update public.email_outbox set status = 'sending', attempts = 2, locked_until = now() - interval '1 second'
where id = (select c.id from claimed c where c.kind = 'payment_confirmed');
set local role service_role;
select is((select r.attempts from public.claim_email_outbox(10) r), 3::smallint, 'an expired lease is claimed again');
reset role;
update public.email_outbox set status = 'sending', attempts = 5, locked_until = now() - interval '1 second'
where id = (select c.id from claimed c where c.kind = 'payment_confirmed');
set local role service_role;
select is((select count(*)::int from public.claim_email_outbox(10)), 0, 'an expired lease out of attempts is not claimed');
reset role;
select is((select status::text from public.email_outbox where id = (select c.id from claimed c where c.kind = 'payment_confirmed')),
  'failed', '... and becomes failed');

set local role service_role;
select is(pg_temp.hint_of($$ select public.finish_email(gen_random_uuid(), 'sent') $$), 'not_found', 'finishing an unknown email');
select is(pg_temp.hint_of($$ select public.finish_email(gen_random_uuid(), 'bounced') $$), 'invalid_input', 'unknown outcomes are refused');
reset role;

-- ---------------------------------------------------------------------------
-- Scheduling and retention
-- ---------------------------------------------------------------------------
select is((select count(*)::int from cron.job where jobname in ('send-emails', 'purge-email-outbox')), 2, 'both cron jobs are scheduled');

update public.email_outbox set next_attempt_at = now() - interval '1 second', status = 'pending', locked_until = null
where booking_id = (select id from b where label = 'guest2');
select is(private.kick_email_worker(), null, 'without the Vault secrets the worker is not called');
select vault.create_secret('http://example.invalid/functions/v1/send-emails', 'email_worker_url');
select vault.create_secret('test-worker-secret', 'email_worker_secret');
-- (in its own statement: the queued request is only visible to the next statement's snapshot)
create temp table kicked as select private.kick_email_worker() as id;
select ok(
  (select q.headers ->> 'x-worker-secret' = 'test-worker-secret' and q.body = convert_to('{}', 'UTF8')
   from kicked k join net.http_request_queue q on q.id = k.id),
  'with due work and the secrets, the worker is called with an empty body');

update public.email_outbox set status = 'sent', sent_at = now(), created_at = now() - interval '31 days'
where booking_id = (select id from b where label = 'guest2');
update public.email_outbox set created_at = now() - interval '31 days'
where booking_id = (select id from b where label = 'paid') and status = 'pending';
select ok(private.purge_email_outbox() >= 1, 'old finished emails are purged');
select ok(not exists (select 1 from public.email_outbox o join b on b.id = o.booking_id where b.label = 'guest2')
      and exists (select 1 from public.email_outbox o join b on b.id = o.booking_id where b.label = 'paid' and o.status = 'pending'),
  'only finished rows are purged; pending ones are kept');

select * from finish();
rollback;
