-- T17.18: public.venues_page, public.invoices_page and public.invoice_detail_page. Platform admins only (anon has no
-- execute; everyone else gets P0001 hint not_platform_admin). Filters, escaped search, stable ordering, clamped limit,
-- totals independent of the page. The old venues_overview / invoices_overview / invoice_detail keep working.
begin;
create extension if not exists pgtap with schema extensions;
select plan(59);

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

-- slugs of one page's rows, in order, comma separated
create function pg_temp.slugs(p jsonb) returns text language sql as $$
  select coalesce(string_agg(e ->> 'slug', ',' order by o), '') from jsonb_array_elements(p -> 'rows') with ordinality t(e, o)
$$;
grant execute on function pg_temp.slugs(jsonb) to authenticated;
-- slug|month of one invoices page's rows, in order
create function pg_temp.inv(p jsonb) returns text language sql as $$
  select coalesce(string_agg((e ->> 'slug') || '|' || (e ->> 'billing_month'), ',' order by o), '') from jsonb_array_elements(p -> 'rows') with ordinality t(e, o)
$$;
grant execute on function pg_temp.inv(jsonb) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000077a1', 'e2e-pg-player@example.com'),
  ('00000000-0000-0000-0000-0000000077a2', 'e2e-pg-platform@example.com'),
  ('00000000-0000-0000-0000-0000000077a3', 'e2e-pg-owner@example.com');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000077a1', 'e2e-pg-same1', 'active'),
  ('a0000000-0000-0000-0000-0000000077a2', 'e2e-pg-same2', 'active'),
  ('a0000000-0000-0000-0000-0000000077a3', 'e2e-pg-same3', 'suspended'),
  ('a0000000-0000-0000-0000-0000000077a4', 'e2e-pg-zed', 'draft'),
  ('a0000000-0000-0000-0000-0000000077a5', 'e2e-pg-pct', 'active'),
  ('a0000000-0000-0000-0000-0000000077a6', 'e2e-pg-fifty', 'active');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-0000000077a1', 'E2E PG Same', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000077a2', 'E2E PG Same', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000077a3', 'E2E PG Same', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000077a4', 'E2E PG Zed', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000077a5', 'E2E PG 50%_Off', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000077a6', 'E2E PG 50xxOff', 'Asia/Manila');
-- 103 more venues, only to prove the page size is capped
insert into public.venues (id, slug, status)
  select ('a0000000-0000-0000-0000-000000780' || lpad(n::text, 3, '0'))::uuid, 'e2e-zz-' || lpad(n::text, 3, '0'), 'active' from generate_series(1, 103) n;
insert into public.venue_settings (venue_id, name, timezone)
  select ('a0000000-0000-0000-0000-000000780' || lpad(n::text, 3, '0'))::uuid, 'E2E ZZ ' || lpad(n::text, 3, '0'), 'Asia/Manila' from generate_series(1, 103) n;
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000077a1', '00000000-0000-0000-0000-0000000077a3', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000077a2');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000077a1', 'a0000000-0000-0000-0000-0000000077a1', 'E2E PG Court', 'tennis', 100, true);
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, confirmed_at)
  select ('b0000000-0000-0000-0000-00000000770' || n)::uuid, 'a0000000-0000-0000-0000-0000000077a1', 'c0000000-0000-0000-0000-0000000077a1',
         'E2E PG ' || n, 'CB-XXXX' || (array['AB','CD','EF','GH','JK'])[n], 100,
         tstzrange('2030-03-01 00:00+00'::timestamptz + (n || ' hours')::interval, '2030-03-01 00:00+00'::timestamptz + (n || ' hours')::interval + interval '30 minutes'), 'confirmed', now()
  from generate_series(1, 5) n;

-- same1: Jan paid, Feb draft (5 lines), Mar sent. same2: Mar draft. zed: Mar sent.
insert into public.invoices (id, venue_id, billing_month, status, sent_at, paid_at, paid_method, paid_reference) values
  ('d0000000-0000-0000-0000-0000000077c1', 'a0000000-0000-0000-0000-0000000077a1', '2026-01-01', 'paid', now() - interval '40 days', now() - interval '35 days', 'GCash', 'REF-1'),
  ('d0000000-0000-0000-0000-0000000077c2', 'a0000000-0000-0000-0000-0000000077a1', '2026-02-01', 'draft', null, null, null, null),
  ('d0000000-0000-0000-0000-0000000077c3', 'a0000000-0000-0000-0000-0000000077a1', '2026-03-01', 'sent', now() - interval '10 days', null, null, null),
  ('d0000000-0000-0000-0000-0000000077c4', 'a0000000-0000-0000-0000-0000000077a2', '2026-03-01', 'draft', null, null, null, null),
  ('d0000000-0000-0000-0000-0000000077c5', 'a0000000-0000-0000-0000-0000000077a4', '2026-03-01', 'sent', now() - interval '3 days', null, null, null);
insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month, invoice_id)
  select 'a0000000-0000-0000-0000-0000000077a1', ('b0000000-0000-0000-0000-00000000770' || n)::uuid, 'booking_fee', 10 * n,
         '2026-02-01 00:00+00'::timestamptz + (n || ' days')::interval, '2026-02-01', 'd0000000-0000-0000-0000-0000000077c2'
  from generate_series(1, 5) n;

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select public.venues_page()$$, '42501', null, 'anon has no execute on venues_page');
select throws_ok($$select public.invoices_page()$$, '42501', null, 'anon has no execute on invoices_page');
select throws_ok($$select public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2')$$, '42501', null, 'anon has no execute on invoice_detail_page');

-- ---------------------------------------------------------------- player and venue owner
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000077a1","role":"authenticated"}';
select is(pg_temp.err($$select public.venues_page()$$), 'P0001|not_platform_admin', 'a player is refused venues_page');
select is(pg_temp.err($$select public.invoices_page()$$), 'P0001|not_platform_admin', 'a player is refused invoices_page');
select is(pg_temp.err($$select public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2')$$), 'P0001|not_platform_admin', 'a player is refused invoice_detail_page');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000077a3","role":"authenticated"}';
select is(pg_temp.err($$select public.venues_page()$$), 'P0001|not_platform_admin', 'a venue owner is refused venues_page');
select is(pg_temp.err($$select public.invoices_page()$$), 'P0001|not_platform_admin', 'a venue owner is refused invoices_page');
select is(pg_temp.err($$select public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2')$$), 'P0001|not_platform_admin', 'a venue owner is refused the page of their own invoice');

-- ---------------------------------------------------------------- platform admin: venues_page
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000077a2","role":"authenticated"}';
select is(jsonb_typeof(public.venues_page('e2e-pg-')) || ',' || (select string_agg(k, ',' order by k) from jsonb_object_keys(public.venues_page('e2e-pg-')) k),
  'object,rows,total', 'venues_page returns an object with exactly rows and total');
select is((public.venues_page('e2e-pg-') ->> 'total')::int, 6, 'total counts every venue matching the search');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.venues_page('e2e-pg-same1') -> 'rows' -> 0) k),
  'month_total,month_transactions,name,open_invoices,slug,status,venue_id', 'a row has exactly the venues_overview keys');
select is(pg_temp.slugs(public.venues_page('e2e-pg-same')), 'e2e-pg-same1,e2e-pg-same2,e2e-pg-same3', 'venues with identical names are ordered by slug');
select is(public.venues_page('e2e-pg-same1') -> 'rows' -> 0,
  (select e from jsonb_array_elements(public.venues_overview()) e where e ->> 'slug' = 'e2e-pg-same1'),
  'a page row equals the venues_overview element of the same venue');
select is((public.venues_page('E2E-PG-ZED') ->> 'total')::int, 1, 'search ignores case (slug)');
select is((public.venues_page('pg ZED') ->> 'total')::int, 1, 'search matches the venue name');
select is(pg_temp.slugs(public.venues_page('50%_')), 'e2e-pg-pct', 'a % and _ in the search are literal, not wildcards');
select is((public.venues_page('e2e_pg') ->> 'total')::int, 0, 'an underscore does not match any single character');
select is((public.venues_page('\') ->> 'total')::int, 0, 'a backslash in the search is literal');
select is(pg_temp.slugs(public.venues_page('e2e-pg-', 'suspended')), 'e2e-pg-same3', 'the status filter keeps only suspended venues');
select is((public.venues_page('e2e-pg-', 'active') ->> 'total')::int, 4, 'the status filter changes the total');
select is((public.venues_page('e2e-pg-', 'closed') ->> 'total')::int || ',' || jsonb_array_length(public.venues_page('e2e-pg-', 'closed') -> 'rows'), '0,0', 'no match gives total 0 and no rows');
select is(pg_temp.err($$select public.venues_page(null, 'bogus')$$), 'P0001|invalid_filter', 'an unknown status is invalid_filter');
select is(jsonb_array_length(public.venues_page('e2e-pg-', null, 2, 0) -> 'rows') || ',' || (public.venues_page('e2e-pg-', null, 2, 0) ->> 'total'), '2,6', 'limit 2 returns 2 rows and the full total');
select is(array[(public.venues_page('e2e-pg-', null, 2, 0) ->> 'total'), (public.venues_page('e2e-pg-', null, 2, 2) ->> 'total'), (public.venues_page('e2e-pg-', null, 2, 4) ->> 'total')],
  array['6','6','6'], 'the total is the same on every page');
select is(pg_temp.slugs(public.venues_page('e2e-pg-', null, 2, 0)) || ',' || pg_temp.slugs(public.venues_page('e2e-pg-', null, 2, 2)) || ',' || pg_temp.slugs(public.venues_page('e2e-pg-', null, 2, 4)),
  pg_temp.slugs(public.venues_page('e2e-pg-', null, 100, 0)), 'pages joined equal one big page: no gaps and no duplicates');
select is((select count(distinct s)::int from unnest(string_to_array(pg_temp.slugs(public.venues_page('e2e-pg-', null, 2, 0)) || ',' || pg_temp.slugs(public.venues_page('e2e-pg-', null, 2, 2)) || ',' || pg_temp.slugs(public.venues_page('e2e-pg-', null, 2, 4)), ',')) s), 6,
  'the three pages hold six distinct venues');
select is(jsonb_array_length(public.venues_page('e2e-pg-', null, 2, 10) -> 'rows') || ',' || (public.venues_page('e2e-pg-', null, 2, 10) ->> 'total'), '0,6', 'an offset past the end gives no rows and the full total');
select is(pg_temp.slugs(public.venues_page('e2e-pg-', null, 2, -5)), pg_temp.slugs(public.venues_page('e2e-pg-', null, 2, 0)), 'a negative offset counts as 0');
select is(jsonb_array_length(public.venues_page('e2e-zz-', null, 0, 0) -> 'rows'), 1, 'a limit of 0 is raised to 1');
select is(jsonb_array_length(public.venues_page('e2e-zz-', null, -3, 0) -> 'rows'), 1, 'a negative limit is raised to 1');
select is(jsonb_array_length(public.venues_page('e2e-zz-', null, null, 0) -> 'rows'), 25, 'a null limit gives the default of 25');
select is(jsonb_array_length(public.venues_page('e2e-zz-', null, 500, 0) -> 'rows') || ',' || (public.venues_page('e2e-zz-', null, 500, 0) ->> 'total'), '100,103', 'the limit is capped at 100 and the total still counts all 103');

-- ---------------------------------------------------------------- platform admin: invoices_page
select is(pg_temp.inv(public.invoices_page('e2e-pg-')),
  'e2e-pg-same1|2026-03-01,e2e-pg-same2|2026-03-01,e2e-pg-zed|2026-03-01,e2e-pg-same1|2026-02-01,e2e-pg-same1|2026-01-01',
  'invoices are ordered by month (newest first), venue name, slug');
select is((public.invoices_page('e2e-pg-') ->> 'total')::int, 5, 'invoices total counts every matching invoice');
select is(public.invoices_page('e2e-pg-', null, '2026-02-01') -> 'rows' -> 0,
  (select e from jsonb_array_elements(public.invoices_overview()) e where e ->> 'invoice_id' = 'd0000000-0000-0000-0000-0000000077c2'),
  'an invoice page row equals the invoices_overview element');
select is((public.invoices_page('e2e-pg-', 'sent') ->> 'total')::int, 2, 'the status filter keeps sent invoices');
select is(pg_temp.inv(public.invoices_page('e2e-pg-', 'paid')), 'e2e-pg-same1|2026-01-01', 'the status filter keeps paid invoices');
select is((public.invoices_page('e2e-pg-', null, '2026-03-01') ->> 'total')::int, 3, 'the month filter keeps one billing month');
select is((public.invoices_page('e2e-pg-', 'sent', '2026-03-01') ->> 'total')::int, 2, 'status and month filters combine');
select is(pg_temp.err($$select public.invoices_page(null, 'bogus')$$), 'P0001|invalid_filter', 'an unknown invoice status is invalid_filter');
select is(pg_temp.err($$select public.invoices_page(null, null, '2026-03-15')$$), 'P0001|invalid_filter', 'a month that is not the first of the month is invalid_filter');
select is((public.invoices_page('%') ->> 'total')::int, 0, 'a % in the invoice search is literal');
select is(pg_temp.inv(public.invoices_page('pg-zed')), 'e2e-pg-zed|2026-03-01', 'invoice search matches the venue slug');
select is(pg_temp.inv(public.invoices_page('e2e-pg-', null, null, 2, 0)) || ',' || pg_temp.inv(public.invoices_page('e2e-pg-', null, null, 2, 2)) || ',' || pg_temp.inv(public.invoices_page('e2e-pg-', null, null, 2, 4)),
  pg_temp.inv(public.invoices_page('e2e-pg-', null, null, 100, 0)), 'invoice pages joined equal one big page');
select is((public.invoices_page('e2e-pg-', null, null, 2, 4) ->> 'total')::int || ',' || jsonb_array_length(public.invoices_page('e2e-pg-', null, null, 2, 4) -> 'rows'), '5,1', 'the last page holds the remainder and the full total');
select is(jsonb_array_length(public.invoices_page('e2e-pg-', null, null, 0, -1) -> 'rows'), 1, 'invoices_page raises a limit of 0 to 1 and treats a negative offset as 0');

-- ---------------------------------------------------------------- platform admin: invoice_detail_page
select is(pg_temp.err($$select public.invoice_detail_page('d0000000-0000-0000-0000-0000000077ff')$$), 'P0001|invoice_not_found', 'an unknown invoice is invoice_not_found');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2')) k),
  'adjustment_total,billing_month,due_at,fee_count,fee_total,invoice_id,line_total,lines,name,overdue,paid_at,paid_method,paid_reference,sent_at,slug,status,total,venue_id',
  'the detail page has the invoice keys plus lines and line_total');
select is(public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 0) - 'lines' - 'line_total', public.invoice_detail('d0000000-0000-0000-0000-0000000077c2') - 'lines',
  'the invoice header equals the old invoice_detail header, whatever the page');
select is(jsonb_array_length(public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 0) -> 'lines') || ',' || (public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 0) ->> 'line_total'), '2,5',
  'a page of 2 lines reports line_total 5');
select is((select jsonb_agg(l) from (
    select l from jsonb_array_elements(public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 0) -> 'lines') l
    union all select l from jsonb_array_elements(public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 2) -> 'lines') l
    union all select l from jsonb_array_elements(public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 4) -> 'lines') l) x),
  public.invoice_detail('d0000000-0000-0000-0000-0000000077c2') -> 'lines', 'the line pages joined equal the old lines, in order (charged_at, id)');
select is(public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 4) ->> 'line_total', '5', 'line_total is the same on the last page');
select is(jsonb_array_length(public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 9) -> 'lines') || ',' || (public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 9) ->> 'line_total'), '0,5',
  'an offset past the lines gives none and the full line_total');
select is(jsonb_array_length(public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 0, -4) -> 'lines'), 1, 'a limit of 0 is raised to 1 and a negative offset counts as 0');
select is(public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 0) ->> 'total', public.invoice_detail_page('d0000000-0000-0000-0000-0000000077c2', 2, 4) ->> 'total',
  'the invoice total does not depend on the page');

-- ---------------------------------------------------------------- the old contract is untouched
select is(jsonb_typeof(public.venues_overview()), 'array', 'venues_overview still returns an array');
select is(jsonb_typeof(public.invoices_overview()), 'array', 'invoices_overview still returns an array');
select is(jsonb_array_length(public.invoice_detail('d0000000-0000-0000-0000-0000000077c2') -> 'lines'), 5, 'invoice_detail still returns every line');

select * from finish();
rollback;
