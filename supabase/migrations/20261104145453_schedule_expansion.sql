-- T17.9 expands schedule storage. Legacy operating_hours remains authoritative.
create table public.venue_schedule_state (
  venue_id uuid primary key references public.venues(id) on delete cascade,
  schedule_revision integer not null default 0 check (schedule_revision >= 0),
  schedule_v2_active boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.venue_open_periods (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1380 and start_minute % 60 = 0),
  end_minute smallint not null check (end_minute between 1 and 2880 and end_minute % 60 = 0),
  created_at timestamptz not null default now(),
  check (end_minute > start_minute and end_minute - start_minute <= 1440),
  unique (venue_id, id)
);
create index venue_open_periods_venue_day_idx on public.venue_open_periods (venue_id, day_of_week);

create table public.court_schedule_modes (
  venue_id uuid not null,
  court_id uuid not null,
  schedule_mode text not null default 'inherit' check (schedule_mode in ('inherit', 'custom')),
  schedule_revision integer not null default 0 check (schedule_revision >= 0),
  updated_at timestamptz not null default now(),
  primary key (venue_id, court_id),
  foreign key (venue_id, court_id) references public.courts (venue_id, id) on delete cascade
);
create index court_schedule_modes_venue_idx on public.court_schedule_modes (venue_id);

create table public.court_open_periods (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null,
  court_id uuid not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1380 and start_minute % 60 = 0),
  end_minute smallint not null check (end_minute between 1 and 2880 and end_minute % 60 = 0),
  created_at timestamptz not null default now(),
  check (end_minute > start_minute and end_minute - start_minute <= 1440),
  foreign key (venue_id, court_id) references public.courts (venue_id, id) on delete cascade
);
create index court_open_periods_venue_court_day_idx on public.court_open_periods (venue_id, court_id, day_of_week);

alter table public.venue_schedule_state enable row level security;
alter table public.venue_open_periods enable row level security;
alter table public.court_schedule_modes enable row level security;
alter table public.court_open_periods enable row level security;
revoke all on public.venue_schedule_state, public.venue_open_periods, public.court_schedule_modes, public.court_open_periods from anon, authenticated;
grant select on public.venue_open_periods, public.court_schedule_modes, public.court_open_periods to anon, authenticated;
grant insert, update, delete on public.venue_open_periods, public.court_schedule_modes, public.court_open_periods to authenticated;
grant select on public.venue_schedule_state to authenticated;

create policy "Venue admins read schedule state" on public.venue_schedule_state for select to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Public reads periods of visible venues" on public.venue_open_periods for select to anon, authenticated
  using (venue_id in (select id from public.venues));
create policy "Venue admins write venue periods" on public.venue_open_periods for all to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));
create policy "Public reads court modes of visible venues" on public.court_schedule_modes for select to anon, authenticated
  using (venue_id in (select id from public.venues));
create policy "Venue admins write court modes" on public.court_schedule_modes for all to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));
create policy "Public reads custom periods of visible venues" on public.court_open_periods for select to anon, authenticated
  using (venue_id in (select id from public.venues));
create policy "Venue admins write court periods" on public.court_open_periods for all to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));

insert into public.venue_schedule_state (venue_id)
select id from public.venues;
insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
select venue_id, day_of_week,
       (extract(epoch from open_time)::integer / 60)::smallint,
       (extract(epoch from close_time)::integer / 60
         + case when close_time <= open_time then 1440 else 0 end)::smallint
from public.operating_hours where not is_closed;
insert into public.court_schedule_modes (venue_id, court_id)
select venue_id, id from public.courts;

create function private.initialize_venue_schedule_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.venue_schedule_state (venue_id) values (new.id) on conflict (venue_id) do nothing;
  return new;
end $$;
create function private.initialize_court_schedule_mode()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.court_schedule_modes (venue_id, court_id) values (new.venue_id, new.id)
    on conflict (venue_id, court_id) do nothing;
  return new;
end $$;
revoke all on function private.initialize_venue_schedule_state() from public, anon, authenticated;
revoke all on function private.initialize_court_schedule_mode() from public, anon, authenticated;
create trigger venues_initialize_schedule after insert on public.venues for each row execute function private.initialize_venue_schedule_state();
create trigger courts_initialize_schedule after insert on public.courts for each row execute function private.initialize_court_schedule_mode();

create function private.check_weekly_period_overlap()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_start integer := new.day_of_week::integer * 1440 + new.start_minute;
  v_end integer := new.day_of_week::integer * 1440 + new.end_minute;
  v_scope uuid;
begin
  -- Let table constraints report malformed input and RLS reject unauthorized writes.
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
revoke all on function private.check_weekly_period_overlap() from public, anon, authenticated;
create trigger venue_period_no_overlap before insert or update on public.venue_open_periods
  for each row execute function private.check_weekly_period_overlap();
create trigger court_period_no_overlap before insert or update on public.court_open_periods
  for each row execute function private.check_weekly_period_overlap();

-- During expansion, each legacy statement replaces only its affected weekday's backfill.
create function private.sync_venue_periods_after_hours_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.venue_open_periods p using new_hours n
    where p.venue_id = n.venue_id and p.day_of_week = n.day_of_week;
  insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  select n.venue_id, n.day_of_week, (extract(epoch from n.open_time)::integer/60)::smallint,
    (extract(epoch from n.close_time)::integer/60 + case when n.close_time <= n.open_time then 1440 else 0 end)::smallint
  from new_hours n where not n.is_closed;
  update public.venue_schedule_state s set schedule_revision = schedule_revision + 1, updated_at = now()
    where s.venue_id in (select distinct venue_id from new_hours);
  return null;
end $$;
create function private.sync_venue_periods_after_hours_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.venue_open_periods p using new_hours n
    where p.venue_id = n.venue_id and p.day_of_week = n.day_of_week;
  insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
  select n.venue_id, n.day_of_week, (extract(epoch from n.open_time)::integer/60)::smallint,
    (extract(epoch from n.close_time)::integer/60 + case when n.close_time <= n.open_time then 1440 else 0 end)::smallint
  from new_hours n where not n.is_closed;
  update public.venue_schedule_state s set schedule_revision = schedule_revision + 1, updated_at = now()
    where s.venue_id in (select distinct venue_id from new_hours);
  return null;
end $$;
revoke all on function private.sync_venue_periods_after_hours_insert() from public, anon, authenticated;
revoke all on function private.sync_venue_periods_after_hours_update() from public, anon, authenticated;
create trigger operating_hours_expand_insert after insert on public.operating_hours
  referencing new table as new_hours for each statement execute function private.sync_venue_periods_after_hours_insert();
create trigger operating_hours_expand_update after update on public.operating_hours
  referencing new table as new_hours for each statement execute function private.sync_venue_periods_after_hours_update();

comment on table public.venue_schedule_state is 'Schedule v2 revision and server-controlled activation; legacy operating_hours remains authoritative until cutover.';
comment on table public.venue_open_periods is 'Expanded venue weekly open periods; offsets are minutes from the owning weekday midnight.';
comment on table public.court_schedule_modes is 'Per-court schedule inheritance or custom mode and revision.';
comment on table public.court_open_periods is 'Custom court weekly periods; offsets are minutes from the owning weekday midnight.';
