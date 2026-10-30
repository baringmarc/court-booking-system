-- T9.5: delete_court (admin only, refused for a court with any booking, cascades rates and court blackouts)
-- and the one-dimensional sport_order check.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
insert into public.venue_members (venue_id, user_id, role)
select id, '22222222-2222-2222-2222-222222222222', 'staff' from public.venues where slug = 'claudex-courts';

insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000001', 'Delete Me', 'tennis', 500),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000002', 'Booked Once', 'tennis', 500),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000003', 'Cancelled Only', 'tennis', 500);
insert into public.court_rates (court_id, day_of_week, start_hour, price) values
  ('c0000000-0000-0000-0000-000000000001', 1, 18, 700),
  ('c0000000-0000-0000-0000-000000000001', 2, 18, 700);
insert into public.blackouts (venue_id, id, court_id, starts_at, ends_at, reason) values
  (private.default_venue_id(), 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', now() + interval '2 days', now() + interval '2 days 1 hour', 'court'),
  (private.default_venue_id(), 'b0000000-0000-0000-0000-000000000002', null, now() + interval '3 days', now() + interval '3 days 1 hour', 'venue');
-- A confirmed booking on one court, and only a cancelled one on another: both count as "ever booked".
insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, status) values
  ('CB-DELAAB', 'c0000000-0000-0000-0000-000000000002', 'Fixture',
   tstzrange(now() + interval '5 days', now() + interval '5 days 1 hour'), 500, 'confirmed'),
  ('CB-DELAAC', 'c0000000-0000-0000-0000-000000000003', 'Fixture',
   tstzrange(now() + interval '6 days', now() + interval '6 days 1 hour'), 500, 'cancelled');

-- ---------------------------------------------------------------------------
-- As anon and as a player
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok(
  $$ select public.delete_court('c0000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'anon cannot call delete_court'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.delete_court('c0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'Only staff can delete courts.', 'a player cannot delete courts'
);

-- ---------------------------------------------------------------------------
-- As the admin
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select throws_ok(
  $$ select public.delete_court(null) $$,
  'P0001', 'Choose a court.', 'a missing court id is rejected'
);
select throws_ok(
  $$ select public.delete_court('c0000000-0000-0000-0000-0000000000ff') $$,
  'P0001', 'That court does not exist.', 'an unknown court is rejected'
);

select throws_ok(
  $$ select public.delete_court('c0000000-0000-0000-0000-000000000002') $$,
  'P0001', 'This court has bookings, so it can''t be deleted. Archive it instead.',
  'a court with a confirmed booking is refused'
);
select is(
  (select count(*)::int from public.courts where id = 'c0000000-0000-0000-0000-000000000002'), 1,
  'the booked court is kept'
);
select throws_ok(
  $$ select public.delete_court('c0000000-0000-0000-0000-000000000003') $$,
  'P0001', 'This court has bookings, so it can''t be deleted. Archive it instead.',
  'a court whose only booking was cancelled is refused too (history keeps its court)'
);

-- The refusal carries the court_has_bookings hint the client can rely on.
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end;
$$;
select is(
  pg_temp.hint_of($$ select public.delete_court('c0000000-0000-0000-0000-000000000002') $$),
  'court_has_bookings', 'the refusal hint is court_has_bookings'
);
select is(
  pg_temp.hint_of($$ select public.delete_court('c0000000-0000-0000-0000-0000000000ff') $$),
  'invalid_input', 'an unknown court has the invalid_input hint'
);

select lives_ok(
  $$ select public.delete_court('c0000000-0000-0000-0000-000000000001') $$,
  'admin deletes a court that was never booked'
);
select is(
  (select count(*)::int from public.courts where id = 'c0000000-0000-0000-0000-000000000001'), 0,
  'the court is gone'
);
select is(
  (select count(*)::int from public.court_rates where court_id = 'c0000000-0000-0000-0000-000000000001'), 0,
  'its rates are gone'
);
select is(
  (select count(*)::int from public.blackouts where id = 'b0000000-0000-0000-0000-000000000001'), 0,
  'its court-specific blackout is gone'
);
select is(
  (select count(*)::int from public.blackouts where id = 'b0000000-0000-0000-0000-000000000002'), 1,
  'a venue-wide blackout is kept'
);
select throws_ok(
  $$ select public.delete_court('c0000000-0000-0000-0000-000000000001') $$,
  'P0001', 'That court does not exist.', 'deleting it again says it does not exist'
);

-- ---------------------------------------------------------------------------
-- sport_order must be one-dimensional (T9.3 follow-up)
-- ---------------------------------------------------------------------------
reset role;
select throws_ok(
  $$ update public.venue_settings set sport_order = '{{badminton,pickleball},{basketball,tennis}}'::public.sport[] $$,
  '23514', null, 'a two-dimensional sport_order is rejected'
);
select throws_ok(
  $$ update public.venue_settings set sport_order = '{}'::public.sport[] $$,
  '23514', null, 'an empty sport_order is rejected'
);
select lives_ok(
  $$ update public.venue_settings set sport_order = array['tennis', 'basketball', 'pickleball', 'badminton']::public.sport[] $$,
  'a one-dimensional order with every sport is still accepted'
);

select * from finish();
rollback;
