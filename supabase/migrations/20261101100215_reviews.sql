-- T15.4: reviews from the marketing site's review form (docs/PLATFORM.md §4–5, SAAS-PLAN Phase 5).
-- Inserted only by the `site-review` Edge Function (service role), unapproved. Anyone reads approved reviews (the
-- marketing site uses the publishable key); platform admins read all and approve or hide. Limits match
-- supabase/functions/_shared/siteForms.ts.

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
  'Reviews sent from the marketing site (T15.4). Inserted only by the site-review Edge Function; shown once a platform admin approves them.';

create index reviews_approved_created_at_idx on public.reviews (created_at desc) where approved;

alter table public.reviews enable row level security;

revoke all on public.reviews from anon, authenticated;
grant select on public.reviews to anon, authenticated;
grant update (approved) on public.reviews to authenticated;

create policy "Anyone reads approved reviews; platform admins read all"
  on public.reviews for select to anon, authenticated
  using (approved or (select private.is_platform_admin()));

create policy "Platform admins approve reviews"
  on public.reviews for update to authenticated
  using ((select private.is_platform_admin()))
  with check ((select private.is_platform_admin()));
