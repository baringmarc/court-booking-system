-- T30.2 (M30 Retention basics): day-before reminders and "same time next week" data (SPEC §6, §8, §10 2026-11-20).
--
--   1. private.booking_email_data gains court_id, slots, address and maps_url (the rebook link, the .ics and the
--      reminder's address in T30.3); the booking_rescheduled snapshot takes court_id and slots from the new range.
--   2. private.queue_booking_reminders(p_now) + pg_cron 'booking-reminders' every 15 minutes: once a venue's local time
--      reaches 18:00, one booking_reminder row per confirmed online booking (or moved part of one) that starts on the
--      venue's next calendar day and was confirmed before 18:00 local today. email_outbox_once_per_booking already
--      allows one row per booking and kind, so it is never queued twice. send-emails drains them like the others.
--   3. claim_email_outbox also returns booking_starts_at (the booking's start now), so the worker can skip a reminder
--      whose booking moved since it was queued.
--   4. bookings.rebooked_from and create_booking's p_rebook_of_reference (the original's reference code).
--   5. get_earnings gains rebooked {count}.
--
-- Deleting a venue (venue_deletion_preview / delete_unused_venue) needs no change: reminders are email_outbox rows
-- (already deleted with the venue's outbox), and rebooked_from points inside the same venue's bookings.

-- ---------------------------------------------------------------------------
-- 1. Snapshot keys
-- ---------------------------------------------------------------------------
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
    'waiver_accepted_at', p_booking.waiver_accepted_at,
    'court_id',       p_booking.court_id,
    'slots',          round(extract(epoch from upper(p_booking.during) - lower(p_booking.during)) / 3600)::integer,
    'address',        vs.address,
    'maps_url',       vs.maps_url
  )
  from public.courts c
  join public.venue_settings vs on vs.venue_id = p_booking.venue_id
  where c.id = p_booking.court_id;
$function$;

CREATE OR REPLACE FUNCTION private.queue_reschedule_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_booking public.bookings;
  v_root    public.bookings;
begin
  if coalesce(current_setting('app.suppress_booking_emails', true), '') = 'on' then
    return null;
  end if;

  begin
    select * into v_booking from public.bookings b where b.id = new.booking_id;
    select * into v_root from public.bookings b where b.id = coalesce(v_booking.parent_booking_id, v_booking.id);
    if v_root.source <> 'online' or nullif(trim(v_root.guest_email), '') is null then
      return null;
    end if;

    insert into public.email_outbox (booking_id, change_id, kind, to_email, for_guest, data)
    select
      v_root.id, new.id, 'booking_rescheduled', trim(v_root.guest_email),
      v_root.user_id is null and v_root.guest_token_hash is not null,
      private.booking_email_data(v_root) || jsonb_build_object(
        'old_court_name', oc.name, 'old_starts_at', lower(new.old_during), 'old_ends_at', upper(new.old_during),
        'new_court_name', nc.name, 'new_starts_at', lower(new.new_during), 'new_ends_at', upper(new.new_during),
        'continuation_reference', (select m.reference_code from public.bookings m where m.id = new.continuation_id),
        'reason', new.reason,
        -- The rebook link (T30.3) follows the new court and range.
        'court_id', new.new_court_id,
        'slots', round(extract(epoch from upper(new.new_during) - lower(new.new_during)) / 3600)::integer
      )
    from public.courts oc, public.courts nc
    where oc.id = new.old_court_id and nc.id = new.new_court_id
    on conflict do nothing;
  exception when others then
    raise warning 'queue_reschedule_email(%): % (%)', new.id, sqlerrm, sqlstate;
  end;

  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Reminders
-- ---------------------------------------------------------------------------

-- p_now lets the tests fake the clock; the cron job calls it with none. Returns the number of rows queued.
-- Recipients are payment_confirmed's: the booking's own email (a moved part copies its root's contact). Each booking
-- is queued in its own block, so one bad row (or a race with another run) never stops the others.
create function private.queue_booking_reminders(p_now timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_count   integer := 0;
  v_n       integer;
begin
  if coalesce(current_setting('app.suppress_booking_emails', true), '') = 'on' then
    return 0;
  end if;

  for v_booking in
    select b.*
    from public.venue_settings vs
    cross join lateral (select (p_now at time zone vs.timezone) as local_now) l
    join public.bookings b on b.venue_id = vs.venue_id
    left join public.bookings r on r.id = b.parent_booking_id
    where l.local_now::time >= time '18:00'
      and b.status = 'confirmed'
      and (b.source = 'online' or (b.source = 'moved' and r.source = 'online'))
      and nullif(trim(b.guest_email), '') is not null
      and lower(b.during) >= (l.local_now::date + 1)::timestamp at time zone vs.timezone
      and lower(b.during) <  (l.local_now::date + 2)::timestamp at time zone vs.timezone
      and b.confirmed_at < (l.local_now::date + time '18:00') at time zone vs.timezone
      and not exists (
        select 1 from public.email_outbox o where o.booking_id = b.id and o.kind = 'booking_reminder'
      )
  loop
    begin
      insert into public.email_outbox (booking_id, kind, to_email, for_guest, data)
      values (
        v_booking.id, 'booking_reminder', trim(v_booking.guest_email),
        v_booking.user_id is null and v_booking.guest_token_hash is not null,
        private.booking_email_data(v_booking)
      )
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_count := v_count + v_n;
    exception when others then
      raise warning 'queue_booking_reminders(%): % (%)', v_booking.id, sqlerrm, sqlstate;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.queue_booking_reminders(timestamptz) from public, anon, authenticated, service_role;

select cron.schedule('booking-reminders', '*/15 * * * *', 'select private.queue_booking_reminders()');

-- ---------------------------------------------------------------------------
-- 3. claim_email_outbox: + booking_starts_at (the return type changes, so drop and recreate; same grants)
-- ---------------------------------------------------------------------------
drop function public.claim_email_outbox(integer);

-- Leases up to p_limit due rows for 5 minutes. A row whose lease ran out (the worker died) is due again, unless it
-- already used its 5 attempts, in which case it becomes failed. booking_status is the booking's effective status now
-- and booking_starts_at its start now, so the worker can drop an email that a later event has overtaken (a
-- booking_created after a cancellation, a booking_reminder after a cancellation or a move).
create function public.claim_email_outbox(p_limit integer default 20)
returns table (
  id uuid, booking_id uuid, kind public.email_kind, to_email text, for_guest boolean, data jsonb,
  attempts smallint, booking_status public.booking_status, booking_starts_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.email_outbox o
  set status = 'failed', locked_until = null, last_error = coalesce(o.last_error, 'The send did not finish.')
  where o.status = 'sending' and o.locked_until <= now() and o.attempts >= 5;

  return query
  with picked as (
    select o.id
    from public.email_outbox o
    where (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_until <= now())
    order by o.next_attempt_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ),
  leased as (
    update public.email_outbox o
    set status = 'sending', attempts = o.attempts + 1, locked_until = now() + interval '5 minutes'
    from picked
    where o.id = picked.id
    returning o.*
  )
  select l.id, l.booking_id, l.kind, l.to_email, l.for_guest, l.data, l.attempts,
         case when b.status = 'pending_payment' and b.expires_at <= now() then 'expired'::public.booking_status
              else b.status end,
         lower(b.during)
  from leased l
  join public.bookings b on b.id = l.booking_id
  order by l.next_attempt_at;
end;
$$;

revoke all on function public.claim_email_outbox(integer) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Rebookings
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column rebooked_from uuid references public.bookings (id) on delete set null;

comment on column public.bookings.rebooked_from is
  'The booking whose "Same time next week" link made this one (T30.2), resolved from its reference code in the same venue by create_booking. A record only.';

create index bookings_rebooked_from_idx on public.bookings (rebooked_from) where rebooked_from is not null;

-- Clients read bookings through column grants (none is added: rebooked_from is staff/report data, read via RPCs).

drop function public.create_booking(uuid, timestamptz, integer, text, text, text, boolean);

CREATE FUNCTION public.create_booking(p_court_id uuid, p_start timestamp with time zone, p_slots integer, p_guest_name text DEFAULT NULL::text, p_guest_email text DEFAULT NULL::text, p_guest_phone text DEFAULT NULL::text, p_waiver_accepted boolean DEFAULT false, p_rebook_of_reference text DEFAULT NULL::text)
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
  v_rebook_of  uuid;
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

  -- Same time next week (T30.2): the original's reference code, looked up in this venue only. An unknown, blank or
  -- other-venue code leaves rebooked_from null and never fails the booking (a stale link still books). The code is
  -- only a record; it grants nothing.
  if nullif(trim(p_rebook_of_reference), '') is not null then
    select r.id into v_rebook_of
    from public.bookings r
    where r.venue_id = v_venue and r.reference_code = upper(trim(p_rebook_of_reference));
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
        during, total_amount, status, source, guest_token_hash, expires_at, waiver_text, waiver_accepted_at,
        rebooked_from
      ) values (
        private.new_reference_code(), p_court_id, v_uid, v_name, v_email, v_phone,
        v_during, v_price, 'pending_payment', 'online', v_hash,
        now() + make_interval(mins => v_settings.payment_hold_minutes),
        v_waiver, case when v_waiver is not null then now() end,
        v_rebook_of
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

revoke all on function public.create_booking(uuid, timestamptz, integer, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.create_booking(uuid, timestamptz, integer, text, text, text, boolean, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. get_earnings: + rebooked (same signature and grants)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_earnings(p_from date, p_to date, p_venue_id uuid DEFAULT NULL::uuid)
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
    cross join dates dt
    cross join lateral (select dt.day, ep as r from private.effective_open_periods(v_venue, c.id, dt.day) ep) od
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
    -- Same time next week (T30.2): confirmed bookings made from that link, by play date (venue calendar day).
    'rebooked', (
      select jsonb_build_object('count', count(*))
      from public.bookings b
      where b.venue_id = v_venue and b.rebooked_from is not null and b.status = 'confirmed'
        and lower(b.during) >= v_start and lower(b.during) < v_end
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
