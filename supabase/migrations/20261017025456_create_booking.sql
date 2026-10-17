-- Milestone 3: create_booking (SPEC §5.1–5.4, §6). The only way an online booking is created.
-- Conventions (RESEARCH "RPC conventions"): security definer, search_path = '', explicit grants,
-- business errors are P0001 with a readable message and a stable code in HINT.

-- CB- + 6 chars from an unambiguous 32-char alphabet. 256 % 32 = 0, so byte % 32 is unbiased.
create function private.new_reference_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'CB-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(r.b, i) % 32) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(6) as b) as r, generate_series(0, 5) as i;
$$;

revoke all on function private.new_reference_code() from public, anon, authenticated;

create function public.create_booking(
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
  v_tz         text := private.venue_tz();
  v_settings   public.venue_settings;
  v_court      public.courts;
  v_hours      public.operating_hours;
  v_during     tstzrange;
  v_local_start timestamp;
  v_local_end  timestamp;
  v_day        date;
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
  if p_start <= now() then
    raise exception 'That time has already started. Please pick a later slot.'
      using errcode = 'P0001', hint = 'slot_started';
  end if;
  if not private.in_booking_window(v_day) then
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

revoke all on function public.create_booking(uuid, timestamptz, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.create_booking(uuid, timestamptz, integer, text, text, text) to anon, authenticated;
