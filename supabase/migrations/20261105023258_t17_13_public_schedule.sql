-- Public schedule exposes opening periods, never the underlying configuration or bookings.
create function public.get_public_schedule(p_venue_slug text)
returns table(court_id uuid, operating_date date, period_start timestamptz, period_end timestamptz, booking_start date, booking_end date)
language plpgsql stable security definer set search_path = '' as $$
declare v_venue uuid;
begin
  v_venue := private.resolve_public_venue(p_venue_slug);
  return query
  select c.id, d.day::date, lower(p.r), upper(p.r), w.first_day, w.first_day + vs.booking_window_days
  from public.courts c
  join public.venue_settings vs on vs.venue_id = c.venue_id
  cross join lateral (select private.operating_today(v_venue, c.id) as first_day) w
  cross join lateral generate_series(w.first_day::timestamp, (w.first_day + vs.booking_window_days)::timestamp, interval '1 day') d(day)
  cross join lateral private.effective_open_periods(v_venue, c.id, d.day::date) p(r)
  where c.venue_id = v_venue and c.is_active
  order by c.id, d.day, lower(p.r);
end $$;
revoke all on function public.get_public_schedule(text) from public, anon, authenticated;
grant execute on function public.get_public_schedule(text) to anon, authenticated;
