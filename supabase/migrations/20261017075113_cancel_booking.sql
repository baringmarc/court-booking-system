-- Milestone 5: cancellation (SPEC §4, RESEARCH "Cancellation rules" and "DB plan for T5.3–T5.5").
--   guest path   (p_token given):      reference code + token, never counts as admin
--   session path (p_booking_id given): the owner, or an admin
-- Players and guests may cancel an active booking until cancel_cutoff_hours before the start;
-- admins until the booking ends, with a reason the player will see. Payments are never touched
-- (no refunds). Setting 'cancelled' frees the slot because bookings_no_overlap covers active statuses only.

alter table public.bookings
  add column cancelled_by       uuid references public.profiles (id) on delete set null,
  add column cancelled_by_venue boolean not null default false;

comment on column public.bookings.cancelled_by is 'Who cancelled (null when cancelled through a guest link).';
comment on column public.bookings.cancelled_by_venue is 'True when an admin cancelled. Stored at cancel time so later role changes cannot rewrite history.';

create index bookings_cancelled_by_idx on public.bookings (cancelled_by);

create function public.cancel_booking(
  p_booking_id     uuid default null,
  p_reference_code text default null,
  p_token          text default null,
  p_reason         text default null
)
returns public.booking_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_guest    boolean := p_token is not null;
  v_admin    boolean := false;
  v_booking  public.bookings;
  v_cutoff   integer;
  v_reason   text := nullif(trim(p_reason), '');
begin
  if length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Find and lock the booking. Every miss (unknown, wrong token, not yours) gives the same answer.
  if v_guest then
    select b.* into v_booking from public.bookings b
    where b.reference_code = upper(trim(coalesce(p_reference_code, '')))
      and b.guest_token_hash is not null
      and b.guest_token_hash = sha256(convert_to(p_token, 'UTF8'))
    for update;
  elsif p_booking_id is not null and v_uid is not null then
    v_admin := private.is_admin();
    select b.* into v_booking from public.bookings b
    where b.id = p_booking_id and (v_admin or b.user_id = v_uid)
    for update;
  end if;
  if v_booking.id is null then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;

  -- Only effectively active bookings hold a slot; a stale hold is already expired (SPEC §10).
  if not (v_booking.status in ('payment_submitted', 'confirmed')
          or (v_booking.status = 'pending_payment' and v_booking.expires_at > now())) then
    raise exception 'This booking can no longer be cancelled.' using errcode = 'P0001', hint = 'not_cancellable';
  end if;

  if v_admin then
    if now() >= upper(v_booking.during) then
      raise exception 'This booking has already ended.' using errcode = 'P0001', hint = 'booking_ended';
    end if;
    if v_reason is null then
      raise exception 'Give a reason so the player knows why.' using errcode = 'P0001', hint = 'reason_required';
    end if;
  else
    select vs.cancel_cutoff_hours into v_cutoff from public.venue_settings vs;
    if now() > lower(v_booking.during) - make_interval(hours => v_cutoff) then
      raise exception 'It is too late to cancel online. Please contact the venue.'
        using errcode = 'P0001', hint = 'cutoff_passed';
    end if;
  end if;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = v_reason,
      cancelled_by = case when v_guest then null else v_uid end,
      cancelled_by_venue = v_admin
  where id = v_booking.id;

  return 'cancelled'::public.booking_status;
end;
$$;

revoke all on function public.cancel_booking(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid, text, text, text) to anon, authenticated;
