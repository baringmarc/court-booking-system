-- T9.11c: one-off open play sessions (SPEC §5, RESEARCH M9 "Open play sessions"). A session blocks one or more
-- courts for a time range. Players can't book into it; /book shows the slots as open play with the session's
-- details. Admins write only through create_open_play / update_open_play / delete_open_play.
--
-- Sessions and bookings can't share a court and time. A constraint can't span the two tables, so each side
-- checks the other under a per-court advisory lock (private.lock_court_slots), taken by create_booking,
-- create_walk_in, the PayMongo revival of a lapsed hold and the session RPCs. validate_booking_slot is STABLE
-- and checks against its caller's snapshot, so callers take the lock in an earlier statement.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
-- Up to 3 {label, url} links: a label of 1–40 characters and an https URL with a host, at most 500 characters.
create function private.valid_open_play_links(p_links jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_link jsonb;
begin
  if p_links is null or jsonb_typeof(p_links) <> 'array' or jsonb_array_length(p_links) > 3 then
    return false;
  end if;
  for v_link in select e from jsonb_array_elements(p_links) e loop
    if jsonb_typeof(v_link) <> 'object'
       or (select count(*) from jsonb_object_keys(v_link)) <> 2
       or jsonb_typeof(v_link -> 'label') is distinct from 'string'
       or jsonb_typeof(v_link -> 'url') is distinct from 'string'
       or char_length(btrim(v_link ->> 'label')) not between 1 and 40
       or char_length(v_link ->> 'url') > 500
       or (v_link ->> 'url') !~ '^https://[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][^[:space:]<>"]*)?$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function private.valid_open_play_links(jsonb) from public, anon, authenticated;

create table public.open_play_sessions (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(btrim(title)) between 1 and 80),
  details     text not null default '' check (char_length(details) <= 2000),
  links       jsonb not null default '[]' check (private.valid_open_play_links(links)),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index open_play_sessions_created_by_idx on public.open_play_sessions (created_by);
create index open_play_sessions_range_idx on public.open_play_sessions using gist (tstzrange(starts_at, ends_at));

-- The courts a session blocks. during copies the session's range (written only by the RPCs), so two sessions
-- can't overlap on one court.
create table public.open_play_courts (
  session_id  uuid not null references public.open_play_sessions (id) on delete cascade,
  court_id    uuid not null references public.courts (id) on delete cascade,
  during      tstzrange not null,
  primary key (session_id, court_id),
  constraint open_play_courts_no_overlap exclude using gist (court_id with =, during with &&)
);

create index open_play_courts_court_id_idx on public.open_play_courts (court_id);

alter table public.open_play_sessions enable row level security;
alter table public.open_play_courts   enable row level security;

revoke all on public.open_play_sessions, public.open_play_courts from anon, authenticated;
grant select on public.open_play_sessions, public.open_play_courts to anon, authenticated;

-- Public details; writes only through the security definer RPCs below (no write grants or policies).
create policy "Anyone can read open play sessions"
  on public.open_play_sessions for select to anon, authenticated using (true);
create policy "Anyone can read open play courts"
  on public.open_play_courts for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. The per-court lock
-- ---------------------------------------------------------------------------
create function private.lock_court_slots(p_court_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_court_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('court_slots:' || p_court_id::text, 0));
  end if;
end;
$$;

revoke all on function private.lock_court_slots(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The shared slot rules refuse open play. Same body as 20261021001821, plus the open play check.
-- ---------------------------------------------------------------------------
create or replace function private.validate_booking_slot(
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
  v_day := private.operating_day_of(p_start);
  if v_day is null then
    raise exception 'That time is outside opening hours.' using errcode = 'P0001', hint = 'outside_hours';
  end if;
  -- Walk-ins skip the booking window (SPEC §5.8).
  if not p_walk_in and not private.in_booking_window(v_day) then
    raise exception 'Bookings can be made up to % days ahead.', v_settings.booking_window_days
      using errcode = 'P0001', hint = 'outside_window';
  end if;
  -- The whole booking within that one operating day. Running on past the calendar midnight after it means
  -- reaching into another day (multi_day); otherwise it just runs past closing.
  v_open := private.operating_day_range(v_day);
  if not v_open @> v_during then
    if upper(v_during) > (v_day + 1)::timestamp at time zone v_tz then
      raise exception 'A booking must fit within one day''s opening hours.' using errcode = 'P0001', hint = 'multi_day';
    end if;
    raise exception 'That time is outside opening hours.' using errcode = 'P0001', hint = 'outside_hours';
  end if;

  if exists (
    select 1 from public.blackouts bo
    where (bo.court_id is null or bo.court_id = p_court_id)
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

-- ---------------------------------------------------------------------------
-- 4. create_booking and create_walk_in take the court lock first. Same bodies as 20261021001821 otherwise.
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

create or replace function public.create_walk_in(
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
$$;

-- ---------------------------------------------------------------------------
-- 5. record_paymongo_payment: the court lock before the row lock, and a lapsed hold isn't revived into an open
--    play session. Same body as 20261018123355 otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.record_paymongo_payment(
  p_checkout_id      text,
  p_payment_id       text,
  p_event_id         text,
  p_amount_centavos  bigint,
  p_currency         text,
  p_source           text,
  p_booking_id       uuid default null
)
returns table (payment_id uuid, outcome text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_checkout   public.paymongo_checkouts;
  v_booking    public.bookings;
  v_court      public.courts;
  v_proof      public.payments;
  v_existing   uuid;
  v_payment_id uuid;
  v_outcome    text;
  v_note       text;
  v_amount     numeric(10, 2);
begin
  if p_checkout_id is null or p_payment_id is null or p_payment_id not like 'pay\_%'
     or p_amount_centavos is null or p_amount_centavos <= 0 then
    raise exception 'The PayMongo payment is incomplete.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Only sessions we created count; the metadata booking id (if sent) must agree with our record.
  select pc.* into v_checkout from public.paymongo_checkouts pc where pc.checkout_id = p_checkout_id;
  if not found or (p_booking_id is not null and p_booking_id <> v_checkout.booking_id) then
    return query select null::uuid, 'unknown_checkout'::text;
    return;
  end if;

  -- The court lock comes before the booking row lock (same order as create_booking, which updates lapsed
  -- holds under it), so a revival can't deadlock with a booking or an open play session on that court.
  perform private.lock_court_slots((select b.court_id from public.bookings b where b.id = v_checkout.booking_id));
  -- Lock the booking first, then look for a replay, so two deliveries of one event can't both record it.
  select b.* into v_booking from public.bookings b where b.id = v_checkout.booking_id for update;
  select p.id into v_existing from public.payments p where p.provider_payment_id = p_payment_id;
  if found then
    return query select v_existing, 'duplicate'::text;
    return;
  end if;

  v_amount := p_amount_centavos / 100.0;

  if coalesce(upper(p_currency), '') <> 'PHP' or p_amount_centavos <> (v_booking.total_amount * 100)::bigint then
    v_outcome := 'late';
    v_note := 'The amount paid online didn''t match the booking total. The venue will arrange a refund.';

  elsif v_booking.status = 'pending_payment' and v_booking.expires_at > now() then
    -- 1. Paid within the hold.
    v_outcome := 'confirmed';

  elsif v_booking.status = 'payment_submitted' then
    -- 3. A proof is waiting for review: confirm with the PayMongo payment and close the proof without counting
    -- it as a rejection. Lock order matches review_payment (booking, then its pending payment).
    select p.* into v_proof from public.payments p
    where p.booking_id = v_booking.id and p.review_status = 'pending'
    for update;
    if found then
      update public.payments
      set review_status = 'rejected', reviewed_at = now(), review_note = 'Paid online with PayMongo instead.'
      where id = v_proof.id;
    end if;
    v_outcome := 'superseded_proof';

  elsif (v_booking.status = 'pending_payment' and v_booking.expires_at <= now()) or v_booking.status = 'expired' then
    -- 2. The hold lapsed. Revive it only if the slot hasn't started, the court is still active, no blackout
    -- or open play session covers it and nobody else holds it (the exclusion constraint decides the last one).
    select c.* into v_court from public.courts c where c.id = v_booking.court_id;
    if lower(v_booking.during) <= now() then
      v_outcome := 'late';
      v_note := 'Payment received after the booking time had started. The venue will arrange a refund.';
    elsif not v_court.is_active or exists (
      select 1 from public.blackouts bo
      where (bo.court_id is null or bo.court_id = v_booking.court_id)
        and tstzrange(bo.starts_at, bo.ends_at) && v_booking.during
    ) or exists (
      select 1 from public.open_play_courts oc
      where oc.court_id = v_booking.court_id and oc.during && v_booking.during
    ) then
      v_outcome := 'late';
      v_note := 'Payment received after the hold expired, and the court is no longer available at that time. The venue will arrange a refund.';
    else
      begin
        update public.bookings set status = 'confirmed' where id = v_booking.id;
        v_outcome := 'revived';
      exception when exclusion_violation then
        v_outcome := 'late';
        v_note := 'Payment received after the hold expired, and the time was booked by someone else. The venue will arrange a refund.';
      end;
    end if;

  else
    -- 4. Cancelled, rejected or already paid: keep the booking as it is.
    v_outcome := 'late';
    v_note := case v_booking.status
      when 'cancelled' then 'Payment received after the booking was cancelled. The venue will arrange a refund.'
      when 'rejected' then 'Payment received after the booking was closed. The venue will arrange a refund.'
      else 'This booking was already paid. The venue will arrange a refund of this payment.'
    end;
  end if;

  if v_outcome = 'late' then
    insert into public.payments (
      booking_id, method, amount, provider_payment_id, provider_checkout_id, provider_source, provider_event_id,
      review_status, reviewed_at, review_note
    ) values (
      v_booking.id, 'paymongo', v_amount, p_payment_id, p_checkout_id, left(p_source, 50), p_event_id,
      'rejected', now(), v_note
    )
    returning id into v_payment_id;
  else
    insert into public.payments (
      booking_id, method, amount, provider_payment_id, provider_checkout_id, provider_source, provider_event_id,
      review_status, reviewed_at
    ) values (
      v_booking.id, 'paymongo', v_amount, p_payment_id, p_checkout_id, left(p_source, 50), p_event_id,
      'approved', now()
    )
    returning id into v_payment_id;
    if v_outcome <> 'revived' then
      update public.bookings set status = 'confirmed' where id = v_booking.id;
    end if;
  end if;

  return query select v_payment_id, v_outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. get_availability: status 'open_play' (after booked and blackout, before "in progress") and the session id.
--    A new result column, so drop and recreate in this transaction and re-grant (RESEARCH M9).
-- ---------------------------------------------------------------------------
drop function public.get_availability(date, uuid);

create function public.get_availability(p_date date, p_court_id uuid default null)
returns table (
  court_id           uuid,
  slot_start         timestamptz,
  slot_end           timestamptz,
  price              numeric,
  status             text,
  booker_first_name     text,
  open_play_session_id  uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with open_range as (
    select private.operating_day_range(p_date) as r
    where private.in_booking_window(p_date)
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
      bk.guest_name,
      op.session_id,
      case
        when upper(sl.slot) <= now() then 'past'  -- already over
        when bk.guest_name is not null then 'booked'
        when exists (
          select 1 from public.blackouts bo
          where (bo.court_id is null or bo.court_id = c.id)
            and tstzrange(bo.starts_at, bo.ends_at) && sl.slot
        ) then 'blackout'
        when op.session_id is not null then 'open_play'
        when sl.slot_start <= now() then 'past'   -- in progress and free: not bookable online (walk-ins may take it)
        else 'free'
      end as status
    from public.courts c
    cross join slots sl
    -- The active booking on this slot, if any (the exclusion constraint allows at most one).
    left join lateral (
      select b.guest_name
      from public.bookings b
      where b.court_id = c.id
        and b.during && sl.slot
        and b.status in ('pending_payment', 'payment_submitted', 'confirmed')
        and not (b.status = 'pending_payment' and b.expires_at <= now())
      limit 1
    ) bk on true
    -- The open play session on this slot, if any (open_play_courts_no_overlap allows at most one).
    left join lateral (
      select oc.session_id
      from public.open_play_courts oc
      where oc.court_id = c.id and oc.during && sl.slot
      limit 1
    ) op on true
    where c.is_active
      and (p_court_id is null or c.id = p_court_id)
  )
  select
    x.court_id,
    x.slot_start,
    upper(x.slot),
    private.slot_price(x.court_id, x.slot_start, extract(dow from p_date)::smallint),
    x.status,
    case when x.status = 'booked' then nullif(left(split_part(btrim(x.guest_name), ' ', 1), 20), '') end,
    case when x.status = 'open_play' then x.session_id end
  from cells x
  order by array_position((select vs.sport_order from public.venue_settings vs), x.sport),
           x.sort_order, x.name, x.slot_start;
$$;

revoke all on function public.get_availability(date, uuid) from public, anon, authenticated;
grant execute on function public.get_availability(date, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Admin RPCs. private.save_open_play checks and writes one session (p_id null = a new one).
-- ---------------------------------------------------------------------------
create function private.save_open_play(
  p_id         uuid,
  p_court_ids  uuid[],
  p_start      timestamptz,
  p_end        timestamptz,
  p_title      text,
  p_details    text,
  p_links      jsonb
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_tz      text := private.venue_tz();
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
  v_day := private.operating_day_of(p_start);
  if v_day is null or not private.operating_day_range(v_day) @> v_during then
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
    insert into public.open_play_sessions (title, details, links, starts_at, ends_at)
    values (v_title, v_details, v_links, p_start, p_end)
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
$$;

revoke all on function private.save_open_play(uuid, uuid[], timestamptz, timestamptz, text, text, jsonb)
  from public, anon, authenticated;

create function public.create_open_play(
  p_court_ids  uuid[],
  p_start      timestamptz,
  p_end        timestamptz,
  p_title      text,
  p_details    text default '',
  p_links      jsonb default '[]'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can manage open play sessions.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  return private.save_open_play(null, p_court_ids, p_start, p_end, p_title, p_details, p_links);
end;
$$;

-- Replaces everything about a session that hasn't started yet.
create function public.update_open_play(
  p_id         uuid,
  p_court_ids  uuid[],
  p_start      timestamptz,
  p_end        timestamptz,
  p_title      text,
  p_details    text default '',
  p_links      jsonb default '[]'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_starts timestamptz;
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can manage open play sessions.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  select s.starts_at into v_starts from public.open_play_sessions s where s.id = p_id for update;
  if not found then
    raise exception 'That open play session doesn''t exist.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_starts <= now() then
    raise exception 'This session has already started, so it can''t be edited.' using errcode = 'P0001', hint = 'session_started';
  end if;
  return private.save_open_play(p_id, p_court_ids, p_start, p_end, p_title, p_details, p_links);
end;
$$;

-- Allowed at any time: deleting a running session frees its remaining slots.
create function public.delete_open_play(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can manage open play sessions.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  delete from public.open_play_sessions where id = p_id;
  if not found then
    raise exception 'That open play session doesn''t exist.' using errcode = 'P0001', hint = 'not_found';
  end if;
end;
$$;

revoke all on function public.create_open_play(uuid[], timestamptz, timestamptz, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.update_open_play(uuid, uuid[], timestamptz, timestamptz, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.delete_open_play(uuid) from public, anon, authenticated;
grant execute on function public.create_open_play(uuid[], timestamptz, timestamptz, text, text, jsonb) to authenticated;
grant execute on function public.update_open_play(uuid, uuid[], timestamptz, timestamptz, text, text, jsonb) to authenticated;
grant execute on function public.delete_open_play(uuid) to authenticated;
