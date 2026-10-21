-- Milestone 9, T9.9: overnight and 24-hour opening hours (SPEC §5.2, §10; RESEARCH M9 "Overnight and 24-hour
-- opening hours"). A slot belongs to its OPERATING DAY: the day whose opening it follows. So a 1 AM slot after a
-- 6 AM opening belongs to the previous date, is listed under it, priced from its rate row, and counts for it in
-- the booking window. Also: the T9.5 follow-up (a court deleted mid-booking gives a readable error) and the T9.8
-- follow-up (no email-derived contact name, since the first word of it is now public).
-- Compatible with the deployed frontend: same RPC signatures and result columns.

-- ---------------------------------------------------------------------------
-- 1. Storage: keep operating_hours. A close at or before the open means "closes the next day";
--    open = close means 24 hours. Only the open < close check goes.
-- ---------------------------------------------------------------------------
alter table public.operating_hours drop constraint operating_hours_check;

-- ---------------------------------------------------------------------------
-- 2. The operating day, one source of truth for every rule below.
-- ---------------------------------------------------------------------------

-- The instants a day is open: [d + open, d + close), the close on the next day when close <= open.
-- Null when that day is closed (or has no row).
create function private.operating_day_range(p_day date)
returns tstzrange
language sql
stable
set search_path = ''
as $$
  select tstzrange(
    (p_day + oh.open_time) at time zone private.venue_tz(),
    (p_day + case when oh.close_time <= oh.open_time then 1 else 0 end + oh.close_time) at time zone private.venue_tz()
  )
  from public.operating_hours oh
  where oh.day_of_week = extract(dow from p_day)::smallint
    and not oh.is_closed;
$$;

-- The operating day an instant belongs to: its own local date when that day is open then, else the previous
-- date when the previous day runs past midnight to then, else null (the venue is closed).
-- Days never overlap (check below), so at most one of them can contain the instant.
create function private.operating_day_of(p_ts timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  with l as (select (p_ts at time zone private.venue_tz())::date as d)
  select case
    when private.operating_day_range(l.d) @> p_ts then l.d
    when private.operating_day_range(l.d - 1) @> p_ts then l.d - 1
  end
  from l;
$$;

-- "Today" for the venue: the operating day running now (at 1 AM after a 6 AM–5 AM day, that's yesterday's date),
-- or the local date while the venue is closed.
create function private.operating_today()
returns date
language sql
stable
set search_path = ''
as $$
  select coalesce(private.operating_day_of(now()), private.local_today());
$$;

revoke all on function private.operating_day_range(date) from public, anon, authenticated;
revoke all on function private.operating_day_of(timestamptz) from public, anon, authenticated;
revoke all on function private.operating_today() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Days never overlap: a day may run past midnight only until the next day opens.
--    Checked for every write (a deferred constraint trigger), so the RPC below can update all seven rows
--    in one statement, and an old client writing rows one by one is still held to it.
-- ---------------------------------------------------------------------------
create function private.check_operating_hours()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_names constant text[] := array['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  r record;
begin
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

revoke all on function private.check_operating_hours() from public, anon, authenticated;

create constraint trigger operating_hours_no_overlap
  after insert or update on public.operating_hours
  deferrable initially deferred
  for each row execute function private.check_operating_hours();

-- Saves the whole week at once (the schedule editor's single Save). p_hours: a JSON array of seven objects
-- {day_of_week, open_time "HH:MM", close_time "HH:MM", is_closed}.
create function public.set_operating_hours(p_hours jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can change opening hours.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_hours is null or jsonb_typeof(p_hours) <> 'array' or jsonb_array_length(p_hours) <> 7
     or (select count(distinct (e ->> 'day_of_week')::int) from jsonb_array_elements(p_hours) e
         where (e ->> 'day_of_week')::int between 0 and 6) <> 7 then
    raise exception 'Send the hours for all seven days.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.operating_hours oh
  set open_time = (e ->> 'open_time')::time,
      close_time = (e ->> 'close_time')::time,
      is_closed = coalesce((e ->> 'is_closed')::boolean, false)
  from jsonb_array_elements(p_hours) e
  where oh.day_of_week = (e ->> 'day_of_week')::smallint;

  -- Check now, so a clash comes back as this call's error instead of at commit.
  set constraints public.operating_hours_no_overlap immediate;
exception
  when check_violation or invalid_datetime_format or invalid_text_representation or not_null_violation then
    raise exception 'Opening and closing times must be whole hours.' using errcode = 'P0001', hint = 'invalid_input';
end;
$$;

revoke all on function public.set_operating_hours(jsonb) from public, anon, authenticated;
grant execute on function public.set_operating_hours(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The booking window counts operating days.
-- ---------------------------------------------------------------------------
create or replace function private.in_booking_window(p_day date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_day between private.operating_today()
                   and private.operating_today() + (select booking_window_days from public.venue_settings);
$$;

-- ---------------------------------------------------------------------------
-- 5. Pricing: the rate row of the slot's operating day, at the slot's local hour.
-- ---------------------------------------------------------------------------
-- With the day of week known (get_availability lists one operating day; a booking lies within one).
create function private.slot_price(p_court_id uuid, p_slot_start timestamptz, p_dow smallint)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(r.price, c.default_hourly_rate)
  from public.courts c
  cross join private.local_dow_hour(p_slot_start) l
  left join public.court_rates r
    on r.court_id = c.id and r.day_of_week = p_dow and r.start_hour = l.hour
  where c.id = p_court_id;
$$;

-- Without it: the slot's operating day, or its local day when the venue is closed then (same as before M9).
create or replace function private.slot_price(p_court_id uuid, p_slot_start timestamptz)
returns numeric
language sql
stable
set search_path = ''
as $$
  select private.slot_price(
    p_court_id, p_slot_start,
    coalesce(extract(dow from private.operating_day_of(p_slot_start))::smallint, (private.local_dow_hour(p_slot_start)).dow)
  );
$$;

create or replace function private.range_price(p_court_id uuid, p_during tstzrange)
returns numeric
language sql
stable
set search_path = ''
as $$
  with d as (
    select coalesce(extract(dow from private.operating_day_of(lower(p_during)))::smallint,
                    (private.local_dow_hour(lower(p_during))).dow) as dow
  )
  select sum(private.slot_price(p_court_id, s, d.dow))
  from d, generate_series(lower(p_during), upper(p_during) - interval '1 hour', interval '1 hour') as s;
$$;

revoke all on function private.slot_price(uuid, timestamptz, smallint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The shared slot rules (create_booking, create_walk_in): one operating day instead of one calendar day.
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

  return v_during;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. get_availability: the whole operating day p_date (it may run past midnight), priced by p_date's rates.
--    Same signature and columns as 20261021000004.
-- ---------------------------------------------------------------------------
create or replace function public.get_availability(p_date date, p_court_id uuid default null)
returns table (
  court_id           uuid,
  slot_start         timestamptz,
  slot_end           timestamptz,
  price              numeric,
  status             text,
  booker_first_name  text
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
      case
        when upper(sl.slot) <= now() then 'past'  -- already over
        when bk.guest_name is not null then 'booked'
        when exists (
          select 1 from public.blackouts bo
          where (bo.court_id is null or bo.court_id = c.id)
            and tstzrange(bo.starts_at, bo.ends_at) && sl.slot
        ) then 'blackout'
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
    where c.is_active
      and (p_court_id is null or c.id = p_court_id)
  )
  select
    x.court_id,
    x.slot_start,
    upper(x.slot),
    private.slot_price(x.court_id, x.slot_start, extract(dow from p_date)::smallint),
    x.status,
    case when x.status = 'booked' then nullif(left(split_part(btrim(x.guest_name), ' ', 1), 20), '') end
  from cells x
  order by array_position((select vs.sport_order from public.venue_settings vs), x.sport),
           x.sort_order, x.name, x.slot_start;
$$;

-- ---------------------------------------------------------------------------
-- 8. create_booking and create_walk_in: same signatures and behaviour as 20261017034910, plus
--    - a court deleted while booking (bookings.court_id foreign key) is a readable error (T9.5 follow-up);
--    - a signed-in player without a name gets "Player", never their email's local part, which T9.8 would
--      show publicly as the first name (T9.8 follow-up).
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
