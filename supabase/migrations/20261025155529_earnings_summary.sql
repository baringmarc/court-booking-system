-- T10.6: get_earnings(p_from, p_to), the admin earnings summary for the dashboard (T10.7) and CSV export (T10.8).
-- RESEARCH M10 "Earnings":
--   * Money came in when its payment was approved: payments.reviewed_at, for proofs (review_payment), PayMongo (the
--     webhook RPC) and walk-ins (create_walk_in) alike. No received_at column. Counted by venue calendar date.
--   * Refunds due are PayMongo payments stored as rejected (late or wrong amount). Rejected proofs are not money.
--   * Hours are counted by operating day (private.operating_day_range), so 1 AM on an overnight Saturday is
--     Saturday's. Per active court: open hours; blackout hours (the union of that court's and all-courts blackouts,
--     clipped to the day); sold hours (confirmed bookings of any source); open play hours, kept apart from sold.
--     Occupancy = sold / (open - blackout) is worked out by the client.
-- Security definer (the operating-day helpers are private) with an explicit admin check, like the other admin RPCs.
-- Expand only: a new function, nothing else changes.

create function public.get_earnings(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz         text := private.venue_tz();
  v_days       integer;
  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_result     jsonb;
begin
  if not private.is_admin() then
    raise exception 'Only staff can see earnings.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from >= 366 then
    raise exception 'Choose a start and end date, up to 366 days apart.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  v_days := p_to - p_from + 1;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;
  v_prev_start := (p_from - v_days)::timestamp at time zone v_tz;

  with
  -- Approved payments in this period and the one just before it.
  paid as (
    select p.method, p.amount, p.reviewed_at, (p.reviewed_at at time zone v_tz)::date as day
    from public.payments p
    where p.review_status = 'approved' and p.reviewed_at >= v_prev_start and p.reviewed_at < v_end
  ),
  cur as (select * from paid where reviewed_at >= v_start),
  prev as (select * from paid where reviewed_at < v_start),
  dates as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  ),
  open_days as (
    select dt.day, private.operating_day_range(dt.day) as r from dates dt
  ),
  courts as (
    select c.id, c.name, c.sport, c.sort_order,
           array_position((select vs.sport_order from public.venue_settings vs), c.sport) as sport_pos
    from public.courts c
    where c.is_active
  ),
  -- One row per active court and open operating day, with that day's hours in each category.
  hours as (
    select
      c.id as court_id,
      od.day,
      extract(epoch from upper(od.r) - lower(od.r)) / 3600 as open_h,
      coalesce((
        select sum(extract(epoch from upper(x) - lower(x))) / 3600
        from unnest((
          select range_agg(tstzrange(bo.starts_at, bo.ends_at) * od.r)
          from public.blackouts bo
          where (bo.court_id is null or bo.court_id = c.id) and tstzrange(bo.starts_at, bo.ends_at) && od.r
        )) as x
      ), 0) as blackout_h,
      coalesce((
        select sum(extract(epoch from upper(b.during * od.r) - lower(b.during * od.r))) / 3600
        from public.bookings b
        where b.court_id = c.id and b.status = 'confirmed' and b.during && od.r
      ), 0) as sold_h,
      coalesce((
        select sum(extract(epoch from upper(oc.during * od.r) - lower(oc.during * od.r))) / 3600
        from public.open_play_courts oc
        where oc.court_id = c.id and oc.during && od.r
      ), 0) as open_play_h
    from courts c
    cross join open_days od
    where od.r is not null
  ),
  per_court as (
    select c.id, c.name, c.sport, c.sort_order, c.sport_pos,
           coalesce(sum(h.open_h), 0) as open_h,
           coalesce(sum(h.blackout_h), 0) as blackout_h,
           coalesce(sum(h.sold_h), 0) as sold_h,
           coalesce(sum(h.open_play_h), 0) as open_play_h
    from courts c
    left join hours h on h.court_id = c.id
    group by c.id, c.name, c.sport, c.sort_order, c.sport_pos
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'timezone', v_tz,
    'collected', (
      select jsonb_build_object(
        'total', coalesce(sum(m.amount), 0),
        'count', coalesce(sum(m.n), 0),
        'by_method', coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'amount', m.amount, 'count', m.n) order by m.method), '[]'::jsonb))
      from (select method, sum(amount) as amount, count(*) as n from cur group by method) m
    ),
    'previous', (
      select jsonb_build_object(
        'from', p_from - v_days,
        'to', p_from - 1,
        'total', coalesce(sum(m.amount), 0),
        'count', coalesce(sum(m.n), 0),
        'by_method', coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'amount', m.amount, 'count', m.n) order by m.method), '[]'::jsonb))
      from (select method, sum(amount) as amount, count(*) as n from prev group by method) m
    ),
    'refunds_due', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(p.amount), 0))
      from public.payments p
      where p.method = 'paymongo' and p.review_status = 'rejected' and p.reviewed_at >= v_start and p.reviewed_at < v_end
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'date', dt.day,
        'collected', coalesce((select sum(cur.amount) from cur where cur.day = dt.day), 0),
        'sold_hours', round(coalesce((select sum(h.sold_h) from hours h where h.day = dt.day), 0), 2)
      ) order by dt.day)
      from dates dt
    ),
    'courts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'court_id', pc.id, 'name', pc.name, 'sport', pc.sport,
        'open_hours', round(pc.open_h, 2), 'blackout_hours', round(pc.blackout_h, 2),
        'sold_hours', round(pc.sold_h, 2), 'open_play_hours', round(pc.open_play_h, 2)
      ) order by pc.sport_pos, pc.sort_order, pc.name), '[]'::jsonb)
      from per_court pc
    ),
    'sports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'sport', s.sport,
        'open_hours', round(s.open_h, 2), 'blackout_hours', round(s.blackout_h, 2),
        'sold_hours', round(s.sold_h, 2), 'open_play_hours', round(s.open_play_h, 2)
      ) order by s.sport_pos), '[]'::jsonb)
      from (
        select pc.sport, min(pc.sport_pos) as sport_pos, sum(pc.open_h) as open_h, sum(pc.blackout_h) as blackout_h,
               sum(pc.sold_h) as sold_h, sum(pc.open_play_h) as open_play_h
        from per_court pc
        group by pc.sport
      ) s
    ),
    'coming_up', (
      select jsonb_build_object('count', count(*), 'value', coalesce(sum(b.total_amount), 0))
      from public.bookings b
      where b.status = 'confirmed' and lower(b.during) > now()
    )
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_earnings(date, date) from public, anon, authenticated;
grant execute on function public.get_earnings(date, date) to authenticated;
