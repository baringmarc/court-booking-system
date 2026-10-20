-- Milestone 9, T9.3: sport order and court order (SPEC §6, §10; RESEARCH M9 "Sport order", "Court order and deletion").
-- Additive only, so the deployed frontend keeps working (RESEARCH M9 "Shipping DB changes while production is live").

-- ---------------------------------------------------------------------------
-- 1. Sport order: every sport exactly once. Defaults to the enum order, which is the order used until now.
--    Admins edit it through the existing venue_settings UPDATE policy; everyone can read it, like other settings.
-- ---------------------------------------------------------------------------
alter table public.venue_settings
  add column sport_order public.sport[] not null default enum_range(null::public.sport),
  add constraint venue_settings_sport_order_complete check (
    cardinality(sport_order) = cardinality(enum_range(null::public.sport))
    and sport_order @> enum_range(null::public.sport)
  );

-- ---------------------------------------------------------------------------
-- 2. Court order within a sport: swap with the neighbour and renumber that sport 0..n-1.
--    security definer with an explicit admin check, like the other admin RPCs.
-- ---------------------------------------------------------------------------
create function public.move_court(p_court_id uuid, p_direction smallint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_sport public.sport;
  v_ids   uuid[];
  v_pos   integer;
  v_other integer;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can reorder courts.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_court_id is null or p_direction is null or p_direction not in (-1, 1) then
    raise exception 'Choose a court and a direction.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  select c.sport into v_sport from public.courts c where c.id = p_court_id;
  if not found then
    raise exception 'That court does not exist.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Lock the sport's courts so two admins reordering at once can't interleave.
  perform 1 from public.courts c where c.sport = v_sport order by c.id for update;

  -- Current order (archived courts included: the admin list shows them too).
  select array_agg(c.id order by c.sort_order, c.name, c.id) into v_ids
  from public.courts c where c.sport = v_sport;

  v_pos := array_position(v_ids, p_court_id);
  v_other := v_pos + p_direction;
  if v_other between 1 and cardinality(v_ids) then
    v_ids[v_pos] := v_ids[v_other];
    v_ids[v_other] := p_court_id;
  end if;

  -- Renumber 0..n-1 in the new order (also tidies duplicate or sparse numbers from the old number field).
  update public.courts c
  set sort_order = o.ord - 1
  from unnest(v_ids) with ordinality as o(id, ord)
  where c.id = o.id and c.sort_order is distinct from o.ord - 1;
end;
$$;

revoke all on function public.move_court(uuid, smallint) from public, anon, authenticated;
grant execute on function public.move_court(uuid, smallint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. get_availability follows the sport order. Same result columns, so create or replace keeps the grants.
--    Body unchanged from 20261017040615 except the final order by.
-- ---------------------------------------------------------------------------
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
  order by array_position((select vs.sport_order from public.venue_settings vs), c.sport),
           c.sort_order, c.name, sl.slot_start;
$$;
