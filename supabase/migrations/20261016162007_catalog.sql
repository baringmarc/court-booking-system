-- Milestone 2: venue catalog — settings, courts, per-slot rates, operating hours, blackouts.
-- Conventions: day_of_week 0 = Sunday … 6 = Saturday (matches JS Date#getDay and Postgres extract(dow)).
-- Everything here is publicly readable; only admins can write.

create type public.sport as enum ('badminton', 'pickleball', 'basketball', 'tennis');

-- ---------------------------------------------------------------------------
-- Venue settings (singleton row)
-- ---------------------------------------------------------------------------
create table public.venue_settings (
  id                     boolean primary key default true check (id),
  name                   text not null,
  timezone               text not null default 'Asia/Manila',
  currency               char(3) not null default 'PHP',
  slot_minutes           smallint not null default 60 check (slot_minutes = 60), -- fixed in v1
  booking_window_days    smallint not null default 30 check (booking_window_days between 1 and 365),
  payment_hold_minutes   smallint not null default 60 check (payment_hold_minutes between 5 and 1440),
  cancel_cutoff_hours    smallint not null default 1 check (cancel_cutoff_hours between 0 and 168),
  max_rejections         smallint not null default 2 check (max_rejections between 1 and 10),
  payment_instructions   text not null default '',
  updated_at             timestamptz not null default now()
);

create trigger venue_settings_set_updated_at
  before update on public.venue_settings
  for each row execute function private.set_updated_at();

insert into public.venue_settings (name, payment_instructions) values (
  'Claudex Courts',
  E'**GCash**: 0917 000 0000 (Claudex Courts)\n**Maya**: 0917 000 0000 (Claudex Courts)\n**Bank transfer**: BPI 0000-0000-00 (Claudex Courts Inc.)\n\nUse your booking reference as the payment note, then upload a screenshot of the receipt.'
);

-- ---------------------------------------------------------------------------
-- Courts
-- ---------------------------------------------------------------------------
create table public.courts (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null unique check (length(trim(name)) > 0),
  sport                public.sport not null,
  description          text not null default '',
  default_hourly_rate  numeric(10, 2) not null check (default_hourly_rate >= 0),
  is_active            boolean not null default true,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index courts_sport_sort_idx on public.courts (sport, sort_order);

create trigger courts_set_updated_at
  before update on public.courts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Per-slot price overrides. Missing entry => court.default_hourly_rate.
-- ---------------------------------------------------------------------------
create table public.court_rates (
  court_id     uuid not null references public.courts (id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),
  start_hour   smallint not null check (start_hour between 0 and 23),
  price        numeric(10, 2) not null check (price >= 0),
  primary key (court_id, day_of_week, start_hour)
);

-- ---------------------------------------------------------------------------
-- Operating hours (venue-wide, one row per weekday)
-- ---------------------------------------------------------------------------
create table public.operating_hours (
  day_of_week  smallint primary key check (day_of_week between 0 and 6),
  open_time    time not null,
  close_time   time not null,
  is_closed    boolean not null default false,
  -- whole hours only, because slots are 60 minutes
  check (extract(minute from open_time) = 0 and extract(second from open_time) = 0),
  check (extract(minute from close_time) = 0 and extract(second from close_time) = 0),
  check (is_closed or open_time < close_time)
);

insert into public.operating_hours (day_of_week, open_time, close_time)
select d, '06:00', '22:00' from generate_series(0, 6) as d;

-- ---------------------------------------------------------------------------
-- Blackouts (court_id null = whole venue)
-- ---------------------------------------------------------------------------
create table public.blackouts (
  id          uuid primary key default gen_random_uuid(),
  court_id    uuid references public.courts (id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text not null default '',
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index blackouts_court_id_idx on public.blackouts (court_id);
create index blackouts_created_by_idx on public.blackouts (created_by);
create index blackouts_range_idx on public.blackouts using gist (tstzrange(starts_at, ends_at));

-- ---------------------------------------------------------------------------
-- Privileges + RLS
-- ---------------------------------------------------------------------------
alter table public.venue_settings  enable row level security;
alter table public.courts          enable row level security;
alter table public.court_rates     enable row level security;
alter table public.operating_hours enable row level security;
alter table public.blackouts       enable row level security;

revoke all on public.venue_settings, public.courts, public.court_rates,
              public.operating_hours, public.blackouts
  from anon, authenticated;

grant select on public.venue_settings, public.courts, public.court_rates,
                public.operating_hours, public.blackouts
  to anon, authenticated;

-- Singleton/fixed-row tables: admins update only (no insert/delete).
grant update on public.venue_settings, public.operating_hours to authenticated;
grant insert, update, delete on public.courts, public.court_rates, public.blackouts to authenticated;

-- venue_settings
create policy "Anyone can read venue settings"
  on public.venue_settings for select to anon, authenticated using (true);
create policy "Admins can update venue settings"
  on public.venue_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- operating_hours
create policy "Anyone can read operating hours"
  on public.operating_hours for select to anon, authenticated using (true);
create policy "Admins can update operating hours"
  on public.operating_hours for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- courts: archived courts are hidden from the public
create policy "Anyone can read active courts; admins read all"
  on public.courts for select to anon, authenticated
  using (is_active or (select private.is_admin()));
create policy "Admins can insert courts"
  on public.courts for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins can update courts"
  on public.courts for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins can delete courts"
  on public.courts for delete to authenticated
  using ((select private.is_admin()));

-- court_rates
create policy "Anyone can read court rates"
  on public.court_rates for select to anon, authenticated using (true);
create policy "Admins can insert court rates"
  on public.court_rates for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins can update court rates"
  on public.court_rates for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins can delete court rates"
  on public.court_rates for delete to authenticated
  using ((select private.is_admin()));

-- blackouts
create policy "Anyone can read blackouts"
  on public.blackouts for select to anon, authenticated using (true);
create policy "Admins can insert blackouts"
  on public.blackouts for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins can update blackouts"
  on public.blackouts for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins can delete blackouts"
  on public.blackouts for delete to authenticated
  using ((select private.is_admin()));
