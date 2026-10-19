-- Milestone 8: transactional email outbox (SPEC §8; RESEARCH "Email and deploy plan for T8.2–T8.3 and T8.6",
-- including item 5, the T8.1 review refinements). Plus the carried M7 index on payments.provider_checkout_id.
--
-- One AFTER trigger on bookings queues an email_outbox row in the same transaction as the status change, whatever
-- the path (create_booking, review_payment, cancel_booking, record_paymongo_payment). The send-emails Edge Function
-- drains it through service-role RPCs; pg_cron pokes that function every minute through pg_net.
--
--   claim_email_outbox(limit)           -> lease due rows to the worker (skip locked), with the booking's status now
--   finish_email(id, outcome, error)    -> sent | skipped | failed (retried with backoff, `failed` after 5 attempts)
--   claim_guest_link_email(ref, token)  -> lease a guest's booking_created row after checking the token's hash
--
-- The guest token is never stored here: email_outbox.data is a snapshot without it, and only email-guest-link
-- (which receives the token from the checkout page) can put the link into an email.

-- M7 follow-up: paymongo_checkout_for / record_paymongo_checkout look payments up by checkout id.
create index payments_provider_checkout_id_idx on public.payments (provider_checkout_id)
  where provider_checkout_id is not null;

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------------
-- email_outbox
-- ---------------------------------------------------------------------------
create type public.email_kind as enum ('booking_created', 'payment_confirmed', 'proof_rejected', 'booking_cancelled');
create type public.email_status as enum ('pending', 'sending', 'sent', 'skipped', 'failed');

create table public.email_outbox (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid not null references public.bookings (id) on delete cascade,
  payment_id       uuid references public.payments (id) on delete cascade,  -- the rejected proof (proof_rejected)
  kind             public.email_kind not null,
  to_email         text not null check (length(to_email) between 3 and 320 and to_email like '%_@_%'),
  for_guest        boolean not null,      -- a guest booking: booking_created waits for email-guest-link
  data             jsonb not null check (jsonb_typeof(data) = 'object'),  -- template snapshot, never the token
  status           public.email_status not null default 'pending',
  attempts         smallint not null default 0 check (attempts >= 0),
  next_attempt_at  timestamptz not null default now(),
  locked_until     timestamptz,
  last_error       text check (last_error is null or length(last_error) <= 1000),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz,

  constraint email_outbox_sending_has_lease check (status <> 'sending' or locked_until is not null),
  constraint email_outbox_done_has_time check ((status in ('sent', 'skipped')) = (sent_at is not null)),
  constraint email_outbox_rejection_has_payment check ((kind = 'proof_rejected') = (payment_id is not null))
);

comment on table public.email_outbox is
  'Booking emails waiting to be sent (SPEC §8). Filled by a trigger on bookings; drained by service-role RPCs.';

-- booking_created, payment_confirmed and booking_cancelled happen once per booking; a proof can be rejected twice.
create unique index email_outbox_once_per_booking on public.email_outbox (booking_id, kind)
  where kind <> 'proof_rejected';
create unique index email_outbox_once_per_payment on public.email_outbox (payment_id)
  where payment_id is not null;
create index email_outbox_booking_id_idx on public.email_outbox (booking_id);
create index email_outbox_due_idx on public.email_outbox (next_attempt_at)
  where status in ('pending', 'sending');

alter table public.email_outbox enable row level security;

revoke all on public.email_outbox from anon, authenticated;
grant select on public.email_outbox to authenticated;

create policy "Admins read the email outbox"
  on public.email_outbox for select
  to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Queueing (trigger)
-- ---------------------------------------------------------------------------

-- What the templates need, as plain values. Times stay timestamptz; the templates format them in `timezone`.
create function private.booking_email_data(p_booking public.bookings)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'reference_code', p_booking.reference_code,
    'venue_name',     vs.name,
    'timezone',       vs.timezone,
    'court_name',     c.name,
    'sport',          c.sport,
    'starts_at',      lower(p_booking.during),
    'ends_at',        upper(p_booking.during),
    'total_amount',   p_booking.total_amount,
    'status',         p_booking.status,
    'expires_at',     p_booking.expires_at,
    'name',           p_booking.guest_name
  )
  from public.courts c
  cross join (select name, timezone from public.venue_settings limit 1) vs
  where c.id = p_booking.court_id;
$$;

-- Online bookings with an email only (walk-ins never get one). Events:
--   insert                                         -> booking_created (a guest's waits 10 min for the link)
--   -> confirmed                                   -> payment_confirmed
--   -> cancelled                                   -> booking_cancelled
--   payment_submitted -> pending_payment | rejected -> proof_rejected (an admin's rejection; `final` when rejected)
-- A webhook-superseded proof moves the booking to confirmed, so it never reads as a rejection here.
-- Emails must never break the booking change itself, so any error here is downgraded to a warning, and a repeated
-- event is a no-op (on conflict do nothing). `app.suppress_booking_emails = on` (seed.sql) skips queueing.
create function private.queue_booking_email()
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
     or new.source <> 'online'
     or nullif(trim(new.guest_email), '') is null then
    return null;
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

revoke all on function private.booking_email_data(public.bookings) from public, anon, authenticated;
revoke all on function private.queue_booking_email() from public, anon, authenticated;

create trigger bookings_queue_email
  after insert or update of status on public.bookings
  for each row execute function private.queue_booking_email();

-- ---------------------------------------------------------------------------
-- RPCs for the Edge Functions (service_role only)
-- ---------------------------------------------------------------------------

-- Leases up to p_limit due rows for 5 minutes. A row whose lease ran out (the worker died) is due again, unless it
-- already used its 5 attempts, in which case it becomes failed. booking_status is the booking's effective status now,
-- so the worker can drop a booking_created email that a later event has overtaken.
create function public.claim_email_outbox(p_limit integer default 20)
returns table (
  id uuid, booking_id uuid, kind public.email_kind, to_email text, for_guest boolean, data jsonb,
  attempts smallint, booking_status public.booking_status
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  update public.email_outbox o
  set status = 'failed', locked_until = null, last_error = coalesce(o.last_error, 'The send did not finish.')
  where o.status = 'sending' and o.locked_until <= now() and o.attempts >= 5;

  return query
  with picked as (
    select o.id
    from public.email_outbox o
    where (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_until <= now())
    order by o.next_attempt_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ),
  leased as (
    update public.email_outbox o
    set status = 'sending', attempts = o.attempts + 1, locked_until = now() + interval '5 minutes'
    from picked
    where o.id = picked.id
    returning o.*
  )
  select l.id, l.booking_id, l.kind, l.to_email, l.for_guest, l.data, l.attempts,
         case when b.status = 'pending_payment' and b.expires_at <= now() then 'expired'::public.booking_status
              else b.status end
  from leased l
  join public.bookings b on b.id = l.booking_id
  order by l.next_attempt_at;
end;
$$;

-- p_outcome: sent | skipped (transport disabled, or overtaken by a later event) | failed (retry: 1, 5, 15, 60 min,
-- then `failed` after the 5th attempt). Only a leased row can be finished. Returns the row's new status.
create function public.finish_email(p_id uuid, p_outcome text, p_error text default null)
returns public.email_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.email_outbox;
begin
  if p_outcome is null or p_outcome not in ('sent', 'skipped', 'failed') then
    raise exception 'Unknown email outcome.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  select o.* into v_row from public.email_outbox o where o.id = p_id for update;
  if not found then
    raise exception 'Email not found.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_row.status <> 'sending' then
    raise exception 'This email is not being sent.' using errcode = 'P0001', hint = 'invalid_state';
  end if;

  if p_outcome in ('sent', 'skipped') then
    update public.email_outbox
    set status = p_outcome::public.email_status, sent_at = now(), locked_until = null,
        last_error = case when p_outcome = 'skipped' then left(p_error, 1000) else last_error end
    where id = p_id;
    return p_outcome::public.email_status;
  end if;

  if v_row.attempts >= 5 then
    update public.email_outbox
    set status = 'failed', locked_until = null, last_error = left(coalesce(p_error, 'Send failed.'), 1000)
    where id = p_id;
    return 'failed';
  end if;

  update public.email_outbox
  set status = 'pending', locked_until = null, last_error = left(coalesce(p_error, 'Send failed.'), 1000),
      next_attempt_at = now() + case v_row.attempts
                                  when 1 then interval '1 minute'
                                  when 2 then interval '5 minutes'
                                  when 3 then interval '15 minutes'
                                  else interval '60 minutes'
                                end
  where id = p_id;
  return 'pending';
end;
$$;

-- email-guest-link: the checkout page passes the guest's token right after create_booking. Leases that booking's
-- still-pending booking_created row, so at most one email carries the link. Every failure (unknown reference, wrong
-- token, not a guest booking, already sent or leased) is the same not_found, so it reveals nothing.
create function public.claim_guest_link_email(p_reference_code text, p_token text)
returns table (id uuid, booking_id uuid, reference_code text, to_email text, data jsonb, attempts smallint)
language plpgsql
volatile
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

  if found then
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

revoke all on function public.claim_email_outbox(integer) from public, anon, authenticated;
revoke all on function public.finish_email(uuid, text, text) from public, anon, authenticated;
revoke all on function public.claim_guest_link_email(text, text) from public, anon, authenticated;
grant execute on function public.claim_email_outbox(integer) to service_role;
grant execute on function public.finish_email(uuid, text, text) to service_role;
grant execute on function public.claim_guest_link_email(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

-- Pokes send-emails when there is due work. The URL and the worker secret live in Vault (set by hand on the linked
-- project, never committed); without them (e.g. locally) this does nothing. The body carries no booking data.
create function private.kick_email_worker()
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'email_worker_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'email_worker_secret';
  if nullif(v_url, '') is null or nullif(v_secret, '') is null then
    return null;
  end if;

  if not exists (
    select 1 from public.email_outbox o
    where (o.status = 'pending' and o.next_attempt_at <= now())
       or (o.status = 'sending' and o.locked_until <= now())
  ) then
    return null;
  end if;

  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-secret', v_secret),
    timeout_milliseconds := 30000
  );
end;
$$;

-- PII retention: finished rows go after 30 days (the same horizon as guest links).
create function private.purge_email_outbox()
returns integer
language sql
volatile
set search_path = ''
as $$
  with gone as (
    delete from public.email_outbox
    where status in ('sent', 'skipped', 'failed') and created_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke all on function private.kick_email_worker() from public, anon, authenticated;
revoke all on function private.purge_email_outbox() from public, anon, authenticated;

select cron.schedule('send-emails', '* * * * *', 'select private.kick_email_worker()');
select cron.schedule('purge-email-outbox', '17 3 * * *', 'select private.purge_email_outbox()');
