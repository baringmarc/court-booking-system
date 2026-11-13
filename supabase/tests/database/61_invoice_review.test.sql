-- T14.10: public.invoices_overview(), public.invoice_detail(uuid), public.mark_invoice_sent(uuid),
-- public.mark_invoice_paid(uuid, text, text) and platform_pricing.invoice_grace_days (default 7). Platform admins only;
-- everyone else gets P0001 hint not_platform_admin (anon has no execute).
begin;
create extension if not exists pgtap with schema extensions;
select plan(58);

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

-- One field of the overview element of one invoice (venue slug + month), as text.
create function pg_temp.ov(p_slug text, p_month text, p_field text) returns text language plpgsql as $$
begin
  return (select e ->> p_field from jsonb_array_elements(public.invoices_overview()) e
          where e ->> 'slug' = p_slug and e ->> 'billing_month' = p_month);
end $$;
grant execute on function pg_temp.ov(text, text, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000061a1', 'e2e-ir-player@example.com'),
  ('00000000-0000-0000-0000-0000000061a2', 'e2e-ir-platform@example.com'),
  ('00000000-0000-0000-0000-0000000061a3', 'e2e-ir-owner@example.com');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000061a1', 'e2e-ir-alpha', 'active'),
  ('a0000000-0000-0000-0000-0000000061a2', 'e2e-ir-bravo', 'active');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-0000000061a1', 'E2E IR Alpha', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000061a2', 'E2E IR Bravo', 'Asia/Manila');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000061a1', '00000000-0000-0000-0000-0000000061a3', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000061a2');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000061a1', 'a0000000-0000-0000-0000-0000000061a1', 'E2E IR Court A', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000061a2', 'a0000000-0000-0000-0000-0000000061a2', 'E2E IR Court B', 'tennis', 100, true);
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, confirmed_at) values
  ('b0000000-0000-0000-0000-0000000061b1', 'a0000000-0000-0000-0000-0000000061a1', 'c0000000-0000-0000-0000-0000000061a1', 'E2E IR One', 'CB-XXXXAB', 100, tstzrange('2030-03-01 01:00+00', '2030-03-01 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-0000000061b2', 'a0000000-0000-0000-0000-0000000061a1', 'c0000000-0000-0000-0000-0000000061a1', 'E2E IR Two', 'CB-XXXXCD', 100, tstzrange('2030-03-01 03:00+00', '2030-03-01 04:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-0000000061b3', 'a0000000-0000-0000-0000-0000000061a1', 'c0000000-0000-0000-0000-0000000061a1', 'E2E IR Three', 'CB-XXXXEF', 100, tstzrange('2030-03-01 05:00+00', '2030-03-01 06:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-0000000061b4', 'a0000000-0000-0000-0000-0000000061a2', 'c0000000-0000-0000-0000-0000000061a2', 'E2E IR Four', 'CB-XXXXGH', 100, tstzrange('2030-03-01 01:00+00', '2030-03-01 02:00+00'), 'confirmed', now());

-- Alpha: Jan paid, Feb draft (2 fees 10 and 15.50, one adjustment -5), Mar sent 10 days ago.
-- Bravo: Mar sent 3 days ago (one fee 12), Apr empty draft.
insert into public.invoices (id, venue_id, billing_month, status, sent_at, paid_at, paid_method, paid_reference) values
  ('d0000000-0000-0000-0000-0000000061c1', 'a0000000-0000-0000-0000-0000000061a1', '2026-01-01', 'paid', now() - interval '40 days', now() - interval '35 days', 'GCash', 'REF-1'),
  ('d0000000-0000-0000-0000-0000000061c2', 'a0000000-0000-0000-0000-0000000061a1', '2026-02-01', 'draft', null, null, null, null),
  ('d0000000-0000-0000-0000-0000000061c3', 'a0000000-0000-0000-0000-0000000061a1', '2026-03-01', 'sent', now() - interval '10 days', null, null, null),
  ('d0000000-0000-0000-0000-0000000061c4', 'a0000000-0000-0000-0000-0000000061a2', '2026-03-01', 'sent', now() - interval '3 days', null, null, null),
  ('d0000000-0000-0000-0000-0000000061c5', 'a0000000-0000-0000-0000-0000000061a2', '2026-04-01', 'draft', null, null, null, null);
insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month, invoice_id) values
  ('a0000000-0000-0000-0000-0000000061a1', 'b0000000-0000-0000-0000-0000000061b1', 'booking_fee', 10, '2026-02-10 05:00+00', '2026-02-01', 'd0000000-0000-0000-0000-0000000061c2'),
  ('a0000000-0000-0000-0000-0000000061a1', 'b0000000-0000-0000-0000-0000000061b2', 'booking_fee', 15.50, '2026-02-05 05:00+00', '2026-02-01', 'd0000000-0000-0000-0000-0000000061c2'),
  ('a0000000-0000-0000-0000-0000000061a1', 'b0000000-0000-0000-0000-0000000061b3', 'adjustment', -5, '2026-02-20 05:00+00', '2026-02-01', 'd0000000-0000-0000-0000-0000000061c2'),
  ('a0000000-0000-0000-0000-0000000061a2', 'b0000000-0000-0000-0000-0000000061b4', 'booking_fee', 12, '2026-03-05 05:00+00', '2026-03-01', 'd0000000-0000-0000-0000-0000000061c4');

-- ---------------------------------------------------------------- schema
select has_column('public', 'platform_pricing', 'invoice_grace_days', 'platform_pricing has invoice_grace_days');
select is((select invoice_grace_days from public.platform_pricing), 7, 'the grace period defaults to 7 days');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select public.invoices_overview()$$, '42501', null, 'anon has no execute on invoices_overview');
select throws_ok($$select public.invoice_detail('d0000000-0000-0000-0000-0000000061c2')$$, '42501', null, 'anon has no execute on invoice_detail');
select throws_ok($$select public.mark_invoice_sent('d0000000-0000-0000-0000-0000000061c2')$$, '42501', null, 'anon has no execute on mark_invoice_sent');
select throws_ok($$select public.mark_invoice_paid('d0000000-0000-0000-0000-0000000061c3', 'GCash', null)$$, '42501', null, 'anon has no execute on mark_invoice_paid');

-- ---------------------------------------------------------------- player and venue owner
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000061a1","role":"authenticated"}';
select is(pg_temp.err($$select public.invoices_overview()$$), 'P0001|not_platform_admin', 'a player is refused the invoice overview');
select is(pg_temp.err($$select public.invoice_detail('d0000000-0000-0000-0000-0000000061c2')$$), 'P0001|not_platform_admin', 'a player is refused invoice_detail');
select is(pg_temp.err($$select public.mark_invoice_sent('d0000000-0000-0000-0000-0000000061c2')$$), 'P0001|not_platform_admin', 'a player cannot mark an invoice sent');
select is(pg_temp.err($$select public.mark_invoice_paid('d0000000-0000-0000-0000-0000000061c3', 'GCash', null)$$), 'P0001|not_platform_admin', 'a player cannot mark an invoice paid');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000061a3","role":"authenticated"}';
select is(pg_temp.err($$select public.invoices_overview()$$), 'P0001|not_platform_admin', 'a venue owner is refused the invoice overview');
select is(pg_temp.err($$select public.invoice_detail('d0000000-0000-0000-0000-0000000061c2')$$), 'P0001|not_platform_admin', 'a venue owner is refused the detail of their own invoice');
select is(pg_temp.err($$select public.mark_invoice_sent('d0000000-0000-0000-0000-0000000061c2')$$), 'P0001|not_platform_admin', 'a venue owner cannot mark their own invoice sent');
select is(pg_temp.err($$select public.mark_invoice_paid('d0000000-0000-0000-0000-0000000061c3', 'GCash', null)$$), 'P0001|not_platform_admin', 'a venue owner cannot mark their own invoice paid');
reset role;
select is((select status || '|' || (select status from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c3') from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c2'),
  'draft|sent', 'refused calls leave the invoices as they were');

-- ---------------------------------------------------------------- platform admin: the overview
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000061a2","role":"authenticated"}';
select is(jsonb_typeof(public.invoices_overview()), 'array', 'the overview is a jsonb array');
select is((select count(*)::int from jsonb_array_elements(public.invoices_overview()) e where e ->> 'slug' like 'e2e-ir-%'), 5,
  'one element per invoice, whatever its status');
select is((select array_agg((e ->> 'slug') || '|' || (e ->> 'billing_month') order by o)
           from jsonb_array_elements(public.invoices_overview()) with ordinality t(e, o) where e ->> 'slug' like 'e2e-ir-%'),
  array['e2e-ir-bravo|2026-04-01', 'e2e-ir-alpha|2026-03-01', 'e2e-ir-bravo|2026-03-01', 'e2e-ir-alpha|2026-02-01', 'e2e-ir-alpha|2026-01-01'],
  'newest billing month first, then venue name');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select e from jsonb_array_elements(public.invoices_overview()) e where e ->> 'slug' = 'e2e-ir-alpha' limit 1)) k),
  'adjustment_total,billing_month,due_at,email_count,fee_count,fee_total,invoice_id,last_emailed_at,name,overdue,paid_at,paid_method,paid_reference,sent_at,slug,status,total,venue_id',
  'each element has exactly the documented keys');
select is(pg_temp.ov('e2e-ir-alpha', '2026-02-01', 'invoice_id'), 'd0000000-0000-0000-0000-0000000061c2', 'invoice_id is the invoice''s id');
select is(pg_temp.ov('e2e-ir-alpha', '2026-02-01', 'venue_id') || '|' || pg_temp.ov('e2e-ir-alpha', '2026-02-01', 'name'),
  'a0000000-0000-0000-0000-0000000061a1|E2E IR Alpha', 'venue_id and the venue_settings name are included');
select is(pg_temp.ov('e2e-ir-alpha', '2026-02-01', 'fee_count') || '|' || (pg_temp.ov('e2e-ir-alpha', '2026-02-01', 'fee_total'))::numeric
  || '|' || (pg_temp.ov('e2e-ir-alpha', '2026-02-01', 'adjustment_total'))::numeric || '|' || (pg_temp.ov('e2e-ir-alpha', '2026-02-01', 'total'))::numeric,
  '2|25.50|-5.00|20.50'::text, 'fees counted and summed, adjustments negative, total is the sum of all charges');
select is((select jsonb_typeof(e -> 'fee_count') || ',' || jsonb_typeof(e -> 'fee_total') || ',' || jsonb_typeof(e -> 'adjustment_total') || ',' || jsonb_typeof(e -> 'total') || ',' || jsonb_typeof(e -> 'overdue')
  from jsonb_array_elements(public.invoices_overview()) e where e ->> 'slug' = 'e2e-ir-alpha' and e ->> 'billing_month' = '2026-02-01'),
  'number,number,number,number,boolean', 'counters and totals are json numbers, overdue is a boolean');
select is(pg_temp.ov('e2e-ir-bravo', '2026-04-01', 'fee_count') || '|' || (pg_temp.ov('e2e-ir-bravo', '2026-04-01', 'fee_total'))::numeric
  || '|' || (pg_temp.ov('e2e-ir-bravo', '2026-04-01', 'adjustment_total'))::numeric || '|' || (pg_temp.ov('e2e-ir-bravo', '2026-04-01', 'total'))::numeric,
  '0|0|0|0', 'an invoice without charges shows 0 fees and totals of 0');
select is(pg_temp.ov('e2e-ir-bravo', '2026-03-01', 'fee_count') || '|' || (pg_temp.ov('e2e-ir-bravo', '2026-03-01', 'total'))::numeric,
  '1|12.00', 'another venue''s charges do not leak into an invoice');
select ok(pg_temp.ov('e2e-ir-alpha', '2026-02-01', 'due_at') is null and pg_temp.ov('e2e-ir-bravo', '2026-04-01', 'due_at') is null
  and pg_temp.ov('e2e-ir-alpha', '2026-02-01', 'overdue') = 'false', 'a draft has no due date and is not overdue');
select ok(pg_temp.ov('e2e-ir-alpha', '2026-03-01', 'due_at')::timestamptz = (select sent_at + interval '7 days' from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c3'),
  'due_at is sent_at plus the grace days (7)');
select is(pg_temp.ov('e2e-ir-alpha', '2026-03-01', 'overdue') || '|' || pg_temp.ov('e2e-ir-bravo', '2026-03-01', 'overdue'), 'true|false',
  'sent 10 days ago is overdue with a 7-day grace, sent 3 days ago is not');
select is(pg_temp.ov('e2e-ir-alpha', '2026-01-01', 'overdue') || '|' || pg_temp.ov('e2e-ir-alpha', '2026-01-01', 'paid_method') || '|' || pg_temp.ov('e2e-ir-alpha', '2026-01-01', 'paid_reference'),
  'false|GCash|REF-1', 'a paid invoice is never overdue and carries its payment details');
select ok(pg_temp.ov('e2e-ir-alpha', '2026-01-01', 'due_at') is not null, 'a paid invoice that was sent keeps its due_at');

-- grace days are read live from platform_pricing
reset role;
update public.platform_pricing set invoice_grace_days = 2;
set local role authenticated;
select is(pg_temp.ov('e2e-ir-bravo', '2026-03-01', 'overdue'), 'true', 'with a 2-day grace the invoice sent 3 days ago becomes overdue');
select ok(pg_temp.ov('e2e-ir-bravo', '2026-03-01', 'due_at')::timestamptz = (select sent_at + interval '2 days' from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c4'),
  'due_at follows the new grace days');
reset role;
update public.platform_pricing set invoice_grace_days = 14;
set local role authenticated;
select is(pg_temp.ov('e2e-ir-alpha', '2026-03-01', 'overdue'), 'false', 'with a 14-day grace the invoice sent 10 days ago is no longer overdue');

-- ---------------------------------------------------------------- invoice_detail
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.invoice_detail('d0000000-0000-0000-0000-0000000061c2')) k),
  'adjustment_total,billing_month,due_at,email_count,fee_count,fee_total,invoice_id,last_emailed_at,lines,name,overdue,paid_at,paid_method,paid_reference,sent_at,slug,status,total,venue_id',
  'the detail has the overview keys plus lines');
select is((public.invoice_detail('d0000000-0000-0000-0000-0000000061c2') ->> 'total')::numeric || '|' || (public.invoice_detail('d0000000-0000-0000-0000-0000000061c2') ->> 'fee_count')
  || '|' || (public.invoice_detail('d0000000-0000-0000-0000-0000000061c2') ->> 'slug'), '20.50|2|e2e-ir-alpha', 'the detail totals match the overview');
select is((select array_agg(l ->> 'reference_code' order by o) from jsonb_array_elements(public.invoice_detail('d0000000-0000-0000-0000-0000000061c2') -> 'lines') with ordinality t(l, o)),
  array['CB-XXXXCD', 'CB-XXXXAB', 'CB-XXXXEF'], 'lines carry the booking reference codes, ordered by charged_at');
select is((select array_agg((l ->> 'kind') || ':' || (l ->> 'amount')::numeric order by o) from jsonb_array_elements(public.invoice_detail('d0000000-0000-0000-0000-0000000061c2') -> 'lines') with ordinality t(l, o)),
  array['booking_fee:15.50', 'booking_fee:10.00', 'adjustment:-5.00'], 'lines carry kind and amount');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.invoice_detail('d0000000-0000-0000-0000-0000000061c2') -> 'lines' -> 0) k),
  'amount,booking_id,charge_id,charged_at,kind,reference_code', 'each line has exactly the documented keys');
select is((public.invoice_detail('d0000000-0000-0000-0000-0000000061c2') -> 'lines' -> 1 ->> 'booking_id'), 'b0000000-0000-0000-0000-0000000061b1', 'a line carries its booking_id');
select is(public.invoice_detail('d0000000-0000-0000-0000-0000000061c5') -> 'lines', '[]'::jsonb, 'an invoice without charges has an empty lines array');
select is((select array_agg(l ->> 'reference_code') from jsonb_array_elements(public.invoice_detail('d0000000-0000-0000-0000-0000000061c4') -> 'lines') l),
  array['CB-XXXXGH'], 'the detail lists only that invoice''s own charges');
select is(pg_temp.err($$select public.invoice_detail('d0000000-0000-0000-0000-0000000061ff')$$), 'P0001|invoice_not_found', 'an unknown invoice is invoice_not_found');

-- ---------------------------------------------------------------- mark_invoice_sent
select is(pg_temp.err($$select public.mark_invoice_sent('d0000000-0000-0000-0000-0000000061c2')$$), 'ok', 'a platform admin can mark a draft sent');
select is((select status from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c2') || '|' ||
  (select (sent_at = now())::text from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c2'), 'sent|true', 'the invoice is sent and sent_at is now()');
select is(pg_temp.err($$select public.mark_invoice_sent('d0000000-0000-0000-0000-0000000061c2')$$), 'P0001|invalid_status', 'marking a sent invoice sent again is invalid_status');
select is(pg_temp.err($$select public.mark_invoice_sent('d0000000-0000-0000-0000-0000000061c1')$$), 'P0001|invalid_status', 'marking a paid invoice sent is invalid_status');
select is(pg_temp.err($$select public.mark_invoice_sent('d0000000-0000-0000-0000-0000000061ff')$$), 'P0001|invoice_not_found', 'marking an unknown invoice sent is invoice_not_found');

-- ---------------------------------------------------------------- mark_invoice_paid
select is(pg_temp.err($$select public.mark_invoice_paid('d0000000-0000-0000-0000-0000000061c5', 'GCash', null)$$), 'P0001|invalid_status', 'a draft cannot be marked paid');
select is(pg_temp.err($$select public.mark_invoice_paid('d0000000-0000-0000-0000-0000000061c3', '   ', 'X')$$), 'P0001|method_required', 'a whitespace method is method_required');
select is(pg_temp.err($$select public.mark_invoice_paid('d0000000-0000-0000-0000-0000000061c3', null, 'X')$$), 'P0001|method_required', 'a null method is method_required');
select is((select status from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c3') || '|' || (select status from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c5'),
  'sent|draft', 'refused payments leave the invoices unchanged');
select is(pg_temp.err($$select public.mark_invoice_paid('d0000000-0000-0000-0000-0000000061c3', 'Bank transfer', '   ')$$), 'ok', 'a sent invoice can be marked paid with a blank reference');
select is((select status || '|' || (paid_at = now())::text || '|' || paid_method || '|' || coalesce(paid_reference, 'NULL') from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c3'),
  'paid|true|Bank transfer|NULL', 'paid_at is now(), the method is stored and a blank reference is stored as null');
select is(pg_temp.err($$select public.mark_invoice_paid('d0000000-0000-0000-0000-0000000061c4', 'GCash', 'TX-123')$$), 'ok', 'a sent invoice can be marked paid with a reference');
select is((select paid_method || '|' || paid_reference from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c4'), 'GCash|TX-123', 'method and reference are stored');
select is(pg_temp.err($$select public.mark_invoice_paid('d0000000-0000-0000-0000-0000000061c4', 'GCash', null)$$), 'P0001|invalid_status', 'a paid invoice cannot be paid again');
select is(pg_temp.err($$select public.mark_invoice_paid('d0000000-0000-0000-0000-0000000061ff', 'GCash', null)$$), 'P0001|invoice_not_found', 'paying an unknown invoice is invoice_not_found');
select is((select status || '|' || coalesce(sent_at::text, 'NULL') from public.invoices where id = 'd0000000-0000-0000-0000-0000000061c5'), 'draft|NULL',
  'other invoices are untouched');

select * from finish();
rollback;
