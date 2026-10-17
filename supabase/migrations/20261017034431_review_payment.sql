-- Milestone 4: admin review of a submitted payment proof (SPEC §4, RESEARCH "Review and walk-in rules").
--   approve -> payment approved, booking confirmed
--   reject  -> note required; payment rejected; rejection_count + 1; then
--              below max_rejections: back to pending_payment with a fresh hold (slot kept)
--              otherwise:            rejected (no longer active, so the slot is freed)
-- Callable by authenticated users but refuses non-admins; security definer because nobody has write grants.

create function public.review_payment(p_booking_id uuid, p_approve boolean, p_note text default null)
returns table (status public.booking_status)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_admin    uuid := auth.uid();
  v_booking  public.bookings;
  v_payment  public.payments;
  v_settings public.venue_settings;
  v_note     text := nullif(trim(p_note), '');
  v_status   public.booking_status;
begin
  if v_admin is null or not private.is_admin() then
    raise exception 'Only staff can review payments.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_booking_id is null or p_approve is null then
    raise exception 'Choose a booking and a decision.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if not p_approve and v_note is null then
    raise exception 'Give a reason so the player knows what to fix.' using errcode = 'P0001', hint = 'note_required';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Lock the booking, then its pending payment, so a submission or expiry sweep can't interleave.
  select b.* into v_booking from public.bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_booking.status <> 'payment_submitted' then
    raise exception 'This booking has no payment waiting for review.' using errcode = 'P0001', hint = 'invalid_state';
  end if;
  select p.* into v_payment from public.payments p
  where p.booking_id = p_booking_id and p.review_status = 'pending'
  for update;
  if not found then
    raise exception 'This booking has no payment waiting for review.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  if p_approve then
    update public.payments
    set review_status = 'approved', reviewed_by = v_admin, reviewed_at = now(), review_note = v_note
    where id = v_payment.id;
    v_status := 'confirmed';
    update public.bookings set status = v_status where id = p_booking_id;
  else
    update public.payments
    set review_status = 'rejected', reviewed_by = v_admin, reviewed_at = now(), review_note = v_note
    where id = v_payment.id;
    select * into v_settings from public.venue_settings;
    if v_booking.rejection_count + 1 >= v_settings.max_rejections then
      v_status := 'rejected';
      update public.bookings
      set status = v_status, rejection_count = rejection_count + 1
      where id = p_booking_id;
    else
      v_status := 'pending_payment';
      update public.bookings
      set status = v_status,
          rejection_count = rejection_count + 1,
          expires_at = now() + make_interval(mins => v_settings.payment_hold_minutes)
      where id = p_booking_id;
    end if;
  end if;

  return query select v_status;
end;
$$;

revoke all on function public.review_payment(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.review_payment(uuid, boolean, text) to authenticated;
