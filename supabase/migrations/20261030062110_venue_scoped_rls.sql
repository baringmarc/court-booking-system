-- T12.4: every policy on a venue-owned table is scoped to the row's venue.
-- Admin branches use private.is_venue_admin(venue_id) (staff, owner or platform admin of that venue).
-- Public reads see only rows of venues they can read themselves (`venue_id in (select id from venues)`):
-- venues' own policy shows active venues to everyone and any venue to its staff and to platform admins.
-- Policy-only: no schema change. private.is_admin() and profiles.role stay until T12.11.

-- Admin writes ---------------------------------------------------------------------------------

drop policy "Admins can delete blackouts" on public.blackouts;
drop policy "Admins can insert blackouts" on public.blackouts;
drop policy "Admins can update blackouts" on public.blackouts;
create policy "Venue admins can delete blackouts" on public.blackouts for delete to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can insert blackouts" on public.blackouts for insert to authenticated
  with check ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can update blackouts" on public.blackouts for update to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));

drop policy "Admins can delete court photos" on public.court_photos;
drop policy "Admins can insert court photos" on public.court_photos;
drop policy "Admins can update court photos" on public.court_photos;
create policy "Venue admins can delete court photos" on public.court_photos for delete to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can insert court photos" on public.court_photos for insert to authenticated
  with check ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can update court photos" on public.court_photos for update to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));

drop policy "Admins can delete court rates" on public.court_rates;
drop policy "Admins can insert court rates" on public.court_rates;
drop policy "Admins can update court rates" on public.court_rates;
create policy "Venue admins can delete court rates" on public.court_rates for delete to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can insert court rates" on public.court_rates for insert to authenticated
  with check ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can update court rates" on public.court_rates for update to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));

drop policy "Admins can delete courts" on public.courts;
drop policy "Admins can insert courts" on public.courts;
drop policy "Admins can update courts" on public.courts;
create policy "Venue admins can delete courts" on public.courts for delete to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can insert courts" on public.courts for insert to authenticated
  with check ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can update courts" on public.courts for update to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));

drop policy "Admins can delete amenities" on public.venue_amenities;
drop policy "Admins can insert amenities" on public.venue_amenities;
create policy "Venue admins can delete amenities" on public.venue_amenities for delete to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can insert amenities" on public.venue_amenities for insert to authenticated
  with check ((select private.is_venue_admin(venue_id)));

drop policy "Admins can delete info sections" on public.venue_info_sections;
drop policy "Admins can insert info sections" on public.venue_info_sections;
drop policy "Admins can update info sections" on public.venue_info_sections;
create policy "Venue admins can delete info sections" on public.venue_info_sections for delete to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can insert info sections" on public.venue_info_sections for insert to authenticated
  with check ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can update info sections" on public.venue_info_sections for update to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));

drop policy "Admins can delete payment accounts" on public.venue_payment_accounts;
drop policy "Admins can insert payment accounts" on public.venue_payment_accounts;
drop policy "Admins can update payment accounts" on public.venue_payment_accounts;
create policy "Venue admins can delete payment accounts" on public.venue_payment_accounts for delete to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can insert payment accounts" on public.venue_payment_accounts for insert to authenticated
  with check ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can update payment accounts" on public.venue_payment_accounts for update to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));

drop policy "Admins can delete social links" on public.venue_social_links;
drop policy "Admins can insert social links" on public.venue_social_links;
drop policy "Admins can update social links" on public.venue_social_links;
create policy "Venue admins can delete social links" on public.venue_social_links for delete to authenticated
  using ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can insert social links" on public.venue_social_links for insert to authenticated
  with check ((select private.is_venue_admin(venue_id)));
create policy "Venue admins can update social links" on public.venue_social_links for update to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));

drop policy "Admins can update operating hours" on public.operating_hours;
create policy "Venue admins can update operating hours" on public.operating_hours for update to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));

drop policy "Admins can update venue settings" on public.venue_settings;
create policy "Venue admins can update venue settings" on public.venue_settings for update to authenticated
  using ((select private.is_venue_admin(venue_id))) with check ((select private.is_venue_admin(venue_id)));

-- Public reads: only venues the caller can see -------------------------------------------------

drop policy "Anyone can read blackouts" on public.blackouts;
create policy "Anyone can read blackouts of visible venues" on public.blackouts for select to anon, authenticated
  using (venue_id in (select id from public.venues));

drop policy "Anyone can read court rates" on public.court_rates;
create policy "Anyone can read rates of visible venues" on public.court_rates for select to anon, authenticated
  using (venue_id in (select id from public.venues));

drop policy "Anyone can read active courts; admins read all" on public.courts;
create policy "Anyone can read active courts of visible venues; venue admins read all" on public.courts
  for select to anon, authenticated
  using (venue_id in (select id from public.venues) and (is_active or (select private.is_venue_admin(venue_id))));

drop policy "Anyone can read photos of courts they can see" on public.court_photos;
create policy "Anyone can read photos of courts they can see" on public.court_photos for select to anon, authenticated
  using (venue_id in (select id from public.venues)
    and exists (select 1 from public.courts c where c.id = court_photos.court_id));

drop policy "Anyone can read open play courts" on public.open_play_courts;
create policy "Anyone can read open play courts of visible venues" on public.open_play_courts
  for select to anon, authenticated using (venue_id in (select id from public.venues));

drop policy "Anyone can read open play sessions" on public.open_play_sessions;
create policy "Anyone can read open play sessions of visible venues" on public.open_play_sessions
  for select to anon, authenticated using (venue_id in (select id from public.venues));

drop policy "Anyone can read operating hours" on public.operating_hours;
create policy "Anyone can read operating hours of visible venues" on public.operating_hours
  for select to anon, authenticated using (venue_id in (select id from public.venues));

drop policy "Anyone can read venue settings" on public.venue_settings;
create policy "Anyone can read settings of visible venues" on public.venue_settings
  for select to anon, authenticated using (venue_id in (select id from public.venues));

drop policy "Anyone can read social links" on public.venue_social_links;
create policy "Anyone can read social links of visible venues" on public.venue_social_links
  for select to anon, authenticated using (venue_id in (select id from public.venues));

drop policy "Anyone can read amenities" on public.venue_amenities;
create policy "Anyone can read amenities of visible venues" on public.venue_amenities
  for select to anon, authenticated using (venue_id in (select id from public.venues));

drop policy "Anyone can read info sections" on public.venue_info_sections;
create policy "Anyone can read info sections of visible venues" on public.venue_info_sections
  for select to anon, authenticated using (venue_id in (select id from public.venues));

drop policy "Anyone can read payment accounts" on public.venue_payment_accounts;
create policy "Anyone can read payment accounts of visible venues" on public.venue_payment_accounts
  for select to anon, authenticated using (venue_id in (select id from public.venues));

-- Private tables: owner rules unchanged, admin branch scoped to the row's venue ---------------

drop policy "Admins read booking changes" on public.booking_changes;
create policy "Venue admins read booking changes" on public.booking_changes for select to authenticated
  using ((select private.is_venue_admin(venue_id)));

drop policy "Players read own bookings; admins read all" on public.bookings;
create policy "Players read own bookings; venue admins read their venue's" on public.bookings
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_venue_admin(venue_id)));

drop policy "Admins read the email outbox" on public.email_outbox;
create policy "Venue admins read the email outbox" on public.email_outbox for select to authenticated
  using ((select private.is_venue_admin(venue_id)));

drop policy "Owners read their booking's payments; admins read all" on public.payments;
create policy "Owners read their booking's payments; venue admins read their venue's" on public.payments
  for select to authenticated
  using ((select private.is_venue_admin(venue_id))
    or exists (select 1 from public.bookings b where b.id = payments.booking_id and b.user_id = (select auth.uid())));

drop policy "Admins read PayMongo checkouts" on public.paymongo_checkouts;
create policy "Venue admins read PayMongo checkouts" on public.paymongo_checkouts for select to authenticated
  using ((select private.is_venue_admin(venue_id)));

-- Profiles: own row, platform admins, and players who booked at a venue the caller administers.
-- The subquery runs under bookings' own policy, which already scopes admins to their venues.
drop policy "Users can read own profile; admins read all" on public.profiles;
create policy "Users read own profile; admins read their venue's players" on public.profiles
  for select to authenticated
  using (
    (select auth.uid()) = id
    or (select private.is_platform_admin())
    or exists (select 1 from public.bookings b where b.user_id = profiles.id)
  );
