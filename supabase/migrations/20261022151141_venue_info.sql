-- T9.11g: venue info that admins set and players see (SPEC §6, RESEARCH M9 "Venue info"): the location, social
-- links, admin-defined info sections and amenities. Everything here only adds, so the live frontend is unaffected.
--
-- URL and length checks are inline in the constraints. A check that called a private function would need
-- execute for every writing role, and admins write these tables through RLS as `authenticated` (T9.11c lesson).

-- ---------------------------------------------------------------------------
-- 1. Location: an address and what the map searches. The embed URL is built from these, never pasted.
-- ---------------------------------------------------------------------------
alter table public.venue_settings
  add column address    text not null default '' check (char_length(address) <= 300),
  add column maps_query text not null default '' check (char_length(maps_query) <= 300);

-- ---------------------------------------------------------------------------
-- 2. Social links: one optional https URL per platform, each limited to its own hosts.
-- ---------------------------------------------------------------------------
create type public.venue_social_platform as enum ('facebook', 'instagram', 'tiktok', 'youtube', 'x', 'messenger', 'website');

create table public.venue_social_links (
  platform    public.venue_social_platform primary key,
  url         text not null check (char_length(url) <= 500),
  updated_at  timestamptz not null default now(),
  -- The host comes straight after https:// and is followed by the end, a path, a query or a fragment, so
  -- "https://facebook.com.evil.test" and "https://facebook.com@evil.test" are refused.
  constraint venue_social_links_platform_host check (
    url ~* case platform
      when 'facebook'  then '^https://([a-z0-9-]+\.)*(facebook\.com|fb\.com)([/?#][^[:space:]<>"]*)?$'
      when 'instagram' then '^https://([a-z0-9-]+\.)*instagram\.com([/?#][^[:space:]<>"]*)?$'
      when 'tiktok'    then '^https://([a-z0-9-]+\.)*tiktok\.com([/?#][^[:space:]<>"]*)?$'
      when 'youtube'   then '^https://([a-z0-9-]+\.)*(youtube\.com|youtu\.be)([/?#][^[:space:]<>"]*)?$'
      when 'x'         then '^https://([a-z0-9-]+\.)*(x\.com|twitter\.com)([/?#][^[:space:]<>"]*)?$'
      when 'messenger' then '^https://([a-z0-9-]+\.)*(m\.me|messenger\.com)([/?#][^[:space:]<>"]*)?$'
      else                  '^https://[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]{1,5})?([/?#][^[:space:]<>"]*)?$'
    end
  )
);

create trigger venue_social_links_set_updated_at
  before update on public.venue_social_links
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Info sections: a title and a body in the SimpleMarkdown subset (no HTML), in sort_order.
-- ---------------------------------------------------------------------------
create table public.venue_info_sections (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  body        text not null default '' check (char_length(body) <= 5000),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index venue_info_sections_sort_order_idx on public.venue_info_sections (sort_order);

create trigger venue_info_sections_set_updated_at
  before update on public.venue_info_sections
  for each row execute function private.set_updated_at();

-- A new section goes last. Runs as the inserting admin, who can read every section.
create function private.venue_info_sections_append()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.sort_order := coalesce((select max(s.sort_order) + 1 from public.venue_info_sections s), 0);
  return new;
end;
$$;

revoke all on function private.venue_info_sections_append() from public, anon, authenticated;

create trigger venue_info_sections_append
  before insert on public.venue_info_sections
  for each row execute function private.venue_info_sections_append();

-- Swap with the neighbour and renumber 0..n-1, like move_court.
create function public.move_info_section(p_id uuid, p_direction smallint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids   uuid[];
  v_pos   integer;
  v_other integer;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can reorder info sections.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_id is null or p_direction is null or p_direction not in (-1, 1) then
    raise exception 'Choose a section and a direction.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Lock every section so two admins reordering at once can't interleave.
  perform 1 from public.venue_info_sections s order by s.id for update;

  select array_agg(s.id order by s.sort_order, s.created_at, s.id) into v_ids from public.venue_info_sections s;
  v_pos := array_position(v_ids, p_id);
  if v_pos is null then
    raise exception 'That section no longer exists.' using errcode = 'P0001', hint = 'not_found';
  end if;
  v_other := v_pos + p_direction;
  if v_other between 1 and cardinality(v_ids) then
    v_ids[v_pos] := v_ids[v_other];
    v_ids[v_other] := p_id;
  end if;

  update public.venue_info_sections s
  set sort_order = o.ord - 1
  from unnest(v_ids) with ordinality as o(id, ord)
  where s.id = o.id and s.sort_order is distinct from o.ord - 1;
end;
$$;

revoke all on function public.move_info_section(uuid, smallint) from public, anon, authenticated;
grant execute on function public.move_info_section(uuid, smallint) to authenticated;

-- Starter sections, editable or deletable by the admin.
insert into public.venue_info_sections (title, body) values
  ('Waiver', E'By booking and playing at the venue, you accept that sports carry a risk of injury. You play at your own risk and are responsible for your own belongings.\n\nPlayers under 18 need a parent or guardian''s consent.'),
  ('Reminders and policies', E'Please arrive 10 minutes before your booking and leave the court on time for the next group.\n\nBring your booking reference. Wear non-marking court shoes.'),
  ('Cancellation and refund policy', E'You can cancel a booking from your booking page until the cancellation cutoff shown there. After that, the booking can''t be cancelled online.\n\n**Payments aren''t refunded through the app.** If the venue cancels your booking, or a payment can''t be applied, the venue arranges the refund with you.'),
  ('House rules', E'No smoking or vaping. Keep the courts clean and use the bins.\n\nFood and drinks stay outside the playing area, except water.');

-- ---------------------------------------------------------------------------
-- 4. Amenities: a built-in key (icon and label in the app) or a custom name. A row means it's switched on.
-- ---------------------------------------------------------------------------
create table public.venue_amenities (
  id           uuid primary key default gen_random_uuid(),
  builtin_key  text unique check (builtin_key in (
    'restrooms', 'parking', 'showers', 'canteen', 'cafe', 'tables', 'night_lights', 'wifi', 'lockers', 'aircon',
    'water_station', 'first_aid', 'equipment_rental', 'seating', 'pro_shop'
  )),
  custom_name  text check (char_length(btrim(custom_name)) between 1 and 40),
  created_at   timestamptz not null default now(),
  constraint venue_amenities_one_kind check ((builtin_key is null) <> (custom_name is null))
);

create unique index venue_amenities_custom_name_key on public.venue_amenities (lower(btrim(custom_name)));

-- ---------------------------------------------------------------------------
-- 5. Privileges + RLS: anyone reads; admins write (no RPC needed beyond the reorder).
-- ---------------------------------------------------------------------------
alter table public.venue_social_links  enable row level security;
alter table public.venue_info_sections enable row level security;
alter table public.venue_amenities     enable row level security;

revoke all on public.venue_social_links, public.venue_info_sections, public.venue_amenities from anon, authenticated;
grant select on public.venue_social_links, public.venue_info_sections, public.venue_amenities to anon, authenticated;
grant insert, update, delete on public.venue_social_links, public.venue_info_sections to authenticated;
grant insert, delete on public.venue_amenities to authenticated;

create policy "Anyone can read social links"
  on public.venue_social_links for select to anon, authenticated using (true);
create policy "Admins can insert social links"
  on public.venue_social_links for insert to authenticated with check ((select private.is_admin()));
create policy "Admins can update social links"
  on public.venue_social_links for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins can delete social links"
  on public.venue_social_links for delete to authenticated using ((select private.is_admin()));

create policy "Anyone can read info sections"
  on public.venue_info_sections for select to anon, authenticated using (true);
create policy "Admins can insert info sections"
  on public.venue_info_sections for insert to authenticated with check ((select private.is_admin()));
create policy "Admins can update info sections"
  on public.venue_info_sections for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins can delete info sections"
  on public.venue_info_sections for delete to authenticated using ((select private.is_admin()));

create policy "Anyone can read amenities"
  on public.venue_amenities for select to anon, authenticated using (true);
create policy "Admins can insert amenities"
  on public.venue_amenities for insert to authenticated with check ((select private.is_admin()));
create policy "Admins can delete amenities"
  on public.venue_amenities for delete to authenticated using ((select private.is_admin()));
