-- T14.12: private.reset_demo_venue() and the demo-reset pg_cron job. Restores the venue with slug 'claudex-courts' to
-- its seed bookings (the five CB-DEMQ* bookings and their payments, dates relative to the venue's local today) after
-- deleting EVERY booking of that venue (walk-ins, guest bookings, bookings with billing charges), with emails
-- suppressed. Never touches another venue, and leaves courts, rates, settings and invoices alone. Run as postgres.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Fixtures raise no emails; the reset must suppress them itself, so the setting is switched off again before the calls.
select set_config('app.suppress_booking_emails', 'on', true);

-- Start from a known demo state: no demo bookings, then stale data a reset has to remove.
delete from public.bookings where reference_code like 'CB-DEMQ%';

create temp table ids as select (select id from public.venues where slug = 'claudex-courts') as demo;
grant select on ids to public;

-- A second venue with a court, a confirmed booking, a payment, a billing charge and an invoice.
insert into public.venues (id, slug, status) values ('a0000000-0000-0000-0000-000000006301', 'e2e-dr-other', 'active');
insert into public.venue_settings (venue_id, name, timezone) values ('a0000000-0000-0000-0000-000000006301', 'E2E DR Other', 'Asia/Manila');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-000000006301', 'a0000000-0000-0000-0000-000000006301', 'E2E DR Court', 'tennis', 100, true);
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, confirmed_at) values
  ('b0000000-0000-0000-0000-000000006301', 'a0000000-0000-0000-0000-000000006301', 'c0000000-0000-0000-0000-000000006301',
   'E2E DR other', 'CB-WWWWDR', 100, tstzrange('2031-03-01 01:00+00', '2031-03-01 02:00+00'), 'confirmed', now());
insert into public.payments (booking_id, method, amount, reference_number, submitted_at, review_status, reviewed_at) values
  ('b0000000-0000-0000-0000-000000006301', 'gcash', 100, 'E2E-DR-OTHER', now(), 'approved', now());
insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month) values
  ('a0000000-0000-0000-0000-000000006301', 'b0000000-0000-0000-0000-000000006301', 'booking_fee', 10, '2031-03-01 01:00+00', '2031-03-01');
insert into public.invoices (venue_id, billing_month, status) values ('a0000000-0000-0000-0000-000000006301', '2031-02-01', 'draft');

-- The demo venue: a stale seed booking, a walk-in, a guest booking with a payment and a billing charge, an invoice.
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, source, confirmed_at)
select 'b0000000-0000-0000-0000-000000006311', demo, (select id from public.courts where venue_id = demo and name = 'Badminton 1'),
       'E2E DR stale', 'CB-DEMQA2', 1, tstzrange('2031-03-03 02:00+00', '2031-03-03 03:00+00'), 'confirmed', 'online', now() from ids;
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, source, confirmed_at)
select 'b0000000-0000-0000-0000-000000006312', demo, (select id from public.courts where venue_id = demo and name = 'Badminton 3'),
       'E2E DR walk-in', 'CB-WWWWDS', 100, tstzrange('2031-03-01 02:00+00', '2031-03-01 03:00+00'), 'confirmed', 'walk_in', now() from ids;
insert into public.bookings (id, venue_id, court_id, guest_name, guest_email, reference_code, total_amount, during, status, source, confirmed_at)
select 'b0000000-0000-0000-0000-000000006313', demo, (select id from public.courts where venue_id = demo and name = 'Badminton 4'),
       'E2E DR guest', 'e2e-dr@example.com', 'CB-WWWWDT', 100, tstzrange('2031-03-02 02:00+00', '2031-03-02 03:00+00'), 'confirmed', 'online', now() from ids;
insert into public.payments (booking_id, method, amount, reference_number, submitted_at, review_status, reviewed_at) values
  ('b0000000-0000-0000-0000-000000006313', 'gcash', 100, 'E2E-DR-GUEST', now(), 'approved', now());
insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month)
select demo, 'b0000000-0000-0000-0000-000000006313', 'booking_fee', 10, '2031-03-02 02:00+00', '2031-03-01' from ids;
insert into public.invoices (venue_id, billing_month, status) select demo, '2020-01-01', 'draft' from ids;

-- Fingerprints of what must not change.
create function pg_temp.fp(p_sql text) returns text language plpgsql as $$
declare r text;
begin execute 'select coalesce(md5(string_agg(t::text, '','' order by t::text)), ''none'') from (' || p_sql || ') t' into r; return r; end $$;
create temp table before_fp as select
  pg_temp.fp($$ select * from public.bookings where venue_id = 'a0000000-0000-0000-0000-000000006301' $$) as bookings,
  pg_temp.fp($$ select * from public.payments where booking_id = 'b0000000-0000-0000-0000-000000006301' $$) as payments,
  pg_temp.fp($$ select * from public.billing_charges where venue_id = 'a0000000-0000-0000-0000-000000006301' $$) as charges,
  pg_temp.fp($$ select * from public.invoices where venue_id = 'a0000000-0000-0000-0000-000000006301' $$) as invoices,
  pg_temp.fp($$ select * from public.courts where venue_id = 'a0000000-0000-0000-0000-000000006301' $$) as courts,
  pg_temp.fp($$ select * from public.email_outbox where venue_id = 'a0000000-0000-0000-0000-000000006301' $$) as outbox,
  pg_temp.fp($$ select * from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-000000006301' $$) as settings,
  pg_temp.fp($$ select * from public.courts where venue_id = (select id from public.venues where slug = 'claudex-courts') $$) as demo_courts,
  pg_temp.fp($$ select r.* from public.court_rates r join public.courts c on c.id = r.court_id where c.venue_id = (select id from public.venues where slug = 'claudex-courts') $$) as demo_rates,
  pg_temp.fp($$ select * from public.venue_settings where venue_id = (select id from public.venues where slug = 'claudex-courts') $$) as demo_settings;

select set_config('app.suppress_booking_emails', 'off', true);

-- Shape, schedule and privileges
select has_function('private', 'reset_demo_venue', array[]::text[], 'private.reset_demo_venue() exists');
select function_returns('private', 'reset_demo_venue', array[]::text[], 'void', 'it returns void');
select ok(not has_function_privilege('anon', 'private.reset_demo_venue()', 'execute'), 'anon cannot reset the demo');
select ok(not has_function_privilege('authenticated', 'private.reset_demo_venue()', 'execute'), 'authenticated cannot reset the demo');
select results_eq(
  $$ select schedule, command, active from cron.job where jobname = 'demo-reset' $$,
  $$ values ('30 0 * * *'::text, 'select private.reset_demo_venue()'::text, true) $$,
  'the demo-reset job runs daily at 00:30 UTC (08:30 in Manila)'
);
select is((select count(*)::int from cron.job where jobname = 'demo-reset'), 1, 'there is exactly one demo-reset job');

-- First reset
select lives_ok($$select private.reset_demo_venue()$$, 'the reset runs');

select is((select count(*)::int from public.bookings where id in ('b0000000-0000-0000-0000-000000006311', 'b0000000-0000-0000-0000-000000006312', 'b0000000-0000-0000-0000-000000006313')),
  0, 'the stale seed booking, the walk-in and the guest booking with a billing charge are deleted');
select is((select count(*)::int from public.billing_charges where booking_id = 'b0000000-0000-0000-0000-000000006313'), 0, 'the demo booking''s billing charge goes with it');
select is((select count(*)::int from public.payments where booking_id = 'b0000000-0000-0000-0000-000000006313'), 0, 'its payment goes with it');
select is((select count(*)::int from public.bookings b join ids on b.venue_id = ids.demo), 5, 'the demo venue has exactly the five seed bookings');
select results_eq(
  $$ select b.reference_code, c.name, b.status::text,
            ((lower(b.during) at time zone private.venue_tz(b.venue_id))::date - private.local_today(b.venue_id))::int,
            extract(hour from lower(b.during) at time zone private.venue_tz(b.venue_id))::int,
            (extract(epoch from upper(b.during) - lower(b.during)) / 3600)::int
     from public.bookings b join public.courts c on c.id = b.court_id join ids on b.venue_id = ids.demo order by b.reference_code $$,
  $$ values ('CB-DEMQA2'::text, 'Badminton 1'::text, 'confirmed'::text, 1, 18, 2),
            ('CB-DEMQB3', 'Badminton 2', 'payment_submitted', 1, 19, 2),
            ('CB-DEMQC4', 'Pickleball 1', 'confirmed', 1, 7, 2),
            ('CB-DEMQD5', 'Basketball Court', 'confirmed', 2, 17, 2),
            ('CB-DEMQE6', 'Tennis Court', 'confirmed', 2, 6, 2) $$,
  'the five demo bookings are back: same codes, courts, statuses, venue-local day offsets, hours and lengths'
);
select ok(not exists (select 1 from public.bookings b join ids on b.venue_id = ids.demo
                      where b.total_amount <> private.range_price(b.court_id, b.during)
                         or b.guest_name <> 'Demo Player' or b.guest_email <> 'demo@example.com' or b.source <> 'online'),
  'demo bookings carry the server price, the Demo Player guest and the online source');
select results_eq(
  $$ select p.review_status::text, count(*)::int from public.payments p join public.bookings b on b.id = p.booking_id join ids on b.venue_id = ids.demo
     group by p.review_status order by 1 $$,
  $$ values ('approved'::text, 4), ('pending', 1) $$,
  'four confirmed bookings have one approved payment each and the submitted one has a pending payment'
);
select ok(not exists (select 1 from public.bookings b join ids on b.venue_id = ids.demo
                      where (select count(*) from public.payments p where p.booking_id = b.id) <> 1
                         or (select p.amount from public.payments p where p.booking_id = b.id) <> b.total_amount
                         or (select p.review_status::text from public.payments p where p.booking_id = b.id) <> case b.status when 'confirmed' then 'approved' else 'pending' end),
  'each demo booking has exactly one payment, for its total, in the matching review state');
select is((select count(*)::int from public.email_outbox e join ids on e.venue_id = ids.demo), 0, 'no emails are queued for the demo bookings');
select is(current_setting('app.suppress_booking_emails', true), 'off', 'the email suppression does not leak past the reset');

-- Courts, rates, settings, invoices of the demo venue
select is(pg_temp.fp($$ select * from public.courts where venue_id = (select id from public.venues where slug = 'claudex-courts') $$),
  (select demo_courts from before_fp), 'demo courts are unchanged');
select is(pg_temp.fp($$ select r.* from public.court_rates r join public.courts c on c.id = r.court_id where c.venue_id = (select id from public.venues where slug = 'claudex-courts') $$),
  (select demo_rates from before_fp), 'demo court rates are unchanged');
select is(pg_temp.fp($$ select * from public.venue_settings where venue_id = (select id from public.venues where slug = 'claudex-courts') $$),
  (select demo_settings from before_fp), 'demo venue settings are unchanged');
select is((select count(*)::int from public.invoices i join ids on i.venue_id = ids.demo where i.billing_month = '2020-01-01'), 1, 'the demo venue''s invoices are left alone');

-- The other venue
select is(pg_temp.fp($$ select * from public.bookings where venue_id = 'a0000000-0000-0000-0000-000000006301' $$), (select bookings from before_fp), 'the other venue''s booking is untouched');
select is(pg_temp.fp($$ select * from public.payments where booking_id = 'b0000000-0000-0000-0000-000000006301' $$), (select payments from before_fp), 'its payment is untouched');
select is(pg_temp.fp($$ select * from public.billing_charges where venue_id = 'a0000000-0000-0000-0000-000000006301' $$), (select charges from before_fp), 'its billing charge is untouched');
select is(pg_temp.fp($$ select * from public.invoices where venue_id = 'a0000000-0000-0000-0000-000000006301' $$), (select invoices from before_fp), 'its invoices are untouched');
select is(pg_temp.fp($$ select * from public.courts where venue_id = 'a0000000-0000-0000-0000-000000006301' $$), (select courts from before_fp), 'its courts are untouched');
select is(pg_temp.fp($$ select * from public.email_outbox where venue_id = 'a0000000-0000-0000-0000-000000006301' $$), (select outbox from before_fp), 'its email outbox is untouched');

-- Idempotent
select lives_ok($$select private.reset_demo_venue()$$, 'a second reset runs');
select results_eq(
  $$ select (select count(*)::int from public.bookings b join ids on b.venue_id = ids.demo),
            (select count(*)::int from public.payments p join public.bookings b on b.id = p.booking_id join ids on b.venue_id = ids.demo),
            (select count(distinct b.reference_code)::int from public.bookings b join ids on b.venue_id = ids.demo) $$,
  $$ values (5, 5, 5) $$,
  'after two resets there are still exactly 5 bookings and 5 payments, no duplicates'
);
select is(pg_temp.fp($$ select * from public.bookings where venue_id = 'a0000000-0000-0000-0000-000000006301' $$), (select bookings from before_fp), 'the other venue is still untouched after the second reset');

-- No demo venue: nothing happens, no error
update public.venues set slug = 'e2e-dr-renamed' where slug = 'claudex-courts';
select lives_ok($$select private.reset_demo_venue()$$, 'without a claudex-courts venue the reset does nothing and raises no error');
select is((select count(*)::int from public.bookings b join ids on b.venue_id = ids.demo), 5, 'the renamed venue''s bookings are not touched');

select * from finish();
rollback;
