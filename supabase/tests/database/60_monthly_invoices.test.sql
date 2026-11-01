-- T14.9: private.generate_invoices() and the monthly-invoices pg_cron job. For every venue and every venue-local month
-- from the earlier of its creation month and first charge month up to the last ENDED month, a draft invoice exists
-- (even with no charges); unattached charges of those months are attached to draft invoices only. Returns the number
-- of invoices created. Run here as postgres; clients cannot execute it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Invoice month a booking's fee charge is attached to, 'none' if unattached.
create function pg_temp.inv_month(p_booking uuid) returns text language sql as $$
  select coalesce((select i.billing_month::text from public.billing_charges c join public.invoices i on i.id = c.invoice_id
                   where c.booking_id = p_booking and c.kind = 'booking_fee'), 'none') $$;

-- Months of a venue's invoices, oldest first.
create function pg_temp.months(p_venue uuid) returns date[] language sql as $$
  select coalesce(array_agg(billing_month order by billing_month), array[]::date[]) from public.invoices where venue_id = p_venue $$;

-- Every month from p_from to the last ended month in timezone p_tz.
create function pg_temp.expected(p_from date, p_tz text) returns date[] language sql as $$
  select array(select m::date from generate_series(p_from::timestamp,
    (date_trunc('month', now() at time zone p_tz) - interval '1 month')::timestamp, interval '1 month') m order by m) $$;

create function pg_temp.chg(p_venue uuid, p_booking uuid, p_at timestamptz) returns void language sql as $$
  insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month)
  values (p_venue, p_booking, 'booking_fee', 10, p_at, private.billing_month(p_venue, p_at)) $$;

-- Venues: A Manila (UTC+8), B Honolulu (UTC-10), C Manila created now without charges, D Manila created now with an
-- old charge, E Honolulu created at an instant that is still January there.
insert into public.venues (id, slug, status, created_at) values
  ('a0000000-0000-0000-0000-000000006001', 'e2e-mi-alpha', 'active', '2026-01-15 04:00+00'),
  ('a0000000-0000-0000-0000-000000006002', 'e2e-mi-bravo', 'suspended', '2026-01-15 12:00+00'),
  ('a0000000-0000-0000-0000-000000006003', 'e2e-mi-charlie', 'active', now()),
  ('a0000000-0000-0000-0000-000000006004', 'e2e-mi-delta', 'draft', now()),
  ('a0000000-0000-0000-0000-000000006005', 'e2e-mi-echo', 'active', '2026-02-01 05:00+00');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-000000006001', 'E2E MI Alpha', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-000000006002', 'E2E MI Bravo', 'Pacific/Honolulu'),
  ('a0000000-0000-0000-0000-000000006003', 'E2E MI Charlie', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-000000006004', 'E2E MI Delta', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-000000006005', 'E2E MI Echo', 'Pacific/Honolulu');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-000000006001', 'a0000000-0000-0000-0000-000000006001', 'E2E MI Court A', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-000000006002', 'a0000000-0000-0000-0000-000000006002', 'E2E MI Court B', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-000000006004', 'a0000000-0000-0000-0000-000000006004', 'E2E MI Court D', 'tennis', 100, true);
-- Bookings carry no fee, so the billing trigger stays quiet; the charges are inserted by hand below.
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, confirmed_at) values
  ('b0000000-0000-0000-0000-000000006001', 'a0000000-0000-0000-0000-000000006001', 'c0000000-0000-0000-0000-000000006001', 'E2E MI a1', 'CB-WWWWAB', 100, tstzrange('2030-03-01 01:00+00', '2030-03-01 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-000000006002', 'a0000000-0000-0000-0000-000000006001', 'c0000000-0000-0000-0000-000000006001', 'E2E MI a2', 'CB-WWWWCD', 100, tstzrange('2030-03-02 01:00+00', '2030-03-02 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-000000006003', 'a0000000-0000-0000-0000-000000006001', 'c0000000-0000-0000-0000-000000006001', 'E2E MI a3', 'CB-WWWWEF', 100, tstzrange('2030-03-03 01:00+00', '2030-03-03 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-000000006004', 'a0000000-0000-0000-0000-000000006001', 'c0000000-0000-0000-0000-000000006001', 'E2E MI a4', 'CB-WWWWGH', 100, tstzrange('2030-03-04 01:00+00', '2030-03-04 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-000000006005', 'a0000000-0000-0000-0000-000000006001', 'c0000000-0000-0000-0000-000000006001', 'E2E MI a5', 'CB-WWWWJK', 100, tstzrange('2030-03-05 01:00+00', '2030-03-05 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-000000006006', 'a0000000-0000-0000-0000-000000006001', 'c0000000-0000-0000-0000-000000006001', 'E2E MI a6', 'CB-WWWWLM', 100, tstzrange('2030-03-06 01:00+00', '2030-03-06 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-000000006007', 'a0000000-0000-0000-0000-000000006001', 'c0000000-0000-0000-0000-000000006001', 'E2E MI a7', 'CB-WWWWNP', 100, tstzrange('2030-03-07 01:00+00', '2030-03-07 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-000000006008', 'a0000000-0000-0000-0000-000000006002', 'c0000000-0000-0000-0000-000000006002', 'E2E MI b1', 'CB-WWWWQR', 100, tstzrange('2030-03-01 01:00+00', '2030-03-01 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-000000006009', 'a0000000-0000-0000-0000-000000006002', 'c0000000-0000-0000-0000-000000006002', 'E2E MI b2', 'CB-WWWWST', 100, tstzrange('2030-03-02 01:00+00', '2030-03-02 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-000000006010', 'a0000000-0000-0000-0000-000000006004', 'c0000000-0000-0000-0000-000000006004', 'E2E MI d1', 'CB-WWWWUV', 100, tstzrange('2030-03-01 01:00+00', '2030-03-01 02:00+00'), 'confirmed', now());

-- Alpha already has a sent February and a paid April invoice.
insert into public.invoices (venue_id, billing_month, status) values
  ('a0000000-0000-0000-0000-000000006001', '2026-02-01', 'sent'),
  ('a0000000-0000-0000-0000-000000006001', '2026-04-01', 'paid');

-- Alpha: a1 January, a2 February (sent invoice), a3 2026-03-01 01:00 Manila (still February in UTC), a4 April (paid
-- invoice), a5 this month. Bravo (Honolulu): b1 is the same instant as a3 but still February there; b2 January.
-- Delta: d1 in June.
select pg_temp.chg('a0000000-0000-0000-0000-000000006001', 'b0000000-0000-0000-0000-000000006001', '2026-01-20 05:00+00');
select pg_temp.chg('a0000000-0000-0000-0000-000000006001', 'b0000000-0000-0000-0000-000000006002', '2026-02-10 05:00+00');
select pg_temp.chg('a0000000-0000-0000-0000-000000006001', 'b0000000-0000-0000-0000-000000006003', '2026-02-28 17:00+00');
select pg_temp.chg('a0000000-0000-0000-0000-000000006001', 'b0000000-0000-0000-0000-000000006004', '2026-04-10 05:00+00');
select pg_temp.chg('a0000000-0000-0000-0000-000000006001', 'b0000000-0000-0000-0000-000000006005', now());
select pg_temp.chg('a0000000-0000-0000-0000-000000006002', 'b0000000-0000-0000-0000-000000006008', '2026-03-01 05:00+00');
select pg_temp.chg('a0000000-0000-0000-0000-000000006002', 'b0000000-0000-0000-0000-000000006009', '2026-01-20 05:00+00');
select pg_temp.chg('a0000000-0000-0000-0000-000000006004', 'b0000000-0000-0000-0000-000000006010', '2026-06-10 05:00+00');

select has_function('private', 'generate_invoices', array[]::text[], 'private.generate_invoices() exists');

create temp table run1 as select (select count(*) from public.invoices) as before_n;
create temp table run1b as select private.generate_invoices() as n;
create temp table run1c as select (select count(*) from public.invoices) as after_n;

select is((select n::bigint from run1b), (select after_n - before_n from run1, run1c),
  'the first run returns exactly the number of invoices it created');

-- Alpha (Manila)
select is(pg_temp.months('a0000000-0000-0000-0000-000000006001'), pg_temp.expected('2026-01-01', 'Asia/Manila'),
  'Alpha has one invoice per month from its creation month up to the last ended month, including months without charges');
select is((select status from public.invoices where venue_id = 'a0000000-0000-0000-0000-000000006001' and billing_month = '2026-02-01'), 'sent',
  'a sent invoice stays sent');
select is((select status from public.invoices where venue_id = 'a0000000-0000-0000-0000-000000006001' and billing_month = '2026-04-01'), 'paid',
  'a paid invoice stays paid');
select is((select count(*)::int from public.invoices where venue_id = 'a0000000-0000-0000-0000-000000006001' and status <> 'draft'), 2,
  'every other invoice of Alpha is a draft (no duplicate of the sent and paid months)');
select is(pg_temp.inv_month('b0000000-0000-0000-0000-000000006001'), '2026-01-01', 'a January charge is attached to the January draft');
select is(pg_temp.inv_month('b0000000-0000-0000-0000-000000006003'), '2026-03-01',
  'Manila boundary: 2026-02-28 17:00 UTC is 1 AM on 1 March locally, so it goes on the March invoice');
select is(pg_temp.inv_month('b0000000-0000-0000-0000-000000006002'), 'none', 'a charge in a month whose invoice was sent is not touched');
select is(pg_temp.inv_month('b0000000-0000-0000-0000-000000006004'), 'none', 'a charge in a month whose invoice is paid is not touched');
select is(pg_temp.inv_month('b0000000-0000-0000-0000-000000006005'), 'none', 'a charge of the current, unfinished month stays unattached');
select is((select count(*)::int from public.invoices i where i.venue_id = 'a0000000-0000-0000-0000-000000006001' and i.billing_month = '2026-05-01'
            and i.status = 'draft' and not exists (select 1 from public.billing_charges c where c.invoice_id = i.id)), 1,
  'a month with no charges (May) still gets an empty draft invoice');

-- Bravo (Honolulu): the same instant is still February there
select is(pg_temp.months('a0000000-0000-0000-0000-000000006002'), pg_temp.expected('2026-01-01', 'Pacific/Honolulu'),
  'Bravo is invoiced independently over its own months, whatever its status');
select is(pg_temp.inv_month('b0000000-0000-0000-0000-000000006008'), '2026-02-01',
  'Honolulu boundary: the same instant as Alpha''s March charge is still February there');
select is(pg_temp.inv_month('b0000000-0000-0000-0000-000000006009'), '2026-01-01', 'Bravo''s January charge is on its own January draft');

-- Echo: created 2026-01-31 19:00 Honolulu, so its first month is January
select is(pg_temp.months('a0000000-0000-0000-0000-000000006005'), pg_temp.expected('2026-01-01', 'Pacific/Honolulu'),
  'the creation month is taken in the venue timezone (a venue created 31 Jan locally starts in January)');

-- Charlie: created this month, no charges, nothing has ended
select is((select count(*)::int from public.invoices where venue_id = 'a0000000-0000-0000-0000-000000006003'), 0,
  'a venue created in the current month without charges gets no invoice');

-- Delta: created now but its first charge is in June
select is(pg_temp.months('a0000000-0000-0000-0000-000000006004'), pg_temp.expected('2026-06-01', 'Asia/Manila'),
  'invoices start at the first charge month when it is earlier than the creation month');
select is(pg_temp.inv_month('b0000000-0000-0000-0000-000000006010'), '2026-06-01', 'Delta''s June charge is on the June draft');

select is((select count(*)::int from public.invoices i join public.venue_settings s on s.venue_id = i.venue_id
            where i.venue_id::text like 'a0000000-0000-0000-0000-00000000600%'
              and i.billing_month >= date_trunc('month', now() at time zone s.timezone)::date), 0,
  'no invoice exists for the current, unfinished month');

-- Rerun
create temp table run2 as select (select count(*) from public.invoices) as inv_n,
  (select count(*) from public.billing_charges where invoice_id is not null) as att_n;
select is(private.generate_invoices(), 0, 'a rerun creates nothing and returns 0');
select is((select count(*) from public.invoices), (select inv_n from run2), 'a rerun leaves the invoice count unchanged');
select is((select count(*) from public.billing_charges where invoice_id is not null), (select att_n from run2),
  'a rerun leaves the set of attached charges unchanged');

-- A late charge in an old draft month is attached on the next run; one in a sent month is not
insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month)
select 'a0000000-0000-0000-0000-000000006001', 'b0000000-0000-0000-0000-000000006006', 'booking_fee', 10, '2026-01-25 05:00+00', '2026-01-01';
insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month)
select 'a0000000-0000-0000-0000-000000006001', 'b0000000-0000-0000-0000-000000006007', 'booking_fee', 10, '2026-02-25 05:00+00', '2026-02-01';
select is(private.generate_invoices(), 0, 'attaching late charges creates no invoice, so it returns 0');
select is(pg_temp.inv_month('b0000000-0000-0000-0000-000000006006'), '2026-01-01', 'a late charge in a draft month is attached on the next run');
select is(pg_temp.inv_month('b0000000-0000-0000-0000-000000006007'), 'none', 'a late charge in a sent month stays unattached');

-- Schedule and privileges
select results_eq(
  $$ select schedule, command, active from cron.job where jobname = 'monthly-invoices' $$,
  $$ values ('0 1 * * *'::text, 'select private.generate_invoices()'::text, true) $$,
  'the monthly-invoices job runs daily at 01:00'
);
select is((select count(*)::int from cron.job where jobname = 'monthly-invoices'), 1, 'there is exactly one monthly-invoices job');
select ok(not (select prosecdef from pg_proc where oid = 'private.generate_invoices()'::regprocedure), 'generate_invoices is not security definer');
select ok(not has_function_privilege('anon', 'private.generate_invoices()', 'execute'), 'anon cannot generate invoices');
select ok(not has_function_privilege('authenticated', 'private.generate_invoices()', 'execute'), 'authenticated cannot generate invoices');
set local role authenticated;
select throws_ok($$select private.generate_invoices()$$, '42501', null, 'a signed-in client calling it is refused');
reset role;

select * from finish();
rollback;
