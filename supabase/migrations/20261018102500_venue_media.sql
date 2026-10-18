-- Milestone 6: venue media (SPEC §6 Storage, RESEARCH "DB and storage plan for T6.2").
-- One optional photo per court and an optional site banner, stored as object paths in a public
-- `venue-media` bucket. The columns are written through the existing admin-only RLS on courts and
-- venue_settings (update is already granted table-wide), so there is no RPC and no new grant.

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
-- id::text is lowercase hex and hyphens only, so it is safe to splice into the pattern.
alter table public.courts
  add column photo_path text,
  add constraint courts_photo_path_check
    check (photo_path ~ ('^courts/' || id::text || '/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'));

alter table public.venue_settings
  add column banner_path text,
  add column banner_alt text,
  add constraint venue_settings_banner_path_check
    check (banner_path ~ '^banner/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'),
  -- A banner always has alt text, and alt text never outlives its banner.
  add constraint venue_settings_banner_alt_pair_check
    check ((banner_path is null) = (banner_alt is null)),
  -- Stored trimmed, 1–200 characters, and not only whitespace.
  add constraint venue_settings_banner_alt_check
    check (
      banner_alt is null
      or (
        banner_alt = btrim(banner_alt, E' \t\r\n')
        and char_length(banner_alt) between 1 and 200
        and banner_alt ~ '\S'
      )
    );

-- ---------------------------------------------------------------------------
-- Bucket: public reads through public URLs; uploads are downscaled by the admin's browser first.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('venue-media', 'venue-media', true, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- storage.objects policies: admins only. Public URLs don't need a SELECT policy, so there is
-- none for anon or players (which also keeps listing closed). Admins need SELECT for remove()
-- and upsert to work (RESEARCH "Storage policies and bucket limits").
-- ---------------------------------------------------------------------------
create policy "Admins read venue media"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'venue-media' and (select private.is_admin()));

create policy "Admins upload venue media"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'venue-media'
    and (select private.is_admin())
    and (storage.foldername(name))[1] in ('courts', 'banner')
  );

create policy "Admins update venue media"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'venue-media' and (select private.is_admin()))
  with check (
    bucket_id = 'venue-media'
    and (select private.is_admin())
    and (storage.foldername(name))[1] in ('courts', 'banner')
  );

create policy "Admins delete venue media"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'venue-media' and (select private.is_admin()));
