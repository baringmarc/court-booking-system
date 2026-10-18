-- Milestone 7: PayMongo (test mode) checkout sessions and payments (SPEC §4, §6; RESEARCH "DB and Edge Function
-- plan for T7.2–T7.4"). The create-paymongo-checkout and paymongo-webhook Edge Functions call these RPCs with the
-- secret key; clients never write any of it.
--
--   paymongo_checkout_for(booking)       -> the booking's stored, still usable checkout session (if any)
--   record_paymongo_checkout(...)        -> store a new session; the first one stored wins a race
--   record_paymongo_payment(...)         -> record a verified checkout_session.payment.paid event, under a row lock

-- ---------------------------------------------------------------------------
-- payments: PayMongo ids
-- ---------------------------------------------------------------------------
alter table public.payments
  add column provider_payment_id  text unique,   -- pay_…; also the webhook's idempotency key
  add column provider_checkout_id text,          -- cs_…
  add column provider_source      text,          -- PayMongo source.type, e.g. gcash, paymaya, card, qrph
  add column provider_event_id    text,          -- evt_… of the event that recorded it
  add constraint payments_paymongo_has_provider_id
    check ((method = 'paymongo') = (provider_payment_id is not null)),
  add constraint payments_provider_ids_shape
    check (
      (provider_payment_id is null or (provider_payment_id like 'pay\_%' and length(provider_payment_id) <= 100))
      and (provider_checkout_id is null or (provider_checkout_id like 'cs\_%' and length(provider_checkout_id) <= 100))
      and (provider_source is null or length(provider_source) <= 50)
      and (provider_event_id is null or length(provider_event_id) <= 100)
    );

-- The existing proof and walk-in RPCs accept any payment_method. Turn 'paymongo' there into a readable error
-- (instead of a raw CHECK violation): PayMongo payments are only ever recorded by record_paymongo_payment.
create function private.payments_paymongo_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.method = 'paymongo' and new.provider_payment_id is null then
    raise exception 'Online PayMongo payments are recorded automatically. Choose another payment method.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;
  return new;
end;
$$;

create trigger payments_paymongo_guard
  before insert or update of method, provider_payment_id on public.payments
  for each row execute function private.payments_paymongo_guard();

-- ---------------------------------------------------------------------------
-- paymongo_checkouts: at most one stored session per booking (reused while it's usable)
-- ---------------------------------------------------------------------------
create table public.paymongo_checkouts (
  booking_id       uuid primary key references public.bookings (id) on delete cascade,
  checkout_id      text not null unique check (checkout_id like 'cs\_%' and length(checkout_id) <= 100),
  checkout_url     text not null check (checkout_url like 'https://%' and length(checkout_url) <= 500),
  amount_centavos  bigint not null check (amount_centavos > 0),
  created_at       timestamptz not null default now()
);

comment on table public.paymongo_checkouts is 'PayMongo checkout session per booking. Written only by service-role RPCs.';

alter table public.paymongo_checkouts enable row level security;

revoke all on public.paymongo_checkouts from anon, authenticated;
grant select on public.paymongo_checkouts to authenticated;

create policy "Admins read PayMongo checkouts"
  on public.paymongo_checkouts for select
  to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- RPCs (service_role only)
-- ---------------------------------------------------------------------------

-- A stored session is dead once a payment was recorded on it (e.g. an amount mismatch while the booking is
-- still payable): PayMongo accepts only one payment per session, so it can't be reused.
create function public.paymongo_checkout_for(p_booking_id uuid)
returns table (checkout_id text, checkout_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select pc.checkout_id, pc.checkout_url
  from public.paymongo_checkouts pc
  where pc.booking_id = p_booking_id
    and not exists (select 1 from public.payments p where p.provider_checkout_id = pc.checkout_id);
$$;

create function public.record_paymongo_checkout(
  p_booking_id       uuid,
  p_checkout_id      text,
  p_checkout_url     text,
  p_amount_centavos  bigint
)
returns table (checkout_id text, checkout_url text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_booking public.bookings;
begin
  if p_checkout_id is null or p_checkout_url is null or p_amount_centavos is null or p_amount_centavos <= 0 then
    raise exception 'The checkout session is incomplete.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  select b.* into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_booking.status = 'pending_payment' and v_booking.expires_at <= now() then
    raise exception 'This hold has expired, so the times were released. Please book again.'
      using errcode = 'P0001', hint = 'hold_expired';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'This booking is not waiting for a payment.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  -- First session stored wins; a dead one (a payment was recorded on it) is replaced.
  insert into public.paymongo_checkouts as pc (booking_id, checkout_id, checkout_url, amount_centavos)
  values (p_booking_id, p_checkout_id, p_checkout_url, p_amount_centavos)
  on conflict (booking_id) do update
    set checkout_id = excluded.checkout_id,
        checkout_url = excluded.checkout_url,
        amount_centavos = excluded.amount_centavos,
        created_at = now()
    where exists (select 1 from public.payments p where p.provider_checkout_id = pc.checkout_id);

  return query
  select pc.checkout_id, pc.checkout_url from public.paymongo_checkouts pc where pc.booking_id = p_booking_id;
end;
$$;

-- Records a verified checkout_session.payment.paid event (SPEC §4, the four cases). Every value comes from the
-- signed payload. Outcomes: confirmed | revived | superseded_proof | late | duplicate | unknown_checkout.
create function public.record_paymongo_payment(
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
    -- covers it and nobody else holds it (the exclusion constraint decides the last one).
    select c.* into v_court from public.courts c where c.id = v_booking.court_id;
    if lower(v_booking.during) <= now() then
      v_outcome := 'late';
      v_note := 'Payment received after the booking time had started. The venue will arrange a refund.';
    elsif not v_court.is_active or exists (
      select 1 from public.blackouts bo
      where (bo.court_id is null or bo.court_id = v_booking.court_id)
        and tstzrange(bo.starts_at, bo.ends_at) && v_booking.during
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

revoke all on function public.paymongo_checkout_for(uuid) from public, anon, authenticated;
revoke all on function public.record_paymongo_checkout(uuid, text, text, bigint) from public, anon, authenticated;
revoke all on function public.record_paymongo_payment(text, text, text, bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public.paymongo_checkout_for(uuid) to service_role;
grant execute on function public.record_paymongo_checkout(uuid, text, text, bigint) to service_role;
grant execute on function public.record_paymongo_payment(text, text, text, bigint, text, text, uuid) to service_role;
