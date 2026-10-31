-- T13.5: drop the single-venue default. A public call names its venue (a slug, or a court that belongs to one).
-- Deploy order: only after the T13.3 frontend is live (it always sends a slug); the old two-argument
-- get_availability(date, uuid) wrapper is dropped here, so an older frontend would get 'venue_required'.

-- 1. resolve_public_venue: the slug is required; no default venue, no "second venue is active" guard.
-- (CREATE OR REPLACE cannot remove a parameter default, so drop first.)
drop function private.resolve_public_venue(text);

create function private.resolve_public_venue(p_slug text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  v_venue uuid;
begin
  if p_slug is null then
    raise exception 'Say which venue you mean.' using errcode = 'P0001', hint = 'venue_required';
  end if;
  select v.id into v_venue from public.venues v where v.slug = p_slug;
  if v_venue is null then
    raise exception 'Venue not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
  perform private.assert_venue_active(v_venue);
  return v_venue;
end;
$$;

-- 2. get_availability: same body, but p_court_id and p_venue_slug default to null (the frontend sends only the slug).
drop function public.get_availability(date, uuid);
drop function public.get_availability(date, uuid, text);

create function public.get_availability(p_date date, p_court_id uuid default null, p_venue_slug text default null)
returns table(court_id uuid, slot_start timestamptz, slot_end timestamptz, price numeric, status text,
              booker_first_name text, open_play_session_id uuid, block_key text)
language plpgsql stable security definer set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_venue uuid;
begin
  if p_court_id is not null then
    select c.venue_id into v_venue from public.courts c where c.id = p_court_id;
    if v_venue is null then
      return;
    end if;
    perform private.assert_venue_active(v_venue);
  else
    v_venue := private.resolve_public_venue(p_venue_slug);
  end if;

  return query
  with open_range as (
    select private.operating_day_range(v_venue, p_date) as r
    where private.in_booking_window(v_venue, p_date)
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
      where bo.venue_id = c.venue_id
        and (bo.court_id is null or bo.court_id = c.id)
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
      and c.venue_id = v_venue
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
  order by array_position((select vs.sport_order from public.venue_settings vs where vs.venue_id = v_venue), x.sport),
           x.sort_order, x.name, x.slot_start;
end;
$function$;

revoke execute on function public.get_availability(date, uuid, text) from public;
grant execute on function public.get_availability(date, uuid, text) to anon, authenticated, service_role;

-- 3. Reserved slugs match docs/PLATFORM.md §3 (adds help and blog; plotline stays reserved and is now documented).
alter table public.venues drop constraint venues_slug_not_reserved;
alter table public.venues add constraint venues_slug_not_reserved check (
  slug <> all (array['www', 'app', 'api', 'admin', 'mail', 'demo', 'plotline', 'support', 'status', 'staging', 'help', 'blog'])
);
