-- T33.1: booking groups (TASKS M33; SPEC §3, §4, §5, §6, §10 2026-11-25; plan approved by the user on 2026-11-25,
-- including the db:push to staging once the local pgTAP tests are green).
--
-- One checkout, several courts: every court stays its own `bookings` row (own reference, own exclusion-constraint range,
-- own price), joined by a `booking_groups` row, so the no-overlap rule, `private.slot_price`, `reschedule_booking` and the
-- earnings reads don't change. Expand only: an existing booking has no group and needs no backfill, and `create_booking`
-- stays for one court.
--   1. booking_groups (venue-owned; venue admins read; `lead_booking_id` is the fee carrier, the PayMongo key and, in
--      T33.2, the email recipient), bookings.booking_group_id, paymongo_checkouts.booking_group_id, and one PayMongo
--      payment id may now appear once per booking (a group's payment is one row per court).
--   2. private helpers: lock_booking_group_rows, split_group_amount.
--   3. set_booking_fee: ONE booking fee per group, on its first booking.
--   4. create_booking_group(items, guest info, waiver): 2-6 courts on one operating date, all or nothing.
--   5. Proof: record_payment_proof writes one pending payment per booking (amount split in proportion to amount_due, the
--      file on the passed booking's row only: payments_path_in_booking_folder), proof_target tells the Edge Function the
--      group, its lead and its total, review_payment approves or rejects the whole group with one new hold.
--   6. PayMongo: one session per group (keyed by the lead), and record_paymongo_payment applies SPEC §4's four outcomes
--      to the group as a whole: accepted for every court or for none.
--   7. cancel_booking: a player or guest cancels every active court of the group; staff cancel one court once the group is
--      confirmed, and every court while it is unpaid (so no payment is left without a refund record).
--   8. Reads: get_guest_booking gains a last column booking_group; issue_guest_link gives every court the fresh token.
-- Lock order everywhere: court slot locks (sorted by court id), then booking rows (sorted by id). The email queue trigger
-- is not touched here: until T33.2 changes it a grouped booking queues one email per court, and nothing can create a group
-- before the frontend of T33.3 ships.

-- ---------------------------------------------------------------------------
-- 1. Tables and columns
-- ---------------------------------------------------------------------------
create table public.booking_groups (
  id              uuid primary key default gen_random_uuid(),
  venue_id        uuid not null references public.venues (id) on delete cascade,
  lead_booking_id uuid,
  created_at      timestamptz not null default now(),
  constraint booking_groups_venue_id_id_key unique (venue_id, id),
  constraint booking_groups_lead_fkey foreign key (venue_id, lead_booking_id)
    references public.bookings (venue_id, id) on delete set null (lead_booking_id)
);
comment on table public.booking_groups is
  'One checkout of several courts on one date (T33.1). Each court is its own booking with booking_group_id set. '
  'lead_booking_id is the booking that carries the one booking fee, keys the PayMongo session and receives the emails. '
  'Written only by create_booking_group; venue admins read it. Players and guests see their courts through bookings '
  'and get_guest_booking.';
comment on column public.booking_groups.venue_id is 'Cascades with the venue: a group has no meaning without it, and bookings (which block a venue delete) are gone first.';

alter table public.booking_groups enable row level security;
revoke all on public.booking_groups from anon, authenticated;
grant select on public.booking_groups to authenticated;
create policy "Venue admins read their venue's booking groups"
  on public.booking_groups for select to authenticated
  using ((select private.is_venue_admin(venue_id)));

alter table public.bookings add column booking_group_id uuid;
comment on column public.bookings.booking_group_id is
  'The booking group (one checkout of several courts) this booking belongs to (T33.1); null for a single-court booking.';
alter table public.bookings add constraint bookings_booking_group_fkey
  foreign key (venue_id, booking_group_id) references public.booking_groups (venue_id, id);
create index bookings_booking_group_id_idx on public.bookings (booking_group_id) where booking_group_id is not null;
grant select (booking_group_id) on public.bookings to authenticated;

alter table public.paymongo_checkouts add column booking_group_id uuid;
comment on column public.paymongo_checkouts.booking_group_id is
  'Set when this session pays a whole booking group (T33.1); booking_id is then the group''s lead booking.';
alter table public.paymongo_checkouts add constraint paymongo_checkouts_booking_group_fkey
  foreign key (venue_id, booking_group_id) references public.booking_groups (venue_id, id);
create unique index paymongo_checkouts_one_per_group on public.paymongo_checkouts (booking_group_id)
  where booking_group_id is not null;

-- One PayMongo payment of a group is recorded once per court, so the id is unique per booking, not globally.
alter table public.payments drop constraint payments_provider_payment_id_key;
create unique index payments_provider_payment_booking_key on public.payments (provider_payment_id, booking_id);

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- The group's booking rows, locked in id order (a fixed order, so two group operations can't deadlock). The caller takes
-- any court slot locks first.
create function private.lock_booking_group_rows(p_group uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.bookings b where b.booking_group_id = p_group order by b.id for update;
end;
$$;
revoke all on function private.lock_booking_group_rows(uuid) from public, anon, authenticated;

-- Splits an amount over the group's bookings in proportion to their amount_due. Every part is rounded to centavos and the
-- booking in p_remainder_to takes what is left, so the parts always add up to exactly p_amount and none is negative.
create function private.split_group_amount(p_group uuid, p_amount numeric, p_remainder_to uuid)
returns table (booking_id uuid, part numeric)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_total numeric;
  v_amount numeric := round(p_amount, 2);
  v_rest numeric := round(p_amount, 2);
  v_part numeric;
  r record;
begin
  select coalesce(sum(b.amount_due), 0) into v_total from public.bookings b where b.booking_group_id = p_group;
  for r in
    select b.id, b.amount_due from public.bookings b
    where b.booking_group_id = p_group and b.id <> p_remainder_to
    order by b.id
  loop
    v_part := case when v_total > 0 then least(v_rest, round(v_amount * r.amount_due / v_total, 2)) else 0 end;
    v_rest := v_rest - v_part;
    return query select r.id, v_part;
  end loop;
  return query select p_remainder_to, v_rest;
end;
$$;
revoke all on function private.split_group_amount(uuid, numeric, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. One booking fee per checkout: the first booking inserted into a group carries it
-- ---------------------------------------------------------------------------
create or replace function private.set_booking_fee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.booking_fee := case
    when new.source = 'online'
      and not (new.booking_group_id is not null
               and exists (select 1 from public.bookings g where g.booking_group_id = new.booking_group_id))
    then coalesce((select pp.booking_fee from public.platform_pricing pp), 0)
    else 0
  end;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. create_booking_group
-- ---------------------------------------------------------------------------
create function public.create_booking_group(
  p_items            jsonb,
  p_guest_name       text default null,
  p_guest_email      text default null,
  p_guest_phone      text default null,
  p_waiver_accepted  boolean default false
)
returns table (booking_group_id uuid, id uuid, reference_code text, court_id uuid, guest_token text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid        uuid := auth.uid();
  v_count      integer;
  v_courts     uuid[];
  v_starts     timestamptz[];
  v_slots      integer[];
  v_names      text[] := '{}';
  v_durings    tstzrange[] := '{}';
  v_prices     numeric[] := '{}';
  v_ids        uuid[] := '{}';
  v_refs       text[] := '{}';
  v_order      integer[];
  v_found      integer;
  v_venues     integer;
  v_venue      uuid;
  v_settings   public.venue_settings;
  v_court      uuid;
  v_day        date;
  v_name       text;
  v_email      text;
  v_phone      text;
  v_token      text;
  v_hash       bytea;
  v_waiver     text;
  v_expires    timestamptz;
  v_group      uuid;
  v_id         uuid;
  v_ref        text;
  v_constraint text;
  v_msg        text;
  v_hint       text;
  i            integer;
  k            integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Choose the courts and times again.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 6 then
    raise exception 'You can book up to 6 courts in one checkout.' using errcode = 'P0001', hint = 'too_many_courts';
  end if;
  if v_count < 2 then
    raise exception 'Choose at least two courts for one checkout.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  begin
    select array_agg((t.e ->> 'court_id')::uuid order by t.ord),
           array_agg((t.e ->> 'start')::timestamptz order by t.ord),
           array_agg((t.e ->> 'slots')::integer order by t.ord)
      into v_courts, v_starts, v_slots
    from jsonb_array_elements(p_items) with ordinality as t(e, ord);
  exception when others then
    raise exception 'Choose the courts and times again.' using errcode = 'P0001', hint = 'invalid_input';
  end;
  for i in 1..v_count loop
    if v_courts[i] is null or v_starts[i] is null or v_slots[i] is null then
      raise exception 'Choose the courts and times again.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
  end loop;

  -- Every court exists and belongs to one venue (the venue is the courts', never an argument).
  select count(distinct c.id), count(distinct c.venue_id), (array_agg(c.venue_id))[1]
    into v_found, v_venues, v_venue
  from public.courts c where c.id = any (v_courts);
  if v_found <> (select count(distinct x) from unnest(v_courts) as x) or v_venues <> 1 then
    raise exception 'Choose courts from one venue.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  perform private.assert_venue_active(v_venue);

  -- Serialize with open play sessions and other bookings on every court, in a fixed order (sorted court id), so two
  -- group checkouts that share courts can't deadlock.
  for v_court in select distinct x from unnest(v_courts) as x order by x loop
    perform private.lock_court_slots(v_court);
  end loop;

  select * into v_settings from public.venue_settings vs where vs.venue_id = v_venue;

  -- Validate every item; a failing one names its court (message) and gives the court id (detail) for the UI.
  for i in 1..v_count loop
    v_names := array_append(v_names, (select c.name from public.courts c where c.id = v_courts[i]));
    begin
      v_durings := array_append(v_durings, private.validate_booking_slot(v_courts[i], v_starts[i], v_slots[i], false));
    exception when others then
      get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint;
      raise exception '%: %', v_names[i], v_msg
        using errcode = 'P0001', hint = coalesce(nullif(v_hint, ''), 'invalid_input'), detail = v_courts[i]::text;
    end;
  end loop;

  -- One operating date, and no two items overlapping on a court.
  v_day := private.operating_day_of(v_venue, v_courts[1], v_starts[1]);
  for i in 2..v_count loop
    if private.operating_day_of(v_venue, v_courts[i], v_starts[i]) is distinct from v_day then
      raise exception 'Choose courts on one date for one checkout.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
  end loop;
  for i in 1..v_count - 1 loop
    for k in i + 1..v_count loop
      if v_courts[i] = v_courts[k] and v_durings[i] && v_durings[k] then
        raise exception 'Two of the chosen times overlap on %.', v_names[i] using errcode = 'P0001', hint = 'invalid_input';
      end if;
    end loop;
  end loop;

  -- Who is booking: the same rules as create_booking. user_id always comes from the session.
  if v_uid is not null then
    select p.full_name, p.phone into v_name, v_phone from public.profiles p where p.id = v_uid;
    select u.email into v_email from auth.users u where u.id = v_uid;
    v_name := coalesce(nullif(trim(p_guest_name), ''), nullif(trim(v_name), ''), 'Player');
    v_phone := coalesce(nullif(trim(p_guest_phone), ''), nullif(trim(v_phone), ''));
  else
    v_name := nullif(trim(p_guest_name), '');
    v_email := lower(nullif(trim(p_guest_email), ''));
    v_phone := nullif(trim(p_guest_phone), '');
    if v_name is null or v_email is null then
      raise exception 'Please enter your name and email.' using errcode = 'P0001', hint = 'invalid_guest';
    end if;
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'Please enter a valid email address.' using errcode = 'P0001', hint = 'invalid_guest';
    end if;
    -- One token for the whole group, shown once; every booking stores its hash.
    v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
    v_hash := sha256(convert_to(v_token, 'UTF8'));
  end if;

  if length(v_name) > 100 or length(v_email) > 254 or length(v_phone) > 30 then
    raise exception 'Name, email or phone is too long.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  if btrim(v_settings.waiver_text) <> '' then
    if not coalesce(p_waiver_accepted, false) then
      raise exception 'Please read and accept the waiver to book.' using errcode = 'P0001', hint = 'waiver_required';
    end if;
    v_waiver := v_settings.waiver_text;
  end if;

  for i in 1..v_count loop
    v_prices := array_append(v_prices, private.range_price(v_courts[i], v_durings[i]));
    -- Lazy expiry (as create_booking): the exclusion constraint can't see expires_at.
    update public.bookings b
    set status = 'expired'
    where b.court_id = v_courts[i]
      and b.status = 'pending_payment'
      and b.expires_at <= now()
      and b.during && v_durings[i];
  end loop;

  -- One hold for the whole group.
  v_expires := now() + make_interval(mins => v_settings.payment_hold_minutes);

  insert into public.booking_groups (venue_id) values (v_venue) returning booking_groups.id into v_group;

  -- Insert in start order (ties by court id): the first booking is the lead and carries the one booking fee.
  select array_agg(g.i order by v_starts[g.i], v_courts[g.i]) into v_order from generate_series(1, v_count) as g(i);
  foreach k in array v_order loop
    for attempt in 1..5 loop
      begin
        insert into public.bookings as b (
          reference_code, court_id, user_id, guest_name, guest_email, guest_phone,
          during, total_amount, status, source, guest_token_hash, expires_at, waiver_text, waiver_accepted_at,
          booking_group_id
        ) values (
          private.new_reference_code(), v_courts[k], v_uid, v_name, v_email, v_phone,
          v_durings[k], v_prices[k], 'pending_payment', 'online', v_hash, v_expires,
          v_waiver, case when v_waiver is not null then now() end,
          v_group
        )
        returning b.id, b.reference_code into v_id, v_ref;
        exit;
      exception
        when exclusion_violation then
          raise exception '%: Sorry, that time was just booked. Please pick another slot.', v_names[k]
            using errcode = 'P0001', hint = 'slot_unavailable', detail = v_courts[k]::text;
        when foreign_key_violation then
          raise exception '%: This court is not available for booking.', v_names[k]
            using errcode = 'P0001', hint = 'court_inactive', detail = v_courts[k]::text;
        when unique_violation then
          get stacked diagnostics v_constraint = constraint_name;
          if v_constraint <> 'bookings_reference_code_key' or attempt = 5 then
            raise;
          end if;
      end;
    end loop;
    v_ids := array_append(v_ids, v_id);
    v_refs := array_append(v_refs, v_ref);
    if cardinality(v_ids) = 1 then
      update public.booking_groups bg set lead_booking_id = v_id where bg.id = v_group;
    end if;
  end loop;

  -- v_ids and v_refs are in insertion order, so the lead comes first.
  return query
  select v_group, v_ids[n], v_refs[n], v_courts[v_order[n]], v_token
  from generate_series(1, v_count) as n
  order by n;
end;
$$;
revoke all on function public.create_booking_group(jsonb, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.create_booking_group(jsonb, text, text, text, boolean) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Payment proof for a group
-- ---------------------------------------------------------------------------
create or replace function public.record_payment_proof(
  p_booking_id uuid,
  p_storage_path text,
  p_method public.payment_method,
  p_amount numeric,
  p_reference_number text default null,
  p_account_id uuid default null
)
returns table (payment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_payment_id uuid;
  v_method public.payment_method := p_method;
  v_label text;
  v_group uuid;
  v_part_id uuid;
  r record;
begin
  if p_account_id is not null then
    select a.label into v_label from public.venue_payment_accounts a where a.id = p_account_id;
    if not found then
      raise exception 'Choose one of the venue''s payment accounts.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
    v_method := 'account';
  elsif p_method is null or p_method in ('cash', 'account') then
    raise exception 'Choose GCash, Maya or bank transfer. Cash is paid at the counter.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if p_amount is null or p_amount < 0 or p_amount > 1000000 then
    raise exception 'Enter the amount you paid.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if p_storage_path is null or p_storage_path not like p_booking_id::text || '/%' then
    raise exception 'The proof file is missing.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- A booking of a group: lock every court's row first, in id order, so a concurrent review, cancel or PayMongo
  -- payment on the group can't interleave.
  select b.booking_group_id into v_group from public.bookings b where b.id = p_booking_id;
  if v_group is not null then
    perform private.lock_booking_group_rows(v_group);
  end if;

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

  if v_group is null then
    insert into public.payments (booking_id, method, amount, reference_number, storage_path, review_status, payment_account_id, paid_with)
    values (p_booking_id, v_method, round(p_amount, 2), nullif(trim(p_reference_number), ''), p_storage_path, 'pending', p_account_id, v_label)
    returning id into v_payment_id;

    update public.bookings set status = 'payment_submitted' where id = p_booking_id;
    return query select v_payment_id;
    return;
  end if;

  -- The group pays together: every court must still be waiting for its payment, with a valid hold.
  if exists (
    select 1 from public.bookings g
    where g.booking_group_id = v_group
      and (g.status = 'expired' or (g.status = 'pending_payment' and g.expires_at <= now()))
  ) then
    raise exception 'This hold has expired, so the times were released. Please book again.'
      using errcode = 'P0001', hint = 'hold_expired';
  end if;
  if exists (select 1 from public.bookings g where g.booking_group_id = v_group and g.status <> 'pending_payment') then
    raise exception 'This booking is not waiting for a payment proof.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  -- One pending payment per court: the typed total split in proportion to what each court owes (so the rows add up to
  -- what the player says they paid). The proof file belongs to the booking passed in; the other rows have no file of
  -- their own (payments_path_in_booking_folder).
  for r in select s.booking_id, s.part from private.split_group_amount(v_group, p_amount, p_booking_id) s loop
    insert into public.payments (booking_id, method, amount, reference_number, storage_path, review_status, payment_account_id, paid_with)
    values (r.booking_id, v_method, r.part, nullif(trim(p_reference_number), ''),
            case when r.booking_id = p_booking_id then p_storage_path end, 'pending', p_account_id, v_label)
    returning id into v_part_id;
    if r.booking_id = p_booking_id then
      v_payment_id := v_part_id;
    end if;
  end loop;

  update public.bookings set status = 'payment_submitted' where booking_group_id = v_group;
  return query select v_payment_id;
end;
$$;

-- New result columns: drop and recreate with the same grants.
drop function public.proof_target(text, text, uuid);
create function public.proof_target(p_reference_code text, p_token text, p_user_id uuid)
returns table (
  booking_id uuid, total_amount numeric, amount_due numeric,
  booking_group_id uuid, lead_booking_id uuid, group_amount_due numeric
)
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

  return query
  select v_booking.id, v_booking.total_amount, v_booking.amount_due,
         v_booking.booking_group_id,
         (select g.lead_booking_id from public.booking_groups g where g.id = v_booking.booking_group_id),
         (select sum(x.amount_due) from public.bookings x
          where v_booking.booking_group_id is not null and x.booking_group_id = v_booking.booking_group_id);
end;
$$;
revoke all on function public.proof_target(text, text, uuid) from public, anon, authenticated;
grant execute on function public.proof_target(text, text, uuid) to service_role;

-- Review: approving or rejecting any court of a group does it for the whole group.
create or replace function public.review_payment(p_booking_id uuid, p_approve boolean, p_note text default null)
returns table (status public.booking_status)
language plpgsql
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
  v_group    uuid;
  v_pending  integer;
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

  -- A group's rows are locked together, in id order, before the booking itself.
  select b.booking_group_id into v_group from public.bookings b where b.id = p_booking_id;
  if v_group is not null then
    perform private.lock_booking_group_rows(v_group);
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

  if v_group is null then
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
    return;
  end if;

  -- A group: every court's pending payment is decided together.
  select count(*) into v_pending
  from public.payments p join public.bookings b on b.id = p.booking_id
  where b.booking_group_id = v_group and p.review_status = 'pending';
  if v_pending = 0 then
    raise exception 'This booking has no payment waiting for review.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  if p_approve then
    update public.payments p
    set review_status = 'approved', reviewed_by = v_admin, reviewed_at = now(), review_note = v_note
    from public.bookings b
    where b.id = p.booking_id and b.booking_group_id = v_group and p.review_status = 'pending';
    v_status := 'confirmed';
    update public.bookings set status = v_status where booking_group_id = v_group and status = 'payment_submitted';
  else
    update public.payments p
    set review_status = 'rejected', reviewed_by = v_admin, reviewed_at = now(), review_note = v_note
    from public.bookings b
    where b.id = p.booking_id and b.booking_group_id = v_group and p.review_status = 'pending';
    select * into v_settings from public.venue_settings vs where vs.venue_id = v_booking.venue_id;
    if v_booking.rejection_count + 1 >= v_settings.max_rejections then
      v_status := 'rejected';
      update public.bookings
      set status = v_status, rejection_count = rejection_count + 1
      where booking_group_id = v_group and status = 'payment_submitted';
    else
      -- One new hold for the group, ending at the earliest court's start if that comes first.
      v_status := 'pending_payment';
      update public.bookings
      set status = v_status,
          rejection_count = rejection_count + 1,
          expires_at = least(
            now() + make_interval(mins => v_settings.payment_hold_minutes),
            (select min(lower(g.during)) from public.bookings g
             where g.booking_group_id = v_group and g.status = 'payment_submitted')
          )
      where booking_group_id = v_group and status = 'payment_submitted';
    end if;
  end if;

  return query select v_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. PayMongo for a group
-- ---------------------------------------------------------------------------
create or replace function public.paymongo_checkout_for(p_booking_id uuid)
returns table (checkout_id text, checkout_url text)
language sql
stable
security definer
set search_path = ''
as $$
  select pc.checkout_id, pc.checkout_url
  from public.paymongo_checkouts pc
  where (
      pc.booking_id = p_booking_id
      or (pc.booking_group_id is not null
          and pc.booking_group_id = (select b.booking_group_id from public.bookings b where b.id = p_booking_id))
    )
    and not exists (select 1 from public.payments p where p.provider_checkout_id = pc.checkout_id);
$$;

create or replace function public.record_paymongo_checkout(
  p_booking_id uuid, p_checkout_id text, p_checkout_url text, p_amount_centavos bigint
)
returns table (checkout_id text, checkout_url text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_booking public.bookings;
  v_group   uuid;
  v_target  uuid := p_booking_id;
begin
  if p_checkout_id is null or p_checkout_url is null or p_amount_centavos is null or p_amount_centavos <= 0 then
    raise exception 'The checkout session is incomplete.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- A group has one session, keyed by its lead booking, whichever of its bookings is passed.
  select b.booking_group_id into v_group from public.bookings b where b.id = p_booking_id;
  if v_group is not null then
    perform private.lock_booking_group_rows(v_group);
    select coalesce(g.lead_booking_id, p_booking_id) into v_target from public.booking_groups g where g.id = v_group;
  end if;

  select b.* into v_booking from public.bookings b where b.id = v_target for update;
  if not found then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_booking.status = 'pending_payment' and v_booking.expires_at <= now() then
    raise exception 'This hold has expired, so the times were released. Please book again.'
      using errcode = 'P0001', hint = 'hold_expired';
  end if;
  if v_booking.status <> 'pending_payment' then
    raise exception 'This booking is not waiting for a payment.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  if v_group is not null then
    if exists (
      select 1 from public.bookings g
      where g.booking_group_id = v_group
        and (g.status = 'expired' or (g.status = 'pending_payment' and g.expires_at <= now()))
    ) then
      raise exception 'This hold has expired, so the times were released. Please book again.'
        using errcode = 'P0001', hint = 'hold_expired';
    end if;
    if exists (select 1 from public.bookings g where g.booking_group_id = v_group and g.status <> 'pending_payment') then
      raise exception 'This booking is not waiting for a payment.' using errcode = 'P0001', hint = 'invalid_state';
    end if;
    if p_amount_centavos <> (select (sum(g.amount_due) * 100)::bigint from public.bookings g where g.booking_group_id = v_group) then
      raise exception 'The checkout amount does not match the group total.' using errcode = 'P0001', hint = 'invalid_input';
    end if;
  end if;

  -- First session stored wins; a dead one (a payment was recorded on it) is replaced.
  insert into public.paymongo_checkouts as pc (booking_id, booking_group_id, checkout_id, checkout_url, amount_centavos)
  values (v_target, v_group, p_checkout_id, p_checkout_url, p_amount_centavos)
  on conflict (booking_id) do update
    set checkout_id = excluded.checkout_id,
        checkout_url = excluded.checkout_url,
        amount_centavos = excluded.amount_centavos,
        booking_group_id = excluded.booking_group_id,
        created_at = now()
    where exists (select 1 from public.payments p where p.provider_checkout_id = pc.checkout_id);

  return query
  select pc.checkout_id, pc.checkout_url from public.paymongo_checkouts pc where pc.booking_id = v_target;
end;
$$;

-- The group's payment: SPEC §4's four outcomes applied to the whole group, accepted for every court or for none. One
-- payments row per court (each with the PayMongo ids; a refund owed per court when not accepted).
create function private.record_group_paymongo_payment(
  p_checkout public.paymongo_checkouts,
  p_payment_id text, p_event_id text, p_amount_centavos bigint, p_currency text, p_source text
)
returns table (payment_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_lead      uuid := p_checkout.booking_id;
  v_group     uuid := p_checkout.booking_group_id;
  v_court     uuid;
  v_existing  uuid;
  v_outcome   text;
  v_note      text;
  v_total     numeric;
  v_amount    numeric(10, 2) := p_amount_centavos / 100.0;
  v_n         integer;
  v_pending   integer;
  v_submitted integer;
  v_lapsed    integer;
  v_cancelled integer;
  v_rejected  integer;
  v_lead_row  uuid;
  v_row_id    uuid;
  r           record;
begin
  -- Court locks first, sorted (as create_booking_group), then the rows in id order.
  for v_court in select distinct b.court_id from public.bookings b where b.booking_group_id = v_group order by b.court_id loop
    perform private.lock_court_slots(v_court);
  end loop;
  perform private.lock_booking_group_rows(v_group);

  select p.id into v_existing
  from public.payments p
  where p.provider_payment_id = p_payment_id
  order by (p.booking_id = v_lead) desc
  limit 1;
  if found then
    return query select v_existing, 'duplicate'::text;
    return;
  end if;

  select count(*),
         count(*) filter (where b.status = 'pending_payment' and b.expires_at > now()),
         count(*) filter (where b.status = 'payment_submitted'),
         count(*) filter (where (b.status = 'pending_payment' and b.expires_at <= now()) or b.status = 'expired'),
         count(*) filter (where b.status = 'cancelled'),
         count(*) filter (where b.status = 'rejected'),
         sum(b.amount_due)
    into v_n, v_pending, v_submitted, v_lapsed, v_cancelled, v_rejected, v_total
  from public.bookings b where b.booking_group_id = v_group;

  if coalesce(upper(p_currency), '') <> 'PHP' or p_amount_centavos <> (v_total * 100)::bigint then
    v_outcome := 'late';
    v_note := 'The amount paid online didn''t match the booking total. The venue will arrange a refund.';

  elsif v_pending = v_n then
    -- 1. Paid within the hold.
    v_outcome := 'confirmed';

  elsif v_submitted = v_n then
    -- 3. A proof is waiting for review: confirm every court with the PayMongo payment and close the proofs without
    -- counting a rejection.
    update public.payments p
    set review_status = 'rejected', reviewed_at = now(), review_note = 'Paid online with PayMongo instead.'
    from public.bookings b
    where b.id = p.booking_id and b.booking_group_id = v_group and p.review_status = 'pending';
    v_outcome := 'superseded_proof';

  elsif v_lapsed = v_n then
    -- 2. The hold lapsed. Revive every court only if none has started, every court is still active, no blackout or open
    -- play session covers any of them and nobody else holds any (the exclusion constraint decides the last one, and the
    -- block below undoes the whole update if it fires).
    if exists (select 1 from public.bookings b where b.booking_group_id = v_group and lower(b.during) <= now()) then
      v_outcome := 'late';
      v_note := 'Payment received after the booking time had started. The venue will arrange a refund.';
    elsif exists (
      select 1
      from public.bookings b join public.courts c on c.id = b.court_id
      where b.booking_group_id = v_group
        and (
          not c.is_active
          or exists (
            select 1 from public.blackouts bo
            where (bo.court_id is null or bo.court_id = b.court_id) and tstzrange(bo.starts_at, bo.ends_at) && b.during
          )
          or exists (select 1 from public.open_play_courts oc where oc.court_id = b.court_id and oc.during && b.during)
        )
    ) then
      v_outcome := 'late';
      v_note := 'Payment received after the hold expired, and a court is no longer available at that time. The venue will arrange a refund.';
    else
      begin
        update public.bookings set status = 'confirmed' where booking_group_id = v_group;
        v_outcome := 'revived';
      exception when exclusion_violation then
        v_outcome := 'late';
        v_note := 'Payment received after the hold expired, and a court was booked by someone else. The venue will arrange a refund.';
      end;
    end if;

  else
    -- 4. Cancelled, rejected or already paid: keep every booking as it is.
    v_outcome := 'late';
    v_note := case
      when v_cancelled > 0 then 'Payment received after the booking was cancelled. The venue will arrange a refund.'
      when v_rejected > 0 then 'Payment received after the booking was closed. The venue will arrange a refund.'
      else 'This booking was already paid. The venue will arrange a refund of this payment.'
    end;
  end if;

  for r in select s.booking_id, s.part from private.split_group_amount(v_group, v_amount, v_lead) s loop
    if v_outcome = 'late' then
      insert into public.payments (
        booking_id, method, amount, provider_payment_id, provider_checkout_id, provider_source, provider_event_id,
        review_status, reviewed_at, review_note
      ) values (
        r.booking_id, 'paymongo', r.part, p_payment_id, p_checkout.checkout_id, left(p_source, 50), p_event_id,
        'rejected', now(), v_note
      )
      returning id into v_row_id;
    else
      insert into public.payments (
        booking_id, method, amount, provider_payment_id, provider_checkout_id, provider_source, provider_event_id,
        review_status, reviewed_at
      ) values (
        r.booking_id, 'paymongo', r.part, p_payment_id, p_checkout.checkout_id, left(p_source, 50), p_event_id,
        'approved', now()
      )
      returning id into v_row_id;
    end if;
    if r.booking_id = v_lead then
      v_lead_row := v_row_id;
    end if;
  end loop;

  if v_outcome in ('confirmed', 'superseded_proof') then
    update public.bookings set status = 'confirmed' where booking_group_id = v_group;
  end if;

  return query select v_lead_row, v_outcome;
end;
$$;
revoke all on function private.record_group_paymongo_payment(public.paymongo_checkouts, text, text, bigint, text, text)
  from public, anon, authenticated;

-- The single-booking body is unchanged; a session that pays a group goes to the group function.
create or replace function public.record_paymongo_payment(
  p_checkout_id text, p_payment_id text, p_event_id text, p_amount_centavos bigint, p_currency text, p_source text,
  p_booking_id uuid default null
)
returns table (payment_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_checkout   public.paymongo_checkouts;
  v_booking    public.bookings;
  v_court      public.courts;
  v_proof      public.payments;
  v_existing   uuid;
  v_payment_id uuid;
  v_outcome    text;
  v_note       text;
  v_amount     numeric(10, 2);
begin
  if p_checkout_id is null or p_payment_id is null or p_payment_id not like 'pay\_%'
     or p_amount_centavos is null or p_amount_centavos <= 0 then
    raise exception 'The PayMongo payment is incomplete.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Only sessions we created count; the metadata booking id (if sent) must agree with our record (a group's is its lead).
  select pc.* into v_checkout from public.paymongo_checkouts pc where pc.checkout_id = p_checkout_id;
  if not found or (p_booking_id is not null and p_booking_id <> v_checkout.booking_id) then
    return query select null::uuid, 'unknown_checkout'::text;
    return;
  end if;

  if v_checkout.booking_group_id is not null then
    return query
    select g.payment_id, g.outcome
    from private.record_group_paymongo_payment(v_checkout, p_payment_id, p_event_id, p_amount_centavos, p_currency, p_source) g;
    return;
  end if;

  -- The court lock comes before the booking row lock (same order as create_booking, which updates lapsed
  -- holds under it), so a revival can't deadlock with a booking or an open play session on that court.
  perform private.lock_court_slots((select b.court_id from public.bookings b where b.id = v_checkout.booking_id));
  -- Lock the booking first, then look for a replay, so two deliveries of one event can't both record it.
  select b.* into v_booking from public.bookings b where b.id = v_checkout.booking_id for update;
  select p.id into v_existing from public.payments p where p.provider_payment_id = p_payment_id;
  if found then
    return query select v_existing, 'duplicate'::text;
    return;
  end if;

  v_amount := p_amount_centavos / 100.0;

  if coalesce(upper(p_currency), '') <> 'PHP' or p_amount_centavos <> (v_booking.amount_due * 100)::bigint then
    v_outcome := 'late';
    v_note := 'The amount paid online didn''t match the booking total. The venue will arrange a refund.';

  elsif v_booking.status = 'pending_payment' and v_booking.expires_at > now() then
    -- 1. Paid within the hold.
    v_outcome := 'confirmed';

  elsif v_booking.status = 'payment_submitted' then
    -- 3. A proof is waiting for review: confirm with the PayMongo payment and close the proof without counting
    -- it as a rejection. Lock order matches review_payment (booking, then its pending payment).
    select p.* into v_proof from public.payments p
    where p.booking_id = v_booking.id and p.review_status = 'pending'
    for update;
    if found then
      update public.payments
      set review_status = 'rejected', reviewed_at = now(), review_note = 'Paid online with PayMongo instead.'
      where id = v_proof.id;
    end if;
    v_outcome := 'superseded_proof';

  elsif (v_booking.status = 'pending_payment' and v_booking.expires_at <= now()) or v_booking.status = 'expired' then
    -- 2. The hold lapsed. Revive it only if the slot hasn't started, the court is still active, no blackout
    -- or open play session covers it and nobody else holds it (the exclusion constraint decides the last one).
    select c.* into v_court from public.courts c where c.id = v_booking.court_id;
    if lower(v_booking.during) <= now() then
      v_outcome := 'late';
      v_note := 'Payment received after the booking time had started. The venue will arrange a refund.';
    elsif not v_court.is_active or exists (
      select 1 from public.blackouts bo
      where (bo.court_id is null or bo.court_id = v_booking.court_id)
        and tstzrange(bo.starts_at, bo.ends_at) && v_booking.during
    ) or exists (
      select 1 from public.open_play_courts oc
      where oc.court_id = v_booking.court_id and oc.during && v_booking.during
    ) then
      v_outcome := 'late';
      v_note := 'Payment received after the hold expired, and the court is no longer available at that time. The venue will arrange a refund.';
    else
      begin
        update public.bookings set status = 'confirmed' where id = v_booking.id;
        v_outcome := 'revived';
      exception when exclusion_violation then
        v_outcome := 'late';
        v_note := 'Payment received after the hold expired, and the time was booked by someone else. The venue will arrange a refund.';
      end;
    end if;

  else
    -- 4. Cancelled, rejected or already paid: keep the booking as it is.
    v_outcome := 'late';
    v_note := case v_booking.status
      when 'cancelled' then 'Payment received after the booking was cancelled. The venue will arrange a refund.'
      when 'rejected' then 'Payment received after the booking was closed. The venue will arrange a refund.'
      else 'This booking was already paid. The venue will arrange a refund of this payment.'
    end;
  end if;

  if v_outcome = 'late' then
    insert into public.payments (
      booking_id, method, amount, provider_payment_id, provider_checkout_id, provider_source, provider_event_id,
      review_status, reviewed_at, review_note
    ) values (
      v_booking.id, 'paymongo', v_amount, p_payment_id, p_checkout_id, left(p_source, 50), p_event_id,
      'rejected', now(), v_note
    )
    returning id into v_payment_id;
  else
    insert into public.payments (
      booking_id, method, amount, provider_payment_id, provider_checkout_id, provider_source, provider_event_id,
      review_status, reviewed_at
    ) values (
      v_booking.id, 'paymongo', v_amount, p_payment_id, p_checkout_id, left(p_source, 50), p_event_id,
      'approved', now()
    )
    returning id into v_payment_id;
    if v_outcome <> 'revived' then
      update public.bookings set status = 'confirmed' where id = v_booking.id;
    end if;
  end if;

  return query select v_payment_id, v_outcome;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. cancel_booking
-- ---------------------------------------------------------------------------
create or replace function public.cancel_booking(
  p_booking_id uuid default null, p_reference_code text default null, p_token text default null, p_reason text default null
)
returns public.booking_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid         uuid := auth.uid();
  v_guest       boolean := p_token is not null;
  v_admin       boolean := false;
  v_booking     public.bookings;
  v_cutoff      integer;
  v_reason      text := nullif(trim(p_reason), '');
  v_group       uuid;
  v_targets     uuid[];
  v_first_start timestamptz;
begin
  if length(v_reason) > 500 then
    raise exception 'Keep the reason under 500 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- A booking of a group: lock the whole group first, in id order, so two group operations can't deadlock.
  -- Every miss below (unknown, wrong token, not yours) still gives the same answer.
  if v_guest then
    select b.booking_group_id into v_group from public.bookings b
    where b.reference_code = upper(trim(coalesce(p_reference_code, '')))
      and private.guest_token_matches(b.id, p_token);
  elsif p_booking_id is not null and v_uid is not null then
    select b.booking_group_id into v_group from public.bookings b
    where b.id = p_booking_id and (b.user_id = v_uid or private.is_venue_admin(b.venue_id));
  end if;
  if v_group is not null then
    perform private.lock_booking_group_rows(v_group);
  end if;

  -- Find and lock the booking. Every miss (unknown, wrong token, not yours) gives the same answer.
  if v_guest then
    select b.* into v_booking from public.bookings b
    where b.reference_code = upper(trim(coalesce(p_reference_code, '')))
      and private.guest_token_matches(b.id, p_token)
    for update;
  elsif p_booking_id is not null and v_uid is not null then
    select b.* into v_booking from public.bookings b
    where b.id = p_booking_id and (b.user_id = v_uid or private.is_venue_admin(b.venue_id))
    for update;
    v_admin := v_booking.id is not null and private.is_venue_admin(v_booking.venue_id);
  end if;
  if v_booking.id is null then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;

  -- Which bookings this cancels. A single booking: itself. A group: staff cancel one court once every active court is
  -- confirmed, and every active court while it is unpaid (one payment covers them all, so a partial cancel would leave
  -- money without a refund record); a player or guest cancels every active court.
  if v_booking.booking_group_id is null
     or (v_admin and not exists (
       select 1 from public.bookings g
       where g.booking_group_id = v_booking.booking_group_id
         and (g.status = 'payment_submitted' or (g.status = 'pending_payment' and g.expires_at > now()))
     )) then
    v_targets := array[v_booking.id];
  else
    select coalesce(array_agg(g.id order by g.id), '{}') into v_targets
    from public.bookings g
    where g.booking_group_id = v_booking.booking_group_id
      and (g.status in ('payment_submitted', 'confirmed') or (g.status = 'pending_payment' and g.expires_at > now()));
  end if;

  -- Only effectively active bookings hold a slot; a stale hold is already expired (SPEC §10).
  if v_booking.booking_group_id is not null and not v_admin then
    if cardinality(v_targets) = 0 then
      raise exception 'This booking can no longer be cancelled.' using errcode = 'P0001', hint = 'not_cancellable';
    end if;
  elsif not (v_booking.status in ('payment_submitted', 'confirmed')
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
    -- The cutoff is measured at the earliest court of a group.
    select min(lower(b.during)) into v_first_start from public.bookings b where b.id = any (v_targets);
    select vs.cancel_cutoff_hours into v_cutoff from public.venue_settings vs where vs.venue_id = v_booking.venue_id;
    if now() > v_first_start - make_interval(hours => v_cutoff) then
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
  where id = any (v_targets);

  return 'cancelled'::public.booking_status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Reads
-- ---------------------------------------------------------------------------
-- A fresh guest link opens every court of the group.
create or replace function public.issue_guest_link(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_group uuid;
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

  select b.booking_group_id into v_group from public.bookings b where b.id = p_booking_id;
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.guest_link_tokens (booking_id, token_hash)
  select b.id, sha256(convert_to(v_token, 'UTF8'))
  from public.bookings b
  where b.id = p_booking_id or (v_group is not null and b.booking_group_id = v_group);
  return v_token;
end;
$$;

-- get_guest_booking: same body as 20261121043050 plus the last column booking_group (a new result column: drop and
-- recreate, same grants).
drop function public.get_guest_booking(text, text);

create function public.get_guest_booking(p_reference_code text, p_token text)
returns table (
  id uuid, reference_code text, court_id uuid, court_name text, sport public.sport,
  slot_start timestamptz, slot_end timestamptz, status public.booking_status, total_amount numeric,
  expires_at timestamptz, rejection_count smallint, guest_name text, guest_email text, created_at timestamptz,
  payment_instructions text, payments jsonb, cancelled_at timestamptz, cancel_reason text, cancelled_by_venue boolean,
  parent_reference_code text, continuations jsonb, changes jsonb, booking_fee numeric, amount_due numeric,
  waiver_text text, waiver_accepted_at timestamptz, refund jsonb, booking_group jsonb
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
    b.waiver_text, b.waiver_accepted_at,
    -- The player's view of the booking's refund (T30.5): never the staff note or who recorded it.
    private.refund_player_json(b.id),
    -- The whole checkout (T33.1): every court of the group, null for a single-court booking.
    case when b.booking_group_id is null then null else (
      select jsonb_build_object(
        'id', b.booking_group_id,
        'lead_reference_code', coalesce(
          (select l.reference_code from public.booking_groups bg join public.bookings l on l.id = bg.lead_booking_id
           where bg.id = b.booking_group_id),
          (array_agg(g.reference_code order by lower(g.during), g.court_id))[1]
        ),
        'total_amount', sum(g.total_amount),
        'booking_fee', sum(g.booking_fee),
        'amount_due', sum(g.amount_due),
        'bookings', jsonb_agg(jsonb_build_object(
          'reference_code', g.reference_code, 'court_name', gc.name, 'sport', gc.sport,
          'slot_start', lower(g.during), 'slot_end', upper(g.during),
          'status', case when g.status = 'pending_payment' and g.expires_at <= now()
                         then 'expired'::public.booking_status else g.status end,
          'total_amount', g.total_amount, 'booking_fee', g.booking_fee, 'amount_due', g.amount_due,
          'refund', private.refund_player_json(g.id)
        ) order by lower(g.during), gc.name)
      )
      from public.bookings g join public.courts gc on gc.id = g.court_id
      where g.booking_group_id = b.booking_group_id
    ) end
  from public.bookings b
  join public.courts c on c.id = b.court_id
  join public.venue_settings vs on vs.venue_id = b.venue_id
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
revoke all on function public.get_guest_booking(text, text) from public;
grant execute on function public.get_guest_booking(text, text) to anon, authenticated, service_role;
