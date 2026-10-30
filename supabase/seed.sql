-- Demo data for Claudex Courts. Idempotent: safe to run more than once.
-- Local:  runs automatically on `supabase db reset`.
-- Hosted: npx supabase db query --linked -f supabase/seed.sql

-- Demo bookings must not queue booking emails (SPEC §8): the bookings_queue_email trigger checks this setting.
select set_config('app.suppress_booking_emails', 'on', false);

insert into public.courts (name, sport, description, default_hourly_rate, sort_order) values
  ('Badminton 1',       'badminton',  'Wooden floor, BWF-standard lighting.',      350,  1),
  ('Badminton 2',       'badminton',  'Wooden floor, BWF-standard lighting.',      350,  2),
  ('Badminton 3',       'badminton',  'Wooden floor, BWF-standard lighting.',      350,  3),
  ('Badminton 4',       'badminton',  'Wooden floor, BWF-standard lighting.',      350,  4),
  ('Pickleball 1',      'pickleball', 'Cushioned acrylic surface. Paddles for rent.', 400, 1),
  ('Pickleball 2',      'pickleball', 'Cushioned acrylic surface. Paddles for rent.', 400, 2),
  ('Basketball Court',  'basketball', 'Full court, indoor, with scoreboard.',      1200, 1),
  ('Tennis Court',      'tennis',     'Hard court with night lighting.',            600, 1)
on conflict (venue_id, name) do nothing;

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

-- Demo bookings so the booking grid shows busy slots (tomorrow and the day after, venue time).
-- Fixed reference codes make re-runs no-ops, and rows that would overlap a real booking are skipped,
-- so this never fails on a database that is already in use. Prices come from the server-side helper.
-- Dates are fixed at the first run (re-runs are no-ops), so on a long-lived database they go stale;
-- `npm run db:reset:local` refreshes them locally. Their payment rows are added further below.
insert into public.bookings (reference_code, court_id, guest_name, guest_email, during, total_amount, status, source)
select v.ref, c.id, 'Demo Player', 'demo@example.com', r.during,
       private.range_price(c.id, r.during), v.status::public.booking_status, 'online'
from (values
  ('CB-DEMQA2', 'Badminton 1',      1, time '18:00', 2, 'confirmed'),
  ('CB-DEMQB3', 'Badminton 2',      1, time '19:00', 2, 'payment_submitted'),
  ('CB-DEMQC4', 'Pickleball 1',     1, time '07:00', 2, 'confirmed'),
  ('CB-DEMQD5', 'Basketball Court', 2, time '17:00', 2, 'confirmed'),
  ('CB-DEMQE6', 'Tennis Court',     2, time '06:00', 2, 'confirmed')
) as v(ref, court_name, day_offset, start_time, hours, status)
join public.courts c on c.name = v.court_name
cross join lateral (
  select tstzrange(
    ((private.local_today() + v.day_offset) + v.start_time) at time zone private.venue_tz(),
    ((private.local_today() + v.day_offset) + v.start_time) at time zone private.venue_tz() + make_interval(hours => v.hours)
  ) as during
) as r
where not exists (
  select 1 from public.bookings b
  where b.court_id = c.id
    and b.during && r.during
    and b.status in ('pending_payment', 'payment_submitted', 'confirmed')
)
on conflict (reference_code) do nothing;

-- Payments for the demo bookings (SPEC §3: every confirmed booking has exactly one approved payment).
-- Idempotent: only adds a row when the booking has none in that review state.
insert into public.payments (booking_id, method, amount, reference_number, submitted_at, review_status, reviewed_at)
select b.id, 'gcash', b.total_amount, 'DEMO-' || substr(b.reference_code, 4), now(),
       case b.status when 'confirmed' then 'approved' else 'pending' end::public.payment_review_status,
       case b.status when 'confirmed' then now() end
from public.bookings b
where b.reference_code like 'CB-DEMQ%'
  and b.status in ('confirmed', 'payment_submitted')
  and not exists (
    select 1 from public.payments p
    where p.booking_id = b.id
      and p.review_status = case b.status when 'confirmed' then 'approved' else 'pending' end::public.payment_review_status
  );
