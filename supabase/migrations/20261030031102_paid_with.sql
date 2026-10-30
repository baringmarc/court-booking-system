-- T11.27: "Paid with". A proof can name one of the venue's payment accounts; the payment keeps the account's label
-- as it was at that moment, so renaming or deleting the account never rewrites history.
--   1. payments.payment_account_id (set null when the account is deleted) and payments.paid_with (the label copy).
--   2. record_payment_proof takes an optional p_account_id (expand: without it, today's p_method path).
--   3. get_guest_booking returns paid_with (never the account id or file path); get_earnings groups by it.

alter table public.payments
  add column payment_account_id uuid references public.venue_payment_accounts (id) on delete set null,
  add column paid_with text constraint payments_paid_with_length check (char_length(paid_with) <= 40),
  add constraint payments_account_has_label check (method <> 'account' or paid_with is not null);

comment on column public.payments.paid_with is
  'Label of the payment account the player paid, copied when the proof was submitted (T11.27).';

create index payments_payment_account_id_idx on public.payments (payment_account_id);

-- ---------------------------------------------------------------------------
-- 2. record_payment_proof: the body from 20261017034632_expire_holds_job.sql plus the account.
-- ---------------------------------------------------------------------------
drop function public.record_payment_proof(uuid, text, public.payment_method, numeric, text);

create function public.record_payment_proof(
  p_booking_id        uuid,
  p_storage_path      text,
  p_method            public.payment_method,
  p_amount            numeric,
  p_reference_number  text default null,
  p_account_id        uuid default null
)
returns table (payment_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_payment_id uuid;
  v_method public.payment_method := p_method;
  v_label text;
begin
  if p_account_id is not null then
    select a.label into v_label from public.venue_payment_accounts a where a.id = p_account_id;
    if not found then
      raise exception 'Choose one of the venue''s payment accounts.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    v_method := 'account';
  elsif p_method is null or p_method in ('cash', 'account') then
    raise exception 'Choose GCash, Maya or bank transfer. Cash is paid at the counter.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000 then
    raise exception 'Enter the amount you paid.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if p_storage_path is null or p_storage_path not like p_booking_id::text || '/%' then
    raise exception 'The proof file is missing.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Lock the booking so a concurrent review, expiry sweep or second submission can't interleave.
  select b.* into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_booking.status = 'expired' or (v_booking.status = 'pending_payment' and v_booking.expires_at <= now()) then
    raise exception 'This hold has expired, so the times were released. Please book again.'
      using errcode = 'P0001', hint = 'hold_expired';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'This booking is not waiting for a payment proof.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  insert into public.payments (booking_id, method, amount, reference_number, storage_path, review_status, payment_account_id, paid_with)
  values (p_booking_id, v_method, round(p_amount, 2), nullif(trim(p_reference_number), ''), p_storage_path, 'pending', p_account_id, v_label)
  returning id into v_payment_id;

  update public.bookings set status = 'payment_submitted' where id = p_booking_id;

  return query select v_payment_id;
end;
$$;

revoke all on function public.record_payment_proof(uuid, text, public.payment_method, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.record_payment_proof(uuid, text, public.payment_method, numeric, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3a. get_guest_booking: the body from 20261029150958_venue_waiver.sql plus paid_with in each payment.
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
-- 3b. get_earnings: the body from 20261029132323_booking_fee.sql; each by_method entry gains paid_with, and account
--     payments are grouped by it (null for the other methods).
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
    select p.method, p.paid_with, p.amount, p.reviewed_at, (p.reviewed_at at time zone v_tz)::date as day
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
