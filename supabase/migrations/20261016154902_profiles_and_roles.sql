-- Milestone 1: user profiles and roles.
-- Every auth user gets a profile (created by trigger). Role is 'player' by default;
-- admins are promoted manually:  update public.profiles set role = 'admin' where id = '<uuid>';

-- Internal helpers live in a non-exposed schema so they are not callable via the Data API.
create schema if not exists private;

create type public.user_role as enum ('player', 'admin');

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  role        public.user_role not null default 'player',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'One row per auth user. role controls admin access.';

-- updated_at maintenance (reused by later tables)
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Create a profile whenever a user signs up (email/password or Google).
-- Google puts the display name in full_name / name; our signup form sends full_name.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Admin check for RLS policies. security definer so it can read profiles
-- without recursing through profiles' own RLS.
create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

revoke all on function private.is_admin() from public;
revoke all on function private.handle_new_user() from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_admin() to anon, authenticated;

-- Privileges: explicit, least privilege. Users may edit only their name/phone, never role.
alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

create policy "Users can read own profile; admins read all"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id or (select private.is_admin()));

create policy "Users can update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
