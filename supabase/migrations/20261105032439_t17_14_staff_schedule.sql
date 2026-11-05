create function public.get_staff_schedule(p_venue_id uuid, p_date date)
returns table(court_id uuid, operating_date date, period_start timestamptz, period_end timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_venue_admin(p_venue_id) then
    raise exception 'You cannot read this venue schedule.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  return query
  select c.id, p_date, lower(p.period), upper(p.period)
  from public.courts c
  cross join lateral private.effective_open_periods(p_venue_id, c.id, p_date) p(period)
  where c.venue_id = p_venue_id and c.is_active
  order by c.id, lower(p.period);
end $$;
revoke all on function public.get_staff_schedule(uuid, date) from public, anon, authenticated;
grant execute on function public.get_staff_schedule(uuid, date) to authenticated;
