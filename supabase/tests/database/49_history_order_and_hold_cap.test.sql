-- Change history order (clock_timestamp default) and the rejection hold capped at the booking's start.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.venue_settings set max_rejections = 3, payment_hold_minutes = 60;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
insert into public.venue_members (venue_id, user_id, role)
select id, '22222222-2222-2222-2222-222222222222', 'staff' from public.venues where slug = 'claudex-courts';
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000048', 'Cap Court', 'tennis', 500),
  ('c0000000-0000-0000-0000-000000000049', 'Cap Court B', 'tennis', 500);

create temp table fx as select (private.local_today() + 3 + time '10:00') at time zone 'Asia/Manila' as t10;
create temp table b (label text primary key, id uuid, ref text);
grant select on fx to anon, authenticated, service_role;
grant select, insert on b to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Change history order
-- ---------------------------------------------------------------------------
select col_default_is('public', 'booking_changes', 'changed_at', 'clock_timestamp()',
  'changed_at defaults to the insert''s own time, not the transaction start');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
insert into b select 'soon', r.id, r.reference_code from fx, public.create_booking('c0000000-0000-0000-0000-000000000048', fx.t10, 1) r;
insert into b select 'started', r.id, r.reference_code from fx, public.create_booking('c0000000-0000-0000-0000-000000000048', fx.t10 + interval '2 hours', 1) r;
insert into b select 'later', r.id, r.reference_code from fx, public.create_booking('c0000000-0000-0000-0000-000000000048', fx.t10 + interval '4 hours', 1) r;
reset role;

-- Two changes in one transaction (as two reschedules would write them) get distinct, increasing times.
insert into public.booking_changes (booking_id, old_court_id, old_during, new_court_id, new_during, reason)
select id, 'c0000000-0000-0000-0000-000000000048', tstzrange(fx.t10 + interval '4 hours', fx.t10 + interval '5 hours'),
       'c0000000-0000-0000-0000-000000000049', tstzrange(fx.t10 + interval '4 hours', fx.t10 + interval '5 hours'), 'First'
from b, fx where label = 'later';
insert into public.booking_changes (booking_id, old_court_id, old_during, new_court_id, new_during, reason)
select id, 'c0000000-0000-0000-0000-000000000049', tstzrange(fx.t10 + interval '4 hours', fx.t10 + interval '5 hours'),
       'c0000000-0000-0000-0000-000000000048', tstzrange(fx.t10 + interval '4 hours', fx.t10 + interval '5 hours'), 'Second'
from b, fx where label = 'later';
select ok(
  (select max(changed_at) filter (where reason = 'Second') > max(changed_at) filter (where reason = 'First')
   from public.booking_changes where booking_id = (select id from b where label = 'later')),
  'a later change in the same transaction has a later changed_at');

-- ---------------------------------------------------------------------------
-- 2. The fresh hold after a rejection is capped at the booking's start
-- ---------------------------------------------------------------------------
-- Move two bookings close to now: one starts in 20 minutes (inside the 60-minute hold), one has started.
update public.bookings set during = tstzrange(now() + interval '20 minutes', now() + interval '80 minutes')
where id = (select id from b where label = 'soon');
update public.bookings set court_id = 'c0000000-0000-0000-0000-000000000049', during = tstzrange(now() - interval '10 minutes', now() + interval '50 minutes')
where id = (select id from b where label = 'started');

set local role service_role;
select public.record_payment_proof(id, id::text || '/1.png', 'gcash', 500) from b;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is((select status from public.review_payment((select id from b where label = 'soon'), false, 'Blurry')),
  'pending_payment'::public.booking_status, 'a first rejection still gives a fresh hold');
reset role;
select is((select expires_at from public.bookings where id = (select id from b where label = 'soon')),
  now() + interval '20 minutes', 'the hold ends at the start when the start comes before the hold window');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select public.review_payment((select id from b where label = 'later'), false, 'Wrong amount');
select public.review_payment((select id from b where label = 'started'), false, 'Wrong amount');
reset role;
select ok(
  (select expires_at between now() + interval '59 minutes' and now() + interval '61 minutes'
   from public.bookings where id = (select id from b where label = 'later')),
  'a booking further out keeps the full hold window');
select is((select expires_at from public.bookings where id = (select id from b where label = 'started')),
  now() - interval '10 minutes', 'a rejection after the start leaves a hold that has already lapsed');

select private.expire_holds();
select is((select status from public.bookings where id = (select id from b where label = 'started')),
  'expired'::public.booking_status, 'so the sweep expires it and releases the slot');

select * from finish();
rollback;
