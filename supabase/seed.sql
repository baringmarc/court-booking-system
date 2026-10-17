-- Demo data for Claudex Courts. Idempotent: safe to run more than once.
-- Local:  runs automatically on `supabase db reset`.
-- Hosted: npx supabase db query --linked -f supabase/seed.sql

insert into public.courts (name, sport, description, default_hourly_rate, sort_order) values
  ('Badminton 1',       'badminton',  'Wooden floor, BWF-standard lighting.',      350,  1),
  ('Badminton 2',       'badminton',  'Wooden floor, BWF-standard lighting.',      350,  2),
  ('Badminton 3',       'badminton',  'Wooden floor, BWF-standard lighting.',      350,  3),
  ('Badminton 4',       'badminton',  'Wooden floor, BWF-standard lighting.',      350,  4),
  ('Pickleball 1',      'pickleball', 'Cushioned acrylic surface. Paddles for rent.', 400, 1),
  ('Pickleball 2',      'pickleball', 'Cushioned acrylic surface. Paddles for rent.', 400, 2),
  ('Basketball Court',  'basketball', 'Full court, indoor, with scoreboard.',      1200, 1),
  ('Tennis Court',      'tennis',     'Hard court with night lighting.',            600, 1)
on conflict (name) do nothing;

-- Peak pricing: weekday evenings (Mon–Fri, 17:00–22:00) and all day on weekends.
-- Peak price = default rate + 100 (badminton/pickleball), +300 (basketball), +150 (tennis).
insert into public.court_rates (court_id, day_of_week, start_hour, price)
select c.id, d.dow, h.hour,
       c.default_hourly_rate + case c.sport
         when 'basketball' then 300
         when 'tennis'     then 150
         else 100
       end
from public.courts c
cross join generate_series(0, 6) as d(dow)
cross join generate_series(6, 21) as h(hour)
where c.name in ('Badminton 1', 'Badminton 2', 'Badminton 3', 'Badminton 4',
                 'Pickleball 1', 'Pickleball 2', 'Basketball Court', 'Tennis Court')
  and (d.dow in (0, 6) or h.hour >= 17)
on conflict (court_id, day_of_week, start_hour) do nothing;
