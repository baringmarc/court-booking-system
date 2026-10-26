-- T10.9 review fix: a root's guest history also lists the changes made to its continuations (they are emailed to
-- the root's contact, so the page must show them). Same signature and grants as before.
create or replace function public.get_guest_booking(p_reference_code text, p_token text)
returns table (
  id uuid, reference_code text, court_id uuid, court_name text, sport public.sport,
  slot_start timestamptz, slot_end timestamptz, status public.booking_status, total_amount numeric,
  expires_at timestamptz, rejection_count smallint, guest_name text, guest_email text, created_at timestamptz,
  payment_instructions text, payments jsonb, cancelled_at timestamptz, cancel_reason text, cancelled_by_venue boolean,
  parent_reference_code text, continuations jsonb, changes jsonb
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
    ), '[]'::jsonb)
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

