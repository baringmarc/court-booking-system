-- T17.17 schedule cutover. Activation and rollback are server-owned (postgres / service role only, no client RPC).
-- Once a venue is active, old clients cannot write the legacy hours or rates; save_schedule is the only writer.

create function private.venue_schedule_v2_active(p_venue_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.schedule_v2_active from public.venue_schedule_state s where s.venue_id = p_venue_id), false)
$$;
revoke all on function private.venue_schedule_v2_active(uuid) from public;
grant execute on function private.venue_schedule_v2_active(uuid) to anon, authenticated;

-- SECURITY INVOKER on purpose: a client write runs as anon/authenticated, while save_schedule (a definer RPC) and
-- cascades run as the function owner and pass.
create function private.guard_legacy_schedule_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_venue uuid := case when tg_op = 'DELETE' then old.venue_id else new.venue_id end;
begin
  -- Nested on purpose: the helper must not be planned for roles without usage on private (service_role).
  if current_user in ('anon', 'authenticated') then
    if (select private.venue_schedule_v2_active(v_venue)) then
      raise exception 'Schedule is managed in Weekly Hours & Rates.' using errcode = 'P0001', hint = 'schedule_v2_managed';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
revoke all on function private.guard_legacy_schedule_write() from public;
grant execute on function private.guard_legacy_schedule_write() to anon, authenticated;

create trigger operating_hours_v2_guard before insert or update or delete on public.operating_hours
  for each row execute function private.guard_legacy_schedule_write();
create trigger court_rates_v2_guard before insert or update or delete on public.court_rates
  for each row execute function private.guard_legacy_schedule_write();

-- Same body as 20261030081005, plus the refusal for an active venue.
create or replace function public.set_operating_hours(p_hours jsonb, p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_names constant text[] := array['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  e jsonb;
  v_venue uuid;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can change opening hours.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  v_venue := private.admin_venue(p_venue_id);
  if private.venue_schedule_v2_active(v_venue) then
    raise exception 'Schedule is managed in Weekly Hours & Rates.' using errcode = 'P0001', hint = 'schedule_v2_managed';
  end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 7 then
    raise exception 'Send the hours for all seven days.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  for e in select * from jsonb_array_elements(p_hours) loop
    if jsonb_typeof(e) <> 'object' or coalesce(e ->> 'day_of_week', '') !~ '^[0-6]$' then
      raise exception 'Each day needs a day of the week from 0 (Sunday) to 6 (Saturday).'
        using errcode = 'P0001', hint = 'invalid_input';
    end if;
    if coalesce(e ->> 'open_time', '') !~ '^([01][0-9]|2[0-3]):00(:00)?$' then
      raise exception 'Opening times must be whole hours from 00:00 to 23:00.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    if coalesce(e ->> 'close_time', '') !~ '^([01][0-9]|2[0-4]):00(:00)?$' then
      raise exception 'Closing times must be whole hours from 00:00 to 24:00.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    if e ? 'is_closed' and jsonb_typeof(e -> 'is_closed') <> 'boolean' then
      raise exception 'Closed must be true or false.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    -- 24:00 and 00:00 are different times here, so 00:00 → 24:00 (24 hours) passes.
    if not coalesce((e ->> 'is_closed')::boolean, false) and (e ->> 'open_time')::time = (e ->> 'close_time')::time then
      raise exception '% opens and closes at the same time. For 24 hours, open at 12 AM and close at midnight.',
        v_names[(e ->> 'day_of_week')::int + 1] using errcode = 'P0001', hint = 'invalid_input';
    end if;
  end loop;
  if (select count(distinct (e2 ->> 'day_of_week')::int) from jsonb_array_elements(p_hours) e2) <> 7 then
    raise exception 'Send the hours for all seven days.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.operating_hours oh
  set open_time = (x ->> 'open_time')::time,
      close_time = (x ->> 'close_time')::time,
      is_closed = coalesce((x ->> 'is_closed')::boolean, false)
  from jsonb_array_elements(p_hours) x
  where oh.venue_id = v_venue and oh.day_of_week = (x ->> 'day_of_week')::smallint;

  -- Check now, so a clash comes back as this call's error instead of at commit.
  set constraints public.operating_hours_no_overlap immediate;
end;
$function$;

-- Takes the same court locks as create_booking and save_schedule (sorted by id), then the schedule row.
create function private.activate_schedule_v2(p_venue uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_court uuid;
begin
  for v_court in select c.id from public.courts c where c.venue_id = p_venue order by c.id loop
    perform private.lock_court_slots(v_court);
  end loop;
  update public.venue_schedule_state s
  set schedule_v2_active = true, schedule_revision = s.schedule_revision + 1, updated_at = now()
  where s.venue_id = p_venue;
  if not found then
    raise exception 'Venue schedule not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
end $$;

-- Rollback to the legacy hours. Refuses anything one legacy range per day cannot hold, before writing: split hours are
-- never replaced by their enclosing range, so a rollback can never widen a gap.
create function private.deactivate_schedule_v2(p_venue uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_court uuid;
begin
  for v_court in select c.id from public.courts c where c.venue_id = p_venue order by c.id loop
    perform private.lock_court_slots(v_court);
  end loop;
  perform 1 from public.venue_schedule_state s where s.venue_id = p_venue for update;
  if not found then
    raise exception 'Venue schedule not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if exists (select 1 from public.venue_open_periods p where p.venue_id = p_venue group by p.day_of_week having count(*) > 1)
     or exists (select 1 from public.court_schedule_modes m where m.venue_id = p_venue and m.schedule_mode = 'custom')
     or exists (select 1 from public.venue_open_periods p where p.venue_id = p_venue
                and (p.end_minute - p.start_minute >= 1440 and p.start_minute <> 0 or p.start_minute % 60 <> 0 or p.end_minute % 60 <> 0))
  then
    raise exception 'This schedule cannot be represented by the old single-range hours. Fix forward or disable schedule editing.'
      using errcode = 'P0001', hint = 'schedule_rollback_unsafe';
  end if;

  -- Bring the legacy rows in line with the v2 periods (one period per day at most, by the checks above).
  update public.operating_hours h
  set open_time = pg_catalog.make_interval(mins => p.start_minute::integer)::time,
      close_time = case when p.end_minute = 1440 then time '24:00'
                        else (pg_catalog.make_interval(mins => p.end_minute::integer % 1440))::time end,
      is_closed = false
  from public.venue_open_periods p
  where h.venue_id = p_venue and p.venue_id = p_venue and p.day_of_week = h.day_of_week
    and (h.is_closed or h.open_time is distinct from pg_catalog.make_interval(mins => p.start_minute::integer)::time
         or h.close_time is distinct from case when p.end_minute = 1440 then time '24:00'
                        else (pg_catalog.make_interval(mins => p.end_minute::integer % 1440))::time end);
  update public.operating_hours h set is_closed = true
  where h.venue_id = p_venue and not h.is_closed
    and not exists (select 1 from public.venue_open_periods p where p.venue_id = p_venue and p.day_of_week = h.day_of_week);

  update public.venue_schedule_state s
  set schedule_v2_active = false, schedule_revision = s.schedule_revision + 1, updated_at = now()
  where s.venue_id = p_venue;
end $$;

revoke all on function private.activate_schedule_v2(uuid), private.deactivate_schedule_v2(uuid) from public, anon, authenticated;

comment on function private.activate_schedule_v2(uuid) is 'Switches one venue to schedule v2. Service role / postgres only.';
comment on function private.deactivate_schedule_v2(uuid) is 'Rolls one venue back to the legacy hours, refusing data the legacy hours cannot represent.';
