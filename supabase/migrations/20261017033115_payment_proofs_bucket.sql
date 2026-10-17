-- Milestone 4: private bucket for payment proofs (SPEC §6 Storage, RESEARCH "Storage bucket and read access").
-- Files live at {booking_id}/{uuid}.{ext}. Only the submit-payment-proof Edge Function writes (secret key,
-- bypasses RLS); booking owners and admins can read (which also allows creating signed URLs).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-proofs', 'payment-proofs', false, 5 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Compare the folder as text so a malformed path can never raise a uuid cast error.
create policy "Admins and booking owners read payment proofs"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-proofs'
    and (
      (select private.is_admin())
      or exists (
        select 1 from public.bookings b
        where b.id::text = (storage.foldername(name))[1]
          and b.user_id = (select auth.uid())
      )
    )
  );
-- No insert/update/delete policies: clients can never write to this bucket.
