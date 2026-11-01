-- T14.2: leads from the marketing site's contact form (docs/PLATFORM.md §4–5, SAAS-PLAN Phase 3).
-- Inserted only by the `site-contact` Edge Function (service role); no account is created. Platform admins track
-- them (new → talking → won / lost) and keep notes. Limits match supabase/functions/_shared/siteForms.ts.

create table public.leads (
  id            uuid primary key default gen_random_uuid(),
  first_name    text not null check (char_length(first_name) between 1 and 60),
  last_name     text not null check (char_length(last_name) between 1 and 60),
  email         text not null check (char_length(email) between 3 and 254 and email = lower(email)),
  phone         text not null check (phone ~ '^(\+?63|0)9[0-9]{9}$'),
  venue_name    text not null check (char_length(venue_name) between 2 and 80),
  location      text not null check (char_length(location) between 2 and 120),
  courts        smallint not null check (courts between 1 and 50),
  facebook      text check (char_length(facebook) <= 200),
  message       text check (char_length(message) <= 1000),
  status        text not null default 'new' check (status in ('new', 'talking', 'won', 'lost')),
  notes         text check (char_length(notes) <= 2000),
  consented_at  timestamptz not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.leads is
  'Contact form submissions from the marketing site (T14.2). Inserted only by the site-contact Edge Function; platform admins track them.';

create index leads_status_created_at_idx on public.leads (status, created_at desc);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function private.set_updated_at();

alter table public.leads enable row level security;

revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;
grant update (status, notes) on public.leads to authenticated;

create policy "Platform admins read leads"
  on public.leads for select to authenticated
  using ((select private.is_platform_admin()));

create policy "Platform admins update leads"
  on public.leads for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));
