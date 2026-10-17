-- Every booking stores a contact snapshot (guests, players and walk-ins). The name is required so
-- that deleting a player (user_id -> null) never leaves a booking without anyone to contact,
-- which would otherwise make the profile delete fail the old "user or name" check.
alter table public.bookings alter column guest_name set not null;
alter table public.bookings drop constraint bookings_has_contact;
