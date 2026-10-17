-- Milestone 4: database side of proof submission (RESEARCH "Proof upload for guests").
-- The submit-payment-proof Edge Function calls these with the secret key, in this order:
--   1. proof_target(ref, token, user_id)   -> authorize, check the booking is payable, get booking_id
--   2. upload the file to payment-proofs/{booking_id}/{uuid}.{ext}
--   3. record_payment_proof(...)            -> re-check under a row lock, insert payment, set payment_submitted
-- They live in public (PostgREST doesn't expose private) but only service_role may execute them.
-- p_user_id is the caller's verified user id (from the JWT the function checked); it is never client input.

create function public.proof_target(p_reference_code text, p_token text, p_user_id uuid)
returns table (booking_id uuid, total_amount numeric)
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
  if v_booking.status = 'pending_payment' and v_booking.expires_at <= now() then
    raise exception 'This hold has expired, so the times were released. Please book again.'
      using errcode = 'P0001', hint = 'hold_expired';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'This booking is not waiting for a payment proof.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  return query select v_booking.id, v_booking.total_amount;
end;
$$;

create function public.record_payment_proof(
  p_booking_id        uuid,
  p_storage_path      text,
  p_method            public.payment_method,
  p_amount            numeric,
  p_reference_number  text default null
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
begin
  if p_method is null or p_method = 'cash' then
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
  if v_booking.status = 'pending_payment' and v_booking.expires_at <= now() then
    raise exception 'This hold has expired, so the times were released. Please book again.'
      using errcode = 'P0001', hint = 'hold_expired';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'This booking is not waiting for a payment proof.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  insert into public.payments (booking_id, method, amount, reference_number, storage_path, review_status)
  values (p_booking_id, p_method, round(p_amount, 2), nullif(trim(p_reference_number), ''), p_storage_path, 'pending')
  returning id into v_payment_id;

  update public.bookings set status = 'payment_submitted' where id = p_booking_id;

  return query select v_payment_id;
end;
$$;

revoke all on function public.proof_target(text, text, uuid) from public, anon, authenticated;
revoke all on function public.record_payment_proof(uuid, text, public.payment_method, numeric, text) from public, anon, authenticated;
grant execute on function public.proof_target(text, text, uuid) to service_role;
grant execute on function public.record_payment_proof(uuid, text, public.payment_method, numeric, text) to service_role;

-- ---------------------------------------------------------------------------
-- get_guest_booking now also returns the payment attempts (metadata only: guests never get file paths,
-- SPEC §10). The return type changes, so the function is dropped and recreated with the same grants.
-- ---------------------------------------------------------------------------
drop function public.get_guest_booking(text, text);

create function public.get_guest_booking(p_reference_code text, p_token text)
returns table (
  id                    uuid,
  reference_code        text,
  court_id              uuid,
  court_name            text,
  sport                 public.sport,
  slot_start            timestamptz,
  slot_end              timestamptz,
  status                public.booking_status,
  total_amount          numeric,
  expires_at            timestamptz,
  rejection_count       smallint,
  guest_name            text,
  guest_email           text,
  created_at            timestamptz,
  payment_instructions  text,
  payments              jsonb
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
    ), '[]'::jsonb)
  from public.bookings b
  join public.courts c on c.id = b.court_id
  cross join public.venue_settings vs
  where b.reference_code = upper(trim(p_reference_code))
    and b.guest_token_hash is not null
    and b.guest_token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'));

  if not found then
    raise exception 'Booking not found. Check that you opened the full link from your confirmation.'
      using errcode = 'P0001', hint = 'not_found';
  end if;
end;
$$;

revoke all on function public.get_guest_booking(text, text) from public, anon, authenticated;
grant execute on function public.get_guest_booking(text, text) to anon, authenticated;
