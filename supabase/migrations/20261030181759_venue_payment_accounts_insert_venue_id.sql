-- T12.10: admin writes name their venue instead of relying on the Claudex Courts column default. Inserts into
-- venue_payment_accounts are column-granted, so venue_id needs its own insert grant. The insert policy already
-- requires private.is_venue_admin(venue_id) (T12.4), so a venue admin can only insert into their own venue.
-- UPDATE stays without venue_id: an account never moves to another venue.
grant insert (venue_id) on public.venue_payment_accounts to authenticated;
