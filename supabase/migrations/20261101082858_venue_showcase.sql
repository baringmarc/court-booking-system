-- T14.13: opt-in venue showcase. Two columns on venue_settings (venue admins write them through the existing UPDATE
-- policy) and the public_venues view plotline-site reads (docs/PLATFORM.md). Expand only.
alter table public.venue_settings
  add column city text not null default '' check (length(city) <= 80),
  add column showcase_opt_in boolean not null default false;

-- security_invoker = false on purpose: anon can't read venue_settings rows of other venues' private columns, and the
-- view exposes only these four columns for active, opted-in venues. logo_url is a path in the public venue-media bucket.
create view public.public_venues with (security_invoker = false) as
select v.slug,
       s.name,
       s.city,
       coalesce(
         s.banner_path,
         (select p.path from public.court_photos p where p.venue_id = v.id order by p.sort_order, p.created_at limit 1)
       ) as logo_url
from public.venues v
join public.venue_settings s on s.venue_id = v.id
where v.status = 'active' and s.showcase_opt_in;

revoke all on public.public_venues from public, anon, authenticated;
grant select on public.public_venues to anon, authenticated;
