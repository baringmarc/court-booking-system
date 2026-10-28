-- Marketing site backend (SAAS-PLAN Phase 5, docs/PLATFORM.md §4–5): moved here from plotline-site.
--
-- leads:   a venue owner's contact form (the `site-contact` Edge Function, service role). No auth account is
--          created; we follow up and track the lead (new → talking → won / lost) with notes.
-- reviews: reviews from players and owners (the `site-review` Edge Function, service role). Hidden until an
--          admin approves them; anyone reads approved ones (the marketing site shows them).
--
-- Admin access uses private.is_admin() for now. SaaS Phase 1 switches both tables to
-- private.is_platform_admin(), since leads and reviews belong to Plotline, not to any venue.
-- Limits match supabase/functions/_shared/siteForms.ts; keep them in step.

-- Leads -----------------------------------------------------------------------------------------------------

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
  'Contact form submissions from the marketing site. Inserted only by the site-contact Edge Function; admins track them.';

create index leads_status_created_at_idx on public.leads (status, created_at desc);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function private.set_updated_at();

alter table public.leads enable row level security;

-- Inserts come only from the Edge Function (service role). Admins read leads and change status and notes.
revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;
grant update (status, notes) on public.leads to authenticated;

create policy "Admins read leads"
  on public.leads for select
  to authenticated
  using ((select private.is_admin()));

create policy "Admins update leads"
  on public.leads for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

-- Reviews ---------------------------------------------------------------------------------------------------

create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 60),
  venue         text check (char_length(venue) <= 80),
  quote         text not null check (char_length(quote) between 10 and 400),
  role          text not null check (role in ('player', 'owner')),
  rating        smallint not null check (rating between 1 and 5),
  approved      boolean not null default false,
  consented_at  timestamptz not null,
  created_at    timestamptz not null default now()
);

comment on table public.reviews is
  'Reviews sent from the marketing site. Inserted only by the site-review Edge Function; shown once approved.';

create index reviews_approved_created_at_idx on public.reviews (created_at desc) where approved;

alter table public.reviews enable row level security;

-- Anyone reads approved reviews (the marketing site uses the publishable key). Admins read all and approve.
revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant update (approved) on public.reviews to authenticated;

create policy "Anyone reads approved reviews; admins read all"
  on public.reviews for select
  to anon, authenticated
  using (approved or (select private.is_admin()));

create policy "Admins approve reviews"
  on public.reviews for update
  to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
