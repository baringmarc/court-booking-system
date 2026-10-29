-- T11.19: the venue's waiver (SPEC §10 2026-10-28 and 2026-10-29, RESEARCH M11 "Venue waiver (T11.16)").
--   1. venue_settings.waiver_text: the venue's own text (the default below for new venues, up to 2000 characters).
--      The live venue starts blank (no waiver), so the deployed checkout, which sends no acceptance, keeps booking;
--      the default text is set as a data change once T11.20 is on production (the user's call).
--   2. bookings.waiver_accepted_at and waiver_text: when and what the player accepted. Walk-ins and moved parts
--      keep nulls (a moved part's root holds the acceptance).
--   3. create_booking gains p_waiver_accepted (dropped and recreated, not overloaded: PostgREST refuses ambiguous
--      overloads, PGRST203). The default keeps old calls working.
--   4. get_guest_booking and the email payload carry the accepted text.

-- ---------------------------------------------------------------------------
-- 1. venue_settings.waiver_text
-- ---------------------------------------------------------------------------
alter table public.venue_settings
  add column waiver_text text not null
    default 'By booking and playing at the venue, you accept that sports carry a risk of injury. You play at your own risk and are responsible for your own belongings. Players under 18 need a parent or guardian''s consent.',
  add constraint venue_settings_waiver_text_length check (char_length(waiver_text) <= 2000);
comment on column public.venue_settings.waiver_text is
  'The venue''s waiver (T11.19). Blank turns it off; otherwise create_booking needs the player''s acceptance.';

update public.venue_settings set waiver_text = '';

-- ---------------------------------------------------------------------------
-- 2. The accepted copy on each booking
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column waiver_accepted_at timestamptz,
  add column waiver_text text,
  add constraint bookings_waiver_pair check ((waiver_accepted_at is null) = (waiver_text is null));
comment on column public.bookings.waiver_text is 'The waiver text the player accepted at checkout (T11.19); null when none was asked.';

-- ---------------------------------------------------------------------------
-- 3. create_booking: the live body from 20261029145041_phone_numbers.sql plus the waiver check.
-- ---------------------------------------------------------------------------
drop function public.create_booking(uuid, timestamptz, integer, text, text, text);

create function public.create_booking(
  p_court_id     uuid,
  p_start        timestamptz,
  p_slots        integer,
  p_guest_name   text default null,
  p_guest_email  text default null,
  p_guest_phone  text default null,
  p_waiver_accepted boolean default false
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
  v_waiver     text;
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
$$;

revoke all on function public.create_booking(uuid, timestamptz, integer, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.create_booking(uuid, timestamptz, integer, text, text, text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4a. get_guest_booking: the body from 20261029132323_booking_fee.sql plus the waiver (a new result type: drop and
--     recreate, same grants).
-- ---------------------------------------------------------------------------
drop function public.get_guest_booking(text, text);

create function public.get_guest_booking(p_reference_code text, p_token text)
returns table (
  id uuid, reference_code text, court_id uuid, court_name text, sport public.sport,
  slot_start timestamptz, slot_end timestamptz, status public.booking_status, total_amount numeric,
  expires_at timestamptz, rejection_count smallint, guest_name text, guest_email text, created_at timestamptz,
  payment_instructions text, payments jsonb, cancelled_at timestamptz, cancel_reason text, cancelled_by_venue boolean,
  parent_reference_code text, continuations jsonb, changes jsonb, booking_fee numeric, amount_due numeric,
  waiver_text text, waiver_accepted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
               'reviewed_at', p.reviewed_at, 'review_note', p.review_note
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
  cross join public.venue_settings vs
  where b.reference_code = upper(trim(p_reference_code))
    and b.guest_token_hash is not null
    and b.guest_token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
    and greatest(
          upper(b.during),
          coalesce((select max(upper(m.during)) from public.bookings m where m.parent_booking_id = b.id), upper(b.during))
        ) + interval '30 days' > now();

  if not found then
    raise exception 'Booking not found. Check that you opened the full link from your confirmation.'
      using errcode = 'P0001', hint = 'not_found';
  end if;
end;
$$;

revoke all on function public.get_guest_booking(text, text) from public, anon, authenticated;
grant execute on function public.get_guest_booking(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4b. The email payload gains the accepted waiver.
-- ---------------------------------------------------------------------------
create or replace function private.booking_email_data(p_booking public.bookings)
returns jsonb
language sql
stable
set search_path = ''
as $$
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
  cross join (select name, timezone from public.venue_settings limit 1) vs
  where c.id = p_booking.court_id;
$$;
