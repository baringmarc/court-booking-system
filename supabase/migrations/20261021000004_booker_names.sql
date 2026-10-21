-- Milestone 9, T9.8: booker first names on booked slots (SPEC §6 "Access", §10 2026-10-19 and 2026-10-20).
-- get_availability gains a booker_first_name column. A function's result columns can't change with
-- create or replace (RESEARCH M9 "Shipping DB changes while production is live"), so it is dropped and created
-- again in this one transaction (no moment without it) and re-granted. The deployed frontend ignores the
-- extra column.

drop function public.get_availability(date, uuid);

create function public.get_availability(p_date date, p_court_id uuid default null)
returns table (
  court_id           uuid,
  slot_start         timestamptz,
  slot_end           timestamptz,
  price              numeric,
  status             text,
  -- The first word of the booking's contact name (at most 20 characters) on a booked slot, else null.
  -- Public: never the email, phone, the rest of the name or the reference.
  booker_first_name  text
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
  ),
  cells as (
    select
      c.id as court_id,
      c.sport,
      c.sort_order,
      c.name,
      sl.slot_start,
      sl.slot,
      bk.guest_name,
      case
        when upper(sl.slot) <= now() then 'past'  -- already over
        when bk.guest_name is not null then 'booked'
        when exists (
          select 1 from public.blackouts bo
          where (bo.court_id is null or bo.court_id = c.id)
            and tstzrange(bo.starts_at, bo.ends_at) && sl.slot
        ) then 'blackout'
        when sl.slot_start <= now() then 'past'   -- in progress and free: not bookable online (walk-ins may take it)
        else 'free'
      end as status
    from public.courts c
    cross join slots sl
    -- The active booking on this slot, if any (the exclusion constraint allows at most one).
    left join lateral (
      select b.guest_name
      from public.bookings b
      where b.court_id = c.id
        and b.during && sl.slot
        and b.status in ('pending_payment', 'payment_submitted', 'confirmed')
        and not (b.status = 'pending_payment' and b.expires_at <= now())
      limit 1
    ) bk on true
    where c.is_active
      and (p_court_id is null or c.id = p_court_id)
  )
  select
    x.court_id,
    x.slot_start,
    upper(x.slot),
    private.slot_price(x.court_id, x.slot_start),
    x.status,
    case when x.status = 'booked' then nullif(left(split_part(btrim(x.guest_name), ' ', 1), 20), '') end
  from cells x
  order by array_position((select vs.sport_order from public.venue_settings vs), x.sport),
           x.sort_order, x.name, x.slot_start;
$$;

revoke all on function public.get_availability(date, uuid) from public, anon, authenticated;
grant execute on function public.get_availability(date, uuid) to anon, authenticated;
