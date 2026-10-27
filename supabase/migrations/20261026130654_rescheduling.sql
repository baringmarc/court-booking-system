-- Milestone 10 (T10.9): staff rescheduling (SPEC §4, §6, §7, §10 "Rescheduling design"; RESEARCH M10).
--
--   reschedule_booking(booking, from_start, new_court, new_start, reason)   admin only, confirmed bookings only
--     from_start = the booking's start -> the whole booking moves (same row, reference and guest link)
--     from_start later                 -> the booking is shortened and a `moved` continuation (₱0, no payments)
--                                         carries the rest, always pointing at the ROOT booking
--   booking_changes                    one row per move, the history and the email trigger's source
--
-- Invariant, restated: every confirmed booking that isn't `moved` has exactly one approved payment; a `moved`
-- booking has a root booking and no payments of its own.

-- ---------------------------------------------------------------------------
-- bookings: the link to the root, and what a continuation may look like
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column parent_booking_id uuid references public.bookings (id) on delete restrict;

create index bookings_parent_booking_id_idx on public.bookings (parent_booking_id)
  where parent_booking_id is not null;

alter table public.bookings
  add constraint bookings_moved_has_parent check ((source = 'moved') = (parent_booking_id is not null)),
  add constraint bookings_moved_is_free check (source <> 'moved' or total_amount = 0);

-- A moved booking is paid through its root, never by itself.
create function private.payments_moved_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.bookings b where b.id = new.booking_id and b.source = 'moved') then
    raise exception 'A moved booking is paid through the booking it was moved from.'
      using errcode = 'P0001', hint = 'moved_booking';
  end if;
  return new;
end;
$$;

revoke all on function private.payments_moved_guard() from public, anon, authenticated;

create trigger payments_moved_guard
  before insert on public.payments
  for each row execute function private.payments_moved_guard();

-- ---------------------------------------------------------------------------
-- booking_changes
-- ---------------------------------------------------------------------------
create table public.booking_changes (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references public.bookings (id) on delete cascade,
  old_court_id     uuid not null references public.courts (id) on delete restrict,
  old_during       tstzrange not null check (not isempty(old_during)),  -- the part that moved
  new_court_id     uuid not null references public.courts (id) on delete restrict,
  new_during       tstzrange not null check (not isempty(new_during)),
  continuation_id  uuid references public.bookings (id) on delete set null,  -- null for a whole move
  reason           text not null check (length(trim(reason)) between 1 and 500),
  changed_by       uuid references public.profiles (id) on delete set null,
  changed_at       timestamptz not null default now()
);

comment on table public.booking_changes is
  'History of staff reschedules (SPEC §4). Written only by reschedule_booking.';

create index booking_changes_booking_id_idx on public.booking_changes (booking_id);
create index booking_changes_continuation_id_idx on public.booking_changes (continuation_id) where continuation_id is not null;
create index booking_changes_old_court_id_idx on public.booking_changes (old_court_id);
create index booking_changes_new_court_id_idx on public.booking_changes (new_court_id);
create index booking_changes_changed_by_idx on public.booking_changes (changed_by) where changed_by is not null;

alter table public.booking_changes enable row level security;

revoke all on public.booking_changes from anon, authenticated;
grant select on public.booking_changes to authenticated;

create policy "Admins read booking changes"
  on public.booking_changes for select
  to authenticated
  using ((select private.is_admin()));

create policy "Players read changes of their own bookings"
  on public.booking_changes for select
  to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = booking_changes.booking_id and b.user_id = (select auth.uid())
  ));

-- ---------------------------------------------------------------------------
-- email_outbox: one booking_rescheduled row per change
-- ---------------------------------------------------------------------------
alter table public.email_outbox
  add column change_id uuid references public.booking_changes (id) on delete cascade;

alter table public.email_outbox
  add constraint email_outbox_reschedule_has_change check ((kind = 'booking_rescheduled') = (change_id is not null));

create unique index email_outbox_once_per_change on public.email_outbox (change_id) where change_id is not null;

drop index public.email_outbox_once_per_booking;
create unique index email_outbox_once_per_booking on public.email_outbox (booking_id, kind)
  where kind not in ('proof_rejected', 'booking_rescheduled');

-- Online root bookings with an email only; walk-ins never get one. Errors must not break the reschedule itself.
create function private.queue_reschedule_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_root    public.bookings;
begin
  if coalesce(current_setting('app.suppress_booking_emails', true), '') = 'on' then
    return null;
  end if;

  begin
    select * into v_booking from public.bookings b where b.id = new.booking_id;
    select * into v_root from public.bookings b where b.id = coalesce(v_booking.parent_booking_id, v_booking.id);
    if v_root.source <> 'online' or nullif(trim(v_root.guest_email), '') is null then
      return null;
    end if;

    insert into public.email_outbox (booking_id, change_id, kind, to_email, for_guest, data)
    select
      v_root.id, new.id, 'booking_rescheduled', trim(v_root.guest_email),
      v_root.user_id is null and v_root.guest_token_hash is not null,
      private.booking_email_data(v_root) || jsonb_build_object(
        'old_court_name', oc.name, 'old_starts_at', lower(new.old_during), 'old_ends_at', upper(new.old_during),
        'new_court_name', nc.name, 'new_starts_at', lower(new.new_during), 'new_ends_at', upper(new.new_during),
        'continuation_reference', (select m.reference_code from public.bookings m where m.id = new.continuation_id),
        'reason', new.reason
      )
    from public.courts oc, public.courts nc
    where oc.id = new.old_court_id and nc.id = new.new_court_id
    on conflict do nothing;
  exception when others then
    raise warning 'queue_reschedule_email(%): % (%)', new.id, sqlerrm, sqlstate;
  end;

  return null;
end;
$$;

revoke all on function private.queue_reschedule_email() from public, anon, authenticated;

create trigger booking_changes_queue_email
  after insert on public.booking_changes
  for each row execute function private.queue_reschedule_email();

-- Cancelling a continuation of an online booking tells the root's contact, like cancelling the booking itself.
-- Only that event: a continuation's insert is announced by booking_rescheduled, not booking_created.
create or replace function private.queue_booking_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind      public.email_kind;
  v_data      jsonb;
  v_payment   public.payments;
  v_for_guest boolean := new.user_id is null and new.guest_token_hash is not null;
begin
  if coalesce(current_setting('app.suppress_booking_emails', true), '') = 'on'
     or new.source = 'walk_in'
     or nullif(trim(new.guest_email), '') is null then
    return null;
  end if;

  if new.source = 'moved' then
    if tg_op <> 'UPDATE' or old.status is not distinct from new.status or new.status <> 'cancelled'
       or not exists (select 1 from public.bookings r where r.id = new.parent_booking_id and r.source = 'online') then
      return null;
    end if;
  end if;

  if tg_op = 'INSERT' then
    v_kind := 'booking_created';
  elsif old.status is not distinct from new.status then
    return null;
  elsif new.status = 'confirmed' then
    v_kind := 'payment_confirmed';
  elsif new.status = 'cancelled' then
    v_kind := 'booking_cancelled';
  elsif old.status = 'payment_submitted' and new.status in ('pending_payment', 'rejected') then
    v_kind := 'proof_rejected';
  else
    return null;
  end if;

  begin
    v_data := private.booking_email_data(new);

    if v_kind = 'proof_rejected' then
      select p.* into v_payment
      from public.payments p
      where p.booking_id = new.id and p.review_status = 'rejected' and p.reviewed_by is not null
        and not exists (select 1 from public.email_outbox o where o.payment_id = p.id)
      order by p.reviewed_at desc nulls last, p.submitted_at desc
      limit 1;
      if not found then
        return null;
      end if;
      v_data := v_data || jsonb_build_object('note', v_payment.review_note, 'final', new.status = 'rejected');
    elsif v_kind = 'booking_cancelled' then
      v_data := v_data || jsonb_build_object('cancelled_by_venue', new.cancelled_by_venue, 'reason', new.cancel_reason);
    end if;

    insert into public.email_outbox (booking_id, payment_id, kind, to_email, for_guest, data, next_attempt_at)
    values (
      new.id, v_payment.id, v_kind, trim(new.guest_email), v_for_guest, v_data,
      case when v_kind = 'booking_created' and v_for_guest then now() + interval '10 minutes' else now() end
    )
    on conflict do nothing;
  exception when others then
    raise warning 'queue_booking_email(%): % (%)', new.id, sqlerrm, sqlstate;
  end;

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- reschedule_booking
-- ---------------------------------------------------------------------------
create function public.reschedule_booking(
  p_booking_id   uuid,
  p_from_start   timestamptz,
  p_new_court_id uuid,
  p_new_start    timestamptz,
  p_reason       text
)
returns table (change_id uuid, continuation_id uuid, continuation_reference text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_admin      uuid := auth.uid();
  v_reason     text := nullif(trim(p_reason), '');
  v_court_id   uuid;
  v_booking    public.bookings;
  v_sport      public.sport;
  v_new_court  public.courts;
  v_hours      integer;
  v_new        tstzrange;
  v_old_part   tstzrange;
  v_root       uuid;
  v_cont_id    uuid;
  v_cont_ref   text;
  v_change_id  uuid;
  v_constraint text;
begin
  if v_admin is null or not private.is_admin() then
    raise exception 'Only staff can reschedule bookings.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_booking_id is null or p_from_start is null or p_new_court_id is null or p_new_start is null then
    raise exception 'Choose the booking, the hour to move from and the new court and time.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if v_reason is null then
    raise exception 'Give a reason so the player knows why.' using errcode = 'P0001', hint = 'reason_required';
  end if;
  if length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Both courts are locked (in id order, so two reschedules can't deadlock) before the booking row; then the
  -- booking's court is re-read, in case it moved in between.
  select b.court_id into v_court_id from public.bookings b where b.id = p_booking_id;
  if v_court_id is null then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  perform private.lock_court_slots(least(v_court_id, p_new_court_id));
  perform private.lock_court_slots(greatest(v_court_id, p_new_court_id));

  select b.* into v_booking from public.bookings b where b.id = p_booking_id for update;
  if v_booking.court_id <> v_court_id then
    raise exception 'The booking just changed. Try again.' using errcode = 'P0001', hint = 'try_again';
  end if;
  if v_booking.status <> 'confirmed' then
    raise exception 'Only confirmed bookings can be rescheduled.' using errcode = 'P0001', hint = 'not_confirmed';
  end if;
  if now() >= upper(v_booking.during) then
    raise exception 'This booking has already ended.' using errcode = 'P0001', hint = 'booking_ended';
  end if;

  -- The moved part starts on one of the booking's own hours, no earlier than the hour in progress.
  if p_from_start < lower(v_booking.during) or p_from_start >= upper(v_booking.during) then
    raise exception 'Choose an hour inside the booking.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if mod(extract(epoch from p_from_start - lower(v_booking.during))::bigint, 3600) <> 0 then
    raise exception 'Bookings move by whole hours.' using errcode = 'P0001', hint = 'not_aligned';
  end if;
  if p_from_start + interval '1 hour' <= now() then
    raise exception 'That hour has already passed. Choose the hour in progress or a later one.'
      using errcode = 'P0001', hint = 'from_past';
  end if;

  select c.sport into v_sport from public.courts c where c.id = v_booking.court_id;
  select c.* into v_new_court from public.courts c where c.id = p_new_court_id;
  if not found then
    raise exception 'That court does not exist.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if not v_new_court.is_active then
    raise exception 'This court is not available for booking.' using errcode = 'P0001', hint = 'court_inactive';
  end if;
  if v_new_court.sport <> v_sport then
    raise exception 'A booking can only move to a court of the same sport.'
      using errcode = 'P0001', hint = 'different_sport';
  end if;

  v_hours := (extract(epoch from upper(v_booking.during) - p_from_start) / 3600)::integer;
  v_new := private.validate_booking_slot(p_new_court_id, p_new_start, v_hours, true);
  v_old_part := tstzrange(p_from_start, upper(v_booking.during));

  if p_new_court_id = v_booking.court_id and v_new = v_old_part then
    raise exception 'That is where the booking already is.' using errcode = 'P0001', hint = 'no_change';
  end if;

  -- Same lazy expiry as create_booking: release stale holds that overlap the new range first.
  update public.bookings b
  set status = 'expired'
  where b.court_id = p_new_court_id
    and b.status = 'pending_payment'
    and b.expires_at <= now()
    and b.during && v_new;

  begin
    if p_from_start = lower(v_booking.during) then
      update public.bookings set court_id = p_new_court_id, during = v_new where id = v_booking.id;
    else
      v_root := coalesce(v_booking.parent_booking_id, v_booking.id);
      update public.bookings set during = tstzrange(lower(v_booking.during), p_from_start) where id = v_booking.id;

      for attempt in 1..5 loop
        begin
          insert into public.bookings as b (
            reference_code, court_id, user_id, guest_name, guest_email, guest_phone, during, total_amount,
            status, source, created_by, guest_token_hash, parent_booking_id
          ) values (
            private.new_reference_code(), p_new_court_id, v_booking.user_id, v_booking.guest_name,
            v_booking.guest_email, v_booking.guest_phone, v_new, 0,
            'confirmed', 'moved', v_admin, v_booking.guest_token_hash, v_root
          )
          returning b.id, b.reference_code into v_cont_id, v_cont_ref;
          exit;
        exception when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          if v_constraint <> 'bookings_reference_code_key' or attempt = 5 then
            raise;
          end if;
        end;
      end loop;
    end if;
  exception when exclusion_violation then
    raise exception 'That court is already booked for part of this time.'
      using errcode = 'P0001', hint = 'slot_unavailable';
  end;

  insert into public.booking_changes (
    booking_id, old_court_id, old_during, new_court_id, new_during, continuation_id, reason, changed_by
  ) values (
    v_booking.id, v_booking.court_id, v_old_part, p_new_court_id, v_new, v_cont_id, v_reason, v_admin
  )
  returning id into v_change_id;

  return query select v_change_id, v_cont_id, v_cont_ref;
end;
$$;

revoke all on function public.reschedule_booking(uuid, timestamptz, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.reschedule_booking(uuid, timestamptz, uuid, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Guest link and claims
-- ---------------------------------------------------------------------------

-- Adds parent_reference_code, continuations and changes. The 30-day expiry runs from the latest end among the
-- booking and its continuations. A continuation's own reference opens through the same link (same hash).
drop function public.get_guest_booking(text, text);

create function public.get_guest_booking(p_reference_code text, p_token text)
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

revoke all on function public.get_guest_booking(text, text) from public, anon, authenticated;
grant execute on function public.get_guest_booking(text, text) to anon, authenticated;

-- Continuations copy the root's email and guest hash, so they are claimed with it.
create or replace function public.claim_guest_bookings()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Log in to claim your bookings.' using errcode = 'P0001', hint = 'forbidden';
  end if;

  select lower(trim(u.email)) into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null or v_email = '' then
    return 0;
  end if;

  update public.bookings b
  set user_id = v_uid
  where b.user_id is null
    and b.guest_token_hash is not null
    and b.source in ('online', 'moved')
    and b.guest_email = v_email;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
