-- Milestone 9, T9.6: several photos per court (SPEC §6, §10; RESEARCH M9 "Court photos").
-- Expand only: courts.photo_path stays until the T9.11 contract migration, so the deployed frontend keeps working
-- (RESEARCH M9 "Shipping DB changes while production is live").

-- ---------------------------------------------------------------------------
-- 1. The table. The first photo (lowest sort_order) is the court's cover.
-- ---------------------------------------------------------------------------
create table public.court_photos (
  id          uuid primary key default gen_random_uuid(),
  court_id    uuid not null references public.courts (id) on delete cascade,
  path        text not null unique,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  -- Same rule as courts.photo_path: a new uuid file name in this court's own folder.
  constraint court_photos_path_check
    check (path ~ ('^courts/' || court_id::text || '/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'))
);

create index court_photos_court_order_idx on public.court_photos (court_id, sort_order);

alter table public.court_photos enable row level security;

-- Readable when the court itself is (the courts policy hides archived courts from the public).
create policy "Anyone can read photos of courts they can see"
  on public.court_photos for select to anon, authenticated
  using (exists (select 1 from public.courts c where c.id = court_photos.court_id));
create policy "Admins can insert court photos"
  on public.court_photos for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins can update court photos"
  on public.court_photos for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins can delete court photos"
  on public.court_photos for delete to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 2. At most 6 photos per court. The court row is locked so two uploads at once can't both get the 6th place.
-- ---------------------------------------------------------------------------
create function private.check_court_photo_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.courts c where c.id = new.court_id for update;
  if (select count(*) from public.court_photos p where p.court_id = new.court_id) >= 6 then
    raise exception 'A court can have at most 6 photos. Remove one first.'
      using errcode = 'P0001', hint = 'too_many_photos';
  end if;
  return new;
end;
$$;

revoke all on function private.check_court_photo_limit() from public, anon, authenticated;

create trigger court_photos_limit
  before insert on public.court_photos
  for each row execute function private.check_court_photo_limit();

-- ---------------------------------------------------------------------------
-- 3. Reorder a court's photos in one step (sort_order 0..n-1 in the given order; the first is the cover).
-- ---------------------------------------------------------------------------
create function public.reorder_court_photos(p_court_id uuid, p_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can reorder photos.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_court_id is null or p_ids is null then
    raise exception 'Choose a court and its photos.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Lock the court's photos, then require the list to be exactly them, each once.
  perform 1 from public.court_photos p where p.court_id = p_court_id order by p.id for update;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(p.id order by p.id) from public.court_photos p where p.court_id = p_court_id)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The photo list is out of date. Reload the page and try again.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.court_photos p
  set sort_order = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where p.id = o.id and p.sort_order is distinct from o.ord - 1;
end;
$$;

revoke all on function public.reorder_court_photos(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_court_photos(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Backfill: each courts.photo_path becomes that court's cover. Idempotent, so T9.11 runs it again right before
--    dropping photo_path, to catch photos uploaded through the old frontend in between.
-- ---------------------------------------------------------------------------
create function private.backfill_court_photos()
returns integer
language sql
volatile
set search_path = ''
as $$
  with added as (
    insert into public.court_photos (court_id, path, sort_order)
    select c.id, c.photo_path,
           -- before any photos already there, so it stays the cover
           coalesce((select min(p.sort_order) from public.court_photos p where p.court_id = c.id) - 1, 0)
    from public.courts c
    where c.photo_path is not null
    on conflict (path) do nothing
    returning 1
  )
  select count(*)::integer from added;
$$;

revoke all on function private.backfill_court_photos() from public, anon, authenticated;

select private.backfill_court_photos();
