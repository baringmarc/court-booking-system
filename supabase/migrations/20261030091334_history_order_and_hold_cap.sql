-- Two approved fixes (SPEC §10, 2026-10-30).
--
-- 1. Change history order. booking_changes.changed_at defaulted to now(), the transaction start, so two
--    moves in one transaction tied and every reader that orders by changed_at (get_guest_booking, the
--    owner and admin reads, the client sort) could list them in either order. clock_timestamp() is the
--    insert's own time, so each move gets a distinct, increasing changed_at. Existing rows keep theirs.
alter table public.booking_changes alter column changed_at set default clock_timestamp();

-- 2. review_payment: the fresh hold after a rejection is capped at the booking's start (was uncapped,
--    T4.6 follow-up). A rejection at or after the start leaves a hold that has already lapsed, so the
--    booking reads as expired and the sweep releases it. Otherwise unchanged from 20261030064018.
CREATE OR REPLACE FUNCTION public.review_payment(p_booking_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS TABLE(status booking_status)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_admin    uuid := auth.uid();
  v_booking  public.bookings;
  v_payment  public.payments;
  v_settings public.venue_settings;
  v_note     text := nullif(trim(p_note), '');
  v_status   public.booking_status;
begin
  if v_admin is null or not (private.is_platform_admin()
       or exists (select 1 from public.venue_members m where m.user_id = v_admin)) then
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
  if not private.is_venue_admin(v_booking.venue_id) then
    raise exception 'Only staff can review payments.' using errcode = 'P0001', hint = 'forbidden';
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
    select * into v_settings from public.venue_settings vs where vs.venue_id = v_booking.venue_id;
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
          expires_at = least(now() + make_interval(mins => v_settings.payment_hold_minutes), lower(v_booking.during))
      where id = p_booking_id;
    end if;
  end if;

  return query select v_status;
end;
$function$;
