-- T14.12: nightly demo reset (SPEC §10, RESEARCH M14 "pg_cron: monthly invoices and the demo reset").
-- Deletes every booking of the demo venue (payments, outbox rows, tokens, changes and billing charges cascade
-- with them; the charge guard allows a delete that comes from a deleted booking) and re-inserts the five demo
-- bookings and their payments from seed.sql. Only rows with the demo venue's id are touched. Courts, rates,
-- settings and invoices stay. Runs as the job owner, at 00:30 UTC, before the 01:00 monthly-invoices job.

create function private.reset_demo_venue()
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_venue uuid;
  v_prev text := coalesce(current_setting('app.suppress_booking_emails', true), 'off');
begin
  select id into v_venue from public.venues where slug = 'claudex-courts';
  if v_venue is null then
    return;
  end if;

  perform set_config('app.suppress_booking_emails', 'on', true);

  -- A continuation points at its parent with on delete restrict, so delete children first.
  delete from public.bookings where venue_id = v_venue and parent_booking_id is not null;
  delete from public.bookings where venue_id = v_venue;

  insert into public.bookings (venue_id, reference_code, court_id, guest_name, guest_email, during, total_amount, status, source)
  select v_venue, v.ref, c.id, 'Demo Player', 'demo@example.com', r.during,
         private.range_price(c.id, r.during), v.status::public.booking_status, 'online'
  from (values
    ('CB-DEMQA2', 'Badminton 1',      1, time '18:00', 2, 'confirmed'),
    ('CB-DEMQB3', 'Badminton 2',      1, time '19:00', 2, 'payment_submitted'),
    ('CB-DEMQC4', 'Pickleball 1',     1, time '07:00', 2, 'confirmed'),
    ('CB-DEMQD5', 'Basketball Court', 2, time '17:00', 2, 'confirmed'),
    ('CB-DEMQE6', 'Tennis Court',     2, time '06:00', 2, 'confirmed')
  ) as v(ref, court_name, day_offset, start_time, hours, status)
  join public.courts c on c.name = v.court_name and c.venue_id = v_venue
  cross join lateral (
    select tstzrange(
      ((private.local_today(v_venue) + v.day_offset) + v.start_time) at time zone private.venue_tz(v_venue),
      ((private.local_today(v_venue) + v.day_offset) + v.start_time) at time zone private.venue_tz(v_venue)
        + make_interval(hours => v.hours)
    ) as during
  ) as r;

  insert into public.payments (venue_id, booking_id, method, amount, reference_number, submitted_at, review_status, reviewed_at)
  select b.venue_id, b.id, 'gcash', b.total_amount, 'DEMO-' || substr(b.reference_code, 4), now(),
         case b.status when 'confirmed' then 'approved' else 'pending' end::public.payment_review_status,
         case b.status when 'confirmed' then now() end
  from public.bookings b
  where b.venue_id = v_venue
    and b.reference_code like 'CB-DEMQ%'
    and b.status in ('confirmed', 'payment_submitted');

  perform set_config('app.suppress_booking_emails', v_prev, true);
end;
$$;

revoke all on function private.reset_demo_venue() from public, anon, authenticated;

select cron.schedule('demo-reset', '30 0 * * *', 'select private.reset_demo_venue()');
