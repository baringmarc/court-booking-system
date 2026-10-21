-- Milestone 2: catalog access rules and table constraints.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

insert into public.courts (name, sport, default_hourly_rate, is_active)
values ('Test Archived Court', 'tennis', 500, false);

-- Constraints (as postgres)
select throws_ok(
  $$ insert into public.venue_settings (name) values ('Second venue') $$,
  '23505', null, 'venue_settings is a singleton'
);
select throws_ok(
  $$ update public.operating_hours set open_time = '06:30' where day_of_week = 1 $$,
  '23514', null, 'operating hours must be whole hours'
);
-- Since M9 (T9.9) a close at or before the open means the next day, so 22:00–06:00 is a valid overnight day;
-- what's refused is running into the next day's opening (checked at commit; made immediate here to see it).
set constraints public.operating_hours_no_overlap immediate;
select throws_ok(
  $$ update public.operating_hours set open_time = '22:00', close_time = '07:00' where day_of_week = 1 $$,
  'P0001', 'Monday runs past Tuesday''s opening time. Close earlier, or open Tuesday later.',
  'hours may not run into the next day''s opening (the old open < close rule became this in T9.9)'
);
set constraints public.operating_hours_no_overlap deferred;
select throws_ok(
  $$ insert into public.court_rates (court_id, day_of_week, start_hour, price)
     select id, 7, 10, 100 from public.courts limit 1 $$,
  '23514', null, 'court_rates.day_of_week is 0–6'
);
select throws_ok(
  $$ insert into public.blackouts (starts_at, ends_at) values ('2026-11-01 10:00+08', '2026-11-01 09:00+08') $$,
  '23514', null, 'blackout must end after it starts'
);

-- As anon
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(
  (select count(*)::int from public.courts where name = 'Test Archived Court'), 0,
  'anon does not see archived courts'
);
select ok((select count(*) from public.venue_settings) = 1, 'anon can read venue settings');
select throws_ok(
  $$ insert into public.courts (name, sport, default_hourly_rate) values ('Anon Court', 'tennis', 1) $$,
  '42501', null, 'anon cannot insert courts'
);

-- As a player
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into public.courts (name, sport, default_hourly_rate) values ('Player Court', 'tennis', 1) $$,
  '42501', null, 'player cannot insert courts (RLS)'
);
select lives_ok(
  $$ update public.venue_settings set name = 'Hijacked' $$,
  'player update on venue_settings is filtered by RLS'
);
select is((select name from public.venue_settings), 'Claudex Courts', 'venue name unchanged by player');
select throws_ok(
  $$ insert into public.blackouts (starts_at, ends_at) values (now(), now() + interval '1 hour') $$,
  '42501', null, 'player cannot create blackouts'
);

-- As the admin
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(
  (select count(*)::int from public.courts where name = 'Test Archived Court'), 1,
  'admin sees archived courts'
);
select lives_ok(
  $$ insert into public.courts (name, sport, default_hourly_rate) values ('Admin Court', 'pickleball', 300) $$,
  'admin can insert courts'
);

select * from finish();
rollback;
