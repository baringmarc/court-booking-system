-- Milestone 12 (T12.2, expand): venues, venue membership and platform admins.
-- Additive only. profiles.role and private.is_admin() keep working until the contract migration (T12.11).
-- Clients cannot write these tables: there are no insert/update/delete policies, and write privileges are revoked.

create table public.venues (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  status      text not null default 'draft',
  created_at  timestamptz not null default now(),
  constraint venues_slug_format check (slug ~ '^[a-z0-9-]{3,40}$'),
  constraint venues_slug_not_reserved check (
    slug <> all (array['www', 'app', 'api', 'admin', 'mail', 'demo', 'plotline', 'support', 'status', 'staging'])
  ),
  constraint venues_status_check check (status in ('draft', 'active', 'suspended', 'closed'))
);

create table public.venue_members (
  venue_id  uuid not null references public.venues (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  role      text not null,
  primary key (venue_id, user_id),
  constraint venue_members_role_check check (role in ('owner', 'staff'))
);
create index venue_members_user_venue_idx on public.venue_members (user_id, venue_id);

create table public.platform_admins (
  user_id  uuid primary key references auth.users (id) on delete cascade
);

comment on table public.venues is 'One row per venue. Only active venues are public; draft is visible to its staff and platform admins.';
comment on table public.venue_members is 'Who runs a venue: owner or staff.';
comment on table public.platform_admins is 'Plotline staff. Read everything; replaces profiles.role = admin at T12.11.';

-- Helpers (security definer so policies on the three tables can call them without recursing into RLS).
create function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = (select auth.uid()));
$$;

create function private.is_venue_admin(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_platform_admin()
    or exists (
      select 1 from public.venue_members
      where venue_id = p_venue_id and user_id = (select auth.uid())
    );
$$;

create function private.is_venue_owner(p_venue_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.venue_members
    where venue_id = p_venue_id and user_id = (select auth.uid()) and role = 'owner'
  );
$$;

revoke all on function private.is_platform_admin() from public;
revoke all on function private.is_venue_owner(uuid) from public;
revoke all on function private.is_venue_admin(uuid) from public;
grant execute on function private.is_platform_admin() to anon, authenticated;
grant execute on function private.is_venue_admin(uuid) to anon, authenticated;
grant execute on function private.is_venue_owner(uuid) to authenticated;

-- RLS: select only.
alter table public.venues enable row level security;
alter table public.venue_members enable row level security;
alter table public.platform_admins enable row level security;

revoke insert, update, delete, truncate on public.venues, public.venue_members, public.platform_admins from anon, authenticated;

create policy "Public reads active venues; members and platform admins read theirs"
  on public.venues for select to anon, authenticated
  using (status = 'active' or (select private.is_venue_admin(id)));

create policy "Members read own row; owners read their venue; platform admins read all"
  on public.venue_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select private.is_platform_admin())
    or (select private.is_venue_owner(venue_id))
  );

create policy "Platform admins read own row"
  on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- Seed Claudex Courts and backfill today's admins as its owners and as platform admins.
insert into public.venues (slug, status) values ('claudex-courts', 'active');

insert into public.venue_members (venue_id, user_id, role)
select v.id, p.id, 'owner'
from public.profiles p, public.venues v
where p.role = 'admin' and v.slug = 'claudex-courts';

insert into public.platform_admins (user_id)
select id from public.profiles where role = 'admin';
