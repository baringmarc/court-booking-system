-- Milestone 9, T9.5: delete a court that was never booked (SPEC §6, §10; RESEARCH M9 "Court order and deletion").
-- Plus the T9.3 follow-up: sport_order must be a one-dimensional array.
-- Additive for the deployed frontend (RESEARCH M9 "Shipping DB changes while production is live").

-- ---------------------------------------------------------------------------
-- 1. delete_court. A booked court can only be archived, so booking history keeps its court.
--    Rates and court-specific blackouts cascade. Photo files are removed by the client through the Storage API
--    (RESEARCH M6: deleting storage rows in SQL would orphan the files).
-- ---------------------------------------------------------------------------
create function public.delete_court(p_court_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can delete courts.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_court_id is null then
    raise exception 'Choose a court.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Lock the court: inserting a booking takes a key-share lock on it (foreign key), so a booking being
  -- created right now either finishes first (and is seen below) or waits and then fails on the missing court.
  perform 1 from public.courts c where c.id = p_court_id for update;
  if not found then
    raise exception 'That court does not exist.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  if exists (select 1 from public.bookings b where b.court_id = p_court_id) then
    raise exception 'This court has bookings, so it can''t be deleted. Archive it instead.'
      using errcode = 'P0001', hint = 'court_has_bookings';
  end if;

  begin
    delete from public.courts c where c.id = p_court_id;
  exception when foreign_key_violation then
    -- The bookings foreign key (on delete restrict) is the second line of defence.
    raise exception 'This court has bookings, so it can''t be deleted. Archive it instead.'
      using errcode = 'P0001', hint = 'court_has_bookings';
  end;
end;
$$;

revoke all on function public.delete_court(uuid) from public, anon, authenticated;
grant execute on function public.delete_court(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. sport_order: also require a one-dimensional array. A 2-D array with every sport passed the T9.3 check,
--    and array_position (get_availability) throws on it. array_ndims of an empty array is null, hence coalesce.
-- ---------------------------------------------------------------------------
alter table public.venue_settings
  drop constraint venue_settings_sport_order_complete,
  add constraint venue_settings_sport_order_complete check (
    coalesce(array_ndims(sport_order), 0) = 1
    and cardinality(sport_order) = cardinality(enum_range(null::public.sport))
    and sport_order @> enum_range(null::public.sport)
  );
