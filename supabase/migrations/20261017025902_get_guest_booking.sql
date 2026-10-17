-- Milestone 3: guest access to one booking by reference code + private token (SPEC §6).
-- Logged-in owners and admins read bookings through RLS instead.
-- A wrong token and an unknown reference code raise the same error, so the response never
-- reveals whether a reference code exists. Only the token's sha256 is compared; it is never stored.

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
  payment_instructions  text
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
    vs.payment_instructions
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
