-- T17.11: route booking-time reads through the court's complete effective schedule.
-- Activation remains a server-owned release switch; inactive venues keep exact legacy behavior.

create function private.effective_open_periods(p_venue_id uuid, p_court_id uuid, p_day date)
returns setof tstzrange
language plpgsql stable set search_path = '' as $$
declare
  v_timezone text;
  v_active boolean;
  v_mode text := 'inherit';
begin
  if p_venue_id is null or p_day is null then return; end if;
  select vs.timezone into v_timezone from public.venue_settings vs where vs.venue_id = p_venue_id;
  if v_timezone is null then return; end if;
  if p_court_id is not null and not exists (
    select 1 from public.courts c where c.id = p_court_id and c.venue_id = p_venue_id
  ) then return; end if;

  select s.schedule_v2_active into v_active
  from public.venue_schedule_state s where s.venue_id = p_venue_id;
  if coalesce(v_active, false) then
    if p_court_id is not null then
      select m.schedule_mode into v_mode
      from public.court_schedule_modes m where m.venue_id = p_venue_id and m.court_id = p_court_id;
    end if;
    if v_mode = 'custom' then
      return query
      select pg_catalog.tstzrange(
        (p_day::timestamp + pg_catalog.make_interval(mins => p.start_minute::integer)) at time zone v_timezone,
        (p_day::timestamp + pg_catalog.make_interval(mins => p.end_minute::integer)) at time zone v_timezone,
        '[)')
      from public.court_open_periods p
      where p.venue_id = p_venue_id and p.court_id = p_court_id and p.day_of_week = extract(dow from p_day)::smallint
      order by p.start_minute;
    else
      return query
      select pg_catalog.tstzrange(
        (p_day::timestamp + pg_catalog.make_interval(mins => p.start_minute::integer)) at time zone v_timezone,
        (p_day::timestamp + pg_catalog.make_interval(mins => p.end_minute::integer)) at time zone v_timezone,
        '[)')
      from public.venue_open_periods p
      where p.venue_id = p_venue_id and p.day_of_week = extract(dow from p_day)::smallint
      order by p.start_minute;
    end if;
  else
    return query
    select pg_catalog.tstzrange(
      (p_day + oh.open_time) at time zone v_timezone,
      (p_day + case when oh.close_time <= oh.open_time then 1 else 0 end + oh.close_time) at time zone v_timezone,
      '[)')
    from public.operating_hours oh
    where oh.venue_id = p_venue_id and oh.day_of_week = extract(dow from p_day)::smallint and not oh.is_closed;
  end if;
end;
$$;
revoke all on function private.effective_open_periods(uuid, uuid, date) from public, anon, authenticated;

-- The venue-only overload remains for consumers that do not have a court context.
create or replace function private.operating_day_of(p_venue uuid, p_ts timestamptz)
returns date language plpgsql stable set search_path = '' as $$
declare
  v_local_day date;
  v_day date;
begin
  if p_venue is null or p_ts is null then return null; end if;
  v_local_day := (p_ts at time zone private.venue_tz(p_venue))::date;
  for v_day in select d from (values (v_local_day), (v_local_day - 1)) candidate(d) loop
    if exists (
      select 1 from private.effective_open_periods(p_venue, null, v_day) r where r @> p_ts
    ) then return v_day; end if;
  end loop;
  return null;
end;
$$;

-- Booking-time ownership must resolve against this court's custom periods when present.
create function private.operating_day_of(p_venue uuid, p_court_id uuid, p_ts timestamptz)
returns date language plpgsql stable set search_path = '' as $$
declare
  v_local_day date;
  v_day date;
begin
  if p_court_id is null then return private.operating_day_of(p_venue, p_ts); end if;
  if p_venue is null or p_ts is null then return null; end if;
  v_local_day := (p_ts at time zone private.venue_tz(p_venue))::date;
  for v_day in select d from (values (v_local_day), (v_local_day - 1)) candidate(d) loop
    if exists (
      select 1 from private.effective_open_periods(p_venue, p_court_id, v_day) r where r @> p_ts
    ) then return v_day; end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.operating_day_of(uuid, uuid, timestamptz) from public, anon, authenticated;

create function private.operating_today(p_venue uuid, p_court_id uuid)
returns date language sql stable set search_path = '' as $$
  select coalesce(private.operating_day_of(p_venue, p_court_id, now()), private.local_today(p_venue))
$$;
revoke all on function private.operating_today(uuid, uuid) from public, anon, authenticated;

create function private.in_booking_window(p_venue uuid, p_court_id uuid, p_day date)
returns boolean language sql stable set search_path = '' as $$
  select p_day between private.operating_today(p_venue, p_court_id)
                   and private.operating_today(p_venue, p_court_id)
                       + (select booking_window_days from public.venue_settings where venue_id = p_venue)
$$;
revoke all on function private.in_booking_window(uuid, uuid, date) from public, anon, authenticated;

create or replace function private.slot_price(p_court_id uuid, p_slot_start timestamptz)
returns numeric language sql stable set search_path = '' as $$
  select private.slot_price(c.id, p_slot_start,
           coalesce(extract(dow from private.operating_day_of(c.venue_id, c.id, p_slot_start))::smallint,
                    (private.local_dow_hour(c.venue_id, p_slot_start)).dow))
  from public.courts c where c.id = p_court_id
$$;

create or replace function private.range_price(p_court_id uuid, p_during tstzrange)
returns numeric language sql stable set search_path = '' as $$
  with d as (
    select coalesce(extract(dow from private.operating_day_of(c.venue_id, c.id, lower(p_during)))::smallint,
                    (private.local_dow_hour(c.venue_id, lower(p_during))).dow) as dow
    from public.courts c where c.id = p_court_id
  )
  select sum(private.slot_price(p_court_id, s, d.dow))
  from d, generate_series(lower(p_during), upper(p_during) - interval '1 hour', interval '1 hour') as s
$$;

create or replace function private.validate_booking_slot(p_court_id uuid, p_start timestamptz, p_slots integer, p_walk_in boolean)
returns tstzrange language plpgsql volatile set search_path = '' as $$
declare
  v_tz text;
  v_settings public.venue_settings;
  v_court public.courts;
  v_during tstzrange;
  v_local_start timestamp;
  v_day date;
  v_open tstzrange;
begin
  if p_court_id is null or p_start is null or p_slots is null or p_slots < 1 or p_slots > 24 then
    raise exception 'Choose a court, a start time and at least one slot.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  select * into v_court from public.courts c where c.id = p_court_id;
  if not found then
    raise exception 'That court does not exist.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if not v_court.is_active then
    raise exception 'This court is not available for booking.' using errcode = 'P0001', hint = 'court_inactive';
  end if;
  select * into v_settings from public.venue_settings vs where vs.venue_id = v_court.venue_id;
  v_tz := v_settings.timezone;
  v_during := tstzrange(p_start, p_start + make_interval(hours => p_slots));
  v_local_start := p_start at time zone v_tz;
  if date_trunc('hour', v_local_start) <> v_local_start then
    raise exception 'Bookings must start on the hour.' using errcode = 'P0001', hint = 'not_aligned';
  end if;
  if (not p_walk_in and p_start <= now()) or (p_walk_in and p_start + interval '1 hour' <= now()) then
    raise exception 'That time has already started. Please pick a later slot.' using errcode = 'P0001', hint = 'slot_started';
  end if;

  v_day := private.operating_day_of(v_court.venue_id, p_court_id, p_start);
  if v_day is null then
    raise exception 'That time is outside opening hours.' using errcode = 'P0001', hint = 'outside_hours';
  end if;
  if not p_walk_in and not private.in_booking_window(v_court.venue_id, p_court_id, v_day) then
    raise exception 'Bookings can be made up to % days ahead.', v_settings.booking_window_days
      using errcode = 'P0001', hint = 'outside_window';
  end if;
  select r into v_open
  from private.effective_open_periods(v_court.venue_id, p_court_id, v_day) r
  where r @> p_start
  limit 1;
  if v_open is null or not v_open @> v_during then
    if upper(v_during) > (v_day + 1)::timestamp at time zone v_tz then
      raise exception 'A booking must fit within one day''s opening hours.' using errcode = 'P0001', hint = 'multi_day';
    end if;
    raise exception 'That time is outside opening hours.' using errcode = 'P0001', hint = 'outside_hours';
  end if;
  if exists (
    select 1 from public.blackouts bo where bo.venue_id = v_court.venue_id
      and (bo.court_id is null or bo.court_id = p_court_id)
      and tstzrange(bo.starts_at, bo.ends_at) && v_during
  ) then
    raise exception 'That time is blocked for maintenance or an event.' using errcode = 'P0001', hint = 'blackout';
  end if;
  if exists (select 1 from public.open_play_courts oc where oc.court_id = p_court_id and oc.during && v_during) then
    raise exception 'That time is reserved for open play.' using errcode = 'P0001', hint = 'open_play';
  end if;
  return v_during;
end;
$$;

-- Keep public RPC signatures and status/block-key behavior. Each court contributes only its own effective periods.
create or replace function public.get_availability(p_date date, p_court_id uuid default null::uuid,
  p_venue_slug text default null::text)
returns table(court_id uuid, slot_start timestamptz, slot_end timestamptz, price numeric, status text,
              booker_first_name text, open_play_session_id uuid, block_key text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_venue uuid;
begin
  if p_court_id is not null then
    select c.venue_id into v_venue from public.courts c where c.id = p_court_id;
    if v_venue is null then return; end if;
    perform private.assert_venue_active(v_venue);
  else
    v_venue := private.resolve_public_venue(p_venue_slug);
  end if;

  return query
  with court_periods as (
    select c.id as court_id, c.sport, c.sort_order, c.name, r.period
    from public.courts c
    cross join lateral private.effective_open_periods(v_venue, c.id, p_date) r(period)
    where c.is_active and c.venue_id = v_venue and (p_court_id is null or c.id = p_court_id)
      and private.in_booking_window(v_venue, c.id, p_date)
  ), slots as (
    select cp.court_id, cp.sport, cp.sort_order, cp.name, s as slot_start,
           tstzrange(s, s + interval '1 hour') as slot
    from court_periods cp,
         generate_series(lower(cp.period), upper(cp.period) - interval '1 hour', interval '1 hour') as s
  ), cells as (
    select sl.*, bk.id as booking_id, bk.guest_name, bl.id as blackout_id, op.session_id,
      case
        when upper(sl.slot) <= now() then 'past'
        when bk.guest_name is not null then 'booked'
        when bl.id is not null then 'blackout'
        when op.session_id is not null then 'open_play'
        when sl.slot_start <= now() then 'past'
        else 'free'
      end as status
    from slots sl
    left join lateral (
      select b.id, b.guest_name from public.bookings b
      where b.court_id = sl.court_id and b.during && sl.slot and b.status in ('pending_payment','payment_submitted','confirmed')
        and not (b.status = 'pending_payment' and b.expires_at <= now()) limit 1
    ) bk on true
    left join lateral (
      select bo.id from public.blackouts bo
      where bo.venue_id = v_venue and (bo.court_id is null or bo.court_id = sl.court_id)
        and tstzrange(bo.starts_at, bo.ends_at) && sl.slot order by bo.id limit 1
    ) bl on true
    left join lateral (
      select oc.session_id from public.open_play_courts oc
      where oc.court_id = sl.court_id and oc.during && sl.slot limit 1
    ) op on true
  )
  select x.court_id, x.slot_start, upper(x.slot),
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
  order by array_position((select vs.sport_order from public.venue_settings vs where vs.venue_id = v_venue), x.sport),
           x.sort_order, x.name, x.slot_start;
end;
$$;

comment on function private.effective_open_periods(uuid, uuid, date) is
  'Returns complete local operating-day intervals for a court, using legacy hours until server activation.';
comment on function private.validate_booking_slot(uuid, timestamptz, integer, boolean) is
  'Validates a booking wholly contained in one effective period and preserves blackout/open-play guards.';
