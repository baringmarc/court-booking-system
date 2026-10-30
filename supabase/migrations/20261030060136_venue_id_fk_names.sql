-- T12.3 follow-up: the composite foreign keys take back the single-column keys' names.
-- The frontend embeds through them by name (e.g. courts!booking_changes_old_court_id_fkey).

alter table public.court_rates rename constraint court_rates_court_fkey to court_rates_court_id_fkey;
alter table public.blackouts rename constraint blackouts_court_fkey to blackouts_court_id_fkey;
alter table public.court_photos rename constraint court_photos_court_fkey to court_photos_court_id_fkey;
alter table public.open_play_courts rename constraint open_play_courts_court_fkey to open_play_courts_court_id_fkey;
alter table public.open_play_courts rename constraint open_play_courts_session_fkey to open_play_courts_session_id_fkey;
alter table public.bookings rename constraint bookings_court_fkey to bookings_court_id_fkey;
alter table public.bookings rename constraint bookings_parent_fkey to bookings_parent_booking_id_fkey;
alter table public.payments rename constraint payments_booking_fkey to payments_booking_id_fkey;
alter table public.payments rename constraint payments_payment_account_fkey to payments_payment_account_id_fkey;
alter table public.paymongo_checkouts rename constraint paymongo_checkouts_booking_fkey to paymongo_checkouts_booking_id_fkey;
alter table public.email_outbox rename constraint email_outbox_booking_fkey to email_outbox_booking_id_fkey;
alter table public.email_outbox rename constraint email_outbox_change_fkey to email_outbox_change_id_fkey;
alter table public.email_outbox rename constraint email_outbox_payment_fkey to email_outbox_payment_id_fkey;
alter table public.booking_changes rename constraint booking_changes_booking_fkey to booking_changes_booking_id_fkey;
alter table public.booking_changes rename constraint booking_changes_continuation_fkey to booking_changes_continuation_id_fkey;
alter table public.booking_changes rename constraint booking_changes_new_court_fkey to booking_changes_new_court_id_fkey;
alter table public.booking_changes rename constraint booking_changes_old_court_fkey to booking_changes_old_court_id_fkey;
alter table public.guest_link_tokens rename constraint guest_link_tokens_booking_fkey to guest_link_tokens_booking_id_fkey;

-- venue_id on child tables is filled by a BEFORE INSERT trigger from the parent court or booking. The explicit
-- default null tells the generated types the client may omit it; the column stays NOT NULL.
alter table public.bookings alter column venue_id set default null;
alter table public.court_rates alter column venue_id set default null;
alter table public.court_photos alter column venue_id set default null;
alter table public.open_play_courts alter column venue_id set default null;
alter table public.payments alter column venue_id set default null;
alter table public.paymongo_checkouts alter column venue_id set default null;
alter table public.email_outbox alter column venue_id set default null;
alter table public.booking_changes alter column venue_id set default null;
alter table public.guest_link_tokens alter column venue_id set default null;
