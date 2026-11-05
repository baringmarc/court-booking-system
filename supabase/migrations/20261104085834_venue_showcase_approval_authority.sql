-- T17.7: platform-owned Showcase approval. Existing venue selections remain intact for review and do not auto-publish.
alter table public.venues
  add column showcase_approved boolean not null default false;

comment on column public.venues.showcase_approved is
  'Platform-admin approval for listing this active venue in the public Plotline Showcase.';

create function private.guard_legacy_showcase_opt_in()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.showcase_opt_in is distinct from old.showcase_opt_in then
    raise exception 'Showcase selections are managed by the Plotline platform.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_legacy_showcase_opt_in() from public, anon, authenticated;

create trigger venue_settings_guard_legacy_showcase_opt_in
  before update of showcase_opt_in on public.venue_settings
  for each row
  execute function private.guard_legacy_showcase_opt_in();

create function public.set_venue_showcase_approval(p_venue_id uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can change Showcase approval.'
      using errcode = 'P0001', hint = 'not_platform_admin';
  end if;

  update public.venues
  set showcase_approved = p_approved
  where id = p_venue_id;

  if not found then
    raise exception 'Venue not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
end;
$$;

revoke all on function public.set_venue_showcase_approval(uuid, boolean) from public, anon;
grant execute on function public.set_venue_showcase_approval(uuid, boolean) to authenticated;

create or replace view public.public_venues with (security_invoker = false) as
select v.slug,
       s.name,
       s.city,
       coalesce(
         s.banner_path,
         (select p.path from public.court_photos p where p.venue_id = v.id order by p.sort_order, p.created_at limit 1)
       ) as logo_url
from public.venues v
join public.venue_settings s on s.venue_id = v.id
where v.status = 'active' and v.showcase_approved;
