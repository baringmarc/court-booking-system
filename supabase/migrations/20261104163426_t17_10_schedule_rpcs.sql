-- T17.10: venue-scoped reads, impact preview and atomic schedule editing.

-- Direct period/mode writes would bypass revision checks and atomic replacement.
revoke insert, update, delete on public.venue_open_periods, public.court_schedule_modes,
  public.court_open_periods from authenticated;

create function private.schedule_draft_periods(p_draft jsonb, p_court_id uuid)
returns table(day_of_week smallint, start_minute smallint, end_minute smallint)
language sql stable set search_path = '' as $$
  with court as (
    select c->>'schedule_mode' as schedule_mode, c->'periods' as periods
    from pg_catalog.jsonb_array_elements(coalesce(p_draft->'courts', '[]'::jsonb)) c
    where c->>'court_id' = p_court_id::text
  ), source as (
    select case when (select schedule_mode from court) = 'custom'
      then coalesce((select periods from court), '[]'::jsonb)
      else coalesce(p_draft->'venue_periods', '[]'::jsonb) end as periods
  )
  select (p->>'day_of_week')::smallint, (p->>'start_minute')::smallint, (p->>'end_minute')::smallint
  from source cross join lateral pg_catalog.jsonb_array_elements(source.periods) p
$$;
revoke all on function private.schedule_draft_periods(jsonb, uuid) from public, anon, authenticated;

create function private.schedule_range_allowed(p_venue_id uuid, p_periods jsonb, p_during tstzrange)
returns boolean language sql stable set search_path = '' as $$
  with venue as (
    select vs.timezone from public.venue_settings vs where vs.venue_id = p_venue_id
  ), periods as (
    select (p->>'day_of_week')::smallint as day_of_week,
           (p->>'start_minute')::integer as start_minute,
           (p->>'end_minute')::integer as end_minute
    from pg_catalog.jsonb_array_elements(coalesce(p_periods, '[]'::jsonb)) p
  ), local_bounds as (
    select (lower(p_during) at time zone venue.timezone)::date - 1 as first_day,
           (upper(p_during) at time zone venue.timezone)::date as last_day,
           venue.timezone
    from venue where not lower_inf(p_during) and not upper_inf(p_during)
  ), candidate_days as (
    select (d.day_value)::date as opening_day, b.timezone
    from local_bounds b
    cross join lateral pg_catalog.generate_series(b.first_day::timestamp, b.last_day::timestamp, interval '1 day') d(day_value)
  )
  select exists (
    select 1 from periods p join candidate_days d
      on extract(dow from d.opening_day)::smallint = p.day_of_week
    where p_during <@ tstzrange(
      ((d.opening_day::timestamp + p.start_minute * interval '1 minute') at time zone d.timezone),
      ((d.opening_day::timestamp + p.end_minute * interval '1 minute') at time zone d.timezone), '[)')
  )
$$;
revoke all on function private.schedule_range_allowed(uuid, jsonb, tstzrange) from public, anon, authenticated;

create function public.get_schedule(p_venue_id uuid)
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
            'day_of_week', r.day_of_week, 'start_hour', r.start_hour, 'price', r.price
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
revoke all on function public.get_schedule(uuid) from public, anon;
grant execute on function public.get_schedule(uuid) to authenticated;

create function public.preview_schedule_impact(
  p_venue_id uuid, p_draft jsonb, p_from timestamptz, p_to timestamptz, p_limit integer, p_offset integer
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_timezone text;
  v_booking_total bigint;
  v_open_play_total bigint;
  v_bookings jsonb;
  v_open_play jsonb;
begin
  if not private.is_venue_admin(p_venue_id) then
    raise exception 'You cannot preview this venue schedule.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '90 days'
     or p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0
     or pg_catalog.jsonb_typeof(p_draft) <> 'object'
     or pg_catalog.jsonb_typeof(p_draft->'venue_periods') <> 'array'
     or pg_catalog.jsonb_typeof(p_draft->'courts') <> 'array' then
    raise exception 'The preview range or schedule is invalid.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  select vs.timezone into v_timezone from public.venue_settings vs where vs.venue_id = p_venue_id;
  if v_timezone is null then
    raise exception 'Venue settings not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_draft->'courts') c
    where nullif(c->>'court_id', '') is null
       or not exists (select 1 from public.courts court where court.id = (c->>'court_id')::uuid and court.venue_id = p_venue_id)
       or coalesce(c->>'schedule_mode', '') not in ('inherit', 'custom')
       or pg_catalog.jsonb_typeof(coalesce(c->'periods', '[]'::jsonb)) <> 'array'
  ) then
    raise exception 'The draft includes an invalid court.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  select count(*) into v_booking_total
  from public.bookings b
  where b.venue_id = p_venue_id and b.during && tstzrange(p_from, p_to, '[)')
    and (b.status in ('confirmed', 'payment_submitted') or
         (b.status = 'pending_payment' and b.expires_at > now()))
    and not private.schedule_range_allowed(
      p_venue_id,
      (select coalesce(pg_catalog.jsonb_agg(period), '[]'::jsonb)
       from private.schedule_draft_periods(p_draft, b.court_id) period),
      b.during
    );
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'booking_id', q.id, 'court_id', q.court_id, 'starts_at', lower(q.during), 'ends_at', upper(q.during), 'status', q.status
  ) order by lower(q.during), q.id), '[]'::jsonb) into v_bookings
  from (
    select b.id, b.court_id, b.during, b.status
    from public.bookings b
    where b.venue_id = p_venue_id and b.during && tstzrange(p_from, p_to, '[)')
      and (b.status in ('confirmed', 'payment_submitted') or
           (b.status = 'pending_payment' and b.expires_at > now()))
      and not private.schedule_range_allowed(
        p_venue_id,
        (select coalesce(pg_catalog.jsonb_agg(period), '[]'::jsonb)
         from private.schedule_draft_periods(p_draft, b.court_id) period),
        b.during
      )
    order by lower(b.during), b.id limit p_limit offset p_offset
  ) q;

  select count(*) into v_open_play_total
  from public.open_play_courts opc
  where opc.venue_id = p_venue_id and opc.during && tstzrange(p_from, p_to, '[)')
    and not private.schedule_range_allowed(
      p_venue_id,
      (select coalesce(pg_catalog.jsonb_agg(period), '[]'::jsonb)
       from private.schedule_draft_periods(p_draft, opc.court_id) period),
      opc.during
    );
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'session_id', q.session_id, 'court_id', q.court_id, 'title', q.title,
    'starts_at', lower(q.during), 'ends_at', upper(q.during)
  ) order by lower(q.during), q.session_id, q.court_id), '[]'::jsonb) into v_open_play
  from (
    select opc.session_id, opc.court_id, s.title, opc.during
    from public.open_play_courts opc
    join public.open_play_sessions s on s.venue_id = opc.venue_id and s.id = opc.session_id
    where opc.venue_id = p_venue_id and opc.during && tstzrange(p_from, p_to, '[)')
      and not private.schedule_range_allowed(
        p_venue_id,
        (select coalesce(pg_catalog.jsonb_agg(period), '[]'::jsonb)
         from private.schedule_draft_periods(p_draft, opc.court_id) period),
        opc.during
      )
    order by lower(opc.during), opc.session_id, opc.court_id limit p_limit offset p_offset
  ) q;
  return pg_catalog.jsonb_build_object(
    'from', p_from, 'to', p_to, 'bookings', pg_catalog.jsonb_build_object('total', v_booking_total, 'items', v_bookings),
    'open_play', pg_catalog.jsonb_build_object('total', v_open_play_total, 'items', v_open_play)
  );
end $$;
revoke all on function public.preview_schedule_impact(uuid, jsonb, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.preview_schedule_impact(uuid, jsonb, timestamptz, timestamptz, integer, integer) to authenticated;

create function public.save_schedule(p_venue_id uuid, p_expected_revision integer, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_state public.venue_schedule_state%rowtype;
  v_court jsonb;
  v_copy jsonb;
  v_rate jsonb;
  v_court_id uuid;
  v_source_id uuid;
  v_target_id uuid;
  v_source_day smallint;
  v_target_day smallint;
  v_old_mode text;
  v_new_mode text;
  v_new_revision integer;
  v_changed boolean := false;
begin
  if not private.is_venue_admin(p_venue_id) then
    raise exception 'You cannot edit this venue schedule.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_expected_revision is null or pg_catalog.jsonb_typeof(p_changes) <> 'object'
     or p_changes = '{}'::jsonb then
    raise exception 'A schedule revision and at least one change are required.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Use the booking/open-play lock order: sorted court locks first, then the schedule revision row.
  for v_court_id in
    select c.id from public.courts c where c.venue_id = p_venue_id order by c.id
  loop
    perform private.lock_court_slots(v_court_id);
  end loop;
  select s.* into v_state from public.venue_schedule_state s where s.venue_id = p_venue_id for update;
  if not found then
    raise exception 'Venue schedule not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_state.schedule_revision <> p_expected_revision then
    raise exception 'The schedule changed. Reload before saving.' using errcode = 'P0001', hint = 'schedule_conflict';
  end if;

  if p_changes ? 'venue_periods' then
    if pg_catalog.jsonb_typeof(p_changes->'venue_periods') <> 'array' then
      raise exception 'Venue periods must be an array.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    delete from public.venue_open_periods p where p.venue_id = p_venue_id;
    for v_rate in select value from pg_catalog.jsonb_array_elements(p_changes->'venue_periods') loop
      insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
      values (p_venue_id, (v_rate->>'day_of_week')::smallint,
        (v_rate->>'start_minute')::smallint, (v_rate->>'end_minute')::smallint);
    end loop;
    v_changed := true;
  end if;

  if p_changes ? 'courts' then
    if pg_catalog.jsonb_typeof(p_changes->'courts') <> 'array' then
      raise exception 'Court changes must be an array.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    for v_court in select value from pg_catalog.jsonb_array_elements(p_changes->'courts') loop
      v_court_id := (v_court->>'court_id')::uuid;
      if not exists (select 1 from public.courts c where c.id = v_court_id and c.venue_id = p_venue_id) then
        raise exception 'Court is not part of this venue.' using errcode = 'P0001', hint = 'invalid_input';
      end if;
      v_new_mode := v_court->>'schedule_mode';
      if v_new_mode not in ('inherit', 'custom') then
        raise exception 'Court schedule mode is invalid.' using errcode = 'P0001', hint = 'invalid_input';
      end if;
      select m.schedule_mode into v_old_mode from public.court_schedule_modes m
        where m.venue_id = p_venue_id and m.court_id = v_court_id for update;
      v_old_mode := coalesce(v_old_mode, 'inherit');
      if v_new_mode = 'inherit' then
        delete from public.court_open_periods p where p.venue_id = p_venue_id and p.court_id = v_court_id;
      elsif v_court ? 'periods' then
        if pg_catalog.jsonb_typeof(v_court->'periods') <> 'array' then
          raise exception 'Court periods must be an array.' using errcode = 'P0001', hint = 'invalid_input';
        end if;
        delete from public.court_open_periods p where p.venue_id = p_venue_id and p.court_id = v_court_id;
        for v_rate in select value from pg_catalog.jsonb_array_elements(v_court->'periods') loop
          insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
          values (p_venue_id, v_court_id, (v_rate->>'day_of_week')::smallint,
            (v_rate->>'start_minute')::smallint, (v_rate->>'end_minute')::smallint);
        end loop;
      elsif v_old_mode = 'inherit' then
        insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
        select p_venue_id, v_court_id, p.day_of_week, p.start_minute, p.end_minute
        from public.venue_open_periods p where p.venue_id = p_venue_id;
      end if;
      insert into public.court_schedule_modes (venue_id, court_id, schedule_mode, schedule_revision, updated_at)
      values (p_venue_id, v_court_id, v_new_mode, 1, now())
      on conflict (venue_id, court_id) do update
      set schedule_mode = excluded.schedule_mode,
          schedule_revision = public.court_schedule_modes.schedule_revision + 1,
          updated_at = now();
      v_changed := true;
    end loop;
  end if;

  if p_changes ? 'copy_operations' then
    if pg_catalog.jsonb_typeof(p_changes->'copy_operations') <> 'array' then
      raise exception 'Copy operations must be an array.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    for v_copy in select value from pg_catalog.jsonb_array_elements(p_changes->'copy_operations') loop
      v_source_id := (v_copy->>'source_court_id')::uuid;
      v_target_id := (v_copy->>'target_court_id')::uuid;
      v_source_day := (v_copy->>'source_day_of_week')::smallint;
      v_target_day := (v_copy->>'target_day_of_week')::smallint;
      if v_source_id = v_target_id or v_source_day not between 0 and 6 or v_target_day not between 0 and 6
         or coalesce((v_copy->>'confirm_custom')::boolean, false) is not true
         or not exists (select 1 from public.courts c where c.id = v_source_id and c.venue_id = p_venue_id)
         or not exists (select 1 from public.courts c where c.id = v_target_id and c.venue_id = p_venue_id) then
        raise exception 'Copy requires two venue courts, weekdays and custom-mode confirmation.' using errcode = 'P0001', hint = 'invalid_input';
      end if;
      select m.schedule_mode into v_old_mode from public.court_schedule_modes m
        where m.venue_id = p_venue_id and m.court_id = v_source_id;
      if coalesce(v_old_mode, 'inherit') = 'custom' then
        v_new_mode := 'custom';
        -- Source periods are read before the target's rows are changed.
        delete from public.court_open_periods p where p.venue_id = p_venue_id and p.court_id = v_target_id
          and p.day_of_week = v_target_day;
        insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
        select p_venue_id, v_target_id, v_target_day, p.start_minute, p.end_minute
        from public.court_open_periods p where p.venue_id = p_venue_id and p.court_id = v_source_id
          and p.day_of_week = v_source_day;
      else
        delete from public.court_open_periods p where p.venue_id = p_venue_id and p.court_id = v_target_id
          and p.day_of_week = v_target_day;
        insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
        select p_venue_id, v_target_id, v_target_day, p.start_minute, p.end_minute
        from public.venue_open_periods p where p.venue_id = p_venue_id and p.day_of_week = v_source_day;
      end if;
      select m.schedule_mode into v_new_mode from public.court_schedule_modes m
        where m.venue_id = p_venue_id and m.court_id = v_target_id;
      if coalesce(v_new_mode, 'inherit') = 'inherit' then
        -- Copying one weekday still makes the whole court custom; snapshot other weekdays first.
        insert into public.court_open_periods (venue_id, court_id, day_of_week, start_minute, end_minute)
        select p_venue_id, v_target_id, p.day_of_week, p.start_minute, p.end_minute
        from public.venue_open_periods p where p.venue_id = p_venue_id and p.day_of_week <> v_target_day
          and not exists (select 1 from public.court_open_periods cp
            where cp.venue_id = p_venue_id and cp.court_id = v_target_id and cp.day_of_week = p.day_of_week);
      end if;
      insert into public.court_schedule_modes (venue_id, court_id, schedule_mode, schedule_revision, updated_at)
      values (p_venue_id, v_target_id, 'custom', 1, now())
      on conflict (venue_id, court_id) do update
      set schedule_mode = 'custom', schedule_revision = public.court_schedule_modes.schedule_revision + 1,
          updated_at = now();
      if coalesce((v_copy->>'copy_rates')::boolean, false) then
        delete from public.court_rates r where r.venue_id = p_venue_id and r.court_id = v_target_id and r.day_of_week = v_target_day;
        insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price)
        select p_venue_id, v_target_id, v_target_day, r.start_hour, r.price
        from public.court_rates r where r.venue_id = p_venue_id and r.court_id = v_source_id and r.day_of_week = v_source_day;
      end if;
      v_changed := true;
    end loop;
  end if;

  if p_changes ? 'rate_changes' then
    if pg_catalog.jsonb_typeof(p_changes->'rate_changes') <> 'array' then
      raise exception 'Rate changes must be an array.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    for v_rate in select value from pg_catalog.jsonb_array_elements(p_changes->'rate_changes') loop
      v_court_id := (v_rate->>'court_id')::uuid;
      if not exists (select 1 from public.courts c where c.id = v_court_id and c.venue_id = p_venue_id) then
        raise exception 'Rate court is not part of this venue.' using errcode = 'P0001', hint = 'invalid_input';
      end if;
      if (v_rate->>'price') is null or v_rate->'price' = 'null'::jsonb then
        delete from public.court_rates r where r.venue_id = p_venue_id and r.court_id = v_court_id
          and r.day_of_week = (v_rate->>'day_of_week')::smallint and r.start_hour = (v_rate->>'start_hour')::smallint;
      else
        insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price)
        values (p_venue_id, v_court_id, (v_rate->>'day_of_week')::smallint,
          (v_rate->>'start_hour')::smallint, (v_rate->>'price')::numeric)
        on conflict (court_id, day_of_week, start_hour) do update set price = excluded.price;
      end if;
      v_changed := true;
    end loop;
  end if;

  if not v_changed then
    raise exception 'No schedule changes were supplied.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  update public.venue_schedule_state s set schedule_revision = s.schedule_revision + 1, updated_at = now()
    where s.venue_id = p_venue_id returning s.schedule_revision into v_new_revision;
  return pg_catalog.jsonb_build_object('venue_id', p_venue_id, 'schedule_revision', v_new_revision);
end $$;
revoke all on function public.save_schedule(uuid, integer, jsonb) from public, anon;
grant execute on function public.save_schedule(uuid, integer, jsonb) to authenticated;

comment on function public.get_schedule(uuid) is 'Returns one venue schedule and weekly rates to a venue admin.';
comment on function public.preview_schedule_impact(uuid, jsonb, timestamptz, timestamptz, integer, integer) is 'Paginated, read-only schedule impact preview for an explicit maximum 90-day horizon.';
comment on function public.save_schedule(uuid, integer, jsonb) is 'Atomically saves an explicit venue schedule at an expected revision.';
