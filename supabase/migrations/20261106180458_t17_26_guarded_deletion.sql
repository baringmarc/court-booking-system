-- T17.26: platform-admin-only lead deletion and guarded unused-venue deletion (SPEC §6, §10 2026-11-07).
-- No direct DELETE grant: every deletion goes through these security definer functions. A venue is deletable only
-- when it is not protected (the demo) and has never had a booking, payment, checkout, billing charge, invoice or
-- open play session, whatever their status. Its files are not deleted here: a durable queue
-- (private.venue_file_cleanup) hands the venue's Storage prefixes to T17.27's trusted worker, which removes them
-- through the Storage API and reports back.

-- 1. Protected venues (the demo). Only the migration sets it; no client can update venues.
alter table public.venues add column protected boolean not null default false;
comment on column public.venues.protected is
  'A protected venue (the Claudex Courts demo) can never be deleted through delete_unused_venue (T17.26).';
update public.venues set protected = true where slug = 'claudex-courts';

-- 2. File cleanup queue. venue_id is deliberately not a foreign key: the venue row is gone by the time it runs.
create table private.venue_file_cleanup (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null,
  bucket      text not null,
  prefix      text not null,
  status      text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts    integer not null default 0,
  last_error  text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
comment on table private.venue_file_cleanup is
  'Storage prefixes of deleted venues, queued in the deleting transaction and drained by a service-role worker (T17.26, T17.27).';
create index venue_file_cleanup_open_idx on private.venue_file_cleanup (created_at) where status <> 'done';
revoke all on private.venue_file_cleanup from public, anon, authenticated;

-- 3. Dependency counts of one venue (shared by the preview and the delete).
create function private.venue_dependency_counts(p_venue_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'bookings',           (select count(*) from public.bookings where venue_id = p_venue_id),
    'payments',           (select count(*) from public.payments where venue_id = p_venue_id),
    'checkouts',          (select count(*) from public.paymongo_checkouts where venue_id = p_venue_id),
    'charges',            (select count(*) from public.billing_charges where venue_id = p_venue_id),
    'invoices',           (select count(*) from public.invoices where venue_id = p_venue_id),
    'open_play_sessions', (select count(*) from public.open_play_sessions where venue_id = p_venue_id),
    'courts',             (select count(*) from public.courts where venue_id = p_venue_id),
    'members',            (select count(*) from public.venue_members where venue_id = p_venue_id)
  )
$$;
revoke all on function private.venue_dependency_counts(uuid) from public, anon, authenticated;

-- Blocker codes in a fixed order: protected first, then each history table that has rows.
create function private.venue_deletion_blockers(p_protected boolean, p_counts jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(code order by ord), '[]'::jsonb)
  from (values
    (1, 'protected',  p_protected),
    (2, 'bookings',   (p_counts ->> 'bookings')::int > 0),
    (3, 'payments',   (p_counts ->> 'payments')::int > 0),
    (4, 'checkouts',  (p_counts ->> 'checkouts')::int > 0),
    (5, 'charges',    (p_counts ->> 'charges')::int > 0),
    (6, 'invoices',   (p_counts ->> 'invoices')::int > 0),
    (7, 'open_play',  (p_counts ->> 'open_play_sessions')::int > 0)
  ) b(ord, code, hit)
  where hit
$$;
revoke all on function private.venue_deletion_blockers(boolean, jsonb) from public, anon, authenticated;

-- 4. delete_lead: removes one lead (its notes are a column). Leads link to nothing, so no venue or account goes.
create function public.delete_lead(p_lead_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can delete leads.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  delete from public.leads where id = p_lead_id;
  if not found then
    raise exception 'Lead not found.' using errcode = 'P0001', hint = 'lead_not_found';
  end if;
end;
$$;
revoke all on function public.delete_lead(uuid) from public, anon;
grant execute on function public.delete_lead(uuid) to authenticated;

-- 5. venue_deletion_preview: read-only; the console shows it before asking for the typed slug.
create function public.venue_deletion_preview(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_protected boolean;
  v_counts jsonb;
  v_blockers jsonb;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can preview venue deletion.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  select slug, protected into v_slug, v_protected from public.venues where id = p_venue_id;
  if not found then
    raise exception 'Venue not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
  v_counts := private.venue_dependency_counts(p_venue_id);
  v_blockers := private.venue_deletion_blockers(v_protected, v_counts);
  return jsonb_build_object(
    'slug', v_slug,
    'deletable', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'counts', v_counts
  );
end;
$$;
revoke all on function public.venue_deletion_preview(uuid) from public, anon;
grant execute on function public.venue_deletion_preview(uuid) to authenticated;

-- 6. delete_unused_venue. Race safety: the venue row is locked FOR UPDATE first. Every insert that names the
-- venue (a booking, court, setting, schedule row, membership …) checks its foreign key with a KEY SHARE lock on
-- that row, so it waits for this transaction and then fails because the venue is gone; a write that committed
-- before the lock is seen by the eligibility check, and one still open holds a KEY SHARE lock on the venue row,
-- so the delete waits for it and then refuses. The courts are locked too, so a booking's foreign-key check on its
-- court waits as well (scripts/test-venue-deletion-concurrency.mjs proves both orders).
create function public.delete_unused_venue(p_venue_id uuid, p_confirm_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slug text;
  v_protected boolean;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can delete venues.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  select slug, protected into v_slug, v_protected from public.venues where id = p_venue_id for update;
  if not found then
    raise exception 'Venue not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
  if p_confirm_slug is distinct from v_slug then
    raise exception 'Type the venue''s exact subdomain to confirm.' using errcode = 'P0001', hint = 'confirmation_mismatch';
  end if;
  if v_protected then
    raise exception 'This venue is protected and cannot be deleted.' using errcode = 'P0001', hint = 'venue_protected';
  end if;
  perform 1 from public.courts where venue_id = p_venue_id for update;
  if jsonb_array_length(private.venue_deletion_blockers(false, private.venue_dependency_counts(p_venue_id))) > 0 then
    raise exception 'This venue has booking or billing history and cannot be deleted.'
      using errcode = 'P0001', hint = 'venue_in_use';
  end if;

  -- Children first. Court rates, photos, blackouts of a court, schedule modes and court open periods cascade
  -- from courts; venue_members, venue_schedule_state and venue_open_periods cascade from venues. Rows tied to
  -- bookings (outbox, tokens, changes) cannot exist without a booking, but are cleared defensively.
  delete from public.email_outbox where venue_id = p_venue_id;
  delete from public.guest_link_tokens where venue_id = p_venue_id;
  delete from public.booking_changes where venue_id = p_venue_id;
  delete from public.blackouts where venue_id = p_venue_id;
  delete from public.court_rates where venue_id = p_venue_id;
  delete from public.court_photos where venue_id = p_venue_id;
  delete from public.court_open_periods where venue_id = p_venue_id;
  delete from public.court_schedule_modes where venue_id = p_venue_id;
  delete from public.courts where venue_id = p_venue_id;
  delete from public.venue_open_periods where venue_id = p_venue_id;
  delete from public.operating_hours where venue_id = p_venue_id;
  delete from public.venue_payment_accounts where venue_id = p_venue_id;
  delete from public.venue_social_links where venue_id = p_venue_id;
  delete from public.venue_info_sections where venue_id = p_venue_id;
  delete from public.venue_amenities where venue_id = p_venue_id;
  delete from public.venue_settings where venue_id = p_venue_id;
  delete from public.venue_schedule_state where venue_id = p_venue_id;
  delete from public.venue_members where venue_id = p_venue_id;
  delete from public.venues where id = p_venue_id;

  -- Same transaction: the files are queued only if the rows are really gone.
  insert into private.venue_file_cleanup (venue_id, bucket, prefix) values
    (p_venue_id, 'venue-media', p_venue_id::text || '/'),
    (p_venue_id, 'payment-qr',  p_venue_id::text || '/');

  return jsonb_build_object('venue_id', p_venue_id, 'slug', v_slug);
end;
$$;
revoke all on function public.delete_unused_venue(uuid, text) from public, anon;
grant execute on function public.delete_unused_venue(uuid, text) to authenticated;

-- 7. Worker helpers (service role only). Pending and failed rows are claimed oldest first; a claim counts an attempt.
create function public.claim_venue_file_cleanup(p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with picked as (
    select id from private.venue_file_cleanup
    where status in ('pending', 'failed')
    order by created_at, id
    limit greatest(coalesce(p_limit, 0), 0)
    for update skip locked
  ), claimed as (
    update private.venue_file_cleanup c set attempts = c.attempts + 1
    from picked where c.id = picked.id
    returning c.id, c.venue_id, c.bucket, c.prefix, c.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'venue_id', venue_id, 'bucket', bucket, 'prefix', prefix)
                            order by created_at, id), '[]'::jsonb)
  into v_rows from claimed;
  return v_rows;
end;
$$;
revoke all on function public.claim_venue_file_cleanup(integer) from public, anon, authenticated;
grant execute on function public.claim_venue_file_cleanup(integer) to service_role;

create function public.finish_venue_file_cleanup(p_id uuid, p_ok boolean, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.venue_file_cleanup
  set status = case when p_ok then 'done' else 'failed' end,
      done_at = case when p_ok then now() else null end,
      last_error = case when p_ok then null else left(p_error, 1000) end
  where id = p_id;
end;
$$;
revoke all on function public.finish_venue_file_cleanup(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.finish_venue_file_cleanup(uuid, boolean, text) to service_role;
