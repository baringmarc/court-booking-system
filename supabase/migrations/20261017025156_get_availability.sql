-- Milestone 3: public availability (SPEC §5, §6 "get_availability").
-- security definer because it reads busy ranges from bookings, which anon cannot select.
-- It returns only court ids, slot times, prices and a status: never personal data.

-- Today in the venue timezone.
create function private.local_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone private.venue_tz())::date;
$$;

-- Booking window, defined per venue-local day: today .. today + booking_window_days (inclusive).
-- Shared by get_availability and create_booking so they always agree.
create function private.in_booking_window(p_day date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_day between private.local_today()
                   and private.local_today() + (select booking_window_days from public.venue_settings);
$$;

revoke all on function private.local_today() from public, anon, authenticated;
revoke all on function private.in_booking_window(date) from public, anon, authenticated;

-- One row per active court × 1-hour slot inside that day's operating hours.
-- status precedence: past > booked > blackout > free.
--   past     – the slot has already started
--   booked   – an active booking overlaps it (pending holds past expires_at count as free)
--   blackout – a venue-wide or court-specific blackout overlaps it
-- Closed days and dates outside the booking window return no rows.
create function public.get_availability(p_date date, p_court_id uuid default null)
returns table (
  court_id    uuid,
  slot_start  timestamptz,
  slot_end    timestamptz,
  price       numeric,
  status      text
)
language sql
stable
security definer
set search_path = ''
as $$
  with day_hours as (
    select oh.open_time, oh.close_time
    from public.operating_hours oh
    where oh.day_of_week = extract(dow from p_date)::smallint
      and not oh.is_closed
      and private.in_booking_window(p_date)
  ),
  slots as (
    select s as slot_start, tstzrange(s, s + interval '1 hour') as slot
    from day_hours h,
         generate_series(
           (p_date + h.open_time) at time zone private.venue_tz(),
           (p_date + h.close_time) at time zone private.venue_tz() - interval '1 hour',
           interval '1 hour'
         ) as s
  )
  select
    c.id,
    sl.slot_start,
    upper(sl.slot),
    private.slot_price(c.id, sl.slot_start),
    case
      when sl.slot_start <= now() then 'past'
      when exists (
        select 1 from public.bookings b
        where b.court_id = c.id
          and b.during && sl.slot
          and b.status in ('pending_payment', 'payment_submitted', 'confirmed')
          and not (b.status = 'pending_payment' and b.expires_at <= now())
      ) then 'booked'
      when exists (
        select 1 from public.blackouts bo
        where (bo.court_id is null or bo.court_id = c.id)
          and tstzrange(bo.starts_at, bo.ends_at) && sl.slot
      ) then 'blackout'
      else 'free'
    end
  from public.courts c
  cross join slots sl
  where c.is_active
    and (p_court_id is null or c.id = p_court_id)
  order by c.sport, c.sort_order, c.name, sl.slot_start;
$$;

revoke all on function public.get_availability(date, uuid) from public, anon, authenticated;
grant execute on function public.get_availability(date, uuid) to anon, authenticated;
