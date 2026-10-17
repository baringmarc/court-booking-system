-- Milestone 4: walk-ins (SPEC §5.8, RESEARCH "Review and walk-in rules").
-- 1. private.validate_booking_slot: the slot rules from create_booking, shared so the RPCs can't drift.
-- 2. create_booking recreated on top of it (same signature, grants and behaviour).
-- 3. create_walk_in for admins.

-- Shared slot rules for create_booking and create_walk_in (SPEC §5.1–5.3, §5.8), moved out of
-- create_booking unchanged except for the two walk-in exceptions. Returns the validated range.
create function private.validate_booking_slot(
  p_court_id  uuid,
  p_start     timestamptz,
  p_slots     integer,
  p_walk_in   boolean
)
returns tstzrange
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz          text := private.venue_tz();
  v_settings    public.venue_settings;
  v_court       public.courts;
  v_hours       public.operating_hours;
  v_during      tstzrange;
  v_local_start timestamp;
  v_local_end   timestamp;
  v_day         date;
begin
  -- Input shape
  if p_court_id is null or p_start is null or p_slots is null or p_slots < 1 or p_slots > 24 then
    raise exception 'Choose a court, a start time and at least one slot.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  select * into v_settings from public.venue_settings;
  select * into v_court from public.courts c where c.id = p_court_id;
  if not found then
    raise exception 'That court does not exist.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if not v_court.is_active then
    raise exception 'This court is not available for booking.' using errcode = 'P0001', hint = 'court_inactive';
  end if;

  v_during := tstzrange(p_start, p_start + make_interval(hours => p_slots));
  v_local_start := p_start at time zone v_tz;
  v_local_end := upper(v_during) at time zone v_tz;
  v_day := v_local_start::date;

  -- Time rules, in the venue timezone
  if date_trunc('hour', v_local_start) <> v_local_start then
    raise exception 'Bookings must start on the hour.' using errcode = 'P0001', hint = 'not_aligned';
  end if;
  -- Online bookings must start in the future; walk-ins may start in the slot that is in progress.
  if (not p_walk_in and p_start <= now()) or (p_walk_in and p_start + interval '1 hour' <= now()) then
    raise exception 'That time has already started. Please pick a later slot.'
      using errcode = 'P0001', hint = 'slot_started';
  end if;
  -- Walk-ins skip the booking window (SPEC §5.8).
  if not p_walk_in and not private.in_booking_window(v_day) then
    raise exception 'Bookings can be made up to % days ahead.', v_settings.booking_window_days
      using errcode = 'P0001', hint = 'outside_window';
  end if;
  if (v_local_end - interval '1 microsecond')::date <> v_day then
    raise exception 'A booking must start and end on the same day.' using errcode = 'P0001', hint = 'multi_day';
  end if;

  select * into v_hours from public.operating_hours oh where oh.day_of_week = extract(dow from v_day)::smallint;
  if not found or v_hours.is_closed
     or v_local_start < v_day + v_hours.open_time
     or v_local_end > v_day + v_hours.close_time then
    raise exception 'That time is outside opening hours.' using errcode = 'P0001', hint = 'outside_hours';
  end if;

  if exists (
    select 1 from public.blackouts bo
    where (bo.court_id is null or bo.court_id = p_court_id)
      and tstzrange(bo.starts_at, bo.ends_at) && v_during
  ) then
    raise exception 'That time is blocked for maintenance or an event.' using errcode = 'P0001', hint = 'blackout';
  end if;

  return v_during;
end;
$$;

revoke all on function private.validate_booking_slot(uuid, timestamptz, integer, boolean) from public, anon, authenticated;

create or replace function public.create_booking(
  p_court_id     uuid,
  p_start        timestamptz,
  p_slots        integer,
  p_guest_name   text default null,
  p_guest_email  text default null,
  p_guest_phone  text default null
)
returns table (id uuid, reference_code text, guest_token text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
begin
  v_during := private.validate_booking_slot(p_court_id, p_start, p_slots, false);
  select * into v_settings from public.venue_settings;

  -- Who is booking. user_id always comes from the session, never from arguments.
  if v_uid is not null then
    select p.full_name, p.phone into v_name, v_phone from public.profiles p where p.id = v_uid;
    select u.email into v_email from auth.users u where u.id = v_uid;
    v_name := coalesce(nullif(trim(p_guest_name), ''), nullif(trim(v_name), ''), split_part(v_email, '@', 1));
    v_phone := coalesce(nullif(trim(p_guest_phone), ''), nullif(trim(v_phone), ''));
  else
    v_name := nullif(trim(p_guest_name), '');
    v_email := lower(nullif(trim(p_guest_email), ''));
    v_phone := nullif(trim(p_guest_phone), '');
    if v_name is null or v_email is null or v_phone is null then
      raise exception 'Please enter your name, email and phone number.' using errcode = 'P0001', hint = 'invalid_guest';
    end if;
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'Please enter a valid email address.' using errcode = 'P0001', hint = 'invalid_guest';
    end if;
    if length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 7 then
      raise exception 'Please enter a valid phone number.' using errcode = 'P0001', hint = 'invalid_guest';
    end if;
    -- Shown once to the guest; only its hash is stored.
    v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    v_hash := sha256(convert_to(v_token, 'UTF8'));
  end if;

  if length(v_name) > 100 or length(v_email) > 254 or length(v_phone) > 30 then
    raise exception 'Name, email or phone is too long.' using errcode = 'P0001', hint = 'invalid_input';
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
        during, total_amount, status, source, guest_token_hash, expires_at
      ) values (
        private.new_reference_code(), p_court_id, v_uid, v_name, v_email, v_phone,
        v_during, v_price, 'pending_payment', 'online', v_hash,
        now() + make_interval(mins => v_settings.payment_hold_minutes)
      )
      returning b.id, b.reference_code into v_id, v_ref;
      exit;
    exception
      when exclusion_violation then
        raise exception 'Sorry, that time was just booked. Please pick another slot.'
          using errcode = 'P0001', hint = 'slot_unavailable';
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint <> 'bookings_reference_code_key' or attempt = 5 then
          raise;
        end if;
    end;
  end loop;

  return query select v_id, v_ref, v_token;
end;
$$;

-- Walk-ins (SPEC §5.8): an admin books at the counter. The booking is confirmed immediately with an
-- approved payment recorded by that admin. The booking total is the server price; the payment amount is
-- what was actually received (defaults to the total; the admin may enter a discount).
create function public.create_walk_in(
  p_court_id          uuid,
  p_start             timestamptz,
  p_slots             integer,
  p_name              text,
  p_phone             text default null,
  p_method            public.payment_method default 'cash',
  p_amount            numeric default null,
  p_reference_number  text default null
)
returns table (id uuid, reference_code text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
begin
  if v_admin is null or not private.is_admin() then
    raise exception 'Only staff can record walk-ins.' using errcode = 'P0001', hint = 'forbidden';
  end if;

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
$$;

revoke all on function public.create_walk_in(uuid, timestamptz, integer, text, text, public.payment_method, numeric, text) from public, anon, authenticated;
grant execute on function public.create_walk_in(uuid, timestamptz, integer, text, text, public.payment_method, numeric, text) to authenticated;
