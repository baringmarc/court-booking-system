-- T11.17: phone numbers are optional and stored as an 11-digit PH mobile, 09 + 9 digits (SPEC §10 2026-10-28 and
-- 2026-10-29, RESEARCH M11 "Phone numbers (T11.16)").
--   1. private.normalize_ph_mobile: the one rule (src/lib/phone.ts mirrors it).
--   2. BEFORE triggers on bookings.guest_phone and profiles.phone, so every writer is covered: create_booking,
--      create_walk_in, reschedule_booking's copy and a player's own profile update.
--   3. Backfill what normalizes, then format checks: NOT VALID, validated only when nothing invalid is left.
--   4. create_booking no longer requires a guest's phone (same signature, so the deployed checkout keeps working).

-- ---------------------------------------------------------------------------
-- 1. The rule
-- ---------------------------------------------------------------------------
create function private.normalize_ph_mobile(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(coalesce(p, ''), '[[:space:].()-]', '', 'g');
begin
  if v = '' then
    return null;
  elsif v ~ '^09[0-9]{9}$' then
    return v;
  elsif v ~ '^\+?639[0-9]{9}$' then
    return '0' || right(v, 10);
  elsif v ~ '^9[0-9]{9}$' then
    return '0' || v;
  end if;
  raise exception 'Enter an 11-digit mobile number, like 09171234567.' using errcode = 'P0001', hint = 'invalid_phone';
end;
$$;
revoke all on function private.normalize_ph_mobile(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Triggers. security definer: a player's own profile update runs as authenticated, which can't execute the
--    private helper.
-- ---------------------------------------------------------------------------
create function private.normalize_booking_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.guest_phone := private.normalize_ph_mobile(new.guest_phone);
  return new;
end;
$$;
revoke all on function private.normalize_booking_phone() from public, anon, authenticated;

create trigger bookings_normalize_phone
  before insert or update of guest_phone on public.bookings
  for each row execute function private.normalize_booking_phone();

create function private.normalize_profile_phone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.phone := private.normalize_ph_mobile(new.phone);
  return new;
end;
$$;
revoke all on function private.normalize_profile_phone() from public, anon, authenticated;

create trigger profiles_normalize_phone
  before insert or update of phone on public.profiles
  for each row execute function private.normalize_profile_phone();

-- ---------------------------------------------------------------------------
-- 3. Backfill and checks. The UPDATE goes through the trigger, so only rows the rule accepts are touched
--    (a row it would refuse is left as it was). Blank values become null.
-- ---------------------------------------------------------------------------
create function private.ph_mobile_or_null(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  return private.normalize_ph_mobile(p);
exception when sqlstate 'P0001' then
  return null;
end;
$$;

update public.bookings
set guest_phone = guest_phone
where guest_phone is not null
  and (private.ph_mobile_or_null(guest_phone) is not null or btrim(guest_phone) = '')
  and guest_phone is distinct from private.ph_mobile_or_null(guest_phone);

update public.profiles
set phone = phone
where phone is not null
  and (private.ph_mobile_or_null(phone) is not null or btrim(phone) = '')
  and phone is distinct from private.ph_mobile_or_null(phone);

drop function private.ph_mobile_or_null(text);

alter table public.bookings
  add constraint bookings_guest_phone_format check (guest_phone is null or guest_phone ~ '^09[0-9]{9}$') not valid;
alter table public.profiles
  add constraint profiles_phone_format check (phone is null or phone ~ '^09[0-9]{9}$') not valid;

do $$
begin
  if not exists (select 1 from public.bookings where guest_phone !~ '^09[0-9]{9}$') then
    alter table public.bookings validate constraint bookings_guest_phone_format;
  end if;
  if not exists (select 1 from public.profiles where phone !~ '^09[0-9]{9}$') then
    alter table public.profiles validate constraint profiles_phone_format;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. create_booking: the live body from 20261022140512_open_play_sessions.sql, with the guest phone optional.
-- ---------------------------------------------------------------------------
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
  -- Serialize with open play sessions on this court; validate_booking_slot then checks a fresh snapshot.
  perform private.lock_court_slots(p_court_id);
  v_during := private.validate_booking_slot(p_court_id, p_start, p_slots, false);
  select * into v_settings from public.venue_settings;

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
$$;
