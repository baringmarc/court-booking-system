-- T30.2: the day-before reminder email kind (SPEC §8). Its own migration because a new enum value can't be used in
-- the transaction that adds it (the same split as 20261026130653_reschedule_enums.sql).
alter type public.email_kind add value if not exists 'booking_reminder';
