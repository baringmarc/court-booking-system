-- T33.2: emails for booking groups (TASKS T33.2; SPEC §6, §8, §10 2026-11-25; RESEARCH "Milestone 33").
--
-- Before this, the email queue was per booking: a group queued one email per court. Now:
--   1. booking_groups (venue_id, lead_booking_id) index for the lead foreign key (T33.1 reviewer follow-up).
--   2. private.group_email_data(base, ids): the base booking's private.booking_email_data, with total_amount,
--      booking_fee and amount_due summed over the listed bookings and a `courts` array (start, then court id).
--      private.booking_email_data itself is unchanged, so an ungrouped booking's snapshot is exactly as before.
--   3. private.queue_booking_email: a grouped booking queues
--        - booking_created: nothing from the insert trigger; create_booking_group queues one at the end, once every
--          court exists (private.queue_group_created_email), at the lead;
--        - payment_confirmed and proof_rejected: one, at the lead, listing every court not cancelled;
--        - booking_cancelled: once every court is cancelled, one at the lead (or the earliest court not yet told)
--          listing the courts whose cancellation no email covers yet; while another court is still active, or when
--          this court is the only one left untold, a single-court email for this booking (no `courts`), as before.
--      The group's status changes are single statements (T33.1), and AFTER ROW triggers run after the statement,
--      so every court's new status is visible whichever row fires first.
--   4. private.queue_booking_reminders: one reminder per group, at the earliest still-confirmed court, listing the
--      confirmed courts; never twice for a group.
--   5. claim_guest_link_email: any reference of a group (with the group's token) claims the lead's booking_created.
--   6. create_booking_group: T33.1's body plus the call in 3 after the last insert.

-- ---------------------------------------------------------------------------
-- 1. Index for the lead foreign key
-- ---------------------------------------------------------------------------
create index booking_groups_venue_lead_idx on public.booking_groups (venue_id, lead_booking_id);

-- ---------------------------------------------------------------------------
-- 2. The group snapshot
-- ---------------------------------------------------------------------------
create function private.group_email_data(p_base public.bookings, p_ids uuid[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.booking_email_data(p_base) || jsonb_build_object(
    'total_amount', sum(b.total_amount),
    'booking_fee',  sum(b.booking_fee),
    'amount_due',   sum(b.amount_due),
    'courts', jsonb_agg(jsonb_build_object(
        'booking_id',     b.id,
        'reference_code', b.reference_code,
        'court_name',     c.name,
        'sport',          c.sport,
        'starts_at',      lower(b.during),
        'ends_at',        upper(b.during),
        'total_amount',   b.total_amount
      ) order by lower(b.during), b.court_id)
  )
  from public.bookings b
  join public.courts c on c.id = b.court_id
  where b.id = any (p_ids);
$$;
revoke all on function private.group_email_data(public.bookings, uuid[]) from public, anon, authenticated, service_role;

-- The group's booking_created, queued by create_booking_group once every court exists. Same guards as the trigger.
create function private.queue_group_created_email(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead      public.bookings;
  v_ids       uuid[];
  v_for_guest boolean;
begin
  if coalesce(current_setting('app.suppress_booking_emails', true), '') = 'on' then
    return;
  end if;
  select b.* into v_lead
  from public.booking_groups g join public.bookings b on b.id = g.lead_booking_id
  where g.id = p_group;
  if not found or v_lead.source = 'walk_in' or nullif(trim(v_lead.guest_email), '') is null then
    return;
  end if;

  begin
    select array_agg(b.id) into v_ids from public.bookings b where b.booking_group_id = p_group;
    v_for_guest := v_lead.user_id is null and v_lead.guest_token_hash is not null;
    insert into public.email_outbox (booking_id, kind, to_email, for_guest, data, next_attempt_at)
    values (
      v_lead.id, 'booking_created', trim(v_lead.guest_email), v_for_guest,
      private.group_email_data(v_lead, v_ids),
      case when v_for_guest then now() + interval '10 minutes' else now() end
    )
    on conflict do nothing;
  exception when others then
    raise warning 'queue_group_created_email(%): % (%)', p_group, sqlerrm, sqlstate;
  end;
end;
$$;
revoke all on function private.queue_group_created_email(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The queue trigger
-- ---------------------------------------------------------------------------
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
  v_lead      uuid;
  v_ids       uuid[];
  v_base      public.bookings;
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
    -- A group's booking_created is queued by create_booking_group once every court exists.
    if new.booking_group_id is not null then
      return null;
    end if;
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
    v_base := new;

    if new.booking_group_id is not null then
      select g.lead_booking_id into v_lead from public.booking_groups g where g.id = new.booking_group_id;

      if v_kind in ('payment_confirmed', 'proof_rejected') then
        -- One email for the group, at the lead, listing every court not cancelled.
        if new.id is distinct from v_lead then
          return null;
        end if;
        select array_agg(b.id) into v_ids
        from public.bookings b where b.booking_group_id = new.booking_group_id and b.status <> 'cancelled';
        v_data := private.group_email_data(new, v_ids);

      elsif v_kind = 'booking_cancelled'
            and not exists (select 1 from public.bookings b
                            where b.booking_group_id = new.booking_group_id and b.status <> 'cancelled') then
        -- Every court is cancelled now. The courts no cancellation email covers yet (by its own row or in a group
        -- row's courts) get one email together, at the lead if it is one of them, else the earliest of them.
        select array_agg(b.id order by (b.id = v_lead) desc, lower(b.during), b.court_id) into v_ids
        from public.bookings b
        where b.booking_group_id = new.booking_group_id
          and not exists (
            select 1 from public.email_outbox o
            where o.kind = 'booking_cancelled'
              and (o.booking_id = b.id
                   or (o.data ? 'courts' and o.data -> 'courts' @> jsonb_build_array(jsonb_build_object('booking_id', b.id))))
          );
        if v_ids is null or not (new.id = any (v_ids)) then
          return null;
        end if;
        if cardinality(v_ids) > 1 then
          if new.id <> v_ids[1] then
            return null;
          end if;
          v_data := private.group_email_data(new, v_ids);
        end if;
        -- One court left untold: its own single-court email (v_data stays booking_email_data).
      end if;
      -- booking_cancelled while another court is still active: this court alone, as an ungrouped booking.
    end if;

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
-- 4. Reminders: one per group
-- ---------------------------------------------------------------------------
create or replace function private.queue_booking_reminders(p_now timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_count   integer := 0;
  v_n       integer;
  v_ids     uuid[];
begin
  if coalesce(current_setting('app.suppress_booking_emails', true), '') = 'on' then
    return 0;
  end if;

  for v_booking in
    select b.*
    from public.venue_settings vs
    cross join lateral (select (p_now at time zone vs.timezone) as local_now) l
    join public.bookings b on b.venue_id = vs.venue_id
    left join public.bookings r on r.id = b.parent_booking_id
    where l.local_now::time >= time '18:00'
      and b.status = 'confirmed'
      and (b.source = 'online' or (b.source = 'moved' and r.source = 'online'))
      and nullif(trim(b.guest_email), '') is not null
      and lower(b.during) >= (l.local_now::date + 1)::timestamp at time zone vs.timezone
      and lower(b.during) <  (l.local_now::date + 2)::timestamp at time zone vs.timezone
      and b.confirmed_at < (l.local_now::date + time '18:00') at time zone vs.timezone
      -- A group's reminder goes to its earliest court still confirmed.
      and (b.booking_group_id is null or b.id = (
        select x.id from public.bookings x
        where x.booking_group_id = b.booking_group_id and x.status = 'confirmed'
        order by lower(x.during), x.court_id
        limit 1
      ))
      and not exists (
        select 1 from public.email_outbox o
        where o.kind = 'booking_reminder'
          and (o.booking_id = b.id
               or (b.booking_group_id is not null and o.booking_id in (
                     select x.id from public.bookings x where x.booking_group_id = b.booking_group_id)))
      )
  loop
    begin
      if v_booking.booking_group_id is null then
        insert into public.email_outbox (booking_id, kind, to_email, for_guest, data)
        values (
          v_booking.id, 'booking_reminder', trim(v_booking.guest_email),
          v_booking.user_id is null and v_booking.guest_token_hash is not null,
          private.booking_email_data(v_booking)
        )
        on conflict do nothing;
      else
        select array_agg(x.id) into v_ids
        from public.bookings x where x.booking_group_id = v_booking.booking_group_id and x.status = 'confirmed';
        insert into public.email_outbox (booking_id, kind, to_email, for_guest, data)
        values (
          v_booking.id, 'booking_reminder', trim(v_booking.guest_email),
          v_booking.user_id is null and v_booking.guest_token_hash is not null,
          private.group_email_data(v_booking, v_ids)
        )
        on conflict do nothing;
      end if;
      get diagnostics v_n = row_count;
      v_count := v_count + v_n;
    exception when others then
      raise warning 'queue_booking_reminders(%): % (%)', v_booking.id, sqlerrm, sqlstate;
    end;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The guest's booking_created from any reference of the group
-- ---------------------------------------------------------------------------
create or replace function public.claim_guest_link_email(p_reference_code text, p_token text)
returns table (id uuid, booking_id uuid, reference_code text, to_email text, data jsonb, attempts smallint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_booking public.bookings;
  v_id      uuid;
begin
  select b.* into v_booking
  from public.bookings b
  where b.reference_code = upper(trim(coalesce(p_reference_code, '')))
    and b.guest_token_hash is not null
    and b.guest_token_hash = sha256(convert_to(coalesce(p_token, ''), 'UTF8'));

  -- A group's booking_created is on its lead, which shares the token.
  if found and v_booking.booking_group_id is not null then
    select b.* into v_booking
    from public.booking_groups g join public.bookings b on b.id = g.lead_booking_id
    where g.id = v_booking.booking_group_id;
  end if;

  if v_booking.id is not null then
    select o.id into v_id
    from public.email_outbox o
    where o.booking_id = v_booking.id and o.kind = 'booking_created' and o.for_guest and o.status = 'pending'
    for update skip locked;
  end if;

  if v_id is null then
    raise exception 'Booking not found.' using errcode = 'P0001', hint = 'not_found';
  end if;

  return query
  update public.email_outbox o
  set status = 'sending', attempts = o.attempts + 1, locked_until = now() + interval '5 minutes'
  where o.id = v_id
  returning o.id, o.booking_id, v_booking.reference_code, o.to_email, o.data, o.attempts;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. create_booking_group: T33.1's body (20261125043704) plus private.queue_group_created_email after the inserts
-- ---------------------------------------------------------------------------
create or replace function public.create_booking_group(
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

  -- T33.2: the group's one booking_created, now that every court exists.
  perform private.queue_group_created_email(v_group);

  -- v_ids and v_refs are in insertion order, so the lead comes first.
  return query
  select v_group, v_ids[n], v_refs[n], v_courts[v_order[n]], v_token
  from generate_series(1, v_count) as n
  order by n;
end;
$$;
