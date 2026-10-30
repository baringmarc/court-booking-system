-- T12.8: billing data (SAAS-PLAN §5). Additive.
--   1. bookings.confirmed_at: set the first time a booking is confirmed, backfilled from the approved payment.
--   2. invoices: one per venue and month. No stored total: it is the sum of its charges.
--   3. billing_charges: the ledger. A 'booking_fee' row when an online booking with a fee is confirmed, a negative
--      'adjustment' when the venue cancels it. Written only by the trigger below; never deleted, only put on an invoice.
--   platform_pricing stays global: no per-venue override in M12 (RESEARCH M12, decision 2).

-- ---------------------------------------------------------------------------
-- 1. bookings.confirmed_at
-- ---------------------------------------------------------------------------
alter table public.bookings add column confirmed_at timestamptz;
comment on column public.bookings.confirmed_at is
  'When the booking was first confirmed (T12.8). Set once by a trigger and kept through later status changes; billing charges the fee at this moment.';

create function private.set_confirmed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and new.confirmed_at is null then
    new.confirmed_at := now();
  end if;
  if tg_op = 'UPDATE' and old.confirmed_at is not null then
    new.confirmed_at := old.confirmed_at;
  end if;
  return new;
end;
$$;
revoke all on function private.set_confirmed_at() from public, anon, authenticated;

create trigger bookings_set_confirmed_at
  before insert or update of status on public.bookings
  for each row execute function private.set_confirmed_at();

-- Backfill: the approved payment's time; walk-ins and moved parts (no payment) were confirmed when created.
-- updated_at is left alone, so history keeps its real edit times.
alter table public.bookings disable trigger bookings_set_updated_at;
update public.bookings b
set confirmed_at = coalesce(
  (select min(coalesce(p.reviewed_at, p.submitted_at)) from public.payments p
   where p.booking_id = b.id and p.review_status = 'approved'),
  case when b.source <> 'online' and b.status in ('confirmed', 'cancelled') then b.created_at end,
  case when b.status = 'confirmed' then b.created_at end
)
where b.confirmed_at is null;
alter table public.bookings enable trigger bookings_set_updated_at;

-- ---------------------------------------------------------------------------
-- 2. invoices
-- ---------------------------------------------------------------------------
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references public.venues (id),
  billing_month  date not null check (billing_month = date_trunc('month', billing_month)::date),
  status         text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  sent_at        timestamptz,
  paid_at        timestamptz,
  paid_method    text check (paid_method is null or char_length(paid_method) between 1 and 40),
  paid_reference text check (paid_reference is null or char_length(paid_reference) between 1 and 100),
  created_at     timestamptz not null default now(),
  constraint invoices_venue_month_key unique (venue_id, billing_month),
  constraint invoices_venue_id_id_key unique (venue_id, id)
);
comment on table public.invoices is
  'Plotline''s monthly invoice to a venue (T12.8). Its total is the sum of its billing_charges. No client writes.';

-- ---------------------------------------------------------------------------
-- 3. billing_charges
-- ---------------------------------------------------------------------------
create table public.billing_charges (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues (id),
  booking_id    uuid not null,
  kind          text not null check (kind in ('booking_fee', 'adjustment')),
  amount        numeric(10, 2) not null,
  charged_at    timestamptz not null default now(),
  billing_month date not null check (billing_month = date_trunc('month', billing_month)::date),
  invoice_id    uuid,
  constraint billing_charges_booking_fkey foreign key (venue_id, booking_id)
    references public.bookings (venue_id, id) on delete restrict,
  constraint billing_charges_invoice_fkey foreign key (venue_id, invoice_id)
    references public.invoices (venue_id, id),
  constraint billing_charges_sign check ((kind = 'booking_fee') = (amount > 0))
);
comment on table public.billing_charges is
  'Plotline''s billing ledger (T12.8, SAAS-PLAN §5): one row per billable event. Written only by the bookings trigger; '
  'never deleted, and only invoice_id ever changes. A correction is a new adjustment row.';
create unique index billing_charges_one_fee on public.billing_charges (booking_id) where kind = 'booking_fee';
create unique index billing_charges_one_adjustment on public.billing_charges (booking_id) where kind = 'adjustment';
create index billing_charges_venue_month on public.billing_charges (venue_id, billing_month);
create index billing_charges_invoice on public.billing_charges (invoice_id) where invoice_id is not null;

create function private.guard_billing_charge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Billing charges are never deleted. Add an adjustment instead.' using errcode = 'P0001', hint = 'ledger_immutable';
  end if;
  if (new.id, new.venue_id, new.booking_id, new.kind, new.amount, new.charged_at, new.billing_month)
     is distinct from (old.id, old.venue_id, old.booking_id, old.kind, old.amount, old.charged_at, old.billing_month) then
    raise exception 'Only a charge''s invoice can change. Add an adjustment instead.' using errcode = 'P0001', hint = 'ledger_immutable';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_billing_charge() from public, anon, authenticated;

create trigger billing_charges_guard
  before update or delete on public.billing_charges
  for each row execute function private.guard_billing_charge();

-- The month a charge belongs to, in the venue's timezone.
create function private.billing_month(p_venue uuid, p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$ select date_trunc('month', p_at at time zone private.venue_tz(p_venue))::date $$;
revoke all on function private.billing_month(uuid, timestamptz) from public, anon, authenticated;

-- Runs in the transaction that confirms or cancels the booking (SAAS-PLAN §5): a fee when an online booking with a
-- fee is first confirmed; a credit for that fee when the venue cancels it. Everything else is not billable.
create function private.bill_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.confirmed_at is not null and (tg_op = 'INSERT' or old.confirmed_at is null)
     and new.source = 'online' and new.booking_fee > 0 then
    insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month)
    values (new.venue_id, new.id, 'booking_fee', new.booking_fee, now(), private.billing_month(new.venue_id, now()))
    on conflict (booking_id) where kind = 'booking_fee' do nothing;
  end if;

  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled'
     and new.cancelled_by_venue and new.confirmed_at is not null then
    insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month)
    select c.venue_id, c.booking_id, 'adjustment', -c.amount, now(), private.billing_month(c.venue_id, now())
    from public.billing_charges c
    where c.booking_id = new.id and c.kind = 'booking_fee'
    on conflict (booking_id) where kind = 'adjustment' do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.bill_booking() from public, anon, authenticated;

create trigger bookings_bill
  after insert or update of status on public.bookings
  for each row execute function private.bill_booking();

-- Backfill the ledger for bookings confirmed before this migration (none on production while the fee is 0).
insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month)
select b.venue_id, b.id, 'booking_fee', b.booking_fee, b.confirmed_at, private.billing_month(b.venue_id, b.confirmed_at)
from public.bookings b
where b.confirmed_at is not null and b.source = 'online' and b.booking_fee > 0;

insert into public.billing_charges (venue_id, booking_id, kind, amount, charged_at, billing_month)
select b.venue_id, b.id, 'adjustment', -b.booking_fee, coalesce(b.cancelled_at, now()),
       private.billing_month(b.venue_id, coalesce(b.cancelled_at, now()))
from public.bookings b
where b.confirmed_at is not null and b.source = 'online' and b.booking_fee > 0
  and b.status = 'cancelled' and b.cancelled_by_venue;

-- ---------------------------------------------------------------------------
-- 4. RLS: venue admins (and platform admins) read their venue's ledger and invoices. No client writes.
-- ---------------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.billing_charges enable row level security;
revoke all on public.invoices, public.billing_charges from anon, authenticated;
grant select on public.invoices, public.billing_charges to authenticated;

create policy "Venue admins read invoices" on public.invoices
  for select to authenticated using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins read billing charges" on public.billing_charges
  for select to authenticated using ((select private.is_venue_admin(venue_id)));
