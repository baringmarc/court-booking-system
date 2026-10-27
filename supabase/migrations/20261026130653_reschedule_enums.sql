-- Milestone 10 (T10.9): the enum values rescheduling needs. They ship alone because Postgres can't use a new enum
-- value in the transaction that adds it, and each migration file runs in its own transaction. The next migration
-- (rescheduling) uses them.
alter type public.booking_source add value 'moved';
alter type public.email_kind add value 'booking_rescheduled';
