-- T33.2: emails for booking groups (TASKS M33 / T33.2, SPEC §4, §6, §8 and §10 rows dated 2026-11-25). Written from the approved plan, not from the code.
--   * a grouped booking queues its emails for booking_groups.lead_booking_id only, with every court in email_outbox.data.courts
--     (booking_created, payment_confirmed, proof_rejected, booking_cancelled, booking_reminder); total_amount, booking_fee and amount_due
--     in data are the group's sums; every other key is the lead's, as private.booking_email_data gives it
--   * a staff cancel of ONE court of a confirmed group queues a booking_cancelled for that court alone (no courts key)
--   * private.queue_booking_reminders queues one reminder per group (at the earliest still-confirmed court's booking)
--   * claim_guest_link_email works from any reference of the group and claims the lead's pending booking_created row
--   * an index on booking_groups (venue_id, lead_booking_id)
--   * ungrouped bookings queue exactly what they queue today (regression checks)
-- Fixtures: venue A (active, hold 45 minutes, 2 rejections, courts GE A1..A6 at 100..600 an hour), venue B (another venue's admin).
-- The booking fee is set to 10 (the local one is 0). Every call goes through a catching helper (pg_temp.r, pg_temp.cg, ...), so a missing
-- behavior fails its own assertion instead of aborting the transaction. Dates are the venue-local today plus k days (pg_temp.at(k, hour)),
-- so the file holds at any weekday and hour. Asia/Manila is UTC+8: 06:00 local is 22:00 UTC the day before.
begin;
create extension if not exists pgtap with schema extensions;
select plan(112);

-- ---------------------------------------------------------------------------
-- Temp tables
-- ---------------------------------------------------------------------------
create temp table fxd (d date);
-- Rows returned by create_booking_group (or create_booking): the lead is pos 1.
create temp table gr (label text, pos integer, booking_group_id uuid, id uuid, reference_code text, court_id uuid, guest_token text);
create temp table pp (label text, payment_id uuid);
create temp table res (label text primary key, v text);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- First column of the first row as text ('<null>' for null, 'ERR <hint or sqlstate>' on any error).
create function pg_temp.r(p_sql text) returns text language plpgsql as $$
declare v text; h text;
begin
  execute p_sql into v;
  return coalesce(v, '<null>');
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;

create function pg_temp.as_anon() returns void language sql as $$ select set_config('request.jwt.claims', '{"role": "anon"}', true) $$;
create function pg_temp.as_p1() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true) $$;
create function pg_temp.as_p0() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true) $$;
create function pg_temp.as_staff_a() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true) $$;
create function pg_temp.as_staff_b() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true) $$;
create function pg_temp.as_service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role": "service_role"}', true) $$;

-- Venue-local today + k days at hh:mm on the Manila wall clock, as an instant.
create function pg_temp.at(p_k integer, p_hh integer, p_mm integer default 0) returns timestamptz language sql stable as $$
  select (((select d from fxd) + p_k) + make_interval(hours => p_hh, mins => p_mm)) at time zone 'Asia/Manila'
$$;
-- One create_booking_group item on court 'GE A<n>' (p_court = 'A1' ...).
create function pg_temp.it(p_court text, p_k integer, p_hh integer, p_slots integer default 1) returns jsonb
language sql stable as $$
  select jsonb_build_object('court_id', (select c.id from public.courts c where c.name = 'GE ' || p_court), 'start', pg_temp.at(p_k, p_hh), 'slots', p_slots)
$$;

-- create_booking_group as the current role; the rows go to gr (lead first). 'done' or 'ERR <hint>'.
-- A signed-in caller gives no name or email (the RPC reads them from the account).
create function pg_temp.cg(p_label text, p_items jsonb) returns text language plpgsql as $$
declare h text;
begin
  execute 'insert into gr select $1, (row_number() over ())::int, r.booking_group_id, r.id, r.reference_code, r.court_id, r.guest_token
           from public.create_booking_group($2, $3, $4, null, false) r'
    using p_label, p_items, case when auth.uid() is null then 'Gina Guest' end, case when auth.uid() is null then 'gina@example.com' end;
  return 'done';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;

-- A plain create_booking as a guest; the row goes to gr with a null group.
create function pg_temp.cb(p_label text, p_court text, p_k integer, p_hh integer, p_email text) returns text language plpgsql as $$
declare h text;
begin
  insert into gr
  select p_label, 1, null::uuid, r.id, r.reference_code, (select c.id from public.courts c where c.name = 'GE ' || p_court), r.guest_token
  from public.create_booking((select c.id from public.courts c where c.name = 'GE ' || p_court), pg_temp.at(p_k, p_hh), 1, 'Gina Guest', p_email) r;
  return 'done';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;

-- record_payment_proof as service_role on the group's pos-th booking, for the group's total amount_due (or p_amount). 'done' or 'ERR <hint>'.
create function pg_temp.proof(p_label text, p_pos integer default 2, p_amount numeric default null) returns text language plpgsql as $$
declare h text; v_id uuid := (select g.id from gr g where g.label = p_label and g.pos = p_pos);
begin
  insert into pp select p_label, r.payment_id
  from public.record_payment_proof(v_id, v_id::text || '/proof.png', 'gcash',
    coalesce(p_amount, (select sum(bk.amount_due) from gr g join public.bookings bk on bk.id = g.id where g.label = p_label)), 'REF-1', null) r;
  return 'done';
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || case when sqlstate = 'P0001' then coalesce(nullif(h, ''), sqlstate) else sqlstate end;
end $$;

-- Lookups into gr.
create function pg_temp.gid(p_label text) returns uuid language sql stable as $$ select booking_group_id from gr where label = p_label and pos = 1 $$;
create function pg_temp.nth(p_label text, p_pos integer) returns uuid language sql stable as $$ select id from gr where label = p_label and pos = p_pos $$;
create function pg_temp.ref(p_label text, p_pos integer) returns text language sql stable as $$ select reference_code from gr where label = p_label and pos = p_pos $$;
create function pg_temp.tok(p_label text) returns text language sql stable as $$ select guest_token from gr where label = p_label and pos = 1 $$;
-- The group's lead booking as the database names it.
create function pg_temp.lead(p_label text) returns uuid language sql stable as $$
  select bg.lead_booking_id from public.booking_groups bg where bg.id = pg_temp.gid(p_label)
$$;
-- Statuses of the group's bookings in pos order.
create function pg_temp.pst(p text) returns text language sql stable as $$
  select coalesce(string_agg(bk.status::text, ',' order by g.pos), '<none>') from gr g join public.bookings bk on bk.id = g.id where g.label = p
$$;

-- Outbox digests (read as postgres). p_kind is the email_kind as text.
-- How many rows of this kind the group's bookings have in all.
create function pg_temp.ob(p_label text, p_kind text) returns integer language sql stable as $$
  select count(*)::int from public.email_outbox o where o.booking_id in (select g.id from gr g where g.label = p_label) and o.kind::text = p_kind
$$;
-- How many of them are on the lead.
create function pg_temp.obl(p_label text, p_kind text) returns integer language sql stable as $$
  select count(*)::int from public.email_outbox o where o.booking_id = pg_temp.lead(p_label) and o.kind::text = p_kind
$$;
-- The data of the group's row of this kind (for proof_rejected, the one whose data.final is p_final).
create function pg_temp.od(p_label text, p_kind text, p_final text default null) returns jsonb language sql stable as $$
  select o.data from public.email_outbox o
  where o.booking_id in (select g.id from gr g where g.label = p_label) and o.kind::text = p_kind and (p_final is null or o.data ->> 'final' = p_final)
  order by o.created_at, o.id limit 1
$$;
-- The court names of data.courts in array order ('<no courts>' when the key is missing or not an array).
create function pg_temp.cn(p_data jsonb) returns text language sql stable as $$
  select case when jsonb_typeof(p_data -> 'courts') = 'array'
    then coalesce((select string_agg(e ->> 'court_name', ',' order by n) from jsonb_array_elements(p_data -> 'courts') with ordinality t(e, n)), '<empty>')
    else '<no courts>' end
$$;
-- The sum of amount_due of the group's bookings, and of total_amount.
create function pg_temp.sdue(p_label text) returns numeric language sql stable as $$
  select sum(bk.amount_due) from gr g join public.bookings bk on bk.id = g.id where g.label = p_label
$$;
create function pg_temp.stot(p_label text) returns numeric language sql stable as $$
  select sum(bk.total_amount) from gr g join public.bookings bk on bk.id = g.id where g.label = p_label
$$;
-- data minus the group keys, compared with the lead's own booking_email_data minus the same keys: 'same' or 'differs'.
create function pg_temp.lead_keys_same(p_data jsonb, p_label text) returns text language sql stable as $$
  select case when (p_data - 'courts' - 'total_amount' - 'booking_fee' - 'amount_due')
                 = (private.booking_email_data(bk) - 'total_amount' - 'booking_fee' - 'amount_due') then 'same' else 'differs' end
  from public.bookings bk where bk.id = pg_temp.lead(p_label)
$$;

-- The reminder job as postgres with a faked clock: 'ok' or 'ERR ...'.
create function pg_temp.rj(p_now timestamptz) returns text language plpgsql as $$
begin
  execute 'select private.queue_booking_reminders($1)' using p_now;
  return 'ok';
exception when others then
  return 'ERR ' || sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: users, venues A and B, courts, the booking fee
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'e2e-ge-p1@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2e-ge-staff-a@example.com'),
  ('77777777-7777-7777-7777-777777777777', 'e2e-ge-staff-b@example.com');
-- A signed-in player whose account has no email: a group booked by them queues no email.
insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', null);

insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000093a1', 'e2e-ge-a', 'active'),
  ('b0000000-0000-0000-0000-0000000093b1', 'e2e-ge-b', 'active');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000093a1', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('b0000000-0000-0000-0000-0000000093b1', '77777777-7777-7777-7777-777777777777', 'staff');
insert into public.venue_settings (venue_id, name, timezone, waiver_text) values
  ('a0000000-0000-0000-0000-0000000093a1', 'E2E GE A', 'Asia/Manila', ''),
  ('b0000000-0000-0000-0000-0000000093b1', 'E2E GE B', 'Asia/Manila', '');
update public.venue_settings set payment_hold_minutes = 45, cancel_cutoff_hours = 1, max_rejections = 2, booking_window_days = 30
  where venue_id = 'a0000000-0000-0000-0000-0000000093a1';
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v.id, d, time '06:00', time '22:00'
from (values ('a0000000-0000-0000-0000-0000000093a1'::uuid), ('b0000000-0000-0000-0000-0000000093b1'::uuid)) v(id), generate_series(0, 6) d;
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000093a1', 'a0000000-0000-0000-0000-0000000093a1', 'GE A1', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000093a2', 'a0000000-0000-0000-0000-0000000093a1', 'GE A2', 'badminton', 200, true),
  ('c0000000-0000-0000-0000-0000000093a3', 'a0000000-0000-0000-0000-0000000093a1', 'GE A3', 'pickleball', 300, true),
  ('c0000000-0000-0000-0000-0000000093a4', 'a0000000-0000-0000-0000-0000000093a1', 'GE A4', 'tennis', 400, true),
  ('c0000000-0000-0000-0000-0000000093a5', 'a0000000-0000-0000-0000-0000000093a1', 'GE A5', 'tennis', 500, true),
  ('c0000000-0000-0000-0000-0000000093a6', 'a0000000-0000-0000-0000-0000000093a1', 'GE A6', 'tennis', 600, true),
  ('c0000000-0000-0000-0000-0000000093b1', 'b0000000-0000-0000-0000-0000000093b1', 'GE B1', 'tennis', 150, true);
insert into fxd select private.local_today('a0000000-0000-0000-0000-0000000093a1');
-- The local booking fee is 0, so the fee assertions first set it to 10 (as postgres, inside this rolled-back transaction).
update public.platform_pricing set booking_fee = 10;

grant all on all tables in schema pg_temp to anon, authenticated, service_role;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The index T33.1's reviewer asked for
-- ---------------------------------------------------------------------------
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'booking_groups' and indexdef like '%(venue_id, lead_booking_id)%'),
  'booking_groups has an index on (venue_id, lead_booking_id) for its lead foreign key');

-- ---------------------------------------------------------------------------
-- booking_created: ONE row per group, on the lead
-- ---------------------------------------------------------------------------
-- g1: two courts at the same start (the tie goes to the lower court id), booked by a guest.
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cg('g1', jsonb_build_array(pg_temp.it('A2', 2, 6), pg_temp.it('A1', 2, 6))), 'done', 'g1: a guest books GE A1 and GE A2 at the same start');
reset role;
select is(pg_temp.ob('g1', 'booking_created'), 1, 'a group of 2 queues exactly ONE booking_created in the whole group');
select is(pg_temp.obl('g1', 'booking_created'), 1, 'and it is on booking_groups.lead_booking_id (no row for the other court)');
select is((select o.for_guest and o.next_attempt_at > now() + interval '9 minutes' and o.next_attempt_at < now() + interval '11 minutes'
           from public.email_outbox o where o.booking_id = pg_temp.lead('g1') and o.kind = 'booking_created'),
  true, 'the group''s booking_created is for a guest and waits about 10 minutes (next_attempt_at)');
select is(pg_temp.cn(pg_temp.od('g1', 'booking_created')), 'GE A1,GE A2',
  'data.courts lists both courts, ordered by start then court id (the tie goes to GE A1)');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.od('g1', 'booking_created') -> 'courts' -> 0) k),
  'booking_id,court_name,ends_at,reference_code,sport,starts_at,total_amount',
  'each element of data.courts has exactly booking_id, reference_code, court_name, sport, starts_at, ends_at and total_amount');
select is((select count(*)::text || '|' || bool_and(
    (e ->> 'booking_id')::uuid = bk.id and e ->> 'reference_code' = bk.reference_code and e ->> 'court_name' = c.name
    and e ->> 'sport' = c.sport::text and (e ->> 'starts_at')::timestamptz = lower(bk.during) and (e ->> 'ends_at')::timestamptz = upper(bk.during)
    and (e ->> 'total_amount')::numeric = bk.total_amount)::text
  from jsonb_array_elements(pg_temp.od('g1', 'booking_created') -> 'courts') e
  join public.bookings bk on bk.id = (e ->> 'booking_id')::uuid join public.courts c on c.id = bk.court_id),
  '2|true', 'every element of data.courts carries its own booking id, reference, court name, sport, start, end and price');
select is((pg_temp.od('g1', 'booking_created') ->> 'total_amount')::numeric(12, 2)::text || '|' || (pg_temp.od('g1', 'booking_created') ->> 'booking_fee')::numeric(12, 2)::text
          || '|' || (pg_temp.od('g1', 'booking_created') ->> 'amount_due')::numeric(12, 2)::text,
  '300.00|10.00|310.00', 'data.total_amount, booking_fee and amount_due are the group''s sums: court prices 300, the one fee 10, what the player pays 310');
select is((pg_temp.od('g1', 'booking_created') ->> 'amount_due')::numeric, pg_temp.sdue('g1'), 'data.amount_due equals the sum of the bookings'' amount_due');
select is(pg_temp.lead_keys_same(pg_temp.od('g1', 'booking_created'), 'g1'), 'same',
  'every other key (reference_code, court_name, venue_name, timezone, status, name, expires_at ...) is the lead''s, as private.booking_email_data gives it');

-- g3: three courts given out of order, on different starts.
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cg('g3', jsonb_build_array(pg_temp.it('A3', 3, 10), pg_temp.it('A1', 3, 6), pg_temp.it('A2', 3, 8))), 'done',
  'g3: a guest books three courts at 06:00, 08:00 and 10:00, sent in reverse order');
reset role;
select is(pg_temp.ob('g3', 'booking_created'), 1, 'a group of 3 queues one booking_created');
select is(pg_temp.cn(pg_temp.od('g3', 'booking_created')), 'GE A1,GE A2,GE A3', 'data.courts of 3 is ordered by start, whatever order the items were sent in');
select is((select bool_and(o.booking_id = (select g.id from gr g where g.label = 'g3' and g.pos = 1) and o.data ->> 'court_name' = 'GE A1')
           from public.email_outbox o where o.booking_id in (select g.id from gr g where g.label = 'g3') and o.kind = 'booking_created'),
  true, 'the row is the earliest court''s (the lead), and data.court_name is the lead''s court');

-- Ungrouped bookings are unchanged: one row each, no courts key, data exactly private.booking_email_data.
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cb('u1', 'A1', 7, 6, 'gina.one@example.com'), 'done', 'u1: an ungrouped booking by a guest');
select is(pg_temp.cb('u2', 'A2', 7, 6, 'gina.two@example.com'), 'done', 'u2: another ungrouped booking');
reset role;
select is((select count(*)::int from public.email_outbox o where o.booking_id in (select g.id from gr g where g.label in ('u1', 'u2')) and o.kind = 'booking_created'), 2,
  'create_booking still queues one booking_created per booking');
select is((select bool_and(o.data = private.booking_email_data(bk))
           from public.email_outbox o join public.bookings bk on bk.id = o.booking_id
           where o.booking_id in (select g.id from gr g where g.label in ('u1', 'u2')) and o.kind = 'booking_created'),
  true, 'an ungrouped booking''s data is exactly private.booking_email_data: no courts key, its own amounts');

-- Suppressed and blank-email groups queue nothing.
set local app.suppress_booking_emails = 'on';
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cg('gs', jsonb_build_array(pg_temp.it('A1', 5, 6), pg_temp.it('A2', 5, 8))), 'done', 'gs: a guest books a group while emails are suppressed');
reset role;
set local app.suppress_booking_emails = 'off';
select is((select count(*)::int from public.email_outbox o where o.booking_id in (select g.id from gr g where g.label = 'gs')), 0,
  'a group created while app.suppress_booking_emails = on queues nothing');
set local role authenticated;
select pg_temp.as_p0();
select is(pg_temp.cg('gn', jsonb_build_array(pg_temp.it('A1', 6, 6), pg_temp.it('A2', 6, 8))), 'done', 'gn: a signed-in player whose account has no email books a group');
reset role;
select is((select count(*)::int from public.email_outbox o where o.booking_id in (select g.id from gr g where g.label = 'gn')), 0,
  'a group with no guest email queues nothing');

-- A signed-in player's group: the same one row, not held for 10 minutes.
set local role authenticated;
select pg_temp.as_p1();
select is(pg_temp.cg('gp', jsonb_build_array(pg_temp.it('A1', 4, 6), pg_temp.it('A2', 4, 8))), 'done', 'gp: a signed-in player books two courts');
reset role;
select is(pg_temp.ob('gp', 'booking_created'), 1, 'a signed-in player''s group queues one booking_created');
select is((select o.for_guest::text || '|' || o.to_email || '|' || (o.next_attempt_at <= now() + interval '1 minute')::text
           from public.email_outbox o where o.booking_id = pg_temp.lead('gp') and o.kind = 'booking_created'),
  'false|e2e-ge-p1@example.com|true', 'it is on the lead, to the player''s email, not for_guest and not held back');
select is(pg_temp.cn(pg_temp.od('gp', 'booking_created')), 'GE A1,GE A2', 'and lists both courts');

-- ---------------------------------------------------------------------------
-- payment_confirmed and proof_rejected: one per group, on the lead
-- ---------------------------------------------------------------------------
-- ga: approved from the second court's booking.
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cg('ga', jsonb_build_array(pg_temp.it('A1', 8, 6), pg_temp.it('A2', 8, 8))), 'done', 'ga: a guest books two courts');
reset role;
set local role service_role;
select pg_temp.as_service();
select is(pg_temp.proof('ga'), 'done', 'ga: a proof for the group''s total, sent on the second court');
reset role;
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('ga', 2))), 'confirmed', 'ga: staff approve from the second court');
reset role;
select is(pg_temp.ob('ga', 'payment_confirmed'), 1, 'approving a group queues exactly ONE payment_confirmed');
select is(pg_temp.obl('ga', 'payment_confirmed'), 1, 'and it is on the lead');
select is(pg_temp.cn(pg_temp.od('ga', 'payment_confirmed')), 'GE A1,GE A2', 'payment_confirmed lists every court');
select is((pg_temp.od('ga', 'payment_confirmed') ->> 'amount_due')::numeric, pg_temp.sdue('ga'), 'payment_confirmed''s amount_due is the group''s (310)');
select is(pg_temp.lead_keys_same(pg_temp.od('ga', 'payment_confirmed'), 'ga'), 'same', 'payment_confirmed''s other keys are the lead''s (status confirmed)');

-- gr1: a first rejection, then a second (final) one.
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cg('gr1', jsonb_build_array(pg_temp.it('A1', 9, 6), pg_temp.it('A2', 9, 8))), 'done', 'gr1: a guest books two courts');
reset role;
set local role service_role;
select pg_temp.as_service();
select is(pg_temp.proof('gr1'), 'done', 'gr1: a first proof');
reset role;
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, false, 'Wrong amount') $f$, pg_temp.nth('gr1', 2))), 'pending_payment',
  'gr1: staff reject the first proof (the group gets a fresh hold)');
reset role;
select is(pg_temp.ob('gr1', 'proof_rejected') || '|' || pg_temp.obl('gr1', 'proof_rejected'), '1|1', 'a first rejection queues ONE proof_rejected, on the lead');
select is((pg_temp.od('gr1', 'proof_rejected') ->> 'final') || '|' || (pg_temp.od('gr1', 'proof_rejected') ->> 'note'), 'false|Wrong amount',
  'the first rejection is not final and carries the reviewer''s note');
select is(pg_temp.cn(pg_temp.od('gr1', 'proof_rejected')), 'GE A1,GE A2', 'proof_rejected lists every court');
select is((select o.payment_id from public.email_outbox o where o.booking_id = pg_temp.lead('gr1') and o.kind = 'proof_rejected'),
  (select p.id from public.payments p where p.booking_id = pg_temp.lead('gr1') and p.review_status = 'rejected'),
  'its payment_id is the lead''s rejected payment');
set local role service_role;
select pg_temp.as_service();
select is(pg_temp.proof('gr1'), 'done', 'gr1: a second proof');
reset role;
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, false, 'Still wrong') $f$, pg_temp.nth('gr1', 2))), 'rejected',
  'gr1: staff reject the second proof (the group is rejected)');
reset role;
select is((select string_agg(o.data ->> 'final', ',' order by o.data ->> 'final') from public.email_outbox o
           where o.booking_id in (select g.id from gr g where g.label = 'gr1') and o.kind = 'proof_rejected'),
  'false,true', 'the group has two proof_rejected rows in all: the first not final, the second final');
select is(pg_temp.obl('gr1', 'proof_rejected'), 2, 'both are on the lead (no row for the other court)');
select is(pg_temp.od('gr1', 'proof_rejected', 'true') ->> 'note', 'Still wrong', 'the final one carries the second note');
select is((select count(*)::int from public.email_outbox o join public.payments p on p.id = o.payment_id
           where o.booking_id = pg_temp.lead('gr1') and o.kind = 'proof_rejected' and p.booking_id = pg_temp.lead('gr1') and p.review_status = 'rejected'),
  2, 'each proof_rejected row names a different rejected payment of the lead');

-- ---------------------------------------------------------------------------
-- booking_cancelled: the whole group on the lead; one court alone on that court
-- ---------------------------------------------------------------------------
-- gc: a guest cancels a confirmed group from the second court's reference.
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cg('gc', jsonb_build_array(pg_temp.it('A1', 10, 6), pg_temp.it('A2', 10, 8))), 'done', 'gc: a guest books two courts');
reset role;
set local role service_role;
select pg_temp.as_service();
select is(pg_temp.proof('gc'), 'done', 'gc: a proof');
reset role;
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('gc', 2))), 'confirmed', 'gc: approved');
reset role;
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.r(format($f$ select public.cancel_booking(p_reference_code => %L, p_token => %L, p_reason => 'Rain')::text $f$, pg_temp.ref('gc', 2), pg_temp.tok('gc'))),
  'cancelled', 'gc: the guest cancels the whole group with the shared token');
reset role;
select is(pg_temp.pst('gc'), 'cancelled,cancelled', 'gc: both courts are cancelled');
select is(pg_temp.ob('gc', 'booking_cancelled') || '|' || pg_temp.obl('gc', 'booking_cancelled'), '1|1', 'a guest''s cancel of the group queues ONE booking_cancelled, on the lead');
select is(pg_temp.cn(pg_temp.od('gc', 'booking_cancelled')), 'GE A1,GE A2', 'it lists every court cancelled');
select is((pg_temp.od('gc', 'booking_cancelled') ->> 'cancelled_by_venue') || '|' || (pg_temp.od('gc', 'booking_cancelled') ->> 'reason'), 'false|Rain',
  'cancelled_by_venue is false and the reason is the guest''s, as today');

-- gp (from above, still waiting for payment): the signed-in player cancels from the second court.
set local role authenticated;
select pg_temp.as_p1();
select is(pg_temp.r(format($f$ select public.cancel_booking(%L)::text $f$, pg_temp.nth('gp', 2))), 'cancelled', 'gp: the player cancels the group from the second court');
reset role;
select is(pg_temp.pst('gp'), 'cancelled,cancelled', 'gp: both courts are cancelled');
select is(pg_temp.ob('gp', 'booking_cancelled') || '|' || pg_temp.obl('gp', 'booking_cancelled'), '1|1', 'a player''s cancel of the group queues ONE booking_cancelled, on the lead');
select is(pg_temp.cn(pg_temp.od('gp', 'booking_cancelled')), 'GE A1,GE A2', 'it lists both courts');
select is(coalesce(pg_temp.od('gp', 'booking_cancelled') ->> 'cancelled_by_venue', '<missing>') || '|' || coalesce(pg_temp.od('gp', 'booking_cancelled') ->> 'reason', '<no reason>'),
  'false|<no reason>', 'cancelled_by_venue is false and there is no reason');

-- gsc: staff cancel a group that has not paid yet: every court goes, one email on the lead.
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cg('gsc', jsonb_build_array(pg_temp.it('A1', 11, 6), pg_temp.it('A2', 11, 8))), 'done', 'gsc: a guest books two courts and has not paid');
reset role;
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select public.cancel_booking(%L, p_reason => 'Maintenance')::text $f$, pg_temp.nth('gsc', 2))), 'cancelled',
  'gsc: staff cancel the second court of an unpaid group');
reset role;
select is(pg_temp.pst('gsc'), 'cancelled,cancelled', 'gsc: before payment the staff cancel takes every court');
select is(pg_temp.ob('gsc', 'booking_cancelled') || '|' || pg_temp.obl('gsc', 'booking_cancelled'), '1|1', 'it queues ONE booking_cancelled, on the lead');
select is(pg_temp.cn(pg_temp.od('gsc', 'booking_cancelled')), 'GE A1,GE A2', 'it lists both courts');
select is((pg_temp.od('gsc', 'booking_cancelled') ->> 'cancelled_by_venue') || '|' || (pg_temp.od('gsc', 'booking_cancelled') ->> 'reason'), 'true|Maintenance',
  'cancelled_by_venue is true (read from the booking row) and the reason is the staff''s');

-- gx: staff cancel ONE court at a time of a confirmed group of 3 (GE A1 is the lead).
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cg('gx', jsonb_build_array(pg_temp.it('A1', 12, 6), pg_temp.it('A2', 12, 8), pg_temp.it('A3', 12, 10))), 'done', 'gx: a guest books three courts');
reset role;
set local role service_role;
select pg_temp.as_service();
select is(pg_temp.proof('gx'), 'done', 'gx: a proof');
reset role;
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('gx', 3))), 'confirmed', 'gx: approved');
select is(pg_temp.r(format($f$ select public.cancel_booking(%L, p_reason => 'Court flooded')::text $f$, pg_temp.nth('gx', 2))), 'cancelled',
  'gx: staff cancel the middle court (not the lead)');
reset role;
select is(pg_temp.pst('gx'), 'confirmed,cancelled,confirmed', 'gx: only that court is cancelled');
select is((select count(*)::text || '|' || bool_and(o.booking_id = pg_temp.nth('gx', 2))::text from public.email_outbox o
           where o.booking_id in (select g.id from gr g where g.label = 'gx') and o.kind = 'booking_cancelled'),
  '1|true', 'ONE booking_cancelled in the group, on that court''s own booking (not the lead), none for the other courts');
select is((select (not (o.data ? 'courts'))::text || '|' || (o.data ->> 'cancelled_by_venue') || '|' || (o.data ->> 'reason') || '|' || (o.data ->> 'court_name')
           from public.email_outbox o where o.booking_id = pg_temp.nth('gx', 2) and o.kind = 'booking_cancelled'),
  'true|true|Court flooded|GE A2', 'it has no courts key, cancelled_by_venue true, the reason, and is about GE A2');
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select public.cancel_booking(%L, p_reason => 'Staff short')::text $f$, pg_temp.nth('gx', 1))), 'cancelled', 'gx: staff cancel the lead court next');
reset role;
select is(pg_temp.pst('gx'), 'cancelled,cancelled,confirmed', 'gx: the third court stays confirmed');
select is((select count(*)::text || '|' || bool_and(not (o.data ? 'courts'))::text || '|' || count(*) filter (where o.booking_id = pg_temp.nth('gx', 1))::text
           from public.email_outbox o where o.booking_id in (select g.id from gr g where g.label = 'gx') and o.kind = 'booking_cancelled'),
  '2|true|1', 'cancelling a second court queues its own row: the lead''s, also with no courts key');
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select public.cancel_booking(%L, p_reason => 'Closing early')::text $f$, pg_temp.nth('gx', 3))), 'cancelled', 'gx: staff cancel the last active court');
reset role;
select is((select count(*)::text || '|' || bool_and(not (o.data ? 'courts'))::text || '|' || count(distinct o.booking_id)::text
           from public.email_outbox o where o.booking_id in (select g.id from gr g where g.label = 'gx') and o.kind = 'booking_cancelled'),
  '3|true|3', 'the last court queues its own single-court row (not a group one): three rows on three bookings, none with courts');

-- ---------------------------------------------------------------------------
-- booking_reminder: once per group
-- ---------------------------------------------------------------------------
-- All on tomorrow (D+1), confirmed before 18:00 local: rA (GE A1 at 06:00 and GE A2 at 20:00), rB (GE A3 08:00, A4 10:00, A5 12:00;
-- its lead gets cancelled by staff), ru (an ungrouped booking, GE A6 at 08:00).
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cg('rA', jsonb_build_array(pg_temp.it('A1', 1, 6), pg_temp.it('A2', 1, 20))), 'done', 'rA: a guest books GE A1 at 06:00 and GE A2 at 20:00 tomorrow');
select is(pg_temp.cg('rB', jsonb_build_array(pg_temp.it('A3', 1, 8), pg_temp.it('A4', 1, 10), pg_temp.it('A5', 1, 12))), 'done', 'rB: a guest books three courts tomorrow');
select is(pg_temp.cb('ru', 'A6', 1, 8, 'gina.ru@example.com'), 'done', 'ru: an ungrouped booking tomorrow');
reset role;
set local role service_role;
select pg_temp.as_service();
select is(pg_temp.proof('rA') || ',' || pg_temp.proof('rB') || ',' || pg_temp.proof('ru', 1), 'done,done,done', 'proofs for rA, rB and ru');
reset role;
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('rA', 1)))
  || ',' || pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('rB', 1)))
  || ',' || pg_temp.r(format($f$ select status::text from public.review_payment(%L, true, null) $f$, pg_temp.nth('ru', 1))),
  'confirmed,confirmed,confirmed', 'all three are approved');
select is(pg_temp.r(format($f$ select public.cancel_booking(%L, p_reason => 'Closed')::text $f$, pg_temp.nth('rB', 1))), 'cancelled',
  'rB: staff cancel the lead court (GE A3) of the confirmed group; GE A4 and GE A5 stay confirmed');
reset role;
-- The real clock may be past 18:00 local, so place confirmed_at by hand (09:00 local today); nothing fires on this update.
update public.bookings set confirmed_at = pg_temp.at(0, 9)
where id in (select g.id from gr g where g.label in ('rA', 'rB', 'ru')) and status = 'confirmed';
select is(pg_temp.pst('rB'), 'cancelled,confirmed,confirmed', 'rB: the lead is cancelled, the other two courts are confirmed');
select is(pg_temp.rj(pg_temp.at(0, 18, 30)), 'ok', 'the reminder job runs at 18:30 local');
select is(pg_temp.ob('rA', 'booking_reminder') || '|' || pg_temp.obl('rA', 'booking_reminder'), '1|1',
  'a confirmed group of 2 starting tomorrow gets ONE booking_reminder, on the lead (the 06:00 start is the day before in UTC)');
select is(pg_temp.cn(pg_temp.od('rA', 'booking_reminder')), 'GE A1,GE A2', 'the reminder lists both courts, ordered by start');
select is((pg_temp.od('rA', 'booking_reminder') ->> 'amount_due')::numeric, pg_temp.sdue('rA'), 'and its amount_due is the group''s sum');
select is((select count(*)::int from public.email_outbox o where o.booking_id = pg_temp.nth('ru', 1) and o.kind = 'booking_reminder'), 1,
  'an ungrouped booking in the same run still gets its own reminder');
select is(coalesce((pg_temp.od('ru', 'booking_reminder') ? 'courts')::text, 'none'), 'false', 'and that reminder has no courts key');
select is(pg_temp.ob('rB', 'booking_reminder') || '|' || pg_temp.obl('rB', 'booking_reminder'), '1|0',
  'a group whose lead was cancelled still gets ONE reminder, and not on the cancelled lead');
select is((select bool_and(o.booking_id = pg_temp.nth('rB', 2)) from public.email_outbox o
           where o.booking_id in (select g.id from gr g where g.label = 'rB') and o.kind = 'booking_reminder'),
  true, 'it is on the earliest remaining confirmed court''s booking (GE A4)');
select is(pg_temp.cn(pg_temp.od('rB', 'booking_reminder')), 'GE A4,GE A5', 'and lists only the courts still confirmed');
select is(pg_temp.rj(pg_temp.at(0, 18, 45)), 'ok', 'the job runs again 15 minutes later');
select is((select count(*)::int from public.email_outbox o where o.kind = 'booking_reminder' and o.booking_id in (select g.id from gr g where g.label in ('rA', 'rB', 'ru'))),
  3, 'run twice: no second reminder for a group or for the ungrouped booking (3 rows in all)');

-- ---------------------------------------------------------------------------
-- claim_guest_link_email: from any reference of the group
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.cg('gk1', jsonb_build_array(pg_temp.it('A1', 13, 6), pg_temp.it('A2', 13, 8))), 'done', 'gk1: a guest books two courts');
select is(pg_temp.cg('gk2', jsonb_build_array(pg_temp.it('A1', 14, 6), pg_temp.it('A2', 14, 8))), 'done', 'gk2: another group');
select is(pg_temp.cg('gk3', jsonb_build_array(pg_temp.it('A1', 15, 6), pg_temp.it('A2', 15, 8))), 'done', 'gk3: another group');
reset role;
set local role service_role;
select pg_temp.as_service();
select is(pg_temp.r(format($f$ select booking_id::text from public.claim_guest_link_email(%L, %L) $f$, pg_temp.ref('gk1', 2), pg_temp.tok('gk1'))),
  pg_temp.lead('gk1')::text, 'claiming with the NON-lead court''s reference and the group''s token returns the lead''s booking_created row (booking_id = lead)');
select is(pg_temp.r(format($f$ select booking_id::text from public.claim_guest_link_email(%L, %L) $f$, pg_temp.ref('gk2', 1), pg_temp.tok('gk2'))),
  pg_temp.lead('gk2')::text, 'claiming with the lead''s own reference works the same');
select is(pg_temp.r(format($f$ select booking_id::text from public.claim_guest_link_email(%L, 'wrong-token') $f$, pg_temp.ref('gk3', 2))),
  'ERR not_found', 'a wrong token for a group''s reference is still not_found');
select is(pg_temp.r(format($f$ select booking_id::text from public.claim_guest_link_email(%L, %L) $f$, pg_temp.ref('u1', 1), pg_temp.tok('u1'))),
  pg_temp.nth('u1', 1)::text, 'an ungrouped booking''s claim is unchanged');
reset role;
select is((select o.status::text from public.email_outbox o where o.booking_id = pg_temp.lead('gk1') and o.kind = 'booking_created'), 'sending',
  'gk1: the lead''s booking_created is now sending');
select is((select o.status::text from public.email_outbox o where o.booking_id = pg_temp.lead('gk2') and o.kind = 'booking_created'), 'sending',
  'gk2: the lead''s booking_created is now sending');
select is((select o.status::text from public.email_outbox o where o.booking_id = pg_temp.lead('gk3') and o.kind = 'booking_created'), 'pending',
  'gk3: a refused claim leaves the row pending');
select is((select count(*)::int from public.email_outbox o where o.booking_id in (select g.id from gr g where g.label = 'gk1') and o.kind = 'booking_created'), 1,
  'gk1 has only that one booking_created row (the claim has nothing else to take)');

-- ---------------------------------------------------------------------------
-- email_outbox rows of a group are for that venue's admins only
-- ---------------------------------------------------------------------------
create function pg_temp.seen(p_label text) returns text language sql as $$
  select count(*)::text from public.email_outbox o where o.booking_id in (select g.id from pg_temp.gr g where g.label = p_label)
$$;
grant execute on function pg_temp.seen(text) to anon, authenticated, service_role;
set local role authenticated;
select pg_temp.as_staff_a();
select is(pg_temp.r($$ select pg_temp.seen('g1') $$), '1', 'the venue''s own admin sees the group''s one email row');
select pg_temp.as_staff_b();
select is(pg_temp.r($$ select pg_temp.seen('g1') $$), '0', 'another venue''s admin sees none of the group''s email rows');
select pg_temp.as_p1();
select is(pg_temp.r($$ select pg_temp.seen('g1') $$), '0', 'a player who is not an admin sees none');
reset role;
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.r($$ select pg_temp.seen('g1') $$), 'ERR 42501', 'anon has no access to email_outbox at all');
reset role;

select * from finish();
rollback;
