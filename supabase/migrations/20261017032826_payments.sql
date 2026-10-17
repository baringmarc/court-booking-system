-- Milestone 4: payments (SPEC §3, §6). One row per payment attempt; walk-ins get an approved row directly.
-- Written only by RPCs / the submit-payment-proof Edge Function; clients read through RLS.

create type public.payment_method as enum ('gcash', 'maya', 'bank_transfer', 'cash');
create type public.payment_review_status as enum ('pending', 'approved', 'rejected');

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references public.bookings (id) on delete cascade,
  method            public.payment_method not null,
  amount            numeric(10, 2) not null check (amount >= 0),
  reference_number  text check (reference_number is null or length(reference_number) between 1 and 100),
  -- Proof file in the payment-proofs bucket: {booking_id}/{uuid}.{ext}. Null for cash and demo rows.
  storage_path      text,
  submitted_at      timestamptz not null default now(),
  recorded_by       uuid references public.profiles (id) on delete set null,  -- admin, for walk-ins
  review_status     public.payment_review_status not null default 'pending',
  reviewed_by       uuid references public.profiles (id) on delete set null,
  reviewed_at       timestamptz,
  review_note       text,

  constraint payments_path_in_booking_folder
    check (storage_path is null or storage_path like booking_id::text || '/%'),
  constraint payments_rejection_has_note
    check (review_status <> 'rejected' or length(trim(coalesce(review_note, ''))) > 0)
);

comment on table public.payments is 'Payment attempts per booking. Written only by RPCs and the proof Edge Function.';

-- Every confirmed booking has exactly one approved payment; at most one attempt awaits review.
create unique index payments_one_approved_per_booking on public.payments (booking_id) where review_status = 'approved';
create unique index payments_one_pending_per_booking on public.payments (booking_id) where review_status = 'pending';
create index payments_booking_id_idx on public.payments (booking_id);
create index payments_recorded_by_idx on public.payments (recorded_by);
create index payments_reviewed_by_idx on public.payments (reviewed_by);

alter table public.payments enable row level security;

revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

create policy "Owners read their booking's payments; admins read all"
  on public.payments for select
  to authenticated
  using (
    (select private.is_admin())
    or exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id and b.user_id = (select auth.uid())
    )
  );
