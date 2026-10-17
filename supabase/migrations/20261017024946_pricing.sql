-- Milestone 3: venue-timezone helpers and server-side pricing (SPEC §5.4, RESEARCH "Slot math").
-- Internal helpers: called only from security definer RPCs, never by clients.
-- Day of week / hour are always computed in the venue timezone, never the session TimeZone (UTC).

create function private.venue_tz()
returns text
language sql
stable
set search_path = ''
as $$
  select timezone from public.venue_settings;
$$;

-- The venue-local calendar day [d 00:00, d+1 00:00) as instants. Operating hours are applied separately.
create function private.local_day_bounds(p_day date)
returns tstzrange
language sql
stable
set search_path = ''
as $$
  select tstzrange(
    p_day::timestamp at time zone private.venue_tz(),
    (p_day + 1)::timestamp at time zone private.venue_tz()
  );
$$;

-- day_of_week (0 = Sunday) and hour of an instant, in the venue timezone.
create function private.local_dow_hour(p_ts timestamptz, out dow smallint, out hour smallint)
language sql
stable
set search_path = ''
as $$
  select extract(dow from p_ts at time zone private.venue_tz())::smallint,
         extract(hour from p_ts at time zone private.venue_tz())::smallint;
$$;

-- Price of the 1-hour slot starting at p_slot_start: the court_rates override, else the default rate.
-- Returns null for an unknown court.
create function private.slot_price(p_court_id uuid, p_slot_start timestamptz)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(r.price, c.default_hourly_rate)
  from public.courts c
  cross join private.local_dow_hour(p_slot_start) l
  left join public.court_rates r
    on r.court_id = c.id and r.day_of_week = l.dow and r.start_hour = l.hour
  where c.id = p_court_id;
$$;

-- Total price of a slot-aligned range: the sum of its 1-hour slots. Callers validate alignment first.
create function private.range_price(p_court_id uuid, p_during tstzrange)
returns numeric
language sql
stable
set search_path = ''
as $$
  select sum(private.slot_price(p_court_id, s))
  from generate_series(lower(p_during), upper(p_during) - interval '1 hour', interval '1 hour') as s;
$$;

revoke all on function private.venue_tz() from public, anon, authenticated;
revoke all on function private.local_day_bounds(date) from public, anon, authenticated;
revoke all on function private.local_dow_hour(timestamptz) from public, anon, authenticated;
revoke all on function private.slot_price(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.range_price(uuid, tstzrange) from public, anon, authenticated;
