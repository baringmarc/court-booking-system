-- T3.3: venue-timezone helpers and pricing. 2030-01-05 is a Saturday; Asia/Manila is UTC+8.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000001', 'Pricing Test Court', 'tennis', 300);
-- Saturday 07:00 override, and a Friday 07:00 trap that only a UTC-based lookup would hit.
insert into public.court_rates (court_id, day_of_week, start_hour, price) values
  ('c0000000-0000-0000-0000-000000000001', 6, 7, 500),
  ('c0000000-0000-0000-0000-000000000001', 5, 7, 999),
  ('c0000000-0000-0000-0000-000000000001', 5, 23, 999);

select is(private.venue_tz(), 'Asia/Manila', 'venue timezone comes from venue_settings');
select is(
  private.local_day_bounds('2030-01-05'),
  tstzrange('2030-01-04 16:00+00', '2030-01-05 16:00+00'),
  'local day bounds are Manila midnight to midnight'
);
select is(
  (select row(dow, hour)::text from private.local_dow_hour('2030-01-04 23:00+00')),
  '(6,7)', '23:00 UTC Friday is Saturday 07:00 in Manila'
);

select is(
  private.slot_price('c0000000-0000-0000-0000-000000000001', '2030-01-05 07:00+08'),
  500.00, 'Saturday 07:00 Manila uses the Saturday override, not Friday''s'
);
select is(
  private.slot_price('c0000000-0000-0000-0000-000000000001', '2030-01-05 08:00+08'),
  300.00, 'a slot without an override uses the default hourly rate'
);
select is(
  private.range_price('c0000000-0000-0000-0000-000000000001', tstzrange('2030-01-05 06:00+08', '2030-01-05 09:00+08')),
  1100.00, 'range price sums each slot (300 + 500 + 300)'
);
select ok(
  private.slot_price('00000000-0000-0000-0000-000000000000', '2030-01-05 07:00+08') is null,
  'unknown court has no price'
);

-- Seeded peak pricing (supabase/seed.sql): Badminton 350 default, 450 on weekday evenings and weekends.
select is(
  private.slot_price((select id from public.courts where name = 'Badminton 1'), '2030-01-07 16:00+08'),
  350.00, 'seed: Monday 16:00 is off-peak'
);
select is(
  private.slot_price((select id from public.courts where name = 'Badminton 1'), '2030-01-07 17:00+08'),
  450.00, 'seed: Monday 17:00 is peak'
);
select is(
  private.slot_price((select id from public.courts where name = 'Badminton 1'), '2030-01-05 10:00+08'),
  450.00, 'seed: Saturday daytime is peak'
);

select ok(
  not has_function_privilege('anon', 'private.slot_price(uuid, timestamptz)', 'execute'),
  'anon cannot call pricing helpers'
);
select ok(
  not has_function_privilege('authenticated', 'private.range_price(uuid, tstzrange)', 'execute'),
  'authenticated cannot call pricing helpers'
);

select * from finish();
rollback;
