-- T30.5: refund status (TASKS T30.5; SPEC §4, §6, §10 2026-11-21; plan and db:push to staging approved by the user on
-- 2026-11-21, with the backfill of every existing case and refunds_due as all currently owed refunds).
-- A record only: no money moves, and PayMongo refunds stay a non-goal.
--   1. public.refund_status and public.refunds: one refund per payment, the fields tied to the status by a check.
--      Venue admins read their venue's rows; nobody writes them directly.
--   2. Created automatically as 'owed' by two triggers, wherever SPEC §4 said to settle outside the app:
--      a booking cancelled with an approved payment (cancel_booking is the only path to 'cancelled'), and a PayMongo
--      payment stored as not accepted (record_paymongo_payment's 'late' outcome, which covers a payment on an already
--      cancelled booking; review_payment only acts on 'payment_submitted' bookings, so it never approves one).
--   3. private.backfill_refunds(): the same rows for existing data (run once below; idempotent).
--   4. public.update_refund(...): staff settle (method, date, an editable amount), mark not refunded (a reason shown to
--      the player) or reopen.
--   5. The player's view: get_guest_booking gains a last column refund (drop and recreate, same grants), and
--      public.get_own_booking_refund(uuid) for the signed-in owner. Neither returns note or recorded_by.
--   6. get_earnings: refunded and net added; refunds_due becomes the count and total of every owed refund.
-- Venue deletion is unchanged: a refund needs a booking and a payment, which already block delete_unused_venue.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create type public.refund_status as enum ('owed', 'settled', 'not_refunded');

create table public.refunds (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references public.venues (id),
  booking_id   uuid not null,
  payment_id   uuid not null,
  amount       numeric(10, 2) not null constraint refunds_amount_positive check (amount > 0),
  status       public.refund_status not null default 'owed',
  method       public.payment_method,
  settled_on   date,
  reason       text constraint refunds_reason_length check (char_length(reason) <= 500),
  note         text constraint refunds_note_length check (char_length(note) <= 500),
  recorded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint refunds_one_per_payment unique (payment_id),
  constraint refunds_booking_fkey foreign key (venue_id, booking_id)
    references public.bookings (venue_id, id) on delete cascade,
  constraint refunds_payment_fkey foreign key (venue_id, payment_id)
    references public.payments (venue_id, id) on delete cascade,
  constraint refunds_status_fields check (
    case status
      when 'owed' then method is null and settled_on is null and reason is null
      when 'settled' then method is not null and settled_on is not null and reason is null
      when 'not_refunded' then method is null and settled_on is null and length(btrim(coalesce(reason, ''))) > 0
    end
  )
);
comment on table public.refunds is
  'What happened to the money of a payment the venue has to give back (T30.5): owed, settled (method, venue date, '
  'amount) or not refunded (a reason shown to the player). A record only: no money moves. Created by triggers; staff '
  'change it with update_refund. note and recorded_by are staff only.';
comment on column public.refunds.settled_on is 'The venue calendar date the refund was made (settled only).';
comment on column public.refunds.reason is 'Why no refund was made (not_refunded only); the player sees it.';
comment on column public.refunds.note is 'Staff only; never returned to players.';

create index refunds_booking_idx on public.refunds (booking_id);
create index refunds_venue_status_idx on public.refunds (venue_id, status);
create index refunds_venue_settled_idx on public.refunds (venue_id, settled_on) where status = 'settled';
create index refunds_recorded_by_idx on public.refunds (recorded_by);

create trigger refunds_set_updated_at
  before update on public.refunds
  for each row execute function private.set_updated_at();

alter table public.refunds enable row level security;
revoke all on public.refunds from anon, authenticated;
grant select on public.refunds to authenticated;

create policy "Venue admins read their venue's refunds"
  on public.refunds for select to authenticated
  using ((select private.is_venue_admin(venue_id)));

-- ---------------------------------------------------------------------------
-- 2. Created automatically. Security definer: players and guests cancel, and the service role records PayMongo
--    payments, but nobody may insert refunds directly.
-- ---------------------------------------------------------------------------
create function private.refunds_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.refunds (venue_id, booking_id, payment_id, amount)
  select p.venue_id, p.booking_id, p.id, p.amount
  from public.payments p
  where p.booking_id = new.id and p.review_status = 'approved' and p.amount > 0
  on conflict (payment_id) do nothing;
  return null;
end;
$$;
revoke all on function private.refunds_on_cancel() from public, anon, authenticated;

create trigger bookings_refunds_on_cancel
  after update of status on public.bookings
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function private.refunds_on_cancel();

create function private.refunds_on_paymongo_rejected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.refunds (venue_id, booking_id, payment_id, amount)
  values (new.venue_id, new.booking_id, new.id, new.amount)
  on conflict (payment_id) do nothing;
  return null;
end;
$$;
revoke all on function private.refunds_on_paymongo_rejected() from public, anon, authenticated;

create trigger payments_refunds_on_paymongo_rejected
  after insert on public.payments
  for each row
  when (new.method = 'paymongo' and new.review_status = 'rejected' and new.amount > 0)
  execute function private.refunds_on_paymongo_rejected();

-- ---------------------------------------------------------------------------
-- 3. Backfill: the same two cases for data that existed before the triggers. Dated when the case arose.
-- ---------------------------------------------------------------------------
create function private.backfill_refunds()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  with cases as (
    select p.venue_id, p.booking_id, p.id as payment_id, p.amount, coalesce(b.cancelled_at, now()) as arose_at
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    where b.status = 'cancelled' and p.review_status = 'approved' and p.amount > 0
    union all
    select p.venue_id, p.booking_id, p.id, p.amount, coalesce(p.reviewed_at, p.submitted_at)
    from public.payments p
    where p.method = 'paymongo' and p.review_status = 'rejected' and p.amount > 0
  ),
  ins as (
    insert into public.refunds (venue_id, booking_id, payment_id, amount, created_at, updated_at)
    select c.venue_id, c.booking_id, c.payment_id, c.amount, c.arose_at, c.arose_at from cases c
    on conflict (payment_id) do nothing
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;
revoke all on function private.backfill_refunds() from public, anon, authenticated;

select private.backfill_refunds();

-- ---------------------------------------------------------------------------
-- 4. update_refund
-- ---------------------------------------------------------------------------
create function public.update_refund(
  p_refund_id   uuid,
  p_status      public.refund_status,
  p_amount      numeric default null,
  p_method      public.payment_method default null,
  p_settled_on  date default null,
  p_reason      text default null,
  p_note        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_refund  public.refunds;
  v_paid    numeric;
  v_reason  text := nullif(btrim(p_reason), '');
  v_note    text;
  v_amount  numeric;
begin
  if v_uid is null or not (private.is_platform_admin()
       or exists (select 1 from public.venue_members m where m.user_id = v_uid)) then
    raise exception 'Only venue staff can update refunds.' using errcode = 'P0001', hint = 'forbidden';
  end if;

  select r.* into v_refund from public.refunds r where r.id = p_refund_id for update;
  if not found then
    raise exception 'Refund not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if not private.is_venue_admin(v_refund.venue_id) then
    raise exception 'Only venue staff can update refunds.' using errcode = 'P0001', hint = 'forbidden';
  end if;

  if p_status is null then
    raise exception 'Choose a refund status.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if char_length(p_reason) > 500 then
    raise exception 'Keep the reason under 500 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if char_length(p_note) > 500 then
    raise exception 'Keep the note under 500 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- A null amount keeps the current one; a new one is above 0 and at most what was paid.
  select p.amount into v_paid from public.payments p where p.id = v_refund.payment_id;
  if p_amount is not null and (p_amount <= 0 or p_amount > v_paid) then
    raise exception 'Enter an amount above 0 and no more than what was paid.' using errcode = 'P0001', hint = 'invalid_amount';
  end if;
  v_amount := coalesce(p_amount, v_refund.amount);
  -- A null note keeps the current one; a blank note clears it.
  v_note := case when p_note is null then v_refund.note else nullif(btrim(p_note), '') end;

  if p_status = 'settled' then
    if p_method is null then
      raise exception 'Choose how the refund was made.' using errcode = 'P0001', hint = 'missing_method';
    end if;
    if p_settled_on is null or p_settled_on > private.local_today(v_refund.venue_id) then
      raise exception 'Choose the date the refund was made, today or earlier.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    update public.refunds
    set status = 'settled', amount = v_amount, method = p_method, settled_on = p_settled_on, reason = null,
        note = v_note, recorded_by = v_uid
    where id = v_refund.id;
  elsif p_status = 'not_refunded' then
    if v_reason is null then
      raise exception 'Give a reason so the player knows why.' using errcode = 'P0001', hint = 'missing_reason';
    end if;
    update public.refunds
    set status = 'not_refunded', amount = v_amount, method = null, settled_on = null, reason = v_reason,
        note = v_note, recorded_by = v_uid
    where id = v_refund.id;
  else
    -- Reopened (a mistake): owed again, keeping the amount and the note.
    update public.refunds
    set status = 'owed', amount = v_amount, method = null, settled_on = null, reason = null,
        note = v_note, recorded_by = v_uid
    where id = v_refund.id;
  end if;
end;
$$;
revoke all on function public.update_refund(uuid, public.refund_status, numeric, public.payment_method, date, text, text)
  from public, anon;
grant execute on function public.update_refund(uuid, public.refund_status, numeric, public.payment_method, date, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The player's view of a booking's refund: status, amount, method, settled_on, reason. A booking can have two
--    refunds (a cancelled paid booking that is later paid again online); the player sees the latest.
-- ---------------------------------------------------------------------------
create function private.refund_player_json(p_booking_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'status', r.status, 'amount', r.amount, 'method', r.method, 'settled_on', r.settled_on, 'reason', r.reason)
  from public.refunds r
  where r.booking_id = p_booking_id
  order by r.created_at desc, r.id desc
  limit 1
$$;
revoke all on function private.refund_player_json(uuid) from public, anon, authenticated;

create function public.get_own_booking_refund(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.refund_player_json(b.id)
  from public.bookings b
  where b.id = p_booking_id and b.user_id = (select auth.uid())
$$;
revoke all on function public.get_own_booking_refund(uuid) from public, anon;
grant execute on function public.get_own_booking_refund(uuid) to authenticated, service_role;

-- get_guest_booking: same body as 20261030064018 plus the refund column (a new result column: drop and recreate).
drop function public.get_guest_booking(text, text);

CREATE FUNCTION public.get_guest_booking(p_reference_code text, p_token text)
 RETURNS TABLE(id uuid, reference_code text, court_id uuid, court_name text, sport sport, slot_start timestamp with time zone, slot_end timestamp with time zone, status booking_status, total_amount numeric, expires_at timestamp with time zone, rejection_count smallint, guest_name text, guest_email text, created_at timestamp with time zone, payment_instructions text, payments jsonb, cancelled_at timestamp with time zone, cancel_reason text, cancelled_by_venue boolean, parent_reference_code text, continuations jsonb, changes jsonb, booking_fee numeric, amount_due numeric, waiver_text text, waiver_accepted_at timestamp with time zone, refund jsonb)
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
    b.waiver_text, b.waiver_accepted_at,
    -- The player's view of the booking's refund (T30.5): never the staff note or who recorded it.
    private.refund_player_json(b.id)
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
revoke all on function public.get_guest_booking(text, text) from public;
grant execute on function public.get_guest_booking(text, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. get_earnings: same body as 20261120080043 plus refunded and net; refunds_due counts every owed refund.
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
  -- Settled refunds (T30.5) by settled_on, a venue calendar date, in this period and the one just before it.
  refunded as (
    select r.method, r.amount, r.settled_on
    from public.refunds r
    where r.venue_id = v_venue and r.status = 'settled' and r.settled_on >= p_from - v_days and r.settled_on <= p_to
  ),
  rcur as (select * from refunded where settled_on >= p_from),
  rprev as (select * from refunded where settled_on < p_from),
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
    -- Every refund the venue owes now (T30.5), whatever its kind and whenever it arose: not tied to the period.
    'refunds_due', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(r.amount), 0))
      from public.refunds r
      where r.venue_id = v_venue and r.status = 'owed'
    ),
    'refunded', (
      select jsonb_build_object(
        'total', coalesce(sum(m.amount), 0),
        'count', coalesce(sum(m.n), 0),
        'by_method', coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'amount', m.amount, 'count', m.n) order by m.method), '[]'::jsonb),
        'previous', (
          select jsonb_build_object(
            'from', p_from - v_days,
            'to', p_from - 1,
            'total', coalesce(sum(pm.amount), 0),
            'count', coalesce(sum(pm.n), 0),
            'by_method', coalesce(jsonb_agg(jsonb_build_object('method', pm.method, 'amount', pm.amount, 'count', pm.n) order by pm.method), '[]'::jsonb))
          from (select method, sum(amount) as amount, count(*) as n from rprev group by method) pm))
      from (select method, sum(amount) as amount, count(*) as n from rcur group by method) m
    ),
    -- Net (T30.5): collected minus settled refunds, for the period and the one before.
    'net', jsonb_build_object(
      'total', (select coalesce(sum(cur.amount), 0) from cur) - (select coalesce(sum(rcur.amount), 0) from rcur),
      'previous', jsonb_build_object(
        'total', (select coalesce(sum(prev.amount), 0) from prev) - (select coalesce(sum(rprev.amount), 0) from rprev))
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
