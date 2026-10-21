-- Milestone 9, T9.11: the contract step (RESEARCH M9 "Shipping DB changes while production is live").
-- The T9.7 frontend (court_photos only) is on master, so courts.photo_path can go. Before dropping it, the gallery is
-- reconciled with Storage (T9.6 review): rows whose file is gone are removed, and a legacy photo_path whose file
-- still exists is copied in one last time, unless the court's gallery is full.
-- Also the T9.9 follow-ups: set_operating_hours checks each day's shape with its own message, and the no-overlap
-- trigger serialises concurrent checks (write skew).

-- ---------------------------------------------------------------------------
-- 1. Reconcile court_photos with Storage. Kept as a function: deleting files by hand leaves the same mess.
-- ---------------------------------------------------------------------------
create function private.prune_missing_court_photos()
returns integer
language sql
volatile
set search_path = ''
as $$
  with gone as (
    delete from public.court_photos p
    where not exists (
      select 1 from storage.objects o where o.bucket_id = 'venue-media' and o.name = p.path
    )
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function private.prune_missing_court_photos() from public, anon, authenticated;

select private.prune_missing_court_photos();

-- ---------------------------------------------------------------------------
-- 2. One last copy of legacy photos uploaded through the old frontend: only files that still exist, not already in
--    the gallery, and only where there's room (the limit trigger would otherwise abort this migration).
--    It goes first, so it stays the cover it was.
-- ---------------------------------------------------------------------------
insert into public.court_photos (court_id, path, sort_order)
select c.id, c.photo_path,
       coalesce((select min(p.sort_order) from public.court_photos p where p.court_id = c.id) - 1, 0)
from public.courts c
where c.photo_path is not null
  and exists (select 1 from storage.objects o where o.bucket_id = 'venue-media' and o.name = c.photo_path)
  and not exists (select 1 from public.court_photos p where p.path = c.photo_path)
  and (select count(*) from public.court_photos p where p.court_id = c.id) < 6;

-- ---------------------------------------------------------------------------
-- 3. Contract: the single-photo column and the expand-phase backfill go.
-- ---------------------------------------------------------------------------
drop function private.backfill_court_photos();
alter table public.courts drop constraint courts_photo_path_check;
alter table public.courts drop column photo_path;

-- ---------------------------------------------------------------------------
-- 4. set_operating_hours: each element checked first, with its own message (T9.9 review). A 24:00 opening is
--    refused: it would start the day on the next date. Same signature, so the grants are kept.
-- ---------------------------------------------------------------------------
create or replace function public.set_operating_hours(p_hours jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  e jsonb;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can change opening hours.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 7 then
    raise exception 'Send the hours for all seven days.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  for e in select * from jsonb_array_elements(p_hours) loop
    if jsonb_typeof(e) <> 'object' or coalesce(e ->> 'day_of_week', '') !~ '^[0-6]$' then
      raise exception 'Each day needs a day of the week from 0 (Sunday) to 6 (Saturday).'
        using errcode = 'P0001', hint = 'invalid_input';
    end if;
    if coalesce(e ->> 'open_time', '') !~ '^([01][0-9]|2[0-3]):00(:00)?$' then
      raise exception 'Opening times must be whole hours from 00:00 to 23:00.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    if coalesce(e ->> 'close_time', '') !~ '^([01][0-9]|2[0-4]):00(:00)?$' then
      raise exception 'Closing times must be whole hours from 00:00 to 24:00.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    if e ? 'is_closed' and jsonb_typeof(e -> 'is_closed') <> 'boolean' then
      raise exception 'Closed must be true or false.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
  end loop;
  if (select count(distinct (e2 ->> 'day_of_week')::int) from jsonb_array_elements(p_hours) e2) <> 7 then
    raise exception 'Send the hours for all seven days.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.operating_hours oh
  set open_time = (x ->> 'open_time')::time,
      close_time = (x ->> 'close_time')::time,
      is_closed = coalesce((x ->> 'is_closed')::boolean, false)
  from jsonb_array_elements(p_hours) x
  where oh.day_of_week = (x ->> 'day_of_week')::smallint;

  -- Check now, so a clash comes back as this call's error instead of at commit.
  set constraints public.operating_hours_no_overlap immediate;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The no-overlap check, serialised: at commit, a check waits for any other transaction checking the hours, so
--    it reads that one's committed rows. Two concurrent single-day updates can no longer both pass into an overlap.
--    Same body as 20261021001821 otherwise.
-- ---------------------------------------------------------------------------
create or replace function private.check_operating_hours()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_names constant text[] := array['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  r record;
begin
  perform pg_advisory_xact_lock(hashtext('public.operating_hours no overlap'));

  -- Hours past each day's midnight: a day ends at close (+24 when it closes the next day); the next day,
  -- in the same frame, opens at 24 + its open. They overlap when the end is later than that.
  for r in
    select d.day_of_week as dow, n.day_of_week as next_dow
    from public.operating_hours d
    join public.operating_hours n on n.day_of_week = (d.day_of_week + 1) % 7
    where not d.is_closed and not n.is_closed
      and extract(epoch from d.close_time) / 3600 + case when d.close_time <= d.open_time then 24 else 0 end
          > 24 + extract(epoch from n.open_time) / 3600
  loop
    raise exception '% runs past % opening time. Close earlier, or open % later.',
      v_names[r.dow + 1], v_names[r.next_dow + 1] || '''s', v_names[r.next_dow + 1]
      using errcode = 'P0001', hint = 'hours_overlap';
  end loop;
  return null;
end;
$$;
