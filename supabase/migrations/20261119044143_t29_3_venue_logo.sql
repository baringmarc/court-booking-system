-- T29.3: a venue logo for live stacks (SPEC §6 venue_settings, M29).
-- The logo is an object in the public `venue-media` bucket under {venue_id}/logo/, stored as a path on
-- venue_settings. The bucket's limits (2 MB, JPG/PNG/WEBP) already apply to it, and the existing settings UPDATE
-- policy covers the column. public_venues is unchanged (the user's call, 2026-11-18).

-- Column: venue-prefixed like banner_path (venue_id::text is lowercase hex and hyphens, safe in the pattern).
alter table public.venue_settings
  add column logo_path text,
  add constraint venue_settings_logo_path_check
    check (logo_path ~ ('^' || venue_id::text || '/logo/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'));

-- Storage: let a venue's admins write under {venue_id}/logo/ as well. Read and delete policies already cover any
-- folder of the venue, so only the insert and update policies change.
drop policy "Venue admins upload media" on storage.objects;
create policy "Venue admins upload media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'venue-media'
    and (select private.is_venue_admin(private.storage_venue_id(name)))
    and (storage.foldername(name))[2] in ('courts', 'banner', 'logo')
  );

drop policy "Venue admins update media" on storage.objects;
create policy "Venue admins update media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'venue-media' and (select private.is_venue_admin(private.storage_venue_id(name))))
  with check (
    bucket_id = 'venue-media'
    and (select private.is_venue_admin(private.storage_venue_id(name)))
    and (storage.foldername(name))[2] in ('courts', 'banner', 'logo')
  );
