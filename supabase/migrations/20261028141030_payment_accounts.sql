-- T11.10: the venue's payment accounts (GCash, InstaPay, Maya, a bank...) with optional QR codes (RESEARCH M11
-- "Payment accounts and QR codes"; the user approved the plan and db:push on 2026-10-28). QR images live in their own
-- public bucket, `payment-qr`, not in venue-media: a storage policy can't see an upload's size or type when it runs
-- (local probe, storage-api v1.80.2), so only a bucket of their own gives them a real 1 MB, PNG-only limit (SPEC §10).
-- Anyone reads; admins write through RLS; the order is saved as a whole by reorder_payment_accounts (as T11.5a).
-- A QR object name is a fresh `<uuid>.png` (lossless, so it stays scannable); the same pattern is in the qr_path check
-- and the upload policy below.

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table public.venue_payment_accounts (
  id             uuid primary key default gen_random_uuid(),
  label          text not null check (label = btrim(label) and char_length(label) between 1 and 40),
  account_name   text not null default '' check (account_name = btrim(account_name) and char_length(account_name) <= 80),
  account_number text not null default '' check (account_number = btrim(account_number) and char_length(account_number) <= 60),
  qr_path        text constraint venue_payment_accounts_qr_path check (
    qr_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
  ),
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.venue_payment_accounts is
  'Where players send manual payments (T11.10): a label, the account name and number, and an optional QR image (an object name in the payment-qr bucket).';

create index venue_payment_accounts_position_idx on public.venue_payment_accounts (position);

create trigger venue_payment_accounts_set_updated_at
  before update on public.venue_payment_accounts
  for each row execute function private.set_updated_at();

-- A new account goes last, and there are at most 10. The advisory lock serializes concurrent inserts, so two can't
-- both see 9 rows and make 11. Runs as the inserting admin, who can read every account.
create function private.venue_payment_accounts_append()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.venue_payment_accounts'));
  if (select count(*) from public.venue_payment_accounts) >= 10 then
    raise exception 'A venue can list at most 10 payment accounts.' using errcode = 'P0001', hint = 'too_many';
  end if;
  new.position := coalesce((select max(a.position) + 1 from public.venue_payment_accounts a), 0);
  return new;
end;
$$;
revoke all on function private.venue_payment_accounts_append() from public, anon, authenticated;

create trigger venue_payment_accounts_append
  before insert on public.venue_payment_accounts
  for each row execute function private.venue_payment_accounts_append();

-- ---------------------------------------------------------------------------
-- 2. Privileges + RLS: anyone reads; admins write. `position` is set only by the trigger and the reorder RPC.
-- ---------------------------------------------------------------------------
alter table public.venue_payment_accounts enable row level security;

revoke all on public.venue_payment_accounts from anon, authenticated;
grant select on public.venue_payment_accounts to anon, authenticated;
grant insert (label, account_name, account_number, qr_path) on public.venue_payment_accounts to authenticated;
grant update (label, account_name, account_number, qr_path) on public.venue_payment_accounts to authenticated;
grant delete on public.venue_payment_accounts to authenticated;

create policy "Anyone can read payment accounts"
  on public.venue_payment_accounts for select to anon, authenticated using (true);
create policy "Admins can insert payment accounts"
  on public.venue_payment_accounts for insert to authenticated with check ((select private.is_admin()));
create policy "Admins can update payment accounts"
  on public.venue_payment_accounts for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins can delete payment accounts"
  on public.venue_payment_accounts for delete to authenticated using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- 3. reorder_payment_accounts: every account in this order (as reorder_info_sections, T11.5a).
-- ---------------------------------------------------------------------------
create function public.reorder_payment_accounts(p_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can reorder payment accounts.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_ids is null then
    raise exception 'Choose the accounts.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  perform 1 from public.venue_payment_accounts a order by a.id for update;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(a.id order by a.id) from public.venue_payment_accounts a)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The account list is out of date. Reload the page and try again.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.venue_payment_accounts a
  set position = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where a.id = o.id and a.position is distinct from o.ord - 1;
end;
$$;
revoke all on function public.reorder_payment_accounts(uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_payment_accounts(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The payment-qr bucket: public (a QR code shows the same account as the number beside it), 1 MB, PNG only.
--    Admins read (remove() needs it), upload and delete. Uploads only at a fresh `<uuid>.png` at the top level, so
--    there's no update policy (no upsert). No anon policy, so listing stays closed.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-qr', 'payment-qr', true, 1024 * 1024, array['image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Admins read payment QR codes"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'payment-qr' and (select private.is_admin()));

create policy "Admins upload payment QR codes"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-qr'
    and (select private.is_admin())
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'
  );

create policy "Admins delete payment QR codes"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'payment-qr' and (select private.is_admin()));
