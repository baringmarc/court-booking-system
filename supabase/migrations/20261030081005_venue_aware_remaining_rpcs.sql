-- T12.6: the remaining RPCs read their venue (expand only; the old call shapes keep working).
-- A row names its venue (court, booking, session); RPCs with no row take an optional trailing venue id that is
-- authorised, never trusted: no id means the caller's only venue.

create function private.is_any_venue_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
     and (private.is_platform_admin() or exists (select 1 from public.venue_members m where m.user_id = auth.uid()));
$$;

create function private.admin_venue(p_venue uuid default null)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'Only staff can do this.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_venue is not null then
    if not private.is_venue_admin(p_venue) then
      raise exception 'Only staff of this venue can do this.' using errcode = 'P0001', hint = 'forbidden';
    end if;
    return p_venue;
  end if;
  select array_agg(m.venue_id) into v_ids from public.venue_members m where m.user_id = auth.uid();
  if v_ids is null then
    raise exception 'Only staff can do this.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if cardinality(v_ids) > 1 then
    raise exception 'Say which venue you mean.' using errcode = 'P0001', hint = 'venue_required';
  end if;
  return v_ids[1];
end;
$$;

revoke execute on function private.is_any_venue_admin() from public, anon, authenticated;
revoke execute on function private.admin_venue(uuid) from public, anon, authenticated;

-- Open play
drop function private.save_open_play(uuid, uuid[], timestamptz, timestamptz, text, text, jsonb);

create function private.save_open_play(p_venue uuid, p_id uuid, p_court_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_title text, p_details text, p_links jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tz      text := private.venue_tz(p_venue);
  v_title   text := btrim(p_title);
  v_details text := coalesce(btrim(p_details), '');
  v_links   jsonb := coalesce(p_links, '[]'::jsonb);
  v_courts  uuid[];
  v_court   uuid;
  v_during  tstzrange;
  v_day     date;
  v_clash   text;
  v_id      uuid := p_id;
begin
  if v_title is null or char_length(v_title) not between 1 and 80 then
    raise exception 'Give the session a title (up to 80 characters).' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if char_length(v_details) > 2000 then
    raise exception 'Keep the details under 2000 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if not private.valid_open_play_links(v_links) then
    raise exception 'Each link needs a label (up to 40 characters) and an https:// address, and there can be at most 3.'
      using errcode = 'P0001', hint = 'invalid_links';
  end if;

  select array_agg(distinct x order by x) into v_courts from unnest(p_court_ids) x where x is not null;
  if v_courts is null then
    raise exception 'Choose at least one court.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if exists (select 1 from public.courts c where c.id = any (v_courts) and c.venue_id <> p_venue) then
    raise exception 'Choose courts of this venue.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if exists (
    select 1 from unnest(v_courts) x
    where not exists (select 1 from public.courts c where c.id = x and c.is_active)
  ) then
    raise exception 'Choose active courts only.' using errcode = 'P0001', hint = 'court_inactive';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Choose a start time and a later end time.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if date_trunc('hour', p_start at time zone v_tz) <> p_start at time zone v_tz
     or date_trunc('hour', p_end at time zone v_tz) <> p_end at time zone v_tz then
    raise exception 'Sessions start and end on the hour.' using errcode = 'P0001', hint = 'not_aligned';
  end if;
  if p_start <= now() then
    raise exception 'That time has already started. Please pick a later time.' using errcode = 'P0001', hint = 'slot_started';
  end if;
  v_during := tstzrange(p_start, p_end);
  v_day := private.operating_day_of(p_venue, p_start);
  if v_day is null or not private.operating_day_range(p_venue, v_day) @> v_during then
    raise exception 'A session must fit within one day''s opening hours.' using errcode = 'P0001', hint = 'outside_hours';
  end if;

  -- The courts' locks in uuid order (create_booking takes one of them), then check with a fresh snapshot.
  foreach v_court in array v_courts loop
    perform private.lock_court_slots(v_court);
  end loop;

  -- Active bookings, by the same rule as get_availability (a lapsed hold doesn't count; its revival re-checks).
  select string_agg(distinct c.name, ', ' order by c.name) into v_clash
  from public.bookings b
  join public.courts c on c.id = b.court_id
  where b.court_id = any (v_courts)
    and b.during && v_during
    and b.status in ('pending_payment', 'payment_submitted', 'confirmed')
    and not (b.status = 'pending_payment' and b.expires_at <= now());
  if v_clash is not null then
    raise exception 'There are bookings on % at that time. Cancel or move them first.', v_clash
      using errcode = 'P0001', hint = 'slot_unavailable';
  end if;

  if v_id is null then
    insert into public.open_play_sessions (venue_id, title, details, links, starts_at, ends_at)
    values (p_venue, v_title, v_details, v_links, p_start, p_end)
    returning id into v_id;
  else
    update public.open_play_sessions
    set title = v_title, details = v_details, links = v_links, starts_at = p_start, ends_at = p_end, updated_at = now()
    where id = v_id;
    delete from public.open_play_courts where session_id = v_id;
  end if;

  begin
    insert into public.open_play_courts (session_id, court_id, during)
    select v_id, x, v_during from unnest(v_courts) x;
  exception when exclusion_violation then
    raise exception 'Another open play session already uses one of those courts at that time.'
      using errcode = 'P0001', hint = 'session_overlap';
  end;

  return v_id;
end;
$function$;

revoke execute on function private.save_open_play(uuid, uuid, uuid[], timestamptz, timestamptz, text, text, jsonb) from public, anon, authenticated;


create or replace function public.create_open_play(p_court_ids uuid[], p_start timestamptz, p_end timestamptz, p_title text, p_details text default '', p_links jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_venues uuid[];
  v_venue  uuid;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can manage open play sessions.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  -- The venue is the courts' own; courts of two venues can't share a session.
  select array_agg(distinct c.venue_id) into v_venues from public.courts c where c.id = any (p_court_ids);
  if exists (select 1 from unnest(v_venues) v where not private.is_venue_admin(v)) then
    raise exception 'Only staff can manage open play sessions.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if cardinality(v_venues) > 1 then
    raise exception 'Choose courts of one venue.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  v_venue := coalesce(v_venues[1], private.admin_venue(null));
  return private.save_open_play(v_venue, null, p_court_ids, p_start, p_end, p_title, p_details, p_links);
end;
$$;

create or replace function public.update_open_play(p_id uuid, p_court_ids uuid[], p_start timestamptz, p_end timestamptz, p_title text, p_details text default '', p_links jsonb default '[]'::jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_venue  uuid;
  v_starts timestamptz;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can manage open play sessions.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  select s.venue_id into v_venue from public.open_play_sessions s where s.id = p_id;
  if not found then
    raise exception 'That open play session doesn''t exist.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if not private.is_venue_admin(v_venue) then
    raise exception 'Only staff can manage open play sessions.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  select s.starts_at into v_starts from public.open_play_sessions s where s.id = p_id for update;
  if not found then
    raise exception 'That open play session doesn''t exist.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_starts <= now() then
    raise exception 'This session has already started, so it can''t be edited.' using errcode = 'P0001', hint = 'session_started';
  end if;
  return private.save_open_play(v_venue, p_id, p_court_ids, p_start, p_end, p_title, p_details, p_links);
end;
$$;

create or replace function public.delete_open_play(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_venue uuid;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can manage open play sessions.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  select s.venue_id into v_venue from public.open_play_sessions s where s.id = p_id;
  if found and not private.is_venue_admin(v_venue) then
    raise exception 'Only staff can manage open play sessions.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  delete from public.open_play_sessions where id = p_id;
  if not found then
    raise exception 'That open play session doesn''t exist.' using errcode = 'P0001', hint = 'not_found';
  end if;
end;
$$;

-- Reschedule

CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking_id uuid, p_from_start timestamp with time zone, p_new_court_id uuid, p_new_start timestamp with time zone, p_reason text)
 RETURNS TABLE(change_id uuid, continuation_id uuid, continuation_reference text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_admin      uuid := auth.uid();
  v_reason     text := nullif(trim(p_reason), '');
  v_court_id   uuid;
  v_booking    public.bookings;
  v_sport      public.sport;
  v_new_court  public.courts;
  v_hours      integer;
  v_new        tstzrange;
  v_old_part   tstzrange;
  v_root       uuid;
  v_cont_id    uuid;
  v_cont_ref   text;
  v_change_id  uuid;
  v_constraint text;
  v_venue      uuid;
begin
  if v_admin is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can reschedule bookings.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_booking_id is null or p_from_start is null or p_new_court_id is null or p_new_start is null then
    raise exception 'Choose the booking, the hour to move from and the new court and time.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if v_reason is null then
    raise exception 'Give a reason so the player knows why.' using errcode = 'P0001', hint = 'reason_required';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Both courts are locked (in id order, so two reschedules can't deadlock) before the booking row; then the
  -- booking's court is re-read, in case it moved in between.
  select b.court_id, b.venue_id into v_court_id, v_venue from public.bookings b where b.id = p_booking_id;
  if v_court_id is null then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if not private.is_venue_admin(v_venue) then
    raise exception 'Only staff can reschedule bookings.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  perform private.lock_court_slots(least(v_court_id, p_new_court_id));
  perform private.lock_court_slots(greatest(v_court_id, p_new_court_id));

  select b.* into v_booking from public.bookings b where b.id = p_booking_id for update;
  if v_booking.court_id <> v_court_id then
    raise exception 'The booking just changed. Try again.' using errcode = 'P0001', hint = 'try_again';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be rescheduled.' using errcode = 'P0001', hint = 'not_confirmed';
  end if;
  if now() >= upper(v_booking.during) then
    raise exception 'This booking has already ended.' using errcode = 'P0001', hint = 'booking_ended';
  end if;

  -- The moved part starts on one of the booking's own hours, no earlier than the hour in progress.
  if p_from_start < lower(v_booking.during) or p_from_start >= upper(v_booking.during) then
    raise exception 'Choose an hour inside the booking.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if mod(extract(epoch from p_from_start - lower(v_booking.during))::bigint, 3600) <> 0 then
    raise exception 'Bookings move by whole hours.' using errcode = 'P0001', hint = 'not_aligned';
  end if;
  if p_from_start + interval '1 hour' <= now() then
    raise exception 'That hour has already passed. Choose the hour in progress or a later one.'
      using errcode = 'P0001', hint = 'from_past';
  end if;

  select c.sport into v_sport from public.courts c where c.id = v_booking.court_id;
  select c.* into v_new_court from public.courts c where c.id = p_new_court_id;
  if not found then
    raise exception 'That court does not exist.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if v_new_court.venue_id <> v_venue then
    raise exception 'That court does not exist.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if not v_new_court.is_active then
    raise exception 'This court is not available for booking.' using errcode = 'P0001', hint = 'court_inactive';
  end if;
  if v_new_court.sport <> v_sport then
    raise exception 'A booking can only move to a court of the same sport.'
      using errcode = 'P0001', hint = 'different_sport';
  end if;

  v_hours := (extract(epoch from upper(v_booking.during) - p_from_start) / 3600)::integer;
  v_new := private.validate_booking_slot(p_new_court_id, p_new_start, v_hours, true);
  v_old_part := tstzrange(p_from_start, upper(v_booking.during));

  if p_new_court_id = v_booking.court_id and v_new = v_old_part then
    raise exception 'That is where the booking already is.' using errcode = 'P0001', hint = 'no_change';
  end if;

  -- Same lazy expiry as create_booking: release stale holds that overlap the new range first.
  update public.bookings b
  set status = 'expired'
  where b.court_id = p_new_court_id
    and b.status = 'pending_payment'
    and b.expires_at <= now()
    and b.during && v_new;

  begin
    if p_from_start = lower(v_booking.during) then
      update public.bookings set court_id = p_new_court_id, during = v_new where id = v_booking.id;
    else
      v_root := coalesce(v_booking.parent_booking_id, v_booking.id);
      update public.bookings set during = tstzrange(lower(v_booking.during), p_from_start) where id = v_booking.id;

      for attempt in 1..5 loop
        begin
          insert into public.bookings as b (
            reference_code, court_id, user_id, guest_name, guest_email, guest_phone, during, total_amount,
            status, source, created_by, guest_token_hash, parent_booking_id
          ) values (
            private.new_reference_code(), p_new_court_id, v_booking.user_id, v_booking.guest_name,
            v_booking.guest_email, v_booking.guest_phone, v_new, 0,
            'confirmed', 'moved', v_admin, v_booking.guest_token_hash, v_root
          )
          returning b.id, b.reference_code into v_cont_id, v_cont_ref;
          exit;
        exception when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          if v_constraint <> 'bookings_reference_code_key' or attempt = 5 then
            raise;
          end if;
        end;
      end loop;
    end if;
  exception when exclusion_violation then
    raise exception 'That court is already booked for part of this time.'
      using errcode = 'P0001', hint = 'slot_unavailable';
  end;

  insert into public.booking_changes (
    booking_id, old_court_id, old_during, new_court_id, new_during, continuation_id, reason, changed_by
  ) values (
    v_booking.id, v_booking.court_id, v_old_part, p_new_court_id, v_new, v_cont_id, v_reason, v_admin
  )
  returning id into v_change_id;

  return query select v_change_id, v_cont_id, v_cont_ref;
end;
$function$;


-- Walk-ins and courts

CREATE OR REPLACE FUNCTION public.create_walk_in(p_court_id uuid, p_start timestamp with time zone, p_slots integer, p_name text, p_phone text DEFAULT NULL::text, p_method payment_method DEFAULT 'cash'::payment_method, p_amount numeric DEFAULT NULL::numeric, p_reference_number text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, reference_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_admin      uuid := auth.uid();
  v_during     tstzrange;
  v_name       text := nullif(trim(p_name), '');
  v_phone      text := nullif(trim(p_phone), '');
  v_reference  text := nullif(trim(p_reference_number), '');
  v_price      numeric;
  v_amount     numeric;
  v_id         uuid;
  v_ref        text;
  v_constraint text;
  v_venue      uuid;
begin
  if v_admin is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can record walk-ins.' using errcode = 'P0001', hint = 'forbidden';
  end if;

  select c.venue_id into v_venue from public.courts c where c.id = p_court_id;
  if v_venue is not null and not private.is_venue_admin(v_venue) then
    raise exception 'Only staff can record walk-ins.' using errcode = 'P0001', hint = 'forbidden';
  end if;

  -- Serialize with open play sessions on this court; validate_booking_slot then checks a fresh snapshot.
  perform private.lock_court_slots(p_court_id);
  v_during := private.validate_booking_slot(p_court_id, p_start, p_slots, true);

  if v_name is null then
    raise exception 'Enter the customer''s name.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if length(v_name) > 100 or length(v_phone) > 30 or length(v_reference) > 100 then
    raise exception 'Name, phone or reference is too long.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if p_method is null then
    raise exception 'Choose how the customer paid.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  v_price := private.range_price(p_court_id, v_during);
  v_amount := round(coalesce(p_amount, v_price), 2);
  if v_amount < 0 or v_amount > 1000000 then
    raise exception 'Enter the amount received.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Same lazy expiry as create_booking: release overlapping stale holds first.
  update public.bookings b
  set status = 'expired'
  where b.court_id = p_court_id
    and b.status = 'pending_payment'
    and b.expires_at <= now()
    and b.during && v_during;

  for attempt in 1..5 loop
    begin
      insert into public.bookings as b (
        reference_code, court_id, user_id, guest_name, guest_phone,
        during, total_amount, status, source, created_by
      ) values (
        private.new_reference_code(), p_court_id, null, v_name, v_phone,
        v_during, v_price, 'confirmed', 'walk_in', v_admin
      )
      returning b.id, b.reference_code into v_id, v_ref;
      exit;
    exception
      when exclusion_violation then
        raise exception 'That court is already booked for part of this time.'
          using errcode = 'P0001', hint = 'slot_unavailable';
      when foreign_key_violation then
        raise exception 'This court is not available for booking.' using errcode = 'P0001', hint = 'court_inactive';
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint <> 'bookings_reference_code_key' or attempt = 5 then
          raise;
        end if;
    end;
  end loop;

  insert into public.payments (
    booking_id, method, amount, reference_number, recorded_by,
    review_status, reviewed_by, reviewed_at
  ) values (
    v_id, p_method, v_amount, v_reference, v_admin,
    'approved', v_admin, now()
  );

  return query select v_id, v_ref;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_court(p_court_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue uuid;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can delete courts.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_court_id is null then
    raise exception 'Choose a court.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  select c.venue_id into v_venue from public.courts c where c.id = p_court_id;
  if v_venue is not null and not private.is_venue_admin(v_venue) then
    raise exception 'Only staff can delete courts.' using errcode = 'P0001', hint = 'forbidden';
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
$function$;

CREATE OR REPLACE FUNCTION public.reorder_court_photos(p_court_id uuid, p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue uuid;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can reorder photos.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_court_id is null or p_ids is null then
    raise exception 'Choose a court and its photos.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  select c.venue_id into v_venue from public.courts c where c.id = p_court_id;
  if v_venue is not null and not private.is_venue_admin(v_venue) then
    raise exception 'Only staff can reorder photos.' using errcode = 'P0001', hint = 'forbidden';
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
$function$;

CREATE OR REPLACE FUNCTION public.reorder_courts(p_sport sport, p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue uuid;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can reorder courts.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_sport is null or p_ids is null then
    raise exception 'Choose a sport and its courts.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- The venue is the first court's; an empty list is the caller's only venue.
  select c.venue_id into v_venue from public.courts c where c.id = p_ids[1];
  if v_venue is null then
    v_venue := private.admin_venue(null);
  elsif not private.is_venue_admin(v_venue) then
    raise exception 'Only staff can reorder courts.' using errcode = 'P0001', hint = 'forbidden';
  end if;

  -- Lock the sport's courts (the order move_court takes) so two admins reordering at once can't interleave.
  perform 1 from public.courts c where c.sport = p_sport and c.venue_id = v_venue order by c.id for update;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(c.id order by c.id) from public.courts c where c.sport = p_sport and c.venue_id = v_venue)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The court list is out of date. Reload the page and try again.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.courts c
  set sort_order = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where c.id = o.id and c.sort_order is distinct from o.ord - 1;
end;
$function$;


-- RPCs with no row: an optional venue id

drop function public.reorder_info_sections(uuid[]);
drop function public.reorder_payment_accounts(uuid[]);
drop function public.set_operating_hours(jsonb);
drop function public.get_earnings(date, date);


create function public.reorder_info_sections(p_ids uuid[], p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue uuid;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can reorder info sections.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  v_venue := private.admin_venue(p_venue_id);
  if p_ids is null then
    raise exception 'Choose the sections.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  perform 1 from public.venue_info_sections s where s.venue_id = v_venue order by s.id for update;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(s.id order by s.id) from public.venue_info_sections s where s.venue_id = v_venue)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The section list is out of date. Reload the page and try again.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.venue_info_sections s
  set sort_order = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where s.venue_id = v_venue and s.id = o.id and s.sort_order is distinct from o.ord - 1;
end;
$function$;

create function public.reorder_payment_accounts(p_ids uuid[], p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue uuid;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can reorder payment accounts.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  v_venue := private.admin_venue(p_venue_id);
  if p_ids is null then
    raise exception 'Choose the accounts.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  perform 1 from public.venue_payment_accounts a where a.venue_id = v_venue order by a.id for update;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(a.id order by a.id) from public.venue_payment_accounts a where a.venue_id = v_venue)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The account list is out of date. Reload the page and try again.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.venue_payment_accounts a
  set position = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where a.venue_id = v_venue and a.id = o.id and a.position is distinct from o.ord - 1;
end;
$function$;

create function public.set_operating_hours(p_hours jsonb, p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_names constant text[] := array['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  e jsonb;
  v_venue uuid;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can change opening hours.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  v_venue := private.admin_venue(p_venue_id);
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
  where oh.venue_id = v_venue and oh.day_of_week = (x ->> 'day_of_week')::smallint;

  -- Check now, so a clash comes back as this call's error instead of at commit.
  set constraints public.operating_hours_no_overlap immediate;
end;
$function$;

create function public.get_earnings(p_from date, p_to date, p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue      uuid;
  v_tz         text;
  v_days       integer;
  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_result     jsonb;
begin
  v_venue := private.admin_venue(p_venue_id);
  v_tz := private.venue_tz(v_venue);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from >= 366 then
    raise exception 'Choose a start and end date, up to 366 days apart.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  v_days := p_to - p_from + 1;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;
  v_prev_start := (p_from - v_days)::timestamp at time zone v_tz;

  with
  -- Approved payments in this period and the one just before it.
  paid as (
    select p.method, p.paid_with, p.amount, p.reviewed_at, (p.reviewed_at at time zone v_tz)::date as day
    from public.payments p
    where p.venue_id = v_venue and p.review_status = 'approved' and p.reviewed_at >= v_prev_start and p.reviewed_at < v_end
  ),
  cur as (select * from paid where reviewed_at >= v_start),
  prev as (select * from paid where reviewed_at < v_start),
  -- Plotline fees (T11.12): a booking's fee counts once, when its first payment was approved, unless the venue
  -- cancelled it (SAAS-PLAN §5). Player cancellations keep their fee.
  fee_bookings as (
    select b.booking_fee, min(p.reviewed_at) as paid_at
    from public.bookings b
    join public.payments p on p.booking_id = b.id and p.review_status = 'approved'
    where b.venue_id = v_venue and b.booking_fee > 0 and not b.cancelled_by_venue
    group by b.id, b.booking_fee
  ),
  dates as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  ),
  open_days as (
    select dt.day, private.operating_day_range(v_venue, dt.day) as r from dates dt
  ),
  courts as (
    select c.id, c.name, c.sport, c.sort_order,
           array_position((select vs.sport_order from public.venue_settings vs where vs.venue_id = v_venue), c.sport) as sport_pos
    from public.courts c
    where c.is_active and c.venue_id = v_venue
  ),
  -- One row per active court and open operating day, with that day's hours in each category.
  hours as (
    select
      c.id as court_id,
      od.day,
      extract(epoch from upper(od.r) - lower(od.r)) / 3600 as open_h,
      coalesce((
        select sum(extract(epoch from upper(x) - lower(x))) / 3600
        from unnest((
          select range_agg(tstzrange(bo.starts_at, bo.ends_at) * od.r)
          from public.blackouts bo
          where bo.venue_id = v_venue and (bo.court_id is null or bo.court_id = c.id) and tstzrange(bo.starts_at, bo.ends_at) && od.r
        )) as x
      ), 0) as blackout_h,
      coalesce((
        select sum(extract(epoch from upper(b.during * od.r) - lower(b.during * od.r))) / 3600
        from public.bookings b
        where b.court_id = c.id and b.status = 'confirmed' and b.during && od.r
      ), 0) as sold_h,
      coalesce((
        select sum(extract(epoch from upper(oc.during * od.r) - lower(oc.during * od.r))) / 3600
        from public.open_play_courts oc
        where oc.court_id = c.id and oc.during && od.r
      ), 0) as open_play_h
    from courts c
    cross join open_days od
    where od.r is not null
  ),
  per_court as (
    select c.id, c.name, c.sport, c.sort_order, c.sport_pos,
           coalesce(sum(h.open_h), 0) as open_h,
           coalesce(sum(h.blackout_h), 0) as blackout_h,
           coalesce(sum(h.sold_h), 0) as sold_h,
           coalesce(sum(h.open_play_h), 0) as open_play_h
    from courts c
    left join hours h on h.court_id = c.id
    group by c.id, c.name, c.sport, c.sort_order, c.sport_pos
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'timezone', v_tz,
    'collected', (
      select jsonb_build_object(
        'total', coalesce(sum(m.amount), 0),
        'count', coalesce(sum(m.n), 0),
        'by_method', coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'paid_with', m.paid_with, 'amount', m.amount, 'count', m.n) order by m.method, m.paid_with), '[]'::jsonb))
      from (select method, paid_with, sum(amount) as amount, count(*) as n from cur group by method, paid_with) m
    ),
    'previous', (
      select jsonb_build_object(
        'from', p_from - v_days,
        'to', p_from - 1,
        'total', coalesce(sum(m.amount), 0),
        'count', coalesce(sum(m.n), 0),
        'by_method', coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'paid_with', m.paid_with, 'amount', m.amount, 'count', m.n) order by m.method, m.paid_with), '[]'::jsonb))
      from (select method, paid_with, sum(amount) as amount, count(*) as n from prev group by method, paid_with) m
    ),
    'refunds_due', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(p.amount), 0))
      from public.payments p
      where p.venue_id = v_venue and p.method = 'paymongo' and p.review_status = 'rejected' and p.reviewed_at >= v_start and p.reviewed_at < v_end
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'date', dt.day,
        'collected', coalesce((select sum(cur.amount) from cur where cur.day = dt.day), 0),
        'sold_hours', round(coalesce((select sum(h.sold_h) from hours h where h.day = dt.day), 0), 2)
      ) order by dt.day)
      from dates dt
    ),
    'courts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'court_id', pc.id, 'name', pc.name, 'sport', pc.sport,
        'open_hours', round(pc.open_h, 2), 'blackout_hours', round(pc.blackout_h, 2),
        'sold_hours', round(pc.sold_h, 2), 'open_play_hours', round(pc.open_play_h, 2)
      ) order by pc.sport_pos, pc.sort_order, pc.name), '[]'::jsonb)
      from per_court pc
    ),
    'sports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'sport', s.sport,
        'open_hours', round(s.open_h, 2), 'blackout_hours', round(s.blackout_h, 2),
        'sold_hours', round(s.sold_h, 2), 'open_play_hours', round(s.open_play_h, 2)
      ) order by s.sport_pos), '[]'::jsonb)
      from (
        select pc.sport, min(pc.sport_pos) as sport_pos, sum(pc.open_h) as open_h, sum(pc.blackout_h) as blackout_h,
               sum(pc.sold_h) as sold_h, sum(pc.open_play_h) as open_play_h
        from per_court pc
        group by pc.sport
      ) s
    ),
    'split', (
      select jsonb_build_object(
        'total_revenue', s.cur_revenue,
        'plotline_fees', s.cur_fees,
        'owner_earnings', s.cur_revenue - s.cur_fees,
        'previous', jsonb_build_object(
          'total_revenue', s.prev_revenue,
          'plotline_fees', s.prev_fees,
          'owner_earnings', s.prev_revenue - s.prev_fees))
      from (
        select
          (select coalesce(sum(cur.amount), 0) from cur) as cur_revenue,
          (select coalesce(sum(f.booking_fee), 0) from fee_bookings f where f.paid_at >= v_start and f.paid_at < v_end) as cur_fees,
          (select coalesce(sum(prev.amount), 0) from prev) as prev_revenue,
          (select coalesce(sum(f.booking_fee), 0) from fee_bookings f where f.paid_at >= v_prev_start and f.paid_at < v_start) as prev_fees
      ) s
    ),
    'coming_up', (
      select jsonb_build_object('count', count(*), 'value', coalesce(sum(b.total_amount), 0))
      from public.bookings b
      where b.venue_id = v_venue and b.status = 'confirmed' and lower(b.during) > now()
    )
  )
  into v_result;

  return v_result;
end;
$function$;


revoke execute on function public.reorder_info_sections(uuid[], uuid), public.reorder_payment_accounts(uuid[], uuid),
  public.set_operating_hours(jsonb, uuid), public.get_earnings(date, date, uuid) from public, anon;
grant execute on function public.reorder_info_sections(uuid[], uuid), public.reorder_payment_accounts(uuid[], uuid),
  public.set_operating_hours(jsonb, uuid), public.get_earnings(date, date, uuid) to authenticated, service_role;

-- The outbox trigger reads the booking's own venue.

CREATE OR REPLACE FUNCTION private.booking_email_data(p_booking bookings)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'reference_code', p_booking.reference_code,
    'venue_name',     vs.name,
    'timezone',       vs.timezone,
    'court_name',     c.name,
    'sport',          c.sport,
    'starts_at',      lower(p_booking.during),
    'ends_at',        upper(p_booking.during),
    'total_amount',   p_booking.total_amount,
    'booking_fee',    p_booking.booking_fee,
    'amount_due',     p_booking.amount_due,
    'status',         p_booking.status,
    'expires_at',     p_booking.expires_at,
    'name',           p_booking.guest_name,
    'waiver_text',    p_booking.waiver_text,
    'waiver_accepted_at', p_booking.waiver_accepted_at
  )
  from public.courts c
  join public.venue_settings vs on vs.venue_id = p_booking.venue_id
  where c.id = p_booking.court_id;
$function$;
