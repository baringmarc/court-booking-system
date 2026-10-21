-- Follow-up to T9.9/T9.10 (user decision, 2026-10-21; SPEC §10): 24 hours is set only as 12 AM → midnight
-- (00:00 → 24:00). An open day can't close at its opening time (06:00 → 06:00 used to mean 24 hours running into
-- the next morning; 00:00 → 00:00 too). A close before the open still means the next day (06:00 → 05:00).
-- Same RPC signature, so the grants are kept.

-- ---------------------------------------------------------------------------
-- 1. Reconcile: an open day stored as open = close becomes 00:00 → 24:00, still 24 hours (production's Saturday
--    was 06:00 → 06:00). The no-overlap check runs right away, so a clash fails this migration rather than
--    saving overlapping days; it also leaves no pending trigger events before the ALTER below.
-- ---------------------------------------------------------------------------
update public.operating_hours
set open_time = '00:00', close_time = '24:00'
where not is_closed and open_time = close_time;

set constraints public.operating_hours_no_overlap immediate;

-- ---------------------------------------------------------------------------
-- 2. Hold direct writes to the rule too. A closed day keeps whatever times it had.
-- ---------------------------------------------------------------------------
alter table public.operating_hours
  add constraint operating_hours_open_differs_from_close check (is_closed or close_time <> open_time);

-- ---------------------------------------------------------------------------
-- 3. set_operating_hours: the same rule with a readable message. Same body as 20261021120928 otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.set_operating_hours(p_hours jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_names constant text[] := array['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
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
    -- 24:00 and 00:00 are different times here, so 00:00 → 24:00 (24 hours) passes.
    if not coalesce((e ->> 'is_closed')::boolean, false) and (e ->> 'open_time')::time = (e ->> 'close_time')::time then
      raise exception '% opens and closes at the same time. For 24 hours, open at 12 AM and close at midnight.',
        v_names[(e ->> 'day_of_week')::int + 1] using errcode = 'P0001', hint = 'invalid_input';
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
