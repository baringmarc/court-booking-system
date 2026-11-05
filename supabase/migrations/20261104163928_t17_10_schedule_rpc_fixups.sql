-- Keep JSON price output canonical (e.g. 350 rather than the numeric column scale 350.00).
create or replace function public.get_schedule(p_venue_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_revision integer;
  v_result jsonb;
begin
  if not private.is_venue_admin(p_venue_id) then
    raise exception 'You cannot read this venue schedule.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  select s.schedule_revision into v_revision
  from public.venue_schedule_state s where s.venue_id = p_venue_id;
  if not found then
    raise exception 'Venue schedule not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  select pg_catalog.jsonb_build_object(
    'venue_id', p_venue_id,
    'schedule_revision', v_revision,
    'venue_periods', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'day_of_week', p.day_of_week, 'start_minute', p.start_minute, 'end_minute', p.end_minute
      ) order by p.day_of_week, p.start_minute, p.id)
      from public.venue_open_periods p where p.venue_id = p_venue_id
    ), '[]'::jsonb),
    'courts', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'court_id', c.id,
        'schedule_mode', coalesce(m.schedule_mode, 'inherit'),
        'schedule_revision', coalesce(m.schedule_revision, 0),
        'periods', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', p.id, 'day_of_week', p.day_of_week, 'start_minute', p.start_minute, 'end_minute', p.end_minute
          ) order by p.day_of_week, p.start_minute, p.id)
          from public.court_open_periods p
          where p.venue_id = c.venue_id and p.court_id = c.id
            and coalesce(m.schedule_mode, 'inherit') = 'custom'
        ), '[]'::jsonb),
        'rates', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'day_of_week', r.day_of_week, 'start_hour', r.start_hour, 'price', pg_catalog.trim_scale(r.price)
          ) order by r.day_of_week, r.start_hour)
          from public.court_rates r where r.venue_id = c.venue_id and r.court_id = c.id
        ), '[]'::jsonb)
      ) order by c.sort_order, c.name, c.id)
      from public.courts c
      left join public.court_schedule_modes m on m.venue_id = c.venue_id and m.court_id = c.id
      where c.venue_id = p_venue_id
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end $$;
