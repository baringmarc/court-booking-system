-- T12.7: storage per venue (expand). New objects live under `{venue_id}/…` and are governed by
-- private.is_venue_admin on the first folder. The legacy is_admin() policies and legacy path shapes stay until the
-- contract migration (T12.11), so the deployed frontend keeps uploading.
--   venue-media:  {venue_id}/courts/…  and  {venue_id}/banner/…
--   payment-qr:   {venue_id}/{uuid}.png
--   payment-proofs: {booking_id}/…, now read by the booking owner or an admin of the booking's venue

-- The venue named by an object's first folder, or null. Matches the lowercase uuid shape before casting, so a
-- malformed path is denied and never raises a cast error.
create function private.storage_venue_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when (storage.foldername(p_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
  end;
$$;
revoke all on function private.storage_venue_id(text) from public;
grant execute on function private.storage_venue_id(text) to authenticated;

-- venue-media -----------------------------------------------------------------------------------------------------
create policy "Venue admins read media"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'venue-media' and (select private.is_venue_admin(private.storage_venue_id(name))));

create policy "Venue admins upload media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'venue-media'
    and (select private.is_venue_admin(private.storage_venue_id(name)))
    and (storage.foldername(name))[2] in ('courts', 'banner')
  );

create policy "Venue admins update media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'venue-media' and (select private.is_venue_admin(private.storage_venue_id(name))))
  with check (
    bucket_id = 'venue-media'
    and (select private.is_venue_admin(private.storage_venue_id(name)))
    and (storage.foldername(name))[2] in ('courts', 'banner')
  );

create policy "Venue admins delete media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'venue-media' and (select private.is_venue_admin(private.storage_venue_id(name))));

-- payment-qr ------------------------------------------------------------------------------------------------------
create policy "Venue admins read payment QR"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'payment-qr' and (select private.is_venue_admin(private.storage_venue_id(name))));

create policy "Venue admins upload payment QR"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-qr'
    and (select private.is_venue_admin(private.storage_venue_id(name)))
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
  );

create policy "Venue admins delete payment QR"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'payment-qr' and (select private.is_venue_admin(private.storage_venue_id(name))));

-- payment-proofs: read only (clients never write; the Edge Functions and RPCs do) -------------------------------
drop policy "Admins and booking owners read payment proofs" on storage.objects;
create policy "Admins and booking owners read payment proofs"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-proofs'
    and exists (
      select 1 from public.bookings b
      where b.id::text = (storage.foldername(name))[1]
        and ((select private.is_venue_admin(b.venue_id)) or b.user_id = (select auth.uid()))
    )
  );
