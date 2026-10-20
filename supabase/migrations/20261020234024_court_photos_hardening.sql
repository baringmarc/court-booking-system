-- Milestone 9, T9.6 review fixes for court_photos (approved by the user on 2026-10-21).
-- 1. Least-privilege grants, like every other table (catalog.sql: revoke all, then grant what RLS gates).
-- 2. The 6-photo limit also applies when a photo is moved to another court.
-- 3. A lighter lock: "for no key update" on the court still serializes two uploads (they conflict with each
--    other) but no longer blocks booking inserts, whose foreign key only takes a key-share lock on the court.
-- 4. A photo inserted without a sort_order goes after the last one, instead of tying with the cover at 0.
-- 5. reorder_court_photos takes the same court lock, so it can't interleave with an upload.

-- ---------------------------------------------------------------------------
-- 1. Grants
-- ---------------------------------------------------------------------------
revoke all on public.court_photos from anon, authenticated;
grant select on public.court_photos to anon, authenticated;
grant insert, update, delete on public.court_photos to authenticated;

-- ---------------------------------------------------------------------------
-- 2–4. The limit trigger
-- ---------------------------------------------------------------------------
-- No default: the trigger fills it in (NOT NULL is checked after BEFORE triggers).
alter table public.court_photos alter column sort_order drop default;

create or replace function private.check_court_photo_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.court_id is not distinct from old.court_id then
    return new;
  end if;

  perform 1 from public.courts c where c.id = new.court_id for no key update;
  if (select count(*) from public.court_photos p where p.court_id = new.court_id and p.id <> new.id) >= 6 then
    raise exception 'A court can have at most 6 photos. Remove one first.'
      using errcode = 'P0001', hint = 'too_many_photos';
  end if;

  if new.sort_order is null then
    new.sort_order := coalesce(
      (select max(p.sort_order) + 1 from public.court_photos p where p.court_id = new.court_id and p.id <> new.id), 0);
  end if;
  return new;
end;
$$;

drop trigger court_photos_limit on public.court_photos;
create trigger court_photos_limit
  before insert or update of court_id on public.court_photos
  for each row execute function private.check_court_photo_limit();

-- ---------------------------------------------------------------------------
-- 5. reorder_court_photos: same body as 20261020233215, plus the court lock first.
-- ---------------------------------------------------------------------------
create or replace function public.reorder_court_photos(p_court_id uuid, p_ids uuid[])
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

  -- The court lock the upload trigger takes, then the photos: an upload can't slip in between.
  perform 1 from public.courts c where c.id = p_court_id for no key update;
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
