-- Milestone 4: availability tells the truth about the slot in progress (found in the T4.11 review).
-- Before: past > booked > blackout > free, so a booked or blacked-out slot that had started showed as
-- 'past' and the walk-in form offered it. Now: a finished slot is 'past'; otherwise booked > blackout;
-- a started-but-free slot is 'past'; else 'free'. Online booking is unaffected ('past' and 'booked'
-- are both unbookable). Same signature, so existing grants are kept.

create or replace function public.get_availability(p_date date, p_court_id uuid default null)
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
      when upper(sl.slot) <= now() then 'past'  -- already over
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
      when sl.slot_start <= now() then 'past'   -- in progress and free: not bookable online (walk-ins may take it)
      else 'free'
    end
  from public.courts c
  cross join slots sl
  where c.is_active
    and (p_court_id is null or c.id = p_court_id)
  order by c.sport, c.sort_order, c.name, sl.slot_start;
$$;
