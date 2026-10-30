-- T11.29: fresh guest links. The re-upload email carries a new private link, so a booking can hold
-- several valid tokens: the original (bookings.guest_token_hash) and any issued here. Only hashes are stored.
-- issue_guest_link is service role only (send-emails). Expiry is unchanged (30 days after the booking ends).

create table public.guest_link_tokens (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  token_hash bytea not null,
  created_at timestamptz not null default now(),
  primary key (booking_id, token_hash)
);
alter table public.guest_link_tokens enable row level security;
revoke all on table public.guest_link_tokens from public, anon, authenticated;
-- Explicit deny for clients (the repo rule is a policy on every table); only the definer functions touch it.
create policy "No client access to guest link tokens"
  on public.guest_link_tokens for all
  to anon, authenticated
  using (false) with check (false);

create function private.guest_token_matches(p_booking_id uuid, p_token text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_token is not null and (
    exists (
      select 1 from public.bookings b
      where b.id = p_booking_id and b.guest_token_hash = sha256(convert_to(p_token, 'UTF8'))
    )
    or exists (
      select 1 from public.guest_link_tokens t
      where t.booking_id = p_booking_id and t.token_hash = sha256(convert_to(p_token, 'UTF8'))
    )
  );
$$;

create function public.issue_guest_link(p_booking_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  perform 1 from public.bookings b
  where b.id = p_booking_id
    and b.user_id is null
    and b.guest_token_hash is not null
    and greatest(
          upper(b.during),
          coalesce((select max(upper(m.during)) from public.bookings m where m.parent_booking_id = b.id), upper(b.during))
        ) + interval '30 days' > now();
  if not found then
    raise exception 'Booking not found. Check that you opened the full link from your confirmation.'
      using errcode = 'P0001', hint = 'not_found';
  end if;

  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.guest_link_tokens (booking_id, token_hash)
  values (p_booking_id, sha256(convert_to(v_token, 'UTF8')));
  return v_token;
end;
$$;

revoke all on function public.issue_guest_link(uuid) from public, anon, authenticated;
grant execute on function public.issue_guest_link(uuid) to service_role;

-- The token lookups below now go through the helper; everything else is unchanged.

create or replace function public.get_guest_booking(p_reference_code text, p_token text)
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
    and private.guest_token_matches(b.id, p_token)
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

create or replace function public.proof_target(p_reference_code text, p_token text, p_user_id uuid)
returns table (booking_id uuid, total_amount numeric, amount_due numeric)
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
      or private.guest_token_matches(b.id, p_token)
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

  return query select v_booking.id, v_booking.total_amount, v_booking.amount_due;
end;
$$;

revoke all on function public.proof_target(text, text, uuid) from public, anon, authenticated;
grant execute on function public.proof_target(text, text, uuid) to service_role;

create or replace function public.cancel_booking(
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
      and private.guest_token_matches(b.id, p_token)
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
