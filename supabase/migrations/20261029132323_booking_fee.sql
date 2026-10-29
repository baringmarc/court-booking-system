-- T11.12: the booking fee paid by the player (SPEC §10 2026-10-26 and 2026-10-27, RESEARCH M11 "Booking fee" and
-- "Earnings split"). Expand only: the deployed frontend and Edge Functions keep working, because total_amount stays the
-- court price and the fee starts at 0 (set to 10 in T11.13, once the frontend and both functions are deployed).
--   1. platform_pricing: the current fee, as data. Anyone reads it; no client writes (migration or service role).
--   2. bookings.booking_fee (a snapshot, set by a trigger on insert: online bookings only) and the generated
--      amount_due = total_amount + booking_fee, so no reader can forget the sum.
--   3. The amount the player owes is amount_due in proof_target (checkout and proofs), the PayMongo amount check
--      (and so its refund path), get_guest_booking and the email payload.
--   4. get_earnings gains split: total revenue, Plotline fees and owner earnings, for the range and the one before.

-- ---------------------------------------------------------------------------
-- 1. platform_pricing
-- ---------------------------------------------------------------------------
create table public.platform_pricing (
  id          boolean primary key default true check (id),
  booking_fee numeric(10, 2) not null check (booking_fee >= 0)
);
comment on table public.platform_pricing is
  'Plotline''s current pricing (T11.12): one row. booking_fee is copied onto each new online booking. No client writes.';

insert into public.platform_pricing (booking_fee) values (0);

alter table public.platform_pricing enable row level security;
revoke all on public.platform_pricing from anon, authenticated;
grant select on public.platform_pricing to anon, authenticated;
create policy "Anyone can read platform pricing" on public.platform_pricing for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. bookings.booking_fee and amount_due
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column booking_fee numeric(10, 2) not null default 0 check (booking_fee >= 0),
  add constraint bookings_fee_online_only check (source = 'online' or booking_fee = 0);
alter table public.bookings
  add column amount_due numeric generated always as (total_amount + booking_fee) stored;

comment on column public.bookings.booking_fee is
  'Plotline''s booking fee paid by the player, copied from platform_pricing when an online booking is made (T11.12). 0 for walk-ins, moved parts and bookings made before the fee.';
comment on column public.bookings.amount_due is 'What the player pays: total_amount (the court price) + booking_fee.';

-- Every insert path gets the snapshot, so create_booking, create_walk_in and reschedule_booking need no change.
create function private.set_booking_fee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.booking_fee := case
    when new.source = 'online' then coalesce((select pp.booking_fee from public.platform_pricing pp), 0)
    else 0
  end;
  return new;
end;
$$;
revoke all on function private.set_booking_fee() from public, anon, authenticated;

create trigger bookings_set_booking_fee
  before insert on public.bookings
  for each row execute function private.set_booking_fee();

-- ---------------------------------------------------------------------------
-- 3a. proof_target: also returns amount_due (a new result column: drop and recreate, same grants).
--     total_amount stays for the deployed create-paymongo-checkout until it is redeployed.
-- ---------------------------------------------------------------------------
drop function public.proof_target(text, text, uuid);

create function public.proof_target(p_reference_code text, p_token text, p_user_id uuid)
returns table (booking_id uuid, total_amount numeric, amount_due numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  select b.* into v_booking
  from public.bookings b
  where b.reference_code = upper(trim(p_reference_code))
    and (
      (p_user_id is not null and b.user_id = p_user_id)
      or (b.guest_token_hash is not null and b.guest_token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8')))
    );

  if not found then
    -- Same response for an unknown reference and a wrong token or owner.
    raise exception 'Booking not found. Check that you opened the full link from your confirmation.'
      using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_booking.status = 'expired' or (v_booking.status = 'pending_payment' and v_booking.expires_at <= now()) then
    raise exception 'This hold has expired, so the times were released. Please book again.'
      using errcode = 'P0001', hint = 'hold_expired';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'This booking is not waiting for a payment proof.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  return query select v_booking.id, v_booking.total_amount, v_booking.amount_due;
end;
$$;

revoke all on function public.proof_target(text, text, uuid) from public, anon, authenticated;
grant execute on function public.proof_target(text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3b. record_paymongo_payment: the amount check uses amount_due. Same body as 20261022140512 otherwise.
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

  if coalesce(upper(p_currency), '') <> 'PHP' or p_amount_centavos <> (v_booking.amount_due * 100)::bigint then
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
-- 3c. get_guest_booking: also returns booking_fee and amount_due (new result columns: drop and recreate, same
--     grants). Same body as 20261026131753 otherwise.
-- ---------------------------------------------------------------------------
drop function public.get_guest_booking(text, text);

create function public.get_guest_booking(p_reference_code text, p_token text)
returns table (
  id uuid, reference_code text, court_id uuid, court_name text, sport public.sport,
  slot_start timestamptz, slot_end timestamptz, status public.booking_status, total_amount numeric,
  expires_at timestamptz, rejection_count smallint, guest_name text, guest_email text, created_at timestamptz,
  payment_instructions text, payments jsonb, cancelled_at timestamptz, cancel_reason text, cancelled_by_venue boolean,
  parent_reference_code text, continuations jsonb, changes jsonb, booking_fee numeric, amount_due numeric
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
    b.booking_fee, b.amount_due
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
-- 3d. The email payload gains booking_fee and amount_due (total_amount stays the court price).
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
    'name',           p_booking.guest_name
  )
  from public.courts c
  cross join (select name, timezone from public.venue_settings limit 1) vs
  where c.id = p_booking.court_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. get_earnings: the split (expand only: new key, existing keys unchanged). Same body as 20261025155529 otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.get_earnings(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz         text := private.venue_tz();
  v_days       integer;
  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_result     jsonb;
begin
  if not private.is_admin() then
    raise exception 'Only staff can see earnings.' using errcode = 'P0001', hint = 'forbidden';
  end if;
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
    select p.method, p.amount, p.reviewed_at, (p.reviewed_at at time zone v_tz)::date as day
    from public.payments p
    where p.review_status = 'approved' and p.reviewed_at >= v_prev_start and p.reviewed_at < v_end
  ),
  cur as (select * from paid where reviewed_at >= v_start),
  prev as (select * from paid where reviewed_at < v_start),
  -- Plotline fees (T11.12): a booking's fee counts once, when its first payment was approved, unless the venue
  -- cancelled it (SAAS-PLAN §5). Player cancellations keep their fee.
  fee_bookings as (
    select b.booking_fee, min(p.reviewed_at) as paid_at
    from public.bookings b
    join public.payments p on p.booking_id = b.id and p.review_status = 'approved'
    where b.booking_fee > 0 and not b.cancelled_by_venue
    group by b.id, b.booking_fee
  ),
  dates as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  ),
  open_days as (
    select dt.day, private.operating_day_range(dt.day) as r from dates dt
  ),
  courts as (
    select c.id, c.name, c.sport, c.sort_order,
           array_position((select vs.sport_order from public.venue_settings vs), c.sport) as sport_pos
    from public.courts c
    where c.is_active
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
          where (bo.court_id is null or bo.court_id = c.id) and tstzrange(bo.starts_at, bo.ends_at) && od.r
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
        'by_method', coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'amount', m.amount, 'count', m.n) order by m.method), '[]'::jsonb))
      from (select method, sum(amount) as amount, count(*) as n from cur group by method) m
    ),
    'previous', (
      select jsonb_build_object(
        'from', p_from - v_days,
        'to', p_from - 1,
        'total', coalesce(sum(m.amount), 0),
        'count', coalesce(sum(m.n), 0),
        'by_method', coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'amount', m.amount, 'count', m.n) order by m.method), '[]'::jsonb))
      from (select method, sum(amount) as amount, count(*) as n from prev group by method) m
    ),
    'refunds_due', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(p.amount), 0))
      from public.payments p
      where p.method = 'paymongo' and p.review_status = 'rejected' and p.reviewed_at >= v_start and p.reviewed_at < v_end
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
      where b.status = 'confirmed' and lower(b.during) > now()
    )
  )
  into v_result;

  return v_result;
end;
$$;
