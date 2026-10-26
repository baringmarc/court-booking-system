-- T10.4: get_availability returns a block_key per slot, so the grid can merge consecutive slots of the same
-- booking, open play session or blackout into one cell (T10.5, RESEARCH M10 "Merged blocks on the slot grids").
--   booked:    the first 16 hex characters of sha256('booking:' || id). Stable across refetches, and it can't be
--              turned back into the booking id (which stays private, like the reference code).
--   open_play: the session id (already public).
--   blackout:  'blackout:' || the lowest overlapping blackout id (blackouts are public). An all-courts blackout
--              gives every court the same key.
--   free, past and in-progress free slots: null.
-- Expand only: a new result column, every other column and the status rules unchanged, so the live frontend keeps
-- working. A function can't gain a result column in place, so drop and recreate in this transaction and re-grant
-- (RESEARCH M9 "Shipping DB changes while production is live").

drop function public.get_availability(date, uuid);

create function public.get_availability(p_date date, p_court_id uuid default null)
returns table (
  court_id              uuid,
  slot_start            timestamptz,
  slot_end              timestamptz,
  price                 numeric,
  status                text,
  booker_first_name     text,
  open_play_session_id  uuid,
  block_key             text
)
language sql
stable
security definer
set search_path = ''
as $$
  with open_range as (
    select private.operating_day_range(p_date) as r
    where private.in_booking_window(p_date)
  ),
  slots as (
    select s as slot_start, tstzrange(s, s + interval '1 hour') as slot
    from open_range o,
         generate_series(lower(o.r), upper(o.r) - interval '1 hour', interval '1 hour') as s
    where o.r is not null
  ),
  cells as (
    select
      c.id as court_id,
      c.sport,
      c.sort_order,
      c.name,
      sl.slot_start,
      sl.slot,
      bk.id as booking_id,
      bk.guest_name,
      bl.id as blackout_id,
      op.session_id,
      case
        when upper(sl.slot) <= now() then 'past'  -- already over
        when bk.guest_name is not null then 'booked'
        when bl.id is not null then 'blackout'
        when op.session_id is not null then 'open_play'
        when sl.slot_start <= now() then 'past'   -- in progress and free: not bookable online (walk-ins may take it)
        else 'free'
      end as status
    from public.courts c
    cross join slots sl
    -- The active booking on this slot, if any (the exclusion constraint allows at most one).
    left join lateral (
      select b.id, b.guest_name
      from public.bookings b
      where b.court_id = c.id
        and b.during && sl.slot
        and b.status in ('pending_payment', 'payment_submitted', 'confirmed')
        and not (b.status = 'pending_payment' and b.expires_at <= now())
      limit 1
    ) bk on true
    -- A blackout on this slot, if any. Blackouts may overlap; the lowest id gives a stable key.
    left join lateral (
      select bo.id
      from public.blackouts bo
      where (bo.court_id is null or bo.court_id = c.id)
        and tstzrange(bo.starts_at, bo.ends_at) && sl.slot
      order by bo.id
      limit 1
    ) bl on true
    -- The open play session on this slot, if any (open_play_courts_no_overlap allows at most one).
    left join lateral (
      select oc.session_id
      from public.open_play_courts oc
      where oc.court_id = c.id and oc.during && sl.slot
      limit 1
    ) op on true
    where c.is_active
      and (p_court_id is null or c.id = p_court_id)
  )
  select
    x.court_id,
    x.slot_start,
    upper(x.slot),
    private.slot_price(x.court_id, x.slot_start, extract(dow from p_date)::smallint),
    x.status,
    case when x.status = 'booked' then nullif(left(split_part(btrim(x.guest_name), ' ', 1), 20), '') end,
    case when x.status = 'open_play' then x.session_id end,
    case x.status
      when 'booked' then left(encode(sha256(convert_to('booking:' || x.booking_id::text, 'UTF8')), 'hex'), 16)
      when 'open_play' then x.session_id::text
      when 'blackout' then 'blackout:' || x.blackout_id::text
    end
  from cells x
  order by array_position((select vs.sport_order from public.venue_settings vs), x.sport),
           x.sort_order, x.name, x.slot_start;
$$;

revoke all on function public.get_availability(date, uuid) from public, anon, authenticated;
grant execute on function public.get_availability(date, uuid) to anon, authenticated;
