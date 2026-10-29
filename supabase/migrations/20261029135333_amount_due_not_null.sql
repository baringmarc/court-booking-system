-- T11.13 (T11.12 follow-up): amount_due is generated from two not-null columns, so it is never null; say so, so the
-- generated types read it as a number.
alter table public.bookings alter column amount_due set not null;
