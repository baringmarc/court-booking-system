-- T14.8: public.venues_overview(), public.suspend_venue(uuid), public.reactivate_venue(uuid). Platform admins only;
-- everyone else gets P0001 hint not_platform_admin (anon has no execute). The overview has one element per venue of
-- any status with this month's billing numbers (month taken in the venue's timezone) and its open invoices.
begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

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

-- One field of the overview element of one venue (by slug), as text.
create function pg_temp.ov(p_slug text, p_field text) returns text language plpgsql as $$
begin
  return (select e ->> p_field from jsonb_array_elements(public.venues_overview()) e where e ->> 'slug' = p_slug);
end $$;
grant execute on function pg_temp.ov(text, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000059a1', 'e2e-vo-player@example.com'),
  ('00000000-0000-0000-0000-0000000059a2', 'e2e-vo-platform@example.com'),
  ('00000000-0000-0000-0000-0000000059a3', 'e2e-vo-owner@example.com');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000059a1', 'e2e-vo-alpha', 'active'),
  ('a0000000-0000-0000-0000-0000000059a2', 'e2e-vo-bravo', 'draft'),
  ('a0000000-0000-0000-0000-0000000059a3', 'e2e-vo-charlie', 'suspended'),
  ('a0000000-0000-0000-0000-0000000059a4', 'e2e-vo-delta', 'closed'),
  ('a0000000-0000-0000-0000-0000000059a5', 'e2e-vo-echo', 'active');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-0000000059a1', 'E2E VO Alpha', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000059a2', 'E2E VO Bravo', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000059a3', 'E2E VO Charlie', 'Pacific/Honolulu'),
  ('a0000000-0000-0000-0000-0000000059a4', 'E2E VO Delta', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000059a5', 'E2E VO Echo', 'Asia/Manila');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000059a1', '00000000-0000-0000-0000-0000000059a3', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000059a2');

-- Courts and bookings to hang ledger rows on (written as the table owner, so the bill_booking trigger stays quiet: fee 0).
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000059a1', 'a0000000-0000-0000-0000-0000000059a1', 'E2E VO Court A', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000059a3', 'a0000000-0000-0000-0000-0000000059a3', 'E2E VO Court C', 'tennis', 100, true);
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status, confirmed_at) values
  ('b0000000-0000-0000-0000-0000000059b1', 'a0000000-0000-0000-0000-0000000059a1', 'c0000000-0000-0000-0000-0000000059a1', 'E2E VO One', 'CB-VVVVAB', 100, tstzrange('2030-03-01 01:00+00', '2030-03-01 02:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-0000000059b2', 'a0000000-0000-0000-0000-0000000059a1', 'c0000000-0000-0000-0000-0000000059a1', 'E2E VO Two', 'CB-VVVVCD', 100, tstzrange('2030-03-01 03:00+00', '2030-03-01 04:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-0000000059b3', 'a0000000-0000-0000-0000-0000000059a1', 'c0000000-0000-0000-0000-0000000059a1', 'E2E VO Three', 'CB-VVVVEF', 100, tstzrange('2030-03-01 05:00+00', '2030-03-01 06:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-0000000059b4', 'a0000000-0000-0000-0000-0000000059a1', 'c0000000-0000-0000-0000-0000000059a1', 'E2E VO Four', 'CB-VVVVGH', 100, tstzrange('2030-03-01 07:00+00', '2030-03-01 08:00+00'), 'confirmed', now()),
  ('b0000000-0000-0000-0000-0000000059b5', 'a0000000-0000-0000-0000-0000000059a3', 'c0000000-0000-0000-0000-0000000059a3', 'E2E VO Five', 'CB-VVVVJK', 100, tstzrange('2030-03-01 01:00+00', '2030-03-01 02:00+00'), 'confirmed', now());
-- Alpha: this month 2 fees (10 and 15.50) and one adjustment (-10); one fee last month and one next month do not count.
-- Charlie (another venue) has a fee of 20 this month that must not leak into Alpha.
insert into public.billing_charges (venue_id, booking_id, kind, amount, billing_month) values
  ('a0000000-0000-0000-0000-0000000059a1', 'b0000000-0000-0000-0000-0000000059b1', 'booking_fee', 10, date_trunc('month', now() at time zone 'Asia/Manila')::date),
  ('a0000000-0000-0000-0000-0000000059a1', 'b0000000-0000-0000-0000-0000000059b1', 'adjustment', -10, date_trunc('month', now() at time zone 'Asia/Manila')::date),
  ('a0000000-0000-0000-0000-0000000059a1', 'b0000000-0000-0000-0000-0000000059b2', 'booking_fee', 15.50, date_trunc('month', now() at time zone 'Asia/Manila')::date),
  ('a0000000-0000-0000-0000-0000000059a1', 'b0000000-0000-0000-0000-0000000059b3', 'booking_fee', 99, (date_trunc('month', now() at time zone 'Asia/Manila') - interval '1 month')::date),
  ('a0000000-0000-0000-0000-0000000059a1', 'b0000000-0000-0000-0000-0000000059b4', 'booking_fee', 77, (date_trunc('month', now() at time zone 'Asia/Manila') + interval '1 month')::date),
  ('a0000000-0000-0000-0000-0000000059a3', 'b0000000-0000-0000-0000-0000000059b5', 'booking_fee', 20, date_trunc('month', now() at time zone 'Pacific/Honolulu')::date);
-- Open invoices: Alpha has a draft and a sent one (open) and a paid one (not open); Charlie has one draft.
insert into public.invoices (venue_id, billing_month, status) values
  ('a0000000-0000-0000-0000-0000000059a1', '2030-01-01', 'draft'),
  ('a0000000-0000-0000-0000-0000000059a1', '2030-02-01', 'sent'),
  ('a0000000-0000-0000-0000-0000000059a1', '2030-03-01', 'paid'),
  ('a0000000-0000-0000-0000-0000000059a3', '2030-01-01', 'draft');

select has_function('public', 'venues_overview', array[]::text[], 'venues_overview() exists');
select has_function('public', 'suspend_venue', array['uuid'], 'suspend_venue(uuid) exists');
select has_function('public', 'reactivate_venue', array['uuid'], 'reactivate_venue(uuid) exists');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select public.venues_overview()$$, '42501', null, 'anon has no execute on venues_overview');
select throws_ok($$select public.suspend_venue('a0000000-0000-0000-0000-0000000059a1')$$, '42501', null, 'anon has no execute on suspend_venue');
select throws_ok($$select public.reactivate_venue('a0000000-0000-0000-0000-0000000059a3')$$, '42501', null, 'anon has no execute on reactivate_venue');

-- ---------------------------------------------------------------- player and venue owner
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000059a1","role":"authenticated"}';
select is(pg_temp.err($$select public.venues_overview()$$), 'P0001|not_platform_admin', 'a player is refused the overview with not_platform_admin');
select is(pg_temp.err($$select public.suspend_venue('a0000000-0000-0000-0000-0000000059a1')$$), 'P0001|not_platform_admin', 'a player cannot suspend a venue');
select is(pg_temp.err($$select public.reactivate_venue('a0000000-0000-0000-0000-0000000059a3')$$), 'P0001|not_platform_admin', 'a player cannot reactivate a venue');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000059a3","role":"authenticated"}';
select is(pg_temp.err($$select public.venues_overview()$$), 'P0001|not_platform_admin', 'a venue owner is refused the overview');
select is(pg_temp.err($$select public.suspend_venue('a0000000-0000-0000-0000-0000000059a1')$$), 'P0001|not_platform_admin', 'a venue owner cannot suspend even their own venue');
select is(pg_temp.err($$select public.reactivate_venue('a0000000-0000-0000-0000-0000000059a3')$$), 'P0001|not_platform_admin', 'a venue owner cannot reactivate a venue');
reset role;
select is((select status from public.venues where id = 'a0000000-0000-0000-0000-0000000059a1'), 'active', 'a refused suspend leaves the venue active');

-- ---------------------------------------------------------------- platform admin: the overview
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000059a2","role":"authenticated"}';
select is(jsonb_typeof(public.venues_overview()), 'array', 'the overview is a jsonb array');
select is((select count(*)::int from jsonb_array_elements(public.venues_overview()) e where e ->> 'slug' like 'e2e-vo-%'), 5,
  'one element per venue, whatever its status');
select is((select array_agg(e ->> 'name' order by o) from jsonb_array_elements(public.venues_overview()) with ordinality t(e, o) where e ->> 'slug' like 'e2e-vo-%'),
  array['E2E VO Alpha', 'E2E VO Bravo', 'E2E VO Charlie', 'E2E VO Delta', 'E2E VO Echo'], 'the venues are ordered by name');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select e from jsonb_array_elements(public.venues_overview()) e where e ->> 'slug' = 'e2e-vo-alpha')) k),
  'month_total,month_transactions,name,open_invoices,slug,status,venue_id', 'each element has exactly venue_id, slug, name, status, month_transactions, month_total, open_invoices');
select is(pg_temp.ov('e2e-vo-alpha', 'venue_id'), 'a0000000-0000-0000-0000-0000000059a1', 'the venue_id is the venue''s id');
select is(pg_temp.ov('e2e-vo-alpha', 'name'), 'E2E VO Alpha', 'the name is the venue_settings name');
select is(array[pg_temp.ov('e2e-vo-alpha', 'status'), pg_temp.ov('e2e-vo-bravo', 'status'), pg_temp.ov('e2e-vo-charlie', 'status'), pg_temp.ov('e2e-vo-delta', 'status')],
  array['active', 'draft', 'suspended', 'closed'], 'the status is the venue''s status');
select is(pg_temp.ov('e2e-vo-alpha', 'month_transactions'), '2',
  'month_transactions counts only this month''s booking_fee rows (not the adjustment, not other months)');
select is((pg_temp.ov('e2e-vo-alpha', 'month_total'))::numeric, 15.50,
  'month_total sums this month''s charges, adjustments included (10 + 15.50 - 10), other months excluded');
select is(pg_temp.ov('e2e-vo-alpha', 'open_invoices'), '2', 'open_invoices counts draft and sent invoices, not paid ones');
select is((select jsonb_typeof(e -> 'month_transactions') || ',' || jsonb_typeof(e -> 'month_total') || ',' || jsonb_typeof(e -> 'open_invoices')
  from jsonb_array_elements(public.venues_overview()) e where e ->> 'slug' = 'e2e-vo-alpha'), 'number,number,number', 'the three counters are json numbers');
select is(pg_temp.ov('e2e-vo-bravo', 'month_transactions') || '|' || (pg_temp.ov('e2e-vo-bravo', 'month_total'))::numeric || '|' || pg_temp.ov('e2e-vo-bravo', 'open_invoices'),
  '0|0|0', 'a venue with no charges and no invoices shows 0 transactions, a total of 0 and 0 open invoices');
select is(pg_temp.ov('e2e-vo-charlie', 'month_transactions') || '|' || trim_scale((pg_temp.ov('e2e-vo-charlie', 'month_total'))::numeric) || '|' || pg_temp.ov('e2e-vo-charlie', 'open_invoices'),
  '1|20|1', 'another venue''s charges and invoices are counted for that venue only');

-- ---------------------------------------------------------------- suspend_venue
select is(pg_temp.err($$select public.suspend_venue('a0000000-0000-0000-0000-0000000059ff')$$), 'P0001|venue_not_found', 'suspending an unknown venue is venue_not_found');
select is(pg_temp.err($$select public.suspend_venue('a0000000-0000-0000-0000-0000000059a2')$$), 'P0001|not_active', 'a draft venue cannot be suspended (not_active)');
select is(pg_temp.err($$select public.suspend_venue('a0000000-0000-0000-0000-0000000059a3')$$), 'P0001|not_active', 'a suspended venue cannot be suspended again (not_active)');
select is(pg_temp.err($$select public.suspend_venue('a0000000-0000-0000-0000-0000000059a4')$$), 'P0001|not_active', 'a closed venue cannot be suspended (not_active)');
select is(pg_temp.err($$select public.suspend_venue('a0000000-0000-0000-0000-0000000059a1')$$), 'ok', 'a platform admin suspends an active venue');
select is(pg_temp.ov('e2e-vo-alpha', 'status'), 'suspended', 'the overview then shows it as suspended');
select is(pg_temp.err($$select public.suspend_venue('a0000000-0000-0000-0000-0000000059a1')$$), 'P0001|not_active', 'suspending it a second time is not_active');

-- ---------------------------------------------------------------- reactivate_venue
select is(pg_temp.err($$select public.reactivate_venue('a0000000-0000-0000-0000-0000000059ff')$$), 'P0001|venue_not_found', 'reactivating an unknown venue is venue_not_found');
select is(pg_temp.err($$select public.reactivate_venue('a0000000-0000-0000-0000-0000000059a2')$$), 'P0001|not_suspended', 'a draft venue cannot be reactivated (not_suspended)');
select is(pg_temp.err($$select public.reactivate_venue('a0000000-0000-0000-0000-0000000059a4')$$), 'P0001|not_suspended', 'a closed venue cannot be reactivated (not_suspended)');
select is(pg_temp.err($$select public.reactivate_venue('a0000000-0000-0000-0000-0000000059a5')$$), 'P0001|not_suspended', 'an active venue cannot be reactivated (not_suspended)');
select is(pg_temp.err($$select public.reactivate_venue('a0000000-0000-0000-0000-0000000059a3')$$), 'ok', 'a platform admin reactivates a suspended venue');
select is(pg_temp.ov('e2e-vo-charlie', 'status'), 'active', 'the overview then shows it as active');
reset role;
select is((select string_agg(slug || '=' || status, ',' order by slug) from public.venues where slug like 'e2e-vo-%'),
  'e2e-vo-alpha=suspended,e2e-vo-bravo=draft,e2e-vo-charlie=active,e2e-vo-delta=closed,e2e-vo-echo=active',
  'refused calls changed nothing; only the two successful calls changed a status');

select * from finish();
rollback;
