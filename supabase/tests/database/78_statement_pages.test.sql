-- T17.21: public.statement_summary, public.statement_charges_page and public.statement_invoices_page. The venue admin's
-- statement, paged: month totals never depend on a page, charges search by booking reference (escaped), invoices filter by
-- status, "amount due" is exactly the venue's sent invoices. Venue staff only (private.admin_venue); anon has no execute.
-- venue_statement(uuid) is unchanged.
begin;
create extension if not exists pgtap with schema extensions;
select plan(105);

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

create function pg_temp.cm() returns date language sql as $$ select date_trunc('month', now() at time zone 'Asia/Manila')::date $$;
create function pg_temp.mat(m int, h int) returns timestamptz language sql as $$
  select ((pg_temp.cm() - make_interval(months => m))::timestamp + make_interval(hours => h)) at time zone 'Asia/Manila' $$;
create function pg_temp.mon(m int) returns text language sql as $$ select to_char(pg_temp.cm() - make_interval(months => m), 'YYYY-MM-DD') $$;
-- reference codes of one charges page, in order
create function pg_temp.refs(p jsonb) returns text language sql as $$
  select coalesce(string_agg(e ->> 'reference_code', ',' order by o), '') from jsonb_array_elements(p -> 'rows') with ordinality t(e, o) $$;
-- month|status of one invoices page, in order
create function pg_temp.invs(p jsonb) returns text language sql as $$
  select coalesce(string_agg((e ->> 'billing_month') || '|' || (e ->> 'status'), ',' order by o), '') from jsonb_array_elements(p -> 'rows') with ordinality t(e, o) $$;
grant execute on function pg_temp.cm(), pg_temp.mat(int, int), pg_temp.mon(int), pg_temp.refs(jsonb), pg_temp.invs(jsonb) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000078a1', 'e2e-sp-player@example.com'),
  ('00000000-0000-0000-0000-0000000078a2', 'e2e-sp-platform@example.com'),
  ('00000000-0000-0000-0000-0000000078a3', 'e2e-sp-alpha@example.com'),
  ('00000000-0000-0000-0000-0000000078a4', 'e2e-sp-charlie@example.com'),
  ('00000000-0000-0000-0000-0000000078a5', 'e2e-sp-both@example.com');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000078a1', 'e2e-sp-alpha', 'active'),
  ('a0000000-0000-0000-0000-0000000078a2', 'e2e-sp-bravo', 'active'),
  ('a0000000-0000-0000-0000-0000000078a3', 'e2e-sp-charlie', 'active');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-0000000078a1', 'E2E SP Alpha', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000078a2', 'E2E SP Bravo', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000078a3', 'E2E SP Charlie', 'Pacific/Kiritimati');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000078a1', '00000000-0000-0000-0000-0000000078a3', 'owner'),
  ('a0000000-0000-0000-0000-0000000078a3', '00000000-0000-0000-0000-0000000078a4', 'owner'),
  ('a0000000-0000-0000-0000-0000000078a1', '00000000-0000-0000-0000-0000000078a5', 'owner'),
  ('a0000000-0000-0000-0000-0000000078a2', '00000000-0000-0000-0000-0000000078a5', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000078a2');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000078a1', 'a0000000-0000-0000-0000-0000000078a1', 'E2E SP Court A', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000078a2', 'a0000000-0000-0000-0000-0000000078a2', 'E2E SP Court B', 'tennis', 100, true);
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, confirmed_at)
select ('b0000000-0000-0000-0000-0000000078b' || n)::uuid,
       'a0000000-0000-0000-0000-0000000078a1', 'c0000000-0000-0000-0000-0000000078a1',
       'E2E SP ' || n, 'CB-XXXXS' || chr(64 + n), 100,
       tstzrange(timestamptz '2030-03-01 00:00+00' + make_interval(hours => 2 * n), timestamptz '2030-03-01 00:00+00' + make_interval(hours => 2 * n + 1)),
       'confirmed', now()
from generate_series(1, 8) n;
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, confirmed_at) values
  ('b0000000-0000-0000-0000-0000000078c1', 'a0000000-0000-0000-0000-0000000078a2', 'c0000000-0000-0000-0000-0000000078a2', 'E2E SP Other', 'CB-XXXXTA', 100,
   tstzrange('2030-03-01 01:00+00', '2030-03-01 02:00+00'), 'confirmed', now());
insert into public.payments (booking_id, method, amount, review_status, paid_with, submitted_at) values
  ('b0000000-0000-0000-0000-0000000078b1', 'account', 100, 'approved', 'BPI', now() - interval '2 hours'),
  ('b0000000-0000-0000-0000-0000000078b2', 'cash', 100, 'approved', null, now() - interval '2 hours');

-- Alpha: this month's invoice is sent 2 days ago (not overdue), last month's is paid, two months ago is sent 40 days ago
-- (overdue), three months ago is a draft. Bravo has a sent invoice that must never count for Alpha.
insert into public.invoices (id, venue_id, billing_month, status, sent_at, paid_at, paid_method, paid_reference) values
  ('d0000000-0000-0000-0000-0000000078e1', 'a0000000-0000-0000-0000-0000000078a1', pg_temp.cm(), 'sent', now() - interval '2 days', null, null, null),
  ('d0000000-0000-0000-0000-0000000078e2', 'a0000000-0000-0000-0000-0000000078a1', pg_temp.cm() - interval '1 month', 'paid', now() - interval '20 days', now() - interval '10 days', 'GCash', 'REF-78'),
  ('d0000000-0000-0000-0000-0000000078e3', 'a0000000-0000-0000-0000-0000000078a1', pg_temp.cm() - interval '2 months', 'sent', now() - interval '40 days', null, null, null),
  ('d0000000-0000-0000-0000-0000000078e5', 'a0000000-0000-0000-0000-0000000078a1', pg_temp.cm() - interval '3 months', 'draft', null, null, null, null),
  ('d0000000-0000-0000-0000-0000000078e4', 'a0000000-0000-0000-0000-0000000078a2', pg_temp.cm(), 'sent', now() - interval '1 day', null, null, null);
-- f1, f2, f3 share one charged_at on purpose (ordering must fall back to id)
insert into public.billing_charges (id, venue_id, booking_id, kind, amount, charged_at, billing_month, invoice_id) values
  ('e0000000-0000-0000-0000-0000000078f1', 'a0000000-0000-0000-0000-0000000078a1', 'b0000000-0000-0000-0000-0000000078b1', 'booking_fee', 10, pg_temp.mat(0, 1), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000078e1'),
  ('e0000000-0000-0000-0000-0000000078f2', 'a0000000-0000-0000-0000-0000000078a1', 'b0000000-0000-0000-0000-0000000078b2', 'booking_fee', 10, pg_temp.mat(0, 1), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000078e1'),
  ('e0000000-0000-0000-0000-0000000078f3', 'a0000000-0000-0000-0000-0000000078a1', 'b0000000-0000-0000-0000-0000000078b3', 'booking_fee', 10, pg_temp.mat(0, 1), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000078e1'),
  ('e0000000-0000-0000-0000-0000000078f4', 'a0000000-0000-0000-0000-0000000078a1', 'b0000000-0000-0000-0000-0000000078b4', 'booking_fee', 10, pg_temp.mat(0, 4), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000078e1'),
  ('e0000000-0000-0000-0000-0000000078f5', 'a0000000-0000-0000-0000-0000000078a1', 'b0000000-0000-0000-0000-0000000078b5', 'adjustment', -10, pg_temp.mat(0, 5), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000078e1'),
  ('e0000000-0000-0000-0000-0000000078f6', 'a0000000-0000-0000-0000-0000000078a1', 'b0000000-0000-0000-0000-0000000078b6', 'booking_fee', 7.50, pg_temp.mat(1, 1), pg_temp.cm() - interval '1 month', 'd0000000-0000-0000-0000-0000000078e2'),
  ('e0000000-0000-0000-0000-0000000078f7', 'a0000000-0000-0000-0000-0000000078a1', 'b0000000-0000-0000-0000-0000000078b7', 'booking_fee', 5, pg_temp.mat(2, 1), pg_temp.cm() - interval '2 months', 'd0000000-0000-0000-0000-0000000078e3'),
  ('e0000000-0000-0000-0000-0000000078f9', 'a0000000-0000-0000-0000-0000000078a1', 'b0000000-0000-0000-0000-0000000078b8', 'booking_fee', 4, pg_temp.mat(3, 1), pg_temp.cm() - interval '3 months', 'd0000000-0000-0000-0000-0000000078e5'),
  ('e0000000-0000-0000-0000-0000000078f8', 'a0000000-0000-0000-0000-0000000078a2', 'b0000000-0000-0000-0000-0000000078c1', 'booking_fee', 99, pg_temp.mat(0, 1), pg_temp.cm(), 'd0000000-0000-0000-0000-0000000078e4');

-- ---------------------------------------------------------------- schema and anon
select has_function('public', 'statement_summary', array['uuid', 'date'], 'statement_summary(uuid, date) exists');
select has_function('public', 'statement_charges_page', array['uuid', 'date', 'text', 'integer', 'integer'], 'statement_charges_page exists');
select has_function('public', 'statement_invoices_page', array['uuid', 'text', 'integer', 'integer'], 'statement_invoices_page exists');
set local role anon;
select throws_ok($$select public.statement_summary()$$, '42501', null, 'anon has no execute on statement_summary');
select throws_ok($$select public.statement_charges_page()$$, '42501', null, 'anon has no execute on statement_charges_page');
select throws_ok($$select public.statement_invoices_page()$$, '42501', null, 'anon has no execute on statement_invoices_page');
select throws_ok($$select public.statement_summary('a0000000-0000-0000-0000-0000000078a1')$$, '42501', null, 'anon has no execute even naming a venue');

-- ---------------------------------------------------------------- refused callers
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000078a1","role":"authenticated"}';
select is(pg_temp.err($$select public.statement_summary()$$), 'P0001|forbidden', 'a player is refused statement_summary');
select is(pg_temp.err($$select public.statement_charges_page('a0000000-0000-0000-0000-0000000078a1')$$), 'P0001|forbidden', 'a player is refused statement_charges_page, even naming the venue');
select is(pg_temp.err($$select public.statement_invoices_page('a0000000-0000-0000-0000-0000000078a1')$$), 'P0001|forbidden', 'a player is refused statement_invoices_page, even naming the venue');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000078a4","role":"authenticated"}';
select is(pg_temp.err($$select public.statement_summary('a0000000-0000-0000-0000-0000000078a1')$$), 'P0001|forbidden', 'another venue''s admin is refused this venue''s summary');
select is(pg_temp.err($$select public.statement_charges_page('a0000000-0000-0000-0000-0000000078a1')$$), 'P0001|forbidden', 'another venue''s admin is refused this venue''s charges');
select is(pg_temp.err($$select public.statement_invoices_page('a0000000-0000-0000-0000-0000000078a1')$$), 'P0001|forbidden', 'another venue''s admin is refused this venue''s invoices');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000078a2","role":"authenticated"}';
select is(pg_temp.err($$select public.statement_summary()$$), 'P0001|forbidden', 'a platform admin must name a venue (summary)');

-- ---------------------------------------------------------------- member of two venues
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000078a5","role":"authenticated"}';
select is(pg_temp.err($$select public.statement_summary()$$), 'P0001|venue_required', 'a member of two venues must name one (summary)');
select is(pg_temp.err($$select public.statement_charges_page()$$), 'P0001|venue_required', 'a member of two venues must name one (charges)');
select is(pg_temp.err($$select public.statement_invoices_page()$$), 'P0001|venue_required', 'a member of two venues must name one (invoices)');
select is((public.statement_summary('a0000000-0000-0000-0000-0000000078a1') ->> 'total')::numeric(12,2)::text, '30.00', 'naming alpha gives alpha''s summary');
select is((public.statement_summary('a0000000-0000-0000-0000-0000000078a2') ->> 'total')::numeric(12,2)::text, '99.00', 'naming bravo gives bravo''s summary');
select is((public.statement_charges_page('a0000000-0000-0000-0000-0000000078a2') ->> 'total')::int, 1, 'naming bravo gives bravo''s one charge');
select is(pg_temp.err($$select public.statement_summary('a0000000-0000-0000-0000-0000000078a3')$$), 'P0001|forbidden', 'a venue they do not belong to is refused');

-- platform admin naming a venue
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000078a2","role":"authenticated"}';
select is((public.statement_summary('a0000000-0000-0000-0000-0000000078a1') ->> 'total')::numeric(12,2)::text, '30.00', 'a platform admin can read alpha''s summary');
select is((public.statement_invoices_page('a0000000-0000-0000-0000-0000000078a2') ->> 'total')::int, 1, 'a platform admin can page bravo''s invoices');

-- ---------------------------------------------------------------- statement_summary: the venue's admin
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000078a3","role":"authenticated"}';
create temp table sm as select public.statement_summary() as j;
grant select on sm to authenticated;
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select j from sm)) k),
  'accrual,adjustment_total,amount_due,by_method,fee_count,fee_total,month,total', 'the summary has exactly the documented keys');
select is((select j ->> 'month' from sm), pg_temp.mon(0), 'month defaults to the first day of the current venue-local month');
select is((select (j ->> 'fee_count')::int from sm), 4, 'fee_count counts the month''s booking fees only');
select is((select ((j ->> 'fee_total')::numeric(12,2))::text || '|' || ((j ->> 'adjustment_total')::numeric(12,2))::text || '|' || ((j ->> 'total')::numeric(12,2))::text from sm),
  '40.00|-10.00|30.00', 'credits: fees 40 plus adjustment -10 give total 30 (other months and venues excluded)');
select ok((select (j ->> 'fee_total')::numeric + (j ->> 'adjustment_total')::numeric = (j ->> 'total')::numeric and (j ->> 'adjustment_total')::numeric <= 0 from sm), 'total is fee_total plus a non-positive adjustment_total');
select is((select jsonb_typeof(j -> 'fee_count') || ',' || jsonb_typeof(j -> 'fee_total') || ',' || jsonb_typeof(j -> 'adjustment_total') || ',' || jsonb_typeof(j -> 'total') || ',' || jsonb_typeof(j -> 'by_method') || ',' || jsonb_typeof(j -> 'accrual') || ',' || jsonb_typeof(j -> 'amount_due') from sm),
  'number,number,number,number,array,object,object', 'counters are json numbers, by_method an array, accrual and amount_due objects');
select is((select array_agg(coalesce(e ->> 'method', 'NULL') || '|' || coalesce(e ->> 'paid_with', 'NULL') || '|' || (e ->> 'count') || '|' || ((e ->> 'fee_total')::numeric(12,2))::text
    order by coalesce(e ->> 'method', 'zzz'))
  from sm, jsonb_array_elements(j -> 'by_method') e),
  array['account|BPI|1|10.00', 'cash|NULL|1|10.00', 'NULL|NULL|2|20.00'], 'by_method has the venue_statement shape and groups by approved payment');
select is((select string_agg(k, ',' order by k) from sm, jsonb_object_keys(j -> 'by_method' -> 0) k), 'count,fee_total,method,paid_with', 'each by_method entry has exactly the documented keys');

-- accrual
select is((select string_agg(k, ',' order by k) from sm, jsonb_object_keys(j -> 'accrual') k), 'adjustment_total,fee_count,fee_total,total', 'accrual has exactly the documented keys');
select is((select (j -> 'accrual' ->> 'fee_count') || '|' || ((j -> 'accrual' ->> 'fee_total')::numeric(12,2))::text || '|' || ((j -> 'accrual' ->> 'adjustment_total')::numeric(12,2))::text || '|' || ((j -> 'accrual' ->> 'total')::numeric(12,2))::text from sm),
  '4|40.00|-10.00|30.00', 'accrual is this month so far');

-- amount due: sent invoices only (e1 30.00 not overdue, e3 5.00 overdue); draft e5 and paid e2 never count
select is((select string_agg(k, ',' order by k) from sm, jsonb_object_keys(j -> 'amount_due') k), 'count,invoices,total', 'amount_due has exactly the documented keys');
select is((select (j -> 'amount_due' ->> 'count') || '|' || ((j -> 'amount_due' ->> 'total')::numeric(12,2))::text from sm), '2|35.00', 'several unpaid invoices sum: 30 + 5, drafts and paid excluded, other venues excluded');
select is((select string_agg(k, ',' order by k) from sm, jsonb_object_keys(j -> 'amount_due' -> 'invoices' -> 0) k), 'billing_month,due_at,invoice_id,overdue,sent_at,total', 'each amount_due invoice has exactly the documented keys');
select is((select array_agg((e ->> 'invoice_id') || '|' || (e ->> 'billing_month') || '|' || ((e ->> 'total')::numeric(12,2))::text || '|' || (e ->> 'overdue') order by e ->> 'billing_month')
  from sm, jsonb_array_elements(j -> 'amount_due' -> 'invoices') e),
  array['d0000000-0000-0000-0000-0000000078e3|' || pg_temp.mon(2) || '|5.00|true', 'd0000000-0000-0000-0000-0000000078e1|' || pg_temp.mon(0) || '|30.00|false'],
  'amount_due lists each sent invoice once with its total and overdue flag');
select ok((select bool_and((e ->> 'due_at')::timestamptz = (e ->> 'sent_at')::timestamptz + interval '7 days') from sm, jsonb_array_elements(j -> 'amount_due' -> 'invoices') e),
  'due_at is sent_at plus the grace days (7 by default)');
select is((select count(*)::int from sm, jsonb_array_elements(j -> 'amount_due' -> 'invoices') e where e ->> 'invoice_id' in
  ('d0000000-0000-0000-0000-0000000078e2', 'd0000000-0000-0000-0000-0000000078e5', 'd0000000-0000-0000-0000-0000000078e4')), 0, 'paid, draft and other-venue invoices are not in amount_due');
select is((select ((j -> 'amount_due' ->> 'total')::numeric) = (select sum((e ->> 'total')::numeric) from jsonb_array_elements(j -> 'amount_due' -> 'invoices') e) from sm), true, 'amount_due total equals the sum of its invoices');

-- a chosen month
select is((public.statement_summary(p_month => (pg_temp.cm() - interval '1 month')::date) ->> 'month'), pg_temp.mon(1), 'p_month picks the month');
select is((select (j ->> 'fee_count') || '|' || ((j ->> 'total')::numeric(12,2))::text from (select public.statement_summary(p_month => (pg_temp.cm() - interval '1 month')::date) j) x), '1|7.50', 'last month: one fee of 7.50');
select is((public.statement_summary(p_month => (pg_temp.cm() - interval '1 month')::date) -> 'accrual' ->> 'total')::numeric(12,2)::text, '30.00', 'accrual is always the current month, whatever p_month');
select is(public.statement_summary(p_month => (pg_temp.cm() - interval '1 month')::date) -> 'amount_due', (select j -> 'amount_due' from sm), 'amount_due does not depend on p_month');
select is(pg_temp.err($$select public.statement_summary(null, (date_trunc('month', now() at time zone 'Asia/Manila') + interval '14 days')::date)$$), 'P0001|invalid_input', 'a month that is not the first of the month is invalid_input');
select is((select (j ->> 'fee_count') || '|' || ((j ->> 'total')::numeric(12,2))::text || '|' || ((j ->> 'adjustment_total')::numeric(12,2))::text || '|' || (j -> 'by_method')::text from (select public.statement_summary(p_month => (pg_temp.cm() - interval '8 months')::date) j) x),
  '0|0.00|0.00|[]', 'an empty month has zero totals and an empty by_method');

-- ---------------------------------------------------------------- statement_charges_page
create temp table cp as select public.statement_charges_page() as j;
grant select on cp to authenticated;
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select j from cp)) k), 'rows,total', 'charges page returns exactly rows and total');
select is((select (j ->> 'total')::int from cp), 5, 'default month: five charges, fees and the credit');
select is((select string_agg(k, ',' order by k) from cp, jsonb_object_keys(j -> 'rows' -> 0) k), 'amount,booking_id,charge_id,charged_at,invoice_id,kind,reference_code', 'a charge row has exactly the documented keys');
select is(pg_temp.refs((select j from cp)), 'CB-XXXXSE,CB-XXXXSD,CB-XXXXSC,CB-XXXXSB,CB-XXXXSA', 'ordered by charged_at desc then id desc (three charges tie)');
select is((select array_agg((e ->> 'kind') || ':' || ((e ->> 'amount')::numeric(12,2))::text order by o) from cp, jsonb_array_elements(j -> 'rows') with ordinality t(e, o)),
  array['adjustment:-10.00', 'booking_fee:10.00', 'booking_fee:10.00', 'booking_fee:10.00', 'booking_fee:10.00'], 'rows carry kind and the signed amount');
select is((select (j -> 'rows' -> 0 ->> 'charge_id') || '|' || (j -> 'rows' -> 0 ->> 'booking_id') || '|' || (j -> 'rows' -> 0 ->> 'invoice_id') from cp),
  'e0000000-0000-0000-0000-0000000078f5|b0000000-0000-0000-0000-0000000078b5|d0000000-0000-0000-0000-0000000078e1', 'a row carries its charge, booking and invoice ids');
select ok((select (j -> 'rows' -> 0 ->> 'charged_at')::timestamptz = pg_temp.mat(0, 5) from cp), 'a row carries its charged_at');
select is(pg_temp.refs(public.statement_charges_page(null, (pg_temp.cm() - interval '1 month')::date)), 'CB-XXXXSF', 'p_month picks another month''s charges');
select is((public.statement_charges_page(null, (pg_temp.cm() - interval '8 months')::date) ->> 'total') || ',' || jsonb_array_length(public.statement_charges_page(null, (pg_temp.cm() - interval '8 months')::date) -> 'rows'), '0,0', 'an empty month has total 0 and no rows');
select is(pg_temp.err($$select public.statement_charges_page(null, (date_trunc('month', now() at time zone 'Asia/Manila') + interval '3 days')::date)$$), 'P0001|invalid_input', 'a month that is not the first is invalid_input');

-- paging: no row lost or duplicated across the tie
select is(pg_temp.refs(public.statement_charges_page(null, null, null, 2, 0)) || ',' || pg_temp.refs(public.statement_charges_page(null, null, null, 2, 2)) || ',' || pg_temp.refs(public.statement_charges_page(null, null, null, 2, 4)),
  'CB-XXXXSE,CB-XXXXSD,CB-XXXXSC,CB-XXXXSB,CB-XXXXSA', 'pages of 2 joined equal the full ordered list across tied charged_at');
select is(pg_temp.refs(public.statement_charges_page(null, null, null, 1, 2)) || ',' || pg_temp.refs(public.statement_charges_page(null, null, null, 1, 3)) || ',' || pg_temp.refs(public.statement_charges_page(null, null, null, 1, 4)),
  'CB-XXXXSC,CB-XXXXSB,CB-XXXXSA', 'pages of 1 walk the tied charges in id order, none repeated');
select is(array[(public.statement_charges_page(null, null, null, 2, 0) ->> 'total'), (public.statement_charges_page(null, null, null, 2, 2) ->> 'total'), (public.statement_charges_page(null, null, null, 2, 4) ->> 'total')], array['5','5','5'], 'the total is the same on every page');
select is(jsonb_array_length(public.statement_charges_page(null, null, null, 2, 4) -> 'rows'), 1, 'the last page holds the remainder');
select is(jsonb_array_length(public.statement_charges_page(null, null, null, 2, 10) -> 'rows') || ',' || (public.statement_charges_page(null, null, null, 2, 10) ->> 'total'), '0,5', 'an offset past the end gives no rows and the full total');
select is(pg_temp.refs(public.statement_charges_page(null, null, null, 2, -5)), pg_temp.refs(public.statement_charges_page(null, null, null, 2, 0)), 'a negative offset counts as 0');
select is(jsonb_array_length(public.statement_charges_page(null, null, null, 0, 0) -> 'rows'), 1, 'a limit of 0 is raised to 1');
select is(jsonb_array_length(public.statement_charges_page(null, null, null, null, 0) -> 'rows'), 5, 'a null limit gives the default 25 (all five rows)');
select is(jsonb_array_length(public.statement_charges_page(null, null, null, 500, 0) -> 'rows'), 5, 'a limit of 500 is capped at 100 (five rows exist)');

-- search
select is(pg_temp.refs(public.statement_charges_page(null, null, 'xxxxsc')), 'CB-XXXXSC', 'search matches the booking reference, ignoring case');
select is((public.statement_charges_page(null, null, 'CB-XXXXS') ->> 'total')::int, 5, 'a shared prefix matches all five');
select is(jsonb_array_length(public.statement_charges_page(null, null, 'CB-XXXXS', 2, 0) -> 'rows') || ',' || (public.statement_charges_page(null, null, 'CB-XXXXS', 2, 0) ->> 'total'), '2,5', 'total is the filtered count, not the page size');
select is((public.statement_charges_page(null, null, '%') ->> 'total')::int, 0, 'a % in the search is literal');
select is((public.statement_charges_page(null, null, '_') ->> 'total')::int, 0, 'a _ in the search is literal');
select is((public.statement_charges_page(null, null, 'CB-XXXXS_') ->> 'total')::int, 0, 'an underscore does not match any single character');
select is((public.statement_charges_page(null, null, 'nomatch') ->> 'total')::int, 0, 'no match gives total 0');
select is((public.statement_charges_page(null, null, 'CB-XXXXTA') ->> 'total')::int, 0, 'another venue''s reference is never found');
select is((public.statement_charges_page(null, null, 'CB-XXXXSF') ->> 'total')::int, 0, 'search stays inside the chosen month');

-- totals come from the whole month, never from a page
select is((select sum((e ->> 'amount')::numeric) from generate_series(0, 4) o, lateral jsonb_array_elements(public.statement_charges_page(null, null, null, 1, o) -> 'rows') e),
  (select (j ->> 'total')::numeric from sm), 'the one-row pages add up to the summary total');
select is((select j from sm), public.statement_summary(), 'the summary is the same after the page calls');

-- ---------------------------------------------------------------- statement_invoices_page
create temp table ip as select public.statement_invoices_page() as j;
grant select on ip to authenticated;
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select j from ip)) k), 'rows,total', 'invoices page returns exactly rows and total');
select is((select (j ->> 'total')::int from ip), 4, 'four alpha invoices, drafts included, bravo''s excluded');
select is(pg_temp.invs((select j from ip)), pg_temp.mon(0) || '|sent,' || pg_temp.mon(1) || '|paid,' || pg_temp.mon(2) || '|sent,' || pg_temp.mon(3) || '|draft', 'newest billing month first; the draft is labelled draft');
select is((select string_agg(k, ',' order by k) from ip, jsonb_object_keys(j -> 'rows' -> 0) k),
  'adjustment_total,billing_month,due_at,fee_total,invoice_id,overdue,paid_at,paid_method,paid_reference,sent_at,status,total', 'an invoice row has exactly the documented keys');
select is((select ((j -> 'rows' -> 0 ->> 'fee_total')::numeric(12,2))::text || '|' || ((j -> 'rows' -> 0 ->> 'adjustment_total')::numeric(12,2))::text || '|' || ((j -> 'rows' -> 0 ->> 'total')::numeric(12,2))::text from ip),
  '40.00|-10.00|30.00', 'an invoice row''s fee, adjustment and total add up (credit)');
select is((select array_agg((e ->> 'invoice_id') order by o) from ip, jsonb_array_elements(j -> 'rows') with ordinality t(e, o)),
  array['d0000000-0000-0000-0000-0000000078e1', 'd0000000-0000-0000-0000-0000000078e2', 'd0000000-0000-0000-0000-0000000078e3', 'd0000000-0000-0000-0000-0000000078e5'], 'invoice_id is the invoice''s id');
select is((select array_agg((e ->> 'overdue') order by o) from ip, jsonb_array_elements(j -> 'rows') with ordinality t(e, o)), array['false', 'false', 'true', 'false'], 'only the sent invoice past its grace period is overdue');
select ok((select (j -> 'rows' -> 0 ->> 'due_at')::timestamptz = (j -> 'rows' -> 0 ->> 'sent_at')::timestamptz + interval '7 days' from ip), 'due_at is sent_at plus the grace days');
select is((select (j -> 'rows' -> 1 ->> 'paid_method') || '|' || (j -> 'rows' -> 1 ->> 'paid_reference') || '|' || (j -> 'rows' -> 1 ->> 'status') from ip), 'GCash|REF-78|paid', 'a paid invoice shows how it was paid');
select ok((select (j -> 'rows' -> 1 ->> 'paid_at') is not null from ip), 'a paid invoice has paid_at');
select is((select (e -> 'sent_at' = 'null'::jsonb)::text || '/' || (e -> 'due_at' = 'null'::jsonb)::text || '/' || (e -> 'paid_at' = 'null'::jsonb)::text || '/' || (e ->> 'overdue')
  from ip, jsonb_array_elements(j -> 'rows') with ordinality t(e, o) where o = 4), 'true/true/true/false', 'a draft has json null sent_at, due_at and paid_at, and is not overdue');
select is((select jsonb_typeof(j -> 'rows' -> 0 -> 'total') || ',' || jsonb_typeof(j -> 'rows' -> 0 -> 'overdue') from ip), 'number,boolean', 'an invoice total is a json number, overdue a boolean');
select is(pg_temp.invs(public.statement_invoices_page(null, 'draft')), pg_temp.mon(3) || '|draft', 'the draft filter keeps drafts');
select is(pg_temp.invs(public.statement_invoices_page(null, 'sent')), pg_temp.mon(0) || '|sent,' || pg_temp.mon(2) || '|sent', 'the sent filter keeps sent invoices');
select is(pg_temp.invs(public.statement_invoices_page(null, 'paid')), pg_temp.mon(1) || '|paid', 'the paid filter keeps paid invoices');
select is((public.statement_invoices_page(null, 'sent') ->> 'total')::int, 2, 'the status filter changes the total');
select is(pg_temp.err($$select public.statement_invoices_page(null, 'bogus')$$), 'P0001|invalid_filter', 'an unknown status is invalid_filter');
select is(pg_temp.invs(public.statement_invoices_page(null, null, 2, 0)) || ',' || pg_temp.invs(public.statement_invoices_page(null, null, 2, 2)), pg_temp.invs((select j from ip)), 'invoice pages joined equal the full list');
select is(jsonb_array_length(public.statement_invoices_page(null, null, 2, 2) -> 'rows') || ',' || (public.statement_invoices_page(null, null, 2, 2) ->> 'total'), '2,4', 'the total is the full count on any page');
select is(jsonb_array_length(public.statement_invoices_page(null, null, 0, -3) -> 'rows'), 1, 'a limit of 0 is raised to 1 and a negative offset counts as 0');
select is(jsonb_array_length(public.statement_invoices_page(null, null, 2, 10) -> 'rows') || ',' || (public.statement_invoices_page(null, null, 2, 10) ->> 'total'), '0,4', 'an offset past the end gives none and the full total');

-- ---------------------------------------------------------------- a venue with nothing yet (Pacific/Kiritimati)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000078a4","role":"authenticated"}';
select is(public.statement_summary() ->> 'month', to_char(date_trunc('month', now() at time zone 'Pacific/Kiritimati'), 'YYYY-MM-DD'), 'the default month follows the venue''s own timezone');
select is((public.statement_summary() ->> 'fee_count') || '|' || ((public.statement_summary() ->> 'total')::numeric(12,2))::text || '|' || (public.statement_summary() -> 'by_method')::text || '|' || (public.statement_summary() -> 'amount_due' ->> 'count') || '|' || ((public.statement_summary() -> 'amount_due' ->> 'total')::numeric(12,2))::text || '|' || (public.statement_summary() -> 'amount_due' -> 'invoices')::text,
  '0|0.00|[]|0|0.00|[]', 'an empty venue: zero totals, empty arrays, nothing due');
select is((public.statement_summary() -> 'accrual' ->> 'fee_count') || '|' || ((public.statement_summary() -> 'accrual' ->> 'total')::numeric(12,2))::text, '0|0.00', 'an empty venue has a zero accrual');
select is((public.statement_charges_page() ->> 'total') || ',' || (public.statement_charges_page() -> 'rows')::text, '0,[]', 'an empty venue has no charges');
select is((public.statement_invoices_page() ->> 'total') || ',' || (public.statement_invoices_page() -> 'rows')::text, '0,[]', 'an empty venue has no invoices');

-- ---------------------------------------------------------------- venue_statement is unchanged
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000078a3","role":"authenticated"}';
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.venue_statement()) k), 'adjustment_total,by_method,fee_count,fee_total,invoices,lines,month,total', 'venue_statement keeps its keys');
select is((public.venue_statement() ->> 'total')::numeric(12,2)::text || '|' || jsonb_array_length(public.venue_statement() -> 'lines') || '|' || jsonb_array_length(public.venue_statement() -> 'invoices'), '30.00|5|4', 'venue_statement still returns every line and invoice');

-- ---------------------------------------------------------------- read-only
reset role;
select is((select count(*)::int from public.billing_charges where venue_id in ('a0000000-0000-0000-0000-0000000078a1', 'a0000000-0000-0000-0000-0000000078a2')), 9, 'reading changed no charges');

select * from finish();
rollback;
