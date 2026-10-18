-- Milestone 5: guest link hardening (SPEC §6, RESEARCH "Guest token flow hardening" and
-- "DB plan for T5.3–T5.5", item 3).
--   * A guest link stops working 30 days after the booking ends (same not_found as a wrong token),
--     because the link can also cancel and should not live forever.
--   * The guest view also returns the cancellation, so the booking page can show the venue's reason.
-- The return type changes, so the function is dropped and recreated with the same grants.

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
  payments              jsonb,
  cancelled_at          timestamptz,
  cancel_reason         text,
  cancelled_by_venue    boolean
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
    b.cancelled_at, b.cancel_reason, b.cancelled_by_venue
  from public.bookings b
  join public.courts c on c.id = b.court_id
  cross join public.venue_settings vs
  where b.reference_code = upper(trim(p_reference_code))
    and b.guest_token_hash is not null
    and b.guest_token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'))
    and upper(b.during) + interval '30 days' > now();

  if not found then
    raise exception 'Booking not found. Check that you opened the full link from your confirmation.'
      using errcode = 'P0001', hint = 'not_found';
  end if;
end;
$$;

revoke all on function public.get_guest_booking(text, text) from public, anon, authenticated;
grant execute on function public.get_guest_booking(text, text) to anon, authenticated;
