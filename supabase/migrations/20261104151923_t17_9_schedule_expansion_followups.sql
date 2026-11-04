-- Schedule expansion remains private to venue admins until public consumers cut over.
drop policy "Public reads periods of visible venues" on public.venue_open_periods;
drop policy "Public reads court modes of visible venues" on public.court_schedule_modes;
drop policy "Public reads custom periods of visible venues" on public.court_open_periods;
revoke select on public.venue_open_periods, public.court_schedule_modes, public.court_open_periods from anon;
create policy "Venue admins read venue periods" on public.venue_open_periods for select to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins read court modes" on public.court_schedule_modes for select to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins read court periods" on public.court_open_periods for select to authenticated
  using ((select private.is_venue_admin(venue_id)));

-- Legacy hours RPCs retain their established validation and error hints. Their
-- statement trigger writes expanded rows underneath that validation, so the
-- row trigger skips duplicate overlap checking only for this nested write.
create or replace function private.check_weekly_period_overlap()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_start integer := new.day_of_week::integer * 1440 + new.start_minute;
  v_end integer := new.day_of_week::integer * 1440 + new.end_minute;
  v_scope uuid;
begin
  if pg_catalog.pg_trigger_depth() > 1 then return new; end if;
  if new.day_of_week not between 0 and 6 or new.start_minute not between 0 and 1380
     or new.end_minute not between 1 and 2880 or new.start_minute % 60 <> 0
     or new.end_minute % 60 <> 0 or new.end_minute - new.start_minute > 1440 then
    return new;
  end if;
  if tg_table_name = 'venue_open_periods' then
    v_scope := new.venue_id;
    if current_user in ('anon', 'authenticated') and not (select private.is_venue_admin(new.venue_id)) then return new; end if;
  else
    v_scope := new.court_id;
    if current_user in ('anon', 'authenticated') and not (select private.is_venue_admin(new.venue_id)) then return new; end if;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(tg_table_name || ':' || v_scope::text, 0));
  if tg_table_name = 'venue_open_periods' then
    if exists (select 1 from public.venue_open_periods p cross join (values (-10080),(0),(10080)) s(delta)
      where p.venue_id = new.venue_id and p.id <> new.id
      and int4range(v_start,v_end,'[)') && int4range(p.day_of_week::integer*1440+p.start_minute+s.delta,
          p.day_of_week::integer*1440+p.end_minute+s.delta,'[)')) then
      raise exception 'Weekly periods overlap.' using errcode = 'P0001', hint = 'schedule_overlap';
    end if;
  else
    if exists (select 1 from public.court_open_periods p cross join (values (-10080),(0),(10080)) s(delta)
      where p.venue_id = new.venue_id and p.court_id = new.court_id and p.id <> new.id
      and int4range(v_start,v_end,'[)') && int4range(p.day_of_week::integer*1440+p.start_minute+s.delta,
          p.day_of_week::integer*1440+p.end_minute+s.delta,'[)')) then
      raise exception 'Weekly periods overlap.' using errcode = 'P0001', hint = 'schedule_overlap';
    end if;
  end if;
  return new;
end $$;
