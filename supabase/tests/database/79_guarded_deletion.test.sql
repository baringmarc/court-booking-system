-- T17.26: guarded lead and unused-venue deletion. delete_lead, venue_deletion_preview and delete_unused_venue are
-- platform-admin only (anon has no execute; everyone else gets P0001 hint not_platform_admin). A venue with any
-- booking, payment, checkout, charge, invoice or open play session (in any status), or a protected venue, is never
-- deleted. A refused call changes nothing and queues no file cleanup. A successful one removes the venue's
-- configuration only (auth users, other venues and their members survive) and queues two pending file cleanup rows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(114);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare s text; h text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return s || '|' || coalesce(h, '');
end $$;
grant execute on function pg_temp.err(text) to anon, authenticated, service_role;

-- row counts of one venue in every table that belongs to it (22 tables, venues first)
create function pg_temp.snap(v uuid) returns int[] language plpgsql as $$
declare t text; n int; r int[] := '{}';
begin
  foreach t in array array['venues', 'venue_settings', 'operating_hours', 'venue_open_periods', 'venue_schedule_state', 'courts',
    'court_rates', 'court_photos', 'court_open_periods', 'court_schedule_modes', 'blackouts', 'venue_amenities',
    'venue_info_sections', 'venue_payment_accounts', 'venue_social_links', 'venue_members', 'bookings', 'payments',
    'paymongo_checkouts', 'billing_charges', 'invoices', 'open_play_sessions'] loop
    execute format('select count(*) from public.%I where %I = $1', t, case when t = 'venues' then 'id' else 'venue_id' end) into n using v;
    r := r || n;
  end loop;
  return r;
end $$;

-- every fixture venue's counts, plus leads, auth users, memberships and queued file cleanup (run as postgres)
create function pg_temp.state() returns text language plpgsql as $$
declare r text;
begin
  select coalesce((select string_agg(v.slug || '=' || pg_temp.snap(v.id)::text, ';' order by v.slug) from public.venues v where v.slug like 'e2e-pg-%'), '')
    || '|' || (select count(*) from public.leads) || ',' || (select count(*) from auth.users) || ',' || (select count(*) from public.venues)
    || ',' || (select count(*) from public.venue_members) || ',' || (select count(*) from private.venue_file_cleanup) into r;
  return r;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000079a1', 'e2e-pg-player@example.com'),
  ('00000000-0000-0000-0000-0000000079a2', 'e2e-pg-platform@example.com'),
  ('00000000-0000-0000-0000-0000000079a3', 'e2e-pg-owner@example.com'),
  ('00000000-0000-0000-0000-0000000079a4', 'e2e-pg-staff@example.com'),
  ('00000000-0000-0000-0000-0000000079a5', 'e2e-pg-ownerb@example.com');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000079a2');

-- "protected" is only set on the demo venue by the migration: nothing else is protected before the fixtures change it
select is((select count(*)::int from public.venues where protected and slug <> 'claudex-courts'), 0, 'only the claudex-courts demo venue is protected by the migration');
select is((select count(*)::int from public.venues where slug = 'claudex-courts' and not protected), 0, 'the claudex-courts demo venue is protected');

insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000079a1', 'e2e-pg-del-a', 'active'),
  ('a0000000-0000-0000-0000-0000000079a2', 'e2e-pg-del-b', 'active'),
  ('a0000000-0000-0000-0000-0000000079b1', 'e2e-pg-bk', 'draft'),
  ('a0000000-0000-0000-0000-0000000079b2', 'e2e-pg-pay', 'draft'),
  ('a0000000-0000-0000-0000-0000000079b3', 'e2e-pg-chk', 'draft'),
  ('a0000000-0000-0000-0000-0000000079b4', 'e2e-pg-chg', 'draft'),
  ('a0000000-0000-0000-0000-0000000079b5', 'e2e-pg-inv', 'draft'),
  ('a0000000-0000-0000-0000-0000000079b6', 'e2e-pg-op', 'draft'),
  ('a0000000-0000-0000-0000-0000000079b7', 'e2e-pg-prot', 'draft'),
  ('a0000000-0000-0000-0000-0000000079b8', 'e2e-pg-late', 'draft'),
  ('a0000000-0000-0000-0000-0000000079b9', 'e2e-pg-retry', 'draft');
update public.venues set protected = true where slug = 'e2e-pg-prot';

-- venue A: the one that gets deleted, with configuration in every table the deletion must clear
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-0000000079a1', 'E2E PG Del A', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-0000000079a2', 'E2E PG Del B', 'Asia/Manila');
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time) values
  ('a0000000-0000-0000-0000-0000000079a1', 1, '08:00', '22:00'),
  ('a0000000-0000-0000-0000-0000000079a1', 2, '08:00', '22:00'),
  ('a0000000-0000-0000-0000-0000000079a2', 1, '07:00', '21:00');
-- venue_open_periods rows are derived from operating_hours by a trigger
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000079a1', 'a0000000-0000-0000-0000-0000000079a1', 'E2E PG A1', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000079a2', 'a0000000-0000-0000-0000-0000000079a1', 'E2E PG A2', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000079a3', 'a0000000-0000-0000-0000-0000000079a2', 'E2E PG B1', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000079b1', 'a0000000-0000-0000-0000-0000000079b1', 'E2E PG BK', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000079b2', 'a0000000-0000-0000-0000-0000000079b2', 'E2E PG PAY', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000079b3', 'a0000000-0000-0000-0000-0000000079b3', 'E2E PG CHK', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000079b4', 'a0000000-0000-0000-0000-0000000079b4', 'E2E PG CHG', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000079b7', 'a0000000-0000-0000-0000-0000000079b7', 'E2E PG PROT', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000079b8', 'a0000000-0000-0000-0000-0000000079b8', 'E2E PG LATE', 'tennis', 100, true);
insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values
  ('a0000000-0000-0000-0000-0000000079a1', 'c0000000-0000-0000-0000-0000000079a1', 1, 18, 150),
  ('a0000000-0000-0000-0000-0000000079a1', 'c0000000-0000-0000-0000-0000000079a2', 1, 18, 150),
  ('a0000000-0000-0000-0000-0000000079a2', 'c0000000-0000-0000-0000-0000000079a3', 1, 18, 150);
insert into public.court_photos (venue_id, court_id, path, sort_order) values
  ('a0000000-0000-0000-0000-0000000079a1', 'c0000000-0000-0000-0000-0000000079a1',
   'a0000000-0000-0000-0000-0000000079a1/courts/c0000000-0000-0000-0000-0000000079a1/11111111-1111-1111-1111-111111111111.webp', 0);
insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute) values
  ('a0000000-0000-0000-0000-0000000079a1', 'c0000000-0000-0000-0000-0000000079a1', 3, 600, 1200);
insert into public.blackouts (venue_id, starts_at, ends_at, reason) values
  ('a0000000-0000-0000-0000-0000000079a1', '2030-05-01 00:00+00', '2030-05-02 00:00+00', 'E2E PG closure');
insert into public.venue_amenities (venue_id, builtin_key) values ('a0000000-0000-0000-0000-0000000079a1', 'parking');
insert into public.venue_info_sections (venue_id, title, body) values ('a0000000-0000-0000-0000-0000000079a1', 'E2E PG info', 'body');
insert into public.venue_payment_accounts (venue_id, label, account_name, account_number) values ('a0000000-0000-0000-0000-0000000079a1', 'GCash', 'E2E', '0917');
insert into public.venue_social_links (venue_id, platform, url) values ('a0000000-0000-0000-0000-0000000079a1', 'facebook', 'https://facebook.com/e2epg');
-- the owner of A is also a member of B; staff belongs to A only; ownerb to B only
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000079a1', '00000000-0000-0000-0000-0000000079a3', 'owner'),
  ('a0000000-0000-0000-0000-0000000079a1', '00000000-0000-0000-0000-0000000079a4', 'staff'),
  ('a0000000-0000-0000-0000-0000000079a2', '00000000-0000-0000-0000-0000000079a3', 'owner'),
  ('a0000000-0000-0000-0000-0000000079a2', '00000000-0000-0000-0000-0000000079a5', 'owner');

-- one disqualifying dependency per venue (a booking is the parent of payments, checkouts and charges)
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status) values
  ('b0000000-0000-0000-0000-0000000079b1', 'a0000000-0000-0000-0000-0000000079b1', 'c0000000-0000-0000-0000-0000000079b1', 'E2E PG 1', 'CB-KKKKA2', 100,
   tstzrange('2030-04-01 02:00+00', '2030-04-01 03:00+00'), 'cancelled'),
  ('b0000000-0000-0000-0000-0000000079b2', 'a0000000-0000-0000-0000-0000000079b2', 'c0000000-0000-0000-0000-0000000079b2', 'E2E PG 2', 'CB-KKKKA3', 100,
   tstzrange('2030-04-02 02:00+00', '2030-04-02 03:00+00'), 'expired'),
  ('b0000000-0000-0000-0000-0000000079b3', 'a0000000-0000-0000-0000-0000000079b3', 'c0000000-0000-0000-0000-0000000079b3', 'E2E PG 3', 'CB-KKKKA4', 100,
   tstzrange('2030-04-03 02:00+00', '2030-04-03 03:00+00'), 'rejected'),
  ('b0000000-0000-0000-0000-0000000079b4', 'a0000000-0000-0000-0000-0000000079b4', 'c0000000-0000-0000-0000-0000000079b4', 'E2E PG 4', 'CB-KKKKA5', 100,
   tstzrange('2030-04-04 02:00+00', '2030-04-04 03:00+00'), 'cancelled'),
  ('b0000000-0000-0000-0000-0000000079b7', 'a0000000-0000-0000-0000-0000000079b7', 'c0000000-0000-0000-0000-0000000079b7', 'E2E PG 7', 'CB-KKKKA6', 100,
   tstzrange('2030-04-07 02:00+00', '2030-04-07 03:00+00'), 'cancelled');
insert into public.payments (booking_id, method, amount) values ('b0000000-0000-0000-0000-0000000079b2', 'cash', 100);
insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos) values
  ('b0000000-0000-0000-0000-0000000079b3', 'cs_e2epg79', 'https://example.com/cs', 10000);
insert into public.billing_charges (venue_id, booking_id, kind, amount, billing_month) values
  ('a0000000-0000-0000-0000-0000000079b4', 'b0000000-0000-0000-0000-0000000079b4', 'booking_fee', 10, '2030-04-01');
insert into public.invoices (id, venue_id, billing_month) values ('d0000000-0000-0000-0000-0000000079b5', 'a0000000-0000-0000-0000-0000000079b5', '2030-04-01');
insert into public.open_play_sessions (venue_id, title, starts_at, ends_at) values
  ('a0000000-0000-0000-0000-0000000079b6', 'E2E PG open play', '2030-04-06 02:00+00', '2030-04-06 04:00+00'),
  ('a0000000-0000-0000-0000-0000000079b9', 'E2E PG retry session', '2030-04-09 02:00+00', '2030-04-09 04:00+00');

insert into public.leads (id, first_name, last_name, email, phone, venue_name, location, courts, notes, consented_at) values
  ('e0000000-0000-0000-0000-0000000079e1', 'E2E', 'One', 'e2e-pg-lead1@example.com', '09171234567', 'E2E PG Lead Venue', 'Manila', 3, 'private note', now()),
  ('e0000000-0000-0000-0000-0000000079e2', 'E2E', 'Two', 'e2e-pg-lead2@example.com', '09171234568', 'E2E PG Other Venue', 'Cebu', 2, 'other note', now());

-- ---------------------------------------------------------------- shape: column, cleanup queue, grants
select is((select data_type || '|' || is_nullable || '|' || column_default from information_schema.columns where table_schema = 'public' and table_name = 'venues' and column_name = 'protected'),
  'boolean|NO|false', 'venues.protected is a not null boolean defaulting to false');
select is((select protected from public.venues where slug = 'e2e-pg-del-a'), false, 'a new venue is not protected');
select is((select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'private' and table_name = 'venue_file_cleanup'),
  'attempts,bucket,created_at,done_at,id,last_error,prefix,status,venue_id', 'private.venue_file_cleanup has the planned columns');
select is((select count(*)::int from pg_constraint where conrelid = 'private.venue_file_cleanup'::regclass and contype = 'f'), 0, 'the cleanup queue has no foreign key to venues (the venue row is gone by then)');
select is(pg_temp.err($$insert into private.venue_file_cleanup (venue_id, bucket, prefix, status) values (gen_random_uuid(), 'venue-media', 'x/', 'bogus')$$), '23514|', 'a cleanup status must be pending, done or failed');
select is((select count(*)::int from private.venue_file_cleanup where status = 'pending' and attempts = 0 and done_at is null), (select count(*)::int from private.venue_file_cleanup), 'queued rows start pending with 0 attempts');
select ok(not has_table_privilege('anon', 'private.venue_file_cleanup', 'select,insert,update,delete') and not has_table_privilege('authenticated', 'private.venue_file_cleanup', 'select,insert,update,delete'),
  'players and anon cannot touch the cleanup queue directly');
select ok(not has_table_privilege('authenticated', 'public.leads', 'delete') and not has_table_privilege('anon', 'public.leads', 'delete'), 'no direct DELETE on leads for anon or authenticated');
select ok(not has_table_privilege('authenticated', 'public.venues', 'delete') and not has_table_privilege('anon', 'public.venues', 'delete'), 'no direct DELETE on venues for anon or authenticated');
select ok((select bool_and(prosecdef) from pg_proc where oid in (
    'public.delete_lead(uuid)'::regprocedure, 'public.venue_deletion_preview(uuid)'::regprocedure, 'public.delete_unused_venue(uuid,text)'::regprocedure,
    'public.claim_venue_file_cleanup(int)'::regprocedure, 'public.finish_venue_file_cleanup(uuid,boolean,text)'::regprocedure)), 'all five functions are security definer');
select ok(has_function_privilege('service_role', 'public.claim_venue_file_cleanup(int)', 'execute') and has_function_privilege('service_role', 'public.finish_venue_file_cleanup(uuid,boolean,text)', 'execute'),
  'service_role can execute the cleanup helpers');
select ok(not has_function_privilege('anon', 'public.claim_venue_file_cleanup(int)', 'execute') and not has_function_privilege('authenticated', 'public.claim_venue_file_cleanup(int)', 'execute')
  and not has_function_privilege('anon', 'public.finish_venue_file_cleanup(uuid,boolean,text)', 'execute') and not has_function_privilege('authenticated', 'public.finish_venue_file_cleanup(uuid,boolean,text)', 'execute'),
  'anon and authenticated cannot execute the cleanup helpers');
select ok(has_function_privilege('authenticated', 'public.delete_lead(uuid)', 'execute') and has_function_privilege('authenticated', 'public.venue_deletion_preview(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_unused_venue(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.delete_lead(uuid)', 'execute') and not has_function_privilege('anon', 'public.venue_deletion_preview(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.delete_unused_venue(uuid,text)', 'execute'), 'authenticated (not anon) can execute the three console functions');

-- baseline: every refusal below must leave exactly this state
select set_config('t79.state', pg_temp.state(), true);
select set_config('t79.b', pg_temp.snap('a0000000-0000-0000-0000-0000000079a2')::text, true);
select ok((select min(c) >= 1 from unnest((pg_temp.snap('a0000000-0000-0000-0000-0000000079a1'))[1:16]) c), 'fixture: venue A has rows in every configuration table');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select public.delete_lead('e0000000-0000-0000-0000-0000000079e1')$$, '42501', null, 'anon has no execute on delete_lead');
select throws_ok($$select public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1')$$, '42501', null, 'anon has no execute on venue_deletion_preview');
select throws_ok($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079a1', 'e2e-pg-del-a')$$, '42501', null, 'anon has no execute on delete_unused_venue');
select throws_ok($$select public.claim_venue_file_cleanup(5)$$, '42501', null, 'anon has no execute on claim_venue_file_cleanup');
select throws_ok($$select public.finish_venue_file_cleanup(gen_random_uuid(), true, null)$$, '42501', null, 'anon has no execute on finish_venue_file_cleanup');

-- ---------------------------------------------------------------- player, venue staff, venue owner
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a1","role":"authenticated"}';
select is(pg_temp.err($$select public.delete_lead('e0000000-0000-0000-0000-0000000079e1')$$), 'P0001|not_platform_admin', 'a player is refused delete_lead');
select is(pg_temp.err($$select public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1')$$), 'P0001|not_platform_admin', 'a player is refused venue_deletion_preview');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079a1', 'e2e-pg-del-a')$$), 'P0001|not_platform_admin', 'a player is refused delete_unused_venue');
select is(pg_temp.err($$select public.claim_venue_file_cleanup(5)$$), '42501|', 'a player cannot execute claim_venue_file_cleanup');
select is(pg_temp.err($$select public.finish_venue_file_cleanup(gen_random_uuid(), true, null)$$), '42501|', 'a player cannot execute finish_venue_file_cleanup');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a3","role":"authenticated"}';
select is(pg_temp.err($$select public.delete_lead('e0000000-0000-0000-0000-0000000079e1')$$), 'P0001|not_platform_admin', 'a venue owner is refused delete_lead');
select is(pg_temp.err($$select public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1')$$), 'P0001|not_platform_admin', 'a venue owner is refused the preview of their own venue');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079a1', 'e2e-pg-del-a')$$), 'P0001|not_platform_admin', 'a venue owner cannot delete their own unused venue');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a4","role":"authenticated"}';
select is(pg_temp.err($$select public.delete_lead('e0000000-0000-0000-0000-0000000079e1')$$), 'P0001|not_platform_admin', 'venue staff are refused delete_lead');
select is(pg_temp.err($$select public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1')$$), 'P0001|not_platform_admin', 'venue staff are refused venue_deletion_preview');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079a1', 'e2e-pg-del-a')$$), 'P0001|not_platform_admin', 'venue staff are refused delete_unused_venue');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079ff', 'whatever')$$), 'P0001|not_platform_admin', 'the platform-admin check comes before the venue lookup');
reset role;
select is(pg_temp.state(), current_setting('t79.state'), 'refused non-admin calls changed nothing');

-- ---------------------------------------------------------------- platform admin: preview
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a2","role":"authenticated"}';
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1')) k), 'blockers,counts,deletable,slug', 'the preview has exactly slug, deletable, blockers and counts');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1') -> 'counts') k),
  'bookings,charges,checkouts,courts,invoices,members,open_play_sessions,payments', 'the counts have the eight planned keys');
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1') ->> 'slug', 'e2e-pg-del-a', 'the preview returns the slug');
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1') -> 'deletable', 'true'::jsonb, 'an unused venue is deletable');
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1') -> 'blockers', '[]'::jsonb, 'an unused venue has no blockers');
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1') -> 'counts',
  '{"bookings":0,"payments":0,"checkouts":0,"charges":0,"invoices":0,"open_play_sessions":0,"courts":2,"members":2}'::jsonb, 'the counts of venue A are exact');
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b1') -> 'deletable', 'false'::jsonb, 'a venue with a cancelled booking is not deletable');
select ok(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b1') -> 'blockers' @> '["bookings"]'::jsonb, 'a cancelled booking is a bookings blocker');
select is((public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b1') -> 'counts' ->> 'bookings')::int, 1, 'the preview counts the cancelled booking');
select ok(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b2') -> 'blockers' @> '["payments"]'::jsonb, 'a payment is a payments blocker');
select is((public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b2') -> 'counts' ->> 'payments')::int, 1, 'the preview counts the payment');
select ok(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b3') -> 'blockers' @> '["checkouts"]'::jsonb, 'a paymongo checkout is a checkouts blocker');
select is((public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b3') -> 'counts' ->> 'checkouts')::int, 1, 'the preview counts the checkout');
select ok(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b4') -> 'blockers' @> '["charges"]'::jsonb, 'a billing charge is a charges blocker');
select is((public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b4') -> 'counts' ->> 'charges')::int, 1, 'the preview counts the charge');
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b5') -> 'blockers', '["invoices"]'::jsonb, 'an invoice alone is exactly an invoices blocker');
select is((public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b5') -> 'counts' ->> 'invoices')::int, 1, 'the preview counts the invoice');
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b6') -> 'blockers', '["open_play"]'::jsonb, 'an open play session alone is exactly an open_play blocker');
select is((public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b6') -> 'counts' ->> 'open_play_sessions')::int, 1, 'the preview counts the open play session');
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b6') -> 'deletable', 'false'::jsonb, 'a venue with an open play session is not deletable');
select ok(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b7') -> 'blockers' @> '["protected"]'::jsonb, 'a protected venue lists protected as a blocker');
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b7') -> 'deletable', 'false'::jsonb, 'a protected venue is not deletable');
select is(pg_temp.err($$select public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079ff')$$), 'P0001|venue_not_found', 'the preview of an unknown venue is venue_not_found');

-- ---------------------------------------------------------------- platform admin: refusals change nothing
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079ff', 'e2e-pg-del-a')$$), 'P0001|venue_not_found', 'an unknown venue is venue_not_found');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079ff', 'whatever')$$), 'P0001|venue_not_found', 'an unknown venue is venue_not_found whatever the confirmation');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079a1', 'E2E-PG-DEL-A')$$), 'P0001|confirmation_mismatch', 'the confirmation is case sensitive');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079a1', ' e2e-pg-del-a')$$), 'P0001|confirmation_mismatch', 'the confirmation is not trimmed');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079a1', '')$$), 'P0001|confirmation_mismatch', 'an empty confirmation is confirmation_mismatch');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079a1', 'e2e-pg-del-b')$$), 'P0001|confirmation_mismatch', 'another venue slug is confirmation_mismatch');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b1', 'wrong')$$), 'P0001|confirmation_mismatch', 'the confirmation is checked before the dependencies');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b7', 'wrong')$$), 'P0001|confirmation_mismatch', 'the confirmation is checked before protection');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b7', 'e2e-pg-prot')$$), 'P0001|venue_protected', 'a protected venue is never deleted, even with the right slug');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b1', 'e2e-pg-bk')$$), 'P0001|venue_in_use', 'a cancelled booking blocks deletion');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b2', 'e2e-pg-pay')$$), 'P0001|venue_in_use', 'an expired booking with a payment blocks deletion');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b3', 'e2e-pg-chk')$$), 'P0001|venue_in_use', 'a rejected booking with a paymongo checkout blocks deletion');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b4', 'e2e-pg-chg')$$), 'P0001|venue_in_use', 'a billing charge blocks deletion');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b5', 'e2e-pg-inv')$$), 'P0001|venue_in_use', 'an invoice alone blocks deletion');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b6', 'e2e-pg-op')$$), 'P0001|venue_in_use', 'an open play session alone blocks deletion');
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b9', 'e2e-pg-retry')$$), 'P0001|venue_in_use', 'the retry venue is first refused for its open play session');
select is(pg_temp.err($$select public.delete_lead('e0000000-0000-0000-0000-0000000079ff')$$), 'P0001|lead_not_found', 'an unknown lead is lead_not_found');
reset role;
select is(pg_temp.state(), current_setting('t79.state'), 'every refused call and every preview changed nothing, and queued no file cleanup');
select is((select count(*)::int from private.venue_file_cleanup where venue_id::text like 'a0000000-0000-0000-0000-0000000079%'), 0, 'a refused deletion queues no cleanup rows');

-- ---------------------------------------------------------------- a booking that lands between the preview and the delete
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a2","role":"authenticated"}';
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b8') -> 'deletable', 'true'::jsonb, 'the late venue is deletable at first');
reset role;
insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status) values
  ('b0000000-0000-0000-0000-0000000079b8', 'a0000000-0000-0000-0000-0000000079b8', 'c0000000-0000-0000-0000-0000000079b8', 'E2E PG 8', 'CB-KKKKA7', 100,
   tstzrange('2030-04-08 02:00+00', '2030-04-08 03:00+00'), 'cancelled');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a2","role":"authenticated"}';
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b8', 'e2e-pg-late')$$), 'P0001|venue_in_use', 'a booking created just before the call refuses the deletion');
select is(public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079b8') -> 'deletable', 'false'::jsonb, 'the preview now says not deletable');
reset role;
select is((select count(*)::int from public.courts where venue_id = 'a0000000-0000-0000-0000-0000000079b8'), 1, 'the late venue kept its court');

-- ---------------------------------------------------------------- lead deletion
select set_config('t79.venues', (select count(*) from public.venues)::text || ',' || (select count(*) from auth.users)::text || ',' || (select count(*) from public.venue_members)::text, true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a2","role":"authenticated"}';
select lives_ok($$select public.delete_lead('e0000000-0000-0000-0000-0000000079e1')$$, 'a platform admin deletes a lead');
reset role;
select is((select count(*)::int from public.leads where id = 'e0000000-0000-0000-0000-0000000079e1'), 0, 'the lead is gone (its notes with it)');
select is((select count(*)::int from public.leads where id = 'e0000000-0000-0000-0000-0000000079e2'), 1, 'another lead is untouched');
select is((select count(*) from public.venues)::text || ',' || (select count(*) from auth.users)::text || ',' || (select count(*) from public.venue_members)::text, current_setting('t79.venues'),
  'deleting a lead never touches venues, auth users or memberships');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a2","role":"authenticated"}';
select is(pg_temp.err($$select public.delete_lead('e0000000-0000-0000-0000-0000000079e1')$$), 'P0001|lead_not_found', 'deleting the same lead twice is lead_not_found');
reset role;
select lives_ok($$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
  values ('E2E', 'One', 'e2e-pg-lead1@example.com', '09171234567', 'E2E PG Lead Venue', 'Manila', 3, now())$$, 'a new lead with the same email is accepted after the deletion');

-- ---------------------------------------------------------------- platform admin: delete venue A
select set_config('t79.b', pg_temp.snap('a0000000-0000-0000-0000-0000000079a2')::text, true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a2","role":"authenticated"}';
select is(public.delete_unused_venue('a0000000-0000-0000-0000-0000000079a1', 'e2e-pg-del-a'),
  '{"venue_id":"a0000000-0000-0000-0000-0000000079a1","slug":"e2e-pg-del-a"}'::jsonb, 'a platform admin deletes an unused venue and gets its id and slug back');
reset role;
select is(pg_temp.snap('a0000000-0000-0000-0000-0000000079a1'), array_fill(0, array[22]), 'the venue and all its configuration rows are gone');
select is((select count(*)::int from public.court_rates where court_id in ('c0000000-0000-0000-0000-0000000079a1', 'c0000000-0000-0000-0000-0000000079a2')), 0, 'no court rates remain for its courts');
select is((select count(*)::int from auth.users where id in ('00000000-0000-0000-0000-0000000079a3', '00000000-0000-0000-0000-0000000079a4')), 2, 'its members still have their accounts');
select is(pg_temp.snap('a0000000-0000-0000-0000-0000000079a2')::text, current_setting('t79.b'), 'the other venue and all its configuration are untouched');
select is((select count(*)::int from public.venue_members where user_id = '00000000-0000-0000-0000-0000000079a3'), 1, 'a user who belongs to both keeps the other membership');
select is((select venue_id from public.venue_members where user_id = '00000000-0000-0000-0000-0000000079a3'), 'a0000000-0000-0000-0000-0000000079a2'::uuid, 'the kept membership is the other venue');
select is((select count(*)::int from public.venue_members where venue_id = 'a0000000-0000-0000-0000-0000000079a2'), 2, 'the other venue keeps both of its members');
select is((select string_agg(bucket || ':' || prefix || ':' || status || ':' || attempts, '|' order by bucket) from private.venue_file_cleanup where venue_id = 'a0000000-0000-0000-0000-0000000079a1'),
  'payment-qr:a0000000-0000-0000-0000-0000000079a1/:pending:0|venue-media:a0000000-0000-0000-0000-0000000079a1/:pending:0', 'exactly two pending cleanup rows are queued, one per bucket, with the venue prefix');
select is((select count(*)::int from private.venue_file_cleanup where venue_id::text like 'a0000000-0000-0000-0000-0000000079%' and venue_id <> 'a0000000-0000-0000-0000-0000000079a1'), 0, 'no other venue got cleanup rows');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a2","role":"authenticated"}';
select is(pg_temp.err($$select public.delete_unused_venue('a0000000-0000-0000-0000-0000000079a1', 'e2e-pg-del-a')$$), 'P0001|venue_not_found', 'deleting the same venue twice is venue_not_found');
select is(pg_temp.err($$select public.venue_deletion_preview('a0000000-0000-0000-0000-0000000079a1')$$), 'P0001|venue_not_found', 'the preview of the deleted venue is venue_not_found');
reset role;
select is((select count(*)::int from private.venue_file_cleanup where venue_id = 'a0000000-0000-0000-0000-0000000079a1'), 2, 'the second delete queued nothing more');
select is(pg_temp.err($$insert into public.courts (venue_id, name, sport, default_hourly_rate) values ('a0000000-0000-0000-0000-0000000079a1', 'E2E PG late court', 'tennis', 100)$$), '23503|', 'nothing can be added to the deleted venue');
select isnt(pg_temp.err($$insert into public.bookings (venue_id, court_id, guest_name, reference_code, total_amount, during, status)
  values ('a0000000-0000-0000-0000-0000000079a1', 'c0000000-0000-0000-0000-0000000079a1', 'E2E PG late', 'CB-KKKKA8', 100, tstzrange('2030-05-01 02:00+00', '2030-05-01 03:00+00'), 'cancelled')$$), 'ok', 'a booking cannot be created in the deleted venue');

-- ---------------------------------------------------------------- retry: refused, fix the cause, delete
delete from public.open_play_sessions where venue_id = 'a0000000-0000-0000-0000-0000000079b9';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000079a2","role":"authenticated"}';
select is(public.delete_unused_venue('a0000000-0000-0000-0000-0000000079b9', 'e2e-pg-retry') ->> 'slug', 'e2e-pg-retry', 'after the cause is removed the same call succeeds');
reset role;
select is((select count(*)::int from public.venues where slug = 'e2e-pg-retry'), 0, 'the retried venue is gone');
select is((select count(*)::int from private.venue_file_cleanup where venue_id = 'a0000000-0000-0000-0000-0000000079b9' and status = 'pending'), 2, 'the retried deletion queued its two cleanup rows once');
select is((select count(*)::int from public.venues where slug in ('e2e-pg-bk', 'e2e-pg-pay', 'e2e-pg-chk', 'e2e-pg-chg', 'e2e-pg-inv', 'e2e-pg-op', 'e2e-pg-prot', 'e2e-pg-late', 'e2e-pg-del-b')), 9,
  'every venue that was refused (and the other venue) still exists');

-- ---------------------------------------------------------------- service role: claim and finish the cleanup queue
set local role service_role;
select is(jsonb_typeof(public.claim_venue_file_cleanup(1000)), 'array', 'claim_venue_file_cleanup returns an array');
reset role;
select is((select string_agg(attempts::text, ',') from private.venue_file_cleanup where venue_id = 'a0000000-0000-0000-0000-0000000079a1'), '1,1', 'claiming counts one attempt on each claimed row');
set local role service_role;
select is((select count(*)::int from jsonb_array_elements(public.claim_venue_file_cleanup(1000)) e where e ->> 'venue_id' = 'a0000000-0000-0000-0000-0000000079a1'), 2, 'rows can be claimed again (retry)');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys((select e from jsonb_array_elements(public.claim_venue_file_cleanup(1000)) e where e ->> 'venue_id' = 'a0000000-0000-0000-0000-0000000079a1' limit 1)) k),
  'bucket,id,prefix,venue_id', 'a claimed item has id, venue_id, bucket and prefix');
select is(jsonb_array_length(public.claim_venue_file_cleanup(1)), 1, 'the limit caps the number of claimed rows');
select is(jsonb_array_length(public.claim_venue_file_cleanup(0)), 0, 'a limit of 0 claims nothing');
reset role;
select set_config('t79.media', (select id::text from private.venue_file_cleanup where venue_id = 'a0000000-0000-0000-0000-0000000079a1' and bucket = 'venue-media'), true);
select set_config('t79.qr', (select id::text from private.venue_file_cleanup where venue_id = 'a0000000-0000-0000-0000-0000000079a1' and bucket = 'payment-qr'), true);
set local role service_role;
select public.finish_venue_file_cleanup(current_setting('t79.media')::uuid, true, null);
select public.finish_venue_file_cleanup(current_setting('t79.qr')::uuid, false, 'storage said no');
reset role;
select is((select status || ':' || (done_at is not null)::text || ':' || coalesce(last_error, '-') from private.venue_file_cleanup where venue_id = 'a0000000-0000-0000-0000-0000000079a1' and bucket = 'venue-media'),
  'done:true:-', 'finishing ok marks the row done with done_at');
select is((select status || ':' || (done_at is not null)::text || ':' || last_error from private.venue_file_cleanup where venue_id = 'a0000000-0000-0000-0000-0000000079a1' and bucket = 'payment-qr'),
  'failed:false:storage said no', 'finishing with an error marks the row failed with its message');
set local role service_role;
select is((select string_agg(e ->> 'bucket', ',') from jsonb_array_elements(public.claim_venue_file_cleanup(1000)) e where e ->> 'venue_id' = 'a0000000-0000-0000-0000-0000000079a1'), 'payment-qr',
  'a failed row is claimed again and a done row never is');
reset role;

select * from finish();
rollback;
