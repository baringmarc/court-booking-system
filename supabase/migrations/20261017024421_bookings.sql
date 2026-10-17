-- Milestone 3: bookings.
-- Bookings are never written directly by clients: every write goes through security definer RPCs
-- (create_booking, cancel_booking, review_payment, …). Clients only read, through RLS.
-- See SPEC §4–§6 and RESEARCH.md "Exclusion constraint for overlapping bookings".

create extension if not exists btree_gist with schema extensions;

create type public.booking_status as enum (
  'pending_payment', 'payment_submitted', 'confirmed', 'expired', 'rejected', 'cancelled'
);
create type public.booking_source as enum ('online', 'walk_in');

create table public.bookings (
  id                uuid primary key default gen_random_uuid(),
  reference_code    text not null unique check (reference_code ~ '^CB-[A-HJ-NP-Z2-9]{6}$'),
  court_id          uuid not null references public.courts (id) on delete restrict,
  user_id           uuid references public.profiles (id) on delete set null,
  -- Contact snapshot at booking time (guests, players and walk-ins alike).
  guest_name        text check (guest_name is null or length(trim(guest_name)) > 0),
  guest_email       text,
  guest_phone       text,
  during            tstzrange not null
                    check (not isempty(during) and lower_inc(during) and not upper_inc(during)
                           and not lower_inf(during) and not upper_inf(during)),
  total_amount      numeric(10, 2) not null check (total_amount >= 0),
  status            public.booking_status not null default 'pending_payment',
  source            public.booking_source not null default 'online',
  created_by        uuid references public.profiles (id) on delete set null,
  rejection_count   smallint not null default 0 check (rejection_count >= 0),
  guest_token_hash  bytea,  -- sha256 of the guest token; the token itself is never stored
  expires_at        timestamptz,
  cancelled_at      timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint bookings_has_contact check (user_id is not null or guest_name is not null),
  constraint bookings_hold_has_expiry check (status <> 'pending_payment' or expires_at is not null),
  -- No two active bookings may overlap on the same court. Expired-but-unswept holds still count,
  -- so create_booking expires overlapping stale holds before inserting.
  constraint bookings_no_overlap exclude using gist (court_id with =, during with &&)
    where (status in ('pending_payment', 'payment_submitted', 'confirmed'))
);

comment on table public.bookings is 'Court reservations. Written only through RPCs; read via RLS.';

create index bookings_court_id_idx on public.bookings (court_id);
create index bookings_user_id_idx on public.bookings (user_id);
create index bookings_created_by_idx on public.bookings (created_by);

create trigger bookings_set_updated_at
  before update on public.bookings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges + RLS: read-only for clients. No insert/update/delete grants for anyone but RPCs.
-- ---------------------------------------------------------------------------
alter table public.bookings enable row level security;

revoke all on public.bookings from anon, authenticated;
grant select on public.bookings to authenticated;

create policy "Players read own bookings; admins read all"
  on public.bookings for select
  to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
