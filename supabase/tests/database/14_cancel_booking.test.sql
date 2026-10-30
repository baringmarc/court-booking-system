-- T5.3: cancel_booking (SPEC §4). now() is fixed for the whole transaction, so fixtures placed at
-- exact offsets from now() test the cutoff boundary to the second.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

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
update public.venue_settings set cancel_cutoff_hours = 1;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'olga@test.local');
insert into public.venue_members (venue_id, user_id, role)
select id, '22222222-2222-2222-2222-222222222222', 'staff' from public.venues where slug = 'claudex-courts';

-- One court per fixture keeps every active range clear of the exclusion constraint.
create temp table b (label text primary key, id uuid, ref text);
grant select, insert on b to anon, authenticated;

create function pg_temp.mk(
  p_label text, p_from timestamptz, p_status public.booking_status,
  p_user uuid default '11111111-1111-1111-1111-111111111111', p_token text default null,
  p_source public.booking_source default 'online', p_expires timestamptz default now() + interval '1 hour'
) returns void language plpgsql as $$
declare
  v_court uuid := gen_random_uuid();
  v_ref   text := 'CB-' || translate(upper(substr(md5(p_label), 1, 6)), '01', '23');  -- hex minus 0/1 fits the code alphabet
  v_id    uuid;
begin
  insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values (private.default_venue_id(), v_court, 'Court ' || p_label, 'tennis', 500);
  insert into public.bookings (reference_code, court_id, user_id, guest_name, guest_email, during, total_amount,
                               status, source, guest_token_hash, expires_at)
  values (v_ref, v_court, p_user, 'Test ' || p_label, 'guest@test.local', tstzrange(p_from, p_from + interval '1 hour'), 500,
          p_status, p_source, case when p_token is null then null else sha256(convert_to(p_token, 'UTF8')) end,
          case when p_status = 'pending_payment' then p_expires end)
  returning id into v_id;
  insert into b values (p_label, v_id, v_ref);
end $$;

select pg_temp.mk('guest',        now() + interval '2 days', 'pending_payment', null, 'tok-guest');
select pg_temp.mk('guest_late',   now() + interval '30 minutes', 'confirmed', null, 'tok-late');
select pg_temp.mk('owner',        now() + interval '2 days', 'pending_payment');
select pg_temp.mk('submitted',    now() + interval '2 days', 'payment_submitted');
select pg_temp.mk('confirmed',    now() + interval '2 days', 'confirmed');
select pg_temp.mk('stale',        now() + interval '2 days', 'pending_payment', p_expires => now() - interval '1 minute');
select pg_temp.mk('cancelled',    now() + interval '2 days', 'cancelled');
select pg_temp.mk('expired',      now() + interval '2 days', 'expired');
select pg_temp.mk('rejected',     now() + interval '2 days', 'rejected');
select pg_temp.mk('at_cutoff',    now() + interval '1 hour', 'confirmed');
select pg_temp.mk('past_cutoff',  now() + interval '1 hour' - interval '1 second', 'confirmed');
select pg_temp.mk('admin_late',   now() + interval '10 minutes', 'confirmed');
select pg_temp.mk('in_progress',  now() - interval '30 minutes', 'confirmed');
select pg_temp.mk('ended',        now() - interval '2 hours', 'confirmed');
select pg_temp.mk('walk_in',      now() + interval '2 hours', 'confirmed', null, p_source => 'walk_in');
select pg_temp.mk('admin_own',    now() + interval '2 days', 'confirmed', '22222222-2222-2222-2222-222222222222');
select pg_temp.mk('admin_guest',  now() + interval '2 days', 'confirmed', null, 'tok-admin-guest');
select pg_temp.mk('both_x',       now() + interval '2 days', 'confirmed');
select pg_temp.mk('both_y',       now() + interval '2 days', 'confirmed', null, 'tok-y');
insert into public.payments (booking_id, method, amount, storage_path)
  select id, 'gcash', 500, id::text || '/proof.png' from b where label = 'submitted';

-- ---------------------------------------------------------------------------
-- Guest path (anon)
-- ---------------------------------------------------------------------------
select ok(has_function_privilege('anon', 'public.cancel_booking(uuid, text, text, text)', 'execute'), 'anon may call cancel_booking (guest links)');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select public.cancel_booking(p_reference_code => (select ref from b where label = 'guest'), p_token => 'wrong') $$),
  'not_found', 'guest: a wrong token is not_found');
select is(pg_temp.hint_of($$ select public.cancel_booking(p_reference_code => 'CB-ZZZZZZ', p_token => 'tok-guest') $$),
  'not_found', 'guest: an unknown reference code is not_found');
select is(pg_temp.hint_of($$ select public.cancel_booking(p_booking_id => (select id from b where label = 'guest')) $$),
  'not_found', 'anon without a token cannot cancel by id');
select is(pg_temp.hint_of($$ select public.cancel_booking(p_reference_code => (select ref from b where label = 'guest_late'), p_token => 'tok-late') $$),
  'cutoff_passed', 'guest: the cutoff applies');
select is(public.cancel_booking(p_reference_code => lower((select ref from b where label = 'guest')), p_token => 'tok-guest', p_reason => '  Rain  '),
  'cancelled'::public.booking_status, 'guest: the right token cancels (reference code matched case-insensitively)');

reset role;
select results_eq(
  $$ select status::text, cancelled_at = now(), cancel_reason, cancelled_by, cancelled_by_venue from public.bookings where id = (select id from b where label = 'guest') $$,
  $$ values ('cancelled', true, 'Rain', null::uuid, false) $$,
  'guest cancel: status, time, trimmed reason, no canceller, not by the venue');

-- ---------------------------------------------------------------------------
-- Session path: owner and other players
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'owner')) $$),
  'not_found', 'another player cannot cancel the booking (same answer as unknown)');
select is(pg_temp.hint_of($$ select public.cancel_booking('00000000-0000-0000-0000-000000000000') $$),
  'not_found', 'an unknown booking id is not_found');
select is(pg_temp.hint_of($$ select public.cancel_booking() $$), 'not_found', 'neither an id nor a token is not_found');

select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(public.cancel_booking((select id from b where label = 'owner')), 'cancelled'::public.booking_status, 'the owner cancels a pending booking without a reason');
select is(public.cancel_booking((select id from b where label = 'submitted')), 'cancelled'::public.booking_status, 'the owner cancels a payment_submitted booking');
select is(public.cancel_booking((select id from b where label = 'confirmed')), 'cancelled'::public.booking_status, 'the owner cancels a confirmed booking');
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'confirmed'), p_reference_code => (select ref from b where label = 'confirmed'), p_token => 'nope') $$),
  'not_found', 'with both a token and an id, the guest path wins (a wrong token is not_found)');
select is(public.cancel_booking((select id from b where label = 'both_x'), p_reference_code => (select ref from b where label = 'both_y'), p_token => 'tok-y'),
  'cancelled'::public.booking_status, 'with both, a valid token cancels the token''s booking');

-- Statuses that no longer hold a slot
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'stale')) $$), 'not_cancellable', 'a hold past its expiry is already expired');
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'cancelled')) $$), 'not_cancellable', 'cancelled cannot be cancelled again');
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'expired')) $$), 'not_cancellable', 'expired cannot be cancelled');
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'rejected')) $$), 'not_cancellable', 'rejected cannot be cancelled');

-- Cutoff boundary (cancel_cutoff_hours = 1)
select is(public.cancel_booking((select id from b where label = 'at_cutoff')), 'cancelled'::public.booking_status, 'exactly at the cutoff is still allowed');
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'past_cutoff')) $$), 'cutoff_passed', 'one second past the cutoff is refused');
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'owner'), p_reason => repeat('x', 501)) $$), 'invalid_input', 'reasons are limited to 500 characters');

reset role;
select results_eq(
  $$ select cancelled_by, cancelled_by_venue, cancel_reason from public.bookings where id = (select id from b where label = 'owner') $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, false, null::text) $$,
  'owner cancel records the owner and is not by the venue');
select results_eq(
  $$ select label, bk.status::text from public.bookings bk join b using (id) where label in ('both_x', 'both_y') order by label $$,
  $$ values ('both_x', 'confirmed'), ('both_y', 'cancelled') $$,
  'with both arguments only the token''s booking was cancelled, the id was ignored');
select results_eq(
  $$ select p.review_status::text, p.storage_path is not null from public.payments p where p.booking_id = (select id from b where label = 'submitted') $$,
  $$ values ('pending', true) $$,
  'cancelling leaves the payment rows untouched (no refunds)');

-- ---------------------------------------------------------------------------
-- Admin
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'admin_late')) $$), 'reason_required', 'admins must give a reason');
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'admin_own')) $$), 'reason_required', 'an admin cancelling their own booking still needs a reason');
select is(public.cancel_booking((select id from b where label = 'admin_late'), p_reason => 'Court maintenance'), 'cancelled'::public.booking_status, 'admins can cancel after the player cutoff');
select is(public.cancel_booking((select id from b where label = 'in_progress'), p_reason => 'Power outage'), 'cancelled'::public.booking_status, 'admins can cancel a booking in progress');
select is(pg_temp.hint_of($$ select public.cancel_booking((select id from b where label = 'ended'), p_reason => 'Too late') $$), 'booking_ended', 'admins cannot cancel a booking that has ended');
select is(public.cancel_booking((select id from b where label = 'walk_in'), p_reason => 'Customer left'), 'cancelled'::public.booking_status, 'admins can cancel a walk-in');

-- A signed-in admin opening a guest link gets guest rights only
select is(pg_temp.hint_of($$ select public.cancel_booking(p_reference_code => (select ref from b where label = 'guest_late'), p_token => 'tok-late', p_reason => 'x') $$),
  'cutoff_passed', 'the guest path never gives admin rights, even to an admin');
select is(public.cancel_booking(p_reference_code => (select ref from b where label = 'admin_guest'), p_token => 'tok-admin-guest'),
  'cancelled'::public.booking_status, 'an admin may use a guest link like any guest');

reset role;
select results_eq(
  $$ select label, cancelled_by, cancelled_by_venue, cancel_reason from public.bookings bk join b using (id)
     where label in ('admin_late', 'admin_guest') order by label $$,
  $$ values ('admin_guest', null::uuid, false, null::text), ('admin_late', '22222222-2222-2222-2222-222222222222'::uuid, true, 'Court maintenance') $$,
  'admin cancel is by the venue; the same admin via a guest link is recorded as a guest');

-- ---------------------------------------------------------------------------
-- A cancelled booking frees its slot
-- ---------------------------------------------------------------------------
create temp table freed (id uuid);
grant select, insert on freed to authenticated;
create temp table fx as select (private.local_today(private.default_venue_id()) + 3 + time '10:00') at time zone 'Asia/Manila' as t10;
grant select on fx to authenticated;
insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000f1', 'Freed Court', 'tennis', 500);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
insert into freed select r.id from fx, public.create_booking('c0000000-0000-0000-0000-0000000000f1', fx.t10, 2) r;
select is(public.cancel_booking((select id from freed)), 'cancelled'::public.booking_status, 'a booking made through create_booking can be cancelled');
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select lives_ok($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000000f1', (select t10 from fx) + interval '1 hour', 1) $$,
  'the freed slot can be booked again by someone else');
select ok(not has_table_privilege('authenticated', 'public.bookings', 'update'), 'clients still have no direct update on bookings');

select * from finish();
rollback;
