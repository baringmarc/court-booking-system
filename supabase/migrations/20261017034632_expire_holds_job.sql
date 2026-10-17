-- Milestone 4: expiry sweep (SPEC §4, RESEARCH "Expiry job (pg_cron)").
-- Lazy expiry still applies everywhere (expires_at <= now()); this job makes the stored status catch up
-- every minute. The rule is the same one used by get_availability, create_booking and the UI.

create extension if not exists pg_cron with schema pg_catalog;

-- Marks lapsed holds as expired and returns how many changed. Runs as the job owner (no auth.uid()).
create function private.expire_holds()
returns integer
language sql
volatile
set search_path = ''
as $$
  with expired as (
    update public.bookings
    set status = 'expired'
    where status = 'pending_payment'
      and expires_at <= now()
    returning 1
  )
  select count(*)::integer from expired;
$$;

revoke all on function private.expire_holds() from public, anon, authenticated;

-- Scheduling by name is an upsert (verified locally), so re-running this migration is safe.
select cron.schedule('expire-holds', '* * * * *', 'select private.expire_holds()');

-- Once the sweep has marked a hold expired, a late proof should still say "hold expired" rather than
-- "not waiting for a proof". Same bodies as 20261017033337_proof_rpcs, only the expiry check widened.
create or replace function public.proof_target(p_reference_code text, p_token text, p_user_id uuid)
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
  if v_booking.status = 'expired' or (v_booking.status = 'pending_payment' and v_booking.expires_at <= now()) then
    raise exception 'This hold has expired, so the times were released. Please book again.'
      using errcode = 'P0001', hint = 'hold_expired';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'This booking is not waiting for a payment proof.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  return query select v_booking.id, v_booking.total_amount;
end;
$$;

create or replace function public.record_payment_proof(
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
  if v_booking.status = 'expired' or (v_booking.status = 'pending_payment' and v_booking.expires_at <= now()) then
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
