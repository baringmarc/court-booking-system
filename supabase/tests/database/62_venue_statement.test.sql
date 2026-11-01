-- T14.11: public.venue_statement(p_venue_id uuid default null) returns jsonb. The venue admin's own statement:
-- this (venue-local) month's fees, credited cancellations, by payment method, charge lines and past invoices.
-- Venue staff only (private.admin_venue); anon has no execute.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- Returns 'SQLSTATE|hint' of the error a statement raises, or 'ok' if it succeeds.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare s text; h text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return s || '|' || coalesce(h, '');
end $$;
grant execute on function pg_temp.err(text) to anon, authenticated;

-- First day of the current month in Asia/Manila, and a Manila-local instant m months before it plus h hours.
create function pg_temp.cm() returns date language sql as $$ select date_trunc('month', now() at time zone 'Asia/Manila')::date $$;
create function pg_temp.mat(m int, h int) returns timestamptz language sql as $$
  select ((pg_temp.cm() - make_interval(months => m))::timestamp + make_interval(hours => h)) at time zone 'Asia/Manila' $$;
create function pg_temp.mon(m int) returns text language sql as $$ select to_char(pg_temp.cm() - make_interval(months => m), 'YYYY-MM-DD') $$;
grant execute on function pg_temp.cm(), pg_temp.mat(int, int), pg_temp.mon(int) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000062a1', 'e2e-vs-player@example.com'),
  ('00000000-0000-0000-0000-0000000062a2', 'e2e-vs-platform@example.com'),
  ('00000000-0000-0000-0000-0000000062a3', 'e2e-vs-alpha@example.com'),
  ('00000000-0000-0000-0000-0000000062a4', 'e2e-vs-charlie@example.com'),
  ('00000000-0000-0000-0000-0000000062a5', 'e2e-vs-both@example.com');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000062a1', 'e2e-vs-alpha', 'active'),
  ('a0000000-0000-0000-0000-0000000062a2', 'e2e-vs-bravo', 'active'),
  ('a0000000-0000-0000-0000-0000000062a3', 'e2e-vs-charlie', 'active');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-0000000062a1', 'E2E VS Alpha', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000062a2', 'E2E VS Bravo', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000062a3', 'E2E VS Charlie', 'Pacific/Kiritimati');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000062a1', '00000000-0000-0000-0000-0000000062a3', 'owner'),
  ('a0000000-0000-0000-0000-0000000062a3', '00000000-0000-0000-0000-0000000062a4', 'owner'),
  ('a0000000-0000-0000-0000-0000000062a1', '00000000-0000-0000-0000-0000000062a5', 'owner'),
  ('a0000000-0000-0000-0000-0000000062a2', '00000000-0000-0000-0000-0000000062a5', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000062a2');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000062a1', 'a0000000-0000-0000-0000-0000000062a1', 'E2E VS Court A', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000062a2', 'a0000000-0000-0000-0000-0000000062a2', 'E2E VS Court B', 'tennis', 100, true);

-- Alpha bookings s1..s8 (s1-s5 this month, s6 last month, s7 two months ago, s8 unused-by-month), Bravo booking t1.
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, confirmed_at)
select ('b0000000-0000-0000-0000-0000000062b' || n)::uuid,
       'a0000000-0000-0000-0000-0000000062a1', 'c0000000-0000-0000-0000-0000000062a1',
       'E2E VS ' || n, 'CB-XXXXS' || chr(64 + n), 100,
       tstzrange(timestamptz '2030-03-01 00:00+00' + make_interval(hours => 2 * n), timestamptz '2030-03-01 00:00+00' + make_interval(hours => 2 * n + 1)),
       'confirmed', now()
from generate_series(1, 7) n;
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, confirmed_at) values
  ('b0000000-0000-0000-0000-0000000062c1', 'a0000000-0000-0000-0000-0000000062a2', 'c0000000-0000-0000-0000-0000000062a2', 'E2E VS Other', 'CB-XXXXTA', 100,
   tstzrange('2030-03-01 01:00+00', '2030-03-01 02:00+00'), 'confirmed', now());

-- Payments: s1 and s3 paid by an account (BPI), s2 cash, s4 none. s3 also has an earlier pending GCash that must be ignored,
-- (only one approved payment can exist per booking).
insert into public.payments (booking_id, method, amount, review_status, paid_with, submitted_at) values
  ('b0000000-0000-0000-0000-0000000062b1', 'account', 100, 'approved', 'BPI', now() - interval '2 hours'),
  ('b0000000-0000-0000-0000-0000000062b2', 'cash', 100, 'approved', null, now() - interval '2 hours'),
  ('b0000000-0000-0000-0000-0000000062b3', 'gcash', 100, 'pending', null, now() - interval '3 hours'),
  ('b0000000-0000-0000-0000-0000000062b3', 'account', 100, 'approved', 'BPI', now() - interval '2 hours'),
  ('b0000000-0000-0000-0000-0000000062b5', 'cash', 100, 'approved', null, now() - interval '2 hours');

insert into public.invoices (id, venue_id, billing_month, status, sent_at, paid_at) values
  ('d0000000-0000-0000-0000-0000000062e1', 'a0000000-0000-0000-0000-0000000062a1', pg_temp.cm(), 'draft', null, null),
  ('d0000000-0000-0000-0000-0000000062e2', 'a0000000-0000-0000-0000-0000000062a1', pg_temp.cm() - interval '1 month', 'paid', now() - interval '20 days', now() - interval '10 days'),
  ('d0000000-0000-0000-0000-0000000062e3', 'a0000000-0000-0000-0000-0000000062a1', pg_temp.cm() - interval '2 months', 'sent', now() - interval '40 days', null),
  ('d0000000-0000-0000-0000-0000000062e4', 'a0000000-0000-0000-0000-0000000062a2', pg_temp.cm(), 'draft', null, null);
insert into public.billing_charges (id, venue_id, booking_id, kind, amount, charged_at, billing_month, invoice_id) values
  ('e0000000-0000-0000-0000-0000000062f1', 'a0000000-0000-0000-0000-0000000062a1', 'b0000000-0000-0000-0000-0000000062b1', 'booking_fee', 10, pg_temp.mat(0, 1), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000062e1'),
  ('e0000000-0000-0000-0000-0000000062f2', 'a0000000-0000-0000-0000-0000000062a1', 'b0000000-0000-0000-0000-0000000062b2', 'booking_fee', 10, pg_temp.mat(0, 2), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000062e1'),
  ('e0000000-0000-0000-0000-0000000062f3', 'a0000000-0000-0000-0000-0000000062a1', 'b0000000-0000-0000-0000-0000000062b3', 'booking_fee', 10, pg_temp.mat(0, 3), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000062e1'),
  ('e0000000-0000-0000-0000-0000000062f4', 'a0000000-0000-0000-0000-0000000062a1', 'b0000000-0000-0000-0000-0000000062b4', 'booking_fee', 10, pg_temp.mat(0, 4), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000062e1'),
  ('e0000000-0000-0000-0000-0000000062f5', 'a0000000-0000-0000-0000-0000000062a1', 'b0000000-0000-0000-0000-0000000062b5', 'adjustment', -10, pg_temp.mat(0, 5), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000062e1'),
  ('e0000000-0000-0000-0000-0000000062f6', 'a0000000-0000-0000-0000-0000000062a1', 'b0000000-0000-0000-0000-0000000062b6', 'booking_fee', 7.50, pg_temp.mat(1, 1), pg_temp.cm() - interval '1 month', 'd0000000-0000-0000-0000-0000000062e2'),
  ('e0000000-0000-0000-0000-0000000062f7', 'a0000000-0000-0000-0000-0000000062a1', 'b0000000-0000-0000-0000-0000000062b7', 'booking_fee', 5, pg_temp.mat(2, 1), pg_temp.cm() - interval '2 months', 'd0000000-0000-0000-0000-0000000062e3'),
  ('e0000000-0000-0000-0000-0000000062f8', 'a0000000-0000-0000-0000-0000000062a2', 'b0000000-0000-0000-0000-0000000062c1', 'booking_fee', 99, pg_temp.mat(0, 1), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000062e4');

-- ---------------------------------------------------------------- schema and anon
select has_function('public', 'venue_statement', array['uuid'], 'venue_statement(uuid) exists');
set local role anon;
select throws_ok($$select public.venue_statement()$$, '42501', null, 'anon has no execute on venue_statement');
select throws_ok($$select public.venue_statement('a0000000-0000-0000-0000-0000000062a1')$$, '42501', null, 'anon has no execute, even naming a venue');

-- ---------------------------------------------------------------- refused callers
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000062a1","role":"authenticated"}';
select is(pg_temp.err($$select public.venue_statement()$$), 'P0001|forbidden', 'a player is refused the statement');
select is(pg_temp.err($$select public.venue_statement('a0000000-0000-0000-0000-0000000062a1')$$), 'P0001|forbidden', 'a player is refused even when naming the venue');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000062a4","role":"authenticated"}';
select is(pg_temp.err($$select public.venue_statement('a0000000-0000-0000-0000-0000000062a1')$$), 'P0001|forbidden', 'another venue''s admin is refused this venue''s statement');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000062a2","role":"authenticated"}';
select is(pg_temp.err($$select public.venue_statement()$$), 'P0001|forbidden', 'a platform admin must name a venue (no membership to infer one from)');

-- ---------------------------------------------------------------- the venue's admin
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000062a3","role":"authenticated"}';
create temp table st as select public.venue_statement() as j;
grant select on st to authenticated;
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select j from st)) k),
  'adjustment_total,by_method,fee_count,fee_total,invoices,lines,month,total', 'the statement has exactly the documented keys');
select is((select j ->> 'month' from st), pg_temp.mon(0), 'month is the first day of the current venue-local month');
select is((select (j ->> 'fee_count')::int from st), 4, 'fee_count counts this month''s booking fees only');
select is((select ((j ->> 'fee_total')::numeric(12,2))::text || '|' || ((j ->> 'adjustment_total')::numeric(12,2))::text || '|' || ((j ->> 'total')::numeric(12,2))::text from st),
  '40.00|-10.00|30.00', 'fees 40, cancellations credited -10, total 30 (last months and the other venue excluded)');
select is((select jsonb_typeof(j -> 'fee_count') || ',' || jsonb_typeof(j -> 'fee_total') || ',' || jsonb_typeof(j -> 'adjustment_total') || ',' || jsonb_typeof(j -> 'total')
  || ',' || jsonb_typeof(j -> 'by_method') || ',' || jsonb_typeof(j -> 'lines') || ',' || jsonb_typeof(j -> 'invoices') from st),
  'number,number,number,number,array,array,array', 'counters and totals are json numbers, the lists are arrays');

-- by payment method: the booking's first approved payment
select is((select array_agg(coalesce(e ->> 'method', 'NULL') || '|' || coalesce(e ->> 'paid_with', 'NULL') || '|' || (e ->> 'count') || '|' || ((e ->> 'fee_total')::numeric(12,2))::text
    order by coalesce(e ->> 'method', 'zzz'))
  from st, jsonb_array_elements(j -> 'by_method') e),
  array['account|BPI|2|20.00', 'cash|NULL|1|10.00', 'NULL|NULL|1|10.00'],
  'fees are grouped by the booking''s approved payment (a pending one is ignored); no approved payment is method null');
select is((select string_agg(k, ',' order by k) from st, jsonb_object_keys(j -> 'by_method' -> 0) k), 'count,fee_total,method,paid_with', 'each by_method entry has exactly the documented keys');
select is((select sum((e ->> 'count')::int) from st, jsonb_array_elements(j -> 'by_method') e), 4::bigint, 'by_method counts add up to fee_count (the adjustment is not a fee)');

-- lines
select is((select array_agg(l ->> 'reference_code' order by o) from st, jsonb_array_elements(j -> 'lines') with ordinality t(l, o)),
  array['CB-XXXXSA', 'CB-XXXXSB', 'CB-XXXXSC', 'CB-XXXXSD', 'CB-XXXXSE'], 'lines are this month''s charges ordered by charged_at, only this venue''s');
select is((select array_agg((l ->> 'kind') || ':' || ((l ->> 'amount')::numeric(12,2))::text order by o) from st, jsonb_array_elements(j -> 'lines') with ordinality t(l, o)),
  array['booking_fee:10.00', 'booking_fee:10.00', 'booking_fee:10.00', 'booking_fee:10.00', 'adjustment:-10.00'], 'lines carry kind and signed amount');
select is((select string_agg(k, ',' order by k) from st, jsonb_object_keys(j -> 'lines' -> 0) k), 'amount,booking_id,charge_id,charged_at,kind,reference_code', 'each line has exactly the documented keys');
select is((select (j -> 'lines' -> 0 ->> 'booking_id') || '|' || (j -> 'lines' -> 0 ->> 'charge_id') from st),
  'b0000000-0000-0000-0000-0000000062b1|e0000000-0000-0000-0000-0000000062f1', 'a line carries its booking_id and charge_id');
select ok((select (j -> 'lines' -> 0 ->> 'charged_at')::timestamptz = pg_temp.mat(0, 1) from st), 'a line carries its charged_at');

-- invoices
select is((select array_agg((e ->> 'billing_month') || '|' || (e ->> 'status') || '|' || ((e ->> 'total')::numeric(12,2))::text order by o) from st, jsonb_array_elements(j -> 'invoices') with ordinality t(e, o)),
  array[pg_temp.mon(0) || '|draft|30.00', pg_temp.mon(1) || '|paid|7.50', pg_temp.mon(2) || '|sent|5.00'],
  'invoices: this venue''s only, newest month first, each with the sum of its charges (past months listed though excluded from the month figures)');
select is((select array_agg((e ->> 'invoice_id') order by o) from st, jsonb_array_elements(j -> 'invoices') with ordinality t(e, o)),
  array['d0000000-0000-0000-0000-0000000062e1', 'd0000000-0000-0000-0000-0000000062e2', 'd0000000-0000-0000-0000-0000000062e3'], 'invoice_id is the invoice''s id');
select is((select string_agg(k, ',' order by k) from st, jsonb_object_keys(j -> 'invoices' -> 0) k), 'billing_month,invoice_id,paid_at,sent_at,status,total', 'each invoice has exactly the documented keys');
select is((select array_agg((e -> 'sent_at' = 'null'::jsonb)::text || '/' || (e -> 'paid_at' = 'null'::jsonb)::text order by o) from st, jsonb_array_elements(j -> 'invoices') with ordinality t(e, o)),
  array['true/true', 'false/false', 'false/true'], 'sent_at and paid_at are json null until set (draft, paid, sent)');
select is((select jsonb_typeof(j -> 'invoices' -> 0 -> 'total') from st), 'number', 'an invoice total is a json number');

-- naming the venue
select is(((public.venue_statement('a0000000-0000-0000-0000-0000000062a1') ->> 'total')::numeric(12,2))::text, '30.00', 'a member may name their own venue');
select is(pg_temp.err($$select public.venue_statement('a0000000-0000-0000-0000-0000000062a2')$$), 'P0001|forbidden', 'a venue owner is refused another venue''s statement');

-- ---------------------------------------------------------------- platform admin naming a venue
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000062a2","role":"authenticated"}';
select is(((public.venue_statement('a0000000-0000-0000-0000-0000000062a1') ->> 'total')::numeric(12,2))::text, '30.00', 'a platform admin can read alpha''s statement');
select is((select array_agg(l ->> 'reference_code') from jsonb_array_elements(public.venue_statement('a0000000-0000-0000-0000-0000000062a2') -> 'lines') l),
  array['CB-XXXXTA'], 'bravo''s statement holds only bravo''s charge');
select is(((public.venue_statement('a0000000-0000-0000-0000-0000000062a2') ->> 'total')::numeric(12,2))::text || '|' ||
  ((public.venue_statement('a0000000-0000-0000-0000-0000000062a2') ->> 'fee_count')), '99.00|1', 'bravo''s totals are its own');
select is((select array_agg(e ->> 'invoice_id') from jsonb_array_elements(public.venue_statement('a0000000-0000-0000-0000-0000000062a2') -> 'invoices') e),
  array['d0000000-0000-0000-0000-0000000062e4'], 'bravo''s invoices are its own');

-- ---------------------------------------------------------------- member of two venues
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000062a5","role":"authenticated"}';
select is(pg_temp.err($$select public.venue_statement()$$), 'P0001|venue_required', 'a member of two venues must say which one');
select is(((public.venue_statement('a0000000-0000-0000-0000-0000000062a1') ->> 'total')::numeric(12,2))::text, '30.00', 'naming alpha gives alpha''s statement');
select is(((public.venue_statement('a0000000-0000-0000-0000-0000000062a2') ->> 'total')::numeric(12,2))::text, '99.00', 'naming bravo gives bravo''s statement');
select is(pg_temp.err($$select public.venue_statement('a0000000-0000-0000-0000-0000000062a3')$$), 'P0001|forbidden', 'a venue they do not belong to is refused');

-- ---------------------------------------------------------------- a venue with nothing yet (timezone Pacific/Kiritimati)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000062a4","role":"authenticated"}';
create temp table st2 as select public.venue_statement() as j;
grant select on st2 to authenticated;
select is((select j ->> 'month' from st2), to_char(date_trunc('month', now() at time zone 'Pacific/Kiritimati'), 'YYYY-MM-DD'), 'the month follows the venue''s own timezone');
select is((select (j ->> 'fee_count') || '|' || ((j ->> 'fee_total')::numeric)::text || '|' || ((j ->> 'adjustment_total')::numeric)::text || '|' || ((j ->> 'total')::numeric)::text from st2),
  '0|0|0|0', 'no charges: zero counts and totals, not nulls');
select is((select (j -> 'by_method')::text || (j -> 'lines')::text || (j -> 'invoices')::text from st2), '[][][]', 'no charges: empty arrays, not null');

-- ---------------------------------------------------------------- the statement is read-only
reset role;
select is((select count(*)::int from public.billing_charges where venue_id in ('a0000000-0000-0000-0000-0000000062a1', 'a0000000-0000-0000-0000-0000000062a2')), 8, 'reading statements changed no charges');

select * from finish();
rollback;
