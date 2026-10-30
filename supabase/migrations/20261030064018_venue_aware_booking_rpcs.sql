-- T12.5: the booking-path RPCs read the venue they touch (expand only; signatures stay callable).
-- The venue always comes from a row (the court or the booking) or from a public slug, never from a client venue_id.

-- 1. Venue-aware time helpers. The old zero-argument versions stay for T12.6 callers and point at Claudex Courts.
create function private.venue_tz(p_venue uuid)
returns text language sql stable set search_path = ''
as $$ select timezone from public.venue_settings where venue_id = p_venue $$;

create function private.local_today(p_venue uuid)
returns date language sql stable set search_path = ''
as $$ select (now() at time zone private.venue_tz(p_venue))::date $$;

create function private.local_dow_hour(p_venue uuid, p_ts timestamptz, out dow smallint, out hour smallint)
returns record language sql stable set search_path = ''
as $$
  select extract(dow from p_ts at time zone private.venue_tz(p_venue))::smallint,
         extract(hour from p_ts at time zone private.venue_tz(p_venue))::smallint;
$$;

create function private.operating_day_range(p_venue uuid, p_day date)
returns tstzrange language sql stable set search_path = ''
as $$
  select tstzrange(
    (p_day + oh.open_time) at time zone private.venue_tz(p_venue),
    (p_day + case when oh.close_time <= oh.open_time then 1 else 0 end + oh.close_time) at time zone private.venue_tz(p_venue)
  )
  from public.operating_hours oh
  where oh.venue_id = p_venue
    and oh.day_of_week = extract(dow from p_day)::smallint
    and not oh.is_closed;
$$;

create function private.operating_day_of(p_venue uuid, p_ts timestamptz)
returns date language sql stable set search_path = ''
as $$
  with l as (select (p_ts at time zone private.venue_tz(p_venue))::date as d)
  select case
    when private.operating_day_range(p_venue, l.d) @> p_ts then l.d
    when private.operating_day_range(p_venue, l.d - 1) @> p_ts then l.d - 1
  end
  from l;
$$;

create function private.operating_today(p_venue uuid)
returns date language sql stable set search_path = ''
as $$ select coalesce(private.operating_day_of(p_venue, now()), private.local_today(p_venue)) $$;

create function private.in_booking_window(p_venue uuid, p_day date)
returns boolean language sql stable set search_path = ''
as $$
  select p_day between private.operating_today(p_venue)
                   and private.operating_today(p_venue)
                       + (select booking_window_days from public.venue_settings where venue_id = p_venue);
$$;

create or replace function private.venue_tz()
returns text language sql stable set search_path = ''
as $$ select private.venue_tz(private.default_venue_id()) $$;

create or replace function private.local_today()
returns date language sql stable set search_path = ''
as $$ select private.local_today(private.default_venue_id()) $$;

create or replace function private.local_dow_hour(p_ts timestamptz, out dow smallint, out hour smallint)
returns record language sql stable set search_path = ''
as $$ select * from private.local_dow_hour(private.default_venue_id(), p_ts) $$;

create or replace function private.operating_day_range(p_day date)
returns tstzrange language sql stable set search_path = ''
as $$ select private.operating_day_range(private.default_venue_id(), p_day) $$;

create or replace function private.operating_day_of(p_ts timestamptz)
returns date language sql stable set search_path = ''
as $$ select private.operating_day_of(private.default_venue_id(), p_ts) $$;

create or replace function private.operating_today()
returns date language sql stable set search_path = ''
as $$ select private.operating_today(private.default_venue_id()) $$;

create or replace function private.in_booking_window(p_day date)
returns boolean language sql stable set search_path = ''
as $$ select private.in_booking_window(private.default_venue_id(), p_day) $$;

-- Prices follow the court's own venue.
create or replace function private.slot_price(p_court_id uuid, p_slot_start timestamptz, p_dow smallint)
returns numeric language sql stable set search_path = ''
as $$
  select coalesce(r.price, c.default_hourly_rate)
  from public.courts c
  cross join private.local_dow_hour(c.venue_id, p_slot_start) l
  left join public.court_rates r
    on r.court_id = c.id and r.day_of_week = p_dow and r.start_hour = l.hour
  where c.id = p_court_id;
$$;

create or replace function private.slot_price(p_court_id uuid, p_slot_start timestamptz)
returns numeric language sql stable set search_path = ''
as $$
  select private.slot_price(c.id, p_slot_start,
           coalesce(extract(dow from private.operating_day_of(c.venue_id, p_slot_start))::smallint,
                    (private.local_dow_hour(c.venue_id, p_slot_start)).dow))
  from public.courts c where c.id = p_court_id;
$$;

create or replace function private.range_price(p_court_id uuid, p_during tstzrange)
returns numeric language sql stable set search_path = ''
as $$
  with d as (
    select coalesce(extract(dow from private.operating_day_of(c.venue_id, lower(p_during)))::smallint,
                    (private.local_dow_hour(c.venue_id, lower(p_during))).dow) as dow
    from public.courts c where c.id = p_court_id
  )
  select sum(private.slot_price(p_court_id, s, d.dow))
  from d, generate_series(lower(p_during), upper(p_during) - interval '1 hour', interval '1 hour') as s;
$$;

-- 2. Which venue a public call is for. No slug means the default venue, and only while it is the one active venue.
create function private.assert_venue_active(p_venue uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.venues v where v.id = p_venue and v.status = 'active') then
    raise exception 'This venue is not taking bookings right now.' using errcode = 'P0001', hint = 'venue_unavailable';
  end if;
end;
$$;

create function private.resolve_public_venue(p_slug text default null)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare
  v_venue uuid;
begin
  if p_slug is null then
    if (select count(*) from public.venues where status = 'active') > 1 then
      raise exception 'Say which venue you mean.' using errcode = 'P0001', hint = 'venue_required';
    end if;
    v_venue := private.default_venue_id();
  else
    select v.id into v_venue from public.venues v where v.slug = p_slug;
  end if;
  if v_venue is null then
    raise exception 'Venue not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
  perform private.assert_venue_active(v_venue);
  return v_venue;
end;
$$;

-- 3. validate_booking_slot: the venue comes from the court.
create or replace function private.validate_booking_slot(p_court_id uuid, p_start timestamptz, p_slots integer, p_walk_in boolean)
returns tstzrange language plpgsql stable set search_path = ''
as $$
declare
  v_tz          text;
  v_settings    public.venue_settings;
  v_court       public.courts;
  v_during      tstzrange;
  v_local_start timestamp;
  v_day         date;
  v_open        tstzrange;
begin
  -- Input shape
  if p_court_id is null or p_start is null or p_slots is null or p_slots < 1 or p_slots > 24 then
    raise exception 'Choose a court, a start time and at least one slot.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  select * into v_court from public.courts c where c.id = p_court_id;
  if not found then
    raise exception 'That court does not exist.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if not v_court.is_active then
    raise exception 'This court is not available for booking.' using errcode = 'P0001', hint = 'court_inactive';
  end if;
  select * into v_settings from public.venue_settings vs where vs.venue_id = v_court.venue_id;
  v_tz := v_settings.timezone;

  v_during := tstzrange(p_start, p_start + make_interval(hours => p_slots));
  v_local_start := p_start at time zone v_tz;

  -- Time rules, in the venue timezone
  if date_trunc('hour', v_local_start) <> v_local_start then
    raise exception 'Bookings must start on the hour.' using errcode = 'P0001', hint = 'not_aligned';
  end if;
  -- Online bookings must start in the future; walk-ins may start in the slot that is in progress.
  if (not p_walk_in and p_start <= now()) or (p_walk_in and p_start + interval '1 hour' <= now()) then
    raise exception 'That time has already started. Please pick a later slot.'
      using errcode = 'P0001', hint = 'slot_started';
  end if;

  -- The operating day the start belongs to; none means the venue is closed then.
  v_day := private.operating_day_of(v_court.venue_id, p_start);
  if v_day is null then
    raise exception 'That time is outside opening hours.' using errcode = 'P0001', hint = 'outside_hours';
  end if;
  -- Walk-ins skip the booking window (SPEC §5.8).
  if not p_walk_in and not private.in_booking_window(v_court.venue_id, v_day) then
    raise exception 'Bookings can be made up to % days ahead.', v_settings.booking_window_days
      using errcode = 'P0001', hint = 'outside_window';
  end if;
  -- The whole booking within that one operating day. Running on past the calendar midnight after it means
  -- reaching into another day (multi_day); otherwise it just runs past closing.
  v_open := private.operating_day_range(v_court.venue_id, v_day);
  if not v_open @> v_during then
    if upper(v_during) > (v_day + 1)::timestamp at time zone v_tz then
      raise exception 'A booking must fit within one day''s opening hours.' using errcode = 'P0001', hint = 'multi_day';
    end if;
    raise exception 'That time is outside opening hours.' using errcode = 'P0001', hint = 'outside_hours';
  end if;

  if exists (
    select 1 from public.blackouts bo
    where bo.venue_id = v_court.venue_id
      and (bo.court_id is null or bo.court_id = p_court_id)
      and tstzrange(bo.starts_at, bo.ends_at) && v_during
  ) then
    raise exception 'That time is blocked for maintenance or an event.' using errcode = 'P0001', hint = 'blackout';
  end if;
  if exists (
    select 1 from public.open_play_courts oc
    where oc.court_id = p_court_id and oc.during && v_during
  ) then
    raise exception 'That time is reserved for open play.' using errcode = 'P0001', hint = 'open_play';
  end if;

  return v_during;
end;
$$;

-- 4. create_booking: venue from the court; a venue that isn't active refuses.
CREATE OR REPLACE FUNCTION public.create_booking(p_court_id uuid, p_start timestamp with time zone, p_slots integer, p_guest_name text DEFAULT NULL::text, p_guest_email text DEFAULT NULL::text, p_guest_phone text DEFAULT NULL::text, p_waiver_accepted boolean DEFAULT false)
 RETURNS TABLE(id uuid, reference_code text, guest_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_uid        uuid := auth.uid();
  v_settings   public.venue_settings;
  v_during     tstzrange;
  v_name       text;
  v_email      text;
  v_phone      text;
  v_token      text;
  v_hash       bytea;
  v_price      numeric;
  v_id         uuid;
  v_ref        text;
  v_constraint text;
  v_waiver     text;
  v_venue      uuid;
begin
  -- Serialize with open play sessions on this court; validate_booking_slot then checks a fresh snapshot.
  perform private.lock_court_slots(p_court_id);
  -- The venue is the court's, never an argument. An unknown court falls through to validate_booking_slot.
  select c.venue_id into v_venue from public.courts c where c.id = p_court_id;
  if v_venue is not null then
    perform private.assert_venue_active(v_venue);
  end if;
  v_during := private.validate_booking_slot(p_court_id, p_start, p_slots, false);
  select * into v_settings from public.venue_settings vs where vs.venue_id = v_venue;

  -- Who is booking. user_id always comes from the session, never from arguments.
  if v_uid is not null then
    select p.full_name, p.phone into v_name, v_phone from public.profiles p where p.id = v_uid;
    select u.email into v_email from auth.users u where u.id = v_uid;
    v_name := coalesce(nullif(trim(p_guest_name), ''), nullif(trim(v_name), ''), 'Player');
    v_phone := coalesce(nullif(trim(p_guest_phone), ''), nullif(trim(v_phone), ''));
  else
    v_name := nullif(trim(p_guest_name), '');
    v_email := lower(nullif(trim(p_guest_email), ''));
    -- The phone is optional (T11.17); the bookings trigger normalizes it or refuses it (invalid_phone).
    v_phone := nullif(trim(p_guest_phone), '');
    if v_name is null or v_email is null then
      raise exception 'Please enter your name and email.' using errcode = 'P0001', hint = 'invalid_guest';
    end if;
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'Please enter a valid email address.' using errcode = 'P0001', hint = 'invalid_guest';
    end if;
    -- Shown once to the guest; only its hash is stored.
    v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    v_hash := sha256(convert_to(v_token, 'UTF8'));
  end if;

  if length(v_name) > 100 or length(v_email) > 254 or length(v_phone) > 30 then
    raise exception 'Name, email or phone is too long.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- The venue's waiver (T11.19): when it isn't blank the booking needs its acceptance, and keeps a copy of the text.
  if btrim(v_settings.waiver_text) <> '' then
    if not coalesce(p_waiver_accepted, false) then
      raise exception 'Please read and accept the waiver to book.' using errcode = 'P0001', hint = 'waiver_required';
    end if;
    v_waiver := v_settings.waiver_text;
  end if;

  v_price := private.range_price(p_court_id, v_during);

  -- Lazy expiry: the exclusion constraint can't see expires_at, so release overlapping stale holds.
  -- Same rule as get_availability: a hold is expired once expires_at <= now().
  update public.bookings b
  set status = 'expired'
  where b.court_id = p_court_id
    and b.status = 'pending_payment'
    and b.expires_at <= now()
    and b.during && v_during;

  for attempt in 1..5 loop
    begin
      insert into public.bookings as b (
        reference_code, court_id, user_id, guest_name, guest_email, guest_phone,
        during, total_amount, status, source, guest_token_hash, expires_at, waiver_text, waiver_accepted_at
      ) values (
        private.new_reference_code(), p_court_id, v_uid, v_name, v_email, v_phone,
        v_during, v_price, 'pending_payment', 'online', v_hash,
        now() + make_interval(mins => v_settings.payment_hold_minutes),
        v_waiver, case when v_waiver is not null then now() end
      )
      returning b.id, b.reference_code into v_id, v_ref;
      exit;
    exception
      when exclusion_violation then
        raise exception 'Sorry, that time was just booked. Please pick another slot.'
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

  return query select v_id, v_ref, v_token;
end;
$function$;


-- 5. cancel_booking: the admin path is the booking's own venue staff.

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid DEFAULT NULL::uuid, p_reference_code text DEFAULT NULL::text, p_token text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS booking_status
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid      uuid := auth.uid();
  v_guest    boolean := p_token is not null;
  v_admin    boolean := false;
  v_booking  public.bookings;
  v_cutoff   integer;
  v_reason   text := nullif(trim(p_reason), '');
begin
  if length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Find and lock the booking. Every miss (unknown, wrong token, not yours) gives the same answer.
  if v_guest then
    select b.* into v_booking from public.bookings b
    where b.reference_code = upper(trim(coalesce(p_reference_code, '')))
      and private.guest_token_matches(b.id, p_token)
    for update;
  elsif p_booking_id is not null and v_uid is not null then
    select b.* into v_booking from public.bookings b
    where b.id = p_booking_id and (b.user_id = v_uid or private.is_venue_admin(b.venue_id))
    for update;
    v_admin := v_booking.id is not null and private.is_venue_admin(v_booking.venue_id);
  end if;
  if v_booking.id is null then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;

  -- Only effectively active bookings hold a slot; a stale hold is already expired (SPEC §10).
  if not (v_booking.status in ('payment_submitted', 'confirmed')
          or (v_booking.status = 'pending_payment' and v_booking.expires_at > now())) then
    raise exception 'This booking can no longer be cancelled.' using errcode = 'P0001', hint = 'not_cancellable';
  end if;

  if v_admin then
    if now() >= upper(v_booking.during) then
      raise exception 'This booking has already ended.' using errcode = 'P0001', hint = 'booking_ended';
    end if;
    if v_reason is null then
      raise exception 'Give a reason so the player knows why.' using errcode = 'P0001', hint = 'reason_required';
    end if;
  else
    select vs.cancel_cutoff_hours into v_cutoff from public.venue_settings vs where vs.venue_id = v_booking.venue_id;
    if now() > lower(v_booking.during) - make_interval(hours => v_cutoff) then
      raise exception 'It is too late to cancel online. Please contact the venue.'
        using errcode = 'P0001', hint = 'cutoff_passed';
    end if;
  end if;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = v_reason,
      cancelled_by = case when v_guest then null else v_uid end,
      cancelled_by_venue = v_admin
  where id = v_booking.id;

  return 'cancelled'::public.booking_status;
end;
$function$;


-- 6. review_payment: staff of the booking's venue (or a platform admin).

CREATE OR REPLACE FUNCTION public.review_payment(p_booking_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS TABLE(status booking_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_admin    uuid := auth.uid();
  v_booking  public.bookings;
  v_payment  public.payments;
  v_settings public.venue_settings;
  v_note     text := nullif(trim(p_note), '');
  v_status   public.booking_status;
begin
  if v_admin is null or not (private.is_platform_admin()
       or exists (select 1 from public.venue_members m where m.user_id = v_admin)) then
    raise exception 'Only staff can review payments.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_booking_id is null or p_approve is null then
    raise exception 'Choose a booking and a decision.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Give a reason so the player knows what to fix.' using errcode = 'P0001', hint = 'note_required';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Lock the booking, then its pending payment, so a submission or expiry sweep can't interleave.
  select b.* into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if not private.is_venue_admin(v_booking.venue_id) then
    raise exception 'Only staff can review payments.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if v_booking.status <> 'payment_submitted' then
    raise exception 'This booking has no payment waiting for review.' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  select p.* into v_payment from public.payments p
  where p.booking_id = p_booking_id and p.review_status = 'pending'
  for update;
  if not found then
    raise exception 'This booking has no payment waiting for review.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  if p_approve then
    update public.payments
    set review_status = 'approved', reviewed_by = v_admin, reviewed_at = now(), review_note = v_note
    where id = v_payment.id;
    v_status := 'confirmed';
    update public.bookings set status = v_status where id = p_booking_id;
  else
    update public.payments
    set review_status = 'rejected', reviewed_by = v_admin, reviewed_at = now(), review_note = v_note
    where id = v_payment.id;
    select * into v_settings from public.venue_settings vs where vs.venue_id = v_booking.venue_id;
    if v_booking.rejection_count + 1 >= v_settings.max_rejections then
      v_status := 'rejected';
      update public.bookings
      set status = v_status, rejection_count = rejection_count + 1
      where id = p_booking_id;
    else
      v_status := 'pending_payment';
      update public.bookings
      set status = v_status,
          rejection_count = rejection_count + 1,
          expires_at = now() + make_interval(mins => v_settings.payment_hold_minutes)
      where id = p_booking_id;
    end if;
  end if;

  return query select v_status;
end;
$function$;


-- 7. get_guest_booking: the booking's own venue instructions.

CREATE OR REPLACE FUNCTION public.get_guest_booking(p_reference_code text, p_token text)
 RETURNS TABLE(id uuid, reference_code text, court_id uuid, court_name text, sport sport, slot_start timestamp with time zone, slot_end timestamp with time zone, status booking_status, total_amount numeric, expires_at timestamp with time zone, rejection_count smallint, guest_name text, guest_email text, created_at timestamp with time zone, payment_instructions text, payments jsonb, cancelled_at timestamp with time zone, cancel_reason text, cancelled_by_venue boolean, parent_reference_code text, continuations jsonb, changes jsonb, booking_fee numeric, amount_due numeric, waiver_text text, waiver_accepted_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  return query
  select
    b.id, b.reference_code, b.court_id, c.name, c.sport,
    lower(b.during), upper(b.during),
    -- Effective status: a hold past its expiry is expired even before the sweep runs.
    case when b.status = 'pending_payment' and b.expires_at <= now()
         then 'expired'::public.booking_status else b.status end,
    b.total_amount, b.expires_at, b.rejection_count, b.guest_name, b.guest_email, b.created_at,
    vs.payment_instructions,
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'method', p.method, 'amount', p.amount, 'reference_number', p.reference_number,
               'submitted_at', p.submitted_at, 'review_status', p.review_status,
               'reviewed_at', p.reviewed_at, 'review_note', p.review_note, 'paid_with', p.paid_with
             ) order by p.submitted_at)
      from public.payments p where p.booking_id = b.id
    ), '[]'::jsonb),
    b.cancelled_at, b.cancel_reason, b.cancelled_by_venue,
    (select r.reference_code from public.bookings r where r.id = b.parent_booking_id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'reference_code', m.reference_code, 'court_name', mc.name,
               'slot_start', lower(m.during), 'slot_end', upper(m.during), 'status', m.status
             ) order by lower(m.during))
      from public.bookings m join public.courts mc on mc.id = m.court_id
      where m.parent_booking_id = b.id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
               'old_court_name', oc.name, 'old_start', lower(ch.old_during), 'old_end', upper(ch.old_during),
               'new_court_name', nc.name, 'new_start', lower(ch.new_during), 'new_end', upper(ch.new_during),
               'continuation_reference', (select m.reference_code from public.bookings m where m.id = ch.continuation_id),
               'reason', ch.reason, 'changed_at', ch.changed_at
             ) order by ch.changed_at)
      from public.booking_changes ch
      join public.courts oc on oc.id = ch.old_court_id
      join public.courts nc on nc.id = ch.new_court_id
      where ch.booking_id = b.id or ch.continuation_id = b.id
         or ch.booking_id in (select m.id from public.bookings m where m.parent_booking_id = b.id)
    ), '[]'::jsonb),
    b.booking_fee, b.amount_due,
    b.waiver_text, b.waiver_accepted_at
  from public.bookings b
  join public.courts c on c.id = b.court_id
  join public.venue_settings vs on vs.venue_id = b.venue_id
  where b.reference_code = upper(trim(p_reference_code))
    and private.guest_token_matches(b.id, p_token)
    and greatest(
          upper(b.during),
          coalesce((select max(upper(m.during)) from public.bookings m where m.parent_booking_id = b.id), upper(b.during))
        ) + interval '30 days' > now();

  if not found then
    raise exception 'Booking not found. Check that you opened the full link from your confirmation.'
      using errcode = 'P0001', hint = 'not_found';
  end if;
end;
$function$;

-- 8. get_availability: a court names its venue; otherwise a public slug (no slug means the default venue).
drop function public.get_availability(date, uuid);

create function public.get_availability(p_date date, p_court_id uuid, p_venue_slug text)
returns table(court_id uuid, slot_start timestamptz, slot_end timestamptz, price numeric, status text,
              booker_first_name text, open_play_session_id uuid, block_key text)
language plpgsql stable security definer set search_path = ''
as $function$
#variable_conflict use_column
declare
  v_venue uuid;
begin
  if p_court_id is not null then
    select c.venue_id into v_venue from public.courts c where c.id = p_court_id;
    if v_venue is null then
      return;
    end if;
    perform private.assert_venue_active(v_venue);
  else
    v_venue := private.resolve_public_venue(p_venue_slug);
  end if;

  return query
  with open_range as (
    select private.operating_day_range(v_venue, p_date) as r
    where private.in_booking_window(v_venue, p_date)
  ),
  slots as (
    select s as slot_start, tstzrange(s, s + interval '1 hour') as slot
    from open_range o,
         generate_series(lower(o.r), upper(o.r) - interval '1 hour', interval '1 hour') as s
    where o.r is not null
  ),
  cells as (
    select
      c.id as court_id,
      c.sport,
      c.sort_order,
      c.name,
      sl.slot_start,
      sl.slot,
      bk.id as booking_id,
      bk.guest_name,
      bl.id as blackout_id,
      op.session_id,
      case
        when upper(sl.slot) <= now() then 'past'  -- already over
        when bk.guest_name is not null then 'booked'
        when bl.id is not null then 'blackout'
        when op.session_id is not null then 'open_play'
        when sl.slot_start <= now() then 'past'   -- in progress and free: not bookable online (walk-ins may take it)
        else 'free'
      end as status
    from public.courts c
    cross join slots sl
    -- The active booking on this slot, if any (the exclusion constraint allows at most one).
    left join lateral (
      select b.id, b.guest_name
      from public.bookings b
      where b.court_id = c.id
        and b.during && sl.slot
        and b.status in ('pending_payment', 'payment_submitted', 'confirmed')
        and not (b.status = 'pending_payment' and b.expires_at <= now())
      limit 1
    ) bk on true
    -- A blackout on this slot, if any. Blackouts may overlap; the lowest id gives a stable key.
    left join lateral (
      select bo.id
      from public.blackouts bo
      where bo.venue_id = c.venue_id
        and (bo.court_id is null or bo.court_id = c.id)
        and tstzrange(bo.starts_at, bo.ends_at) && sl.slot
      order by bo.id
      limit 1
    ) bl on true
    -- The open play session on this slot, if any (open_play_courts_no_overlap allows at most one).
    left join lateral (
      select oc.session_id
      from public.open_play_courts oc
      where oc.court_id = c.id and oc.during && sl.slot
      limit 1
    ) op on true
    where c.is_active
      and c.venue_id = v_venue
      and (p_court_id is null or c.id = p_court_id)
  )
  select
    x.court_id,
    x.slot_start,
    upper(x.slot),
    private.slot_price(x.court_id, x.slot_start, extract(dow from p_date)::smallint),
    x.status,
    case when x.status = 'booked' then nullif(left(split_part(btrim(x.guest_name), ' ', 1), 20), '') end,
    case when x.status = 'open_play' then x.session_id end,
    case x.status
      when 'booked' then left(encode(sha256(convert_to('booking:' || x.booking_id::text, 'UTF8')), 'hex'), 16)
      when 'open_play' then x.session_id::text
      when 'blackout' then 'blackout:' || x.blackout_id::text
    end
  from cells x
  order by array_position((select vs.sport_order from public.venue_settings vs where vs.venue_id = v_venue), x.sport),
           x.sort_order, x.name, x.slot_start;
end;
$function$;

-- The existing call shape keeps working (and the frontend is unchanged): no slug means the default venue.
create function public.get_availability(p_date date, p_court_id uuid default null)
returns table(court_id uuid, slot_start timestamptz, slot_end timestamptz, price numeric, status text,
              booker_first_name text, open_play_session_id uuid, block_key text)
language sql stable security definer set search_path = ''
as $$ select * from public.get_availability(p_date, p_court_id, null::text) $$;

revoke execute on function public.get_availability(date, uuid) from public;
grant execute on function public.get_availability(date, uuid) to anon, authenticated, service_role;
revoke execute on function public.get_availability(date, uuid, text) from public;
grant execute on function public.get_availability(date, uuid, text) to anon, authenticated, service_role;
