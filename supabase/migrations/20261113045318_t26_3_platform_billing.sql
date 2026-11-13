-- T26.3: Plotline's own payment details (where venues pay their invoices) and the invoice send log (the user's calls,
-- 2026-11-13; plan and db:push approved the same day). Expand only: nothing existing changes shape, so the live frontend
-- keeps working.
--   1. public.platform_payment_accounts: like venue_payment_accounts (T11.10) but platform admins only, at most 5.
--   2. The private platform-billing bucket for their QR images: PNG or JPG (pdf-lib can't embed WEBP, T26.2), 1 MB.
--   3. public.invoice_sends: one row per invoice email, written by the invoice-pdf Edge Function (T26.4) with the
--      service role; platform admins read it.
--   4. last_emailed_at and email_count on the console's invoice reads, through private.invoice_admin_json.
--      private.invoice_json is untouched, so the venue-facing statement reads don't gain the keys.

-- ---------------------------------------------------------------------------
-- 1. platform_payment_accounts
-- ---------------------------------------------------------------------------
create table public.platform_payment_accounts (
  id             uuid primary key default gen_random_uuid(),
  label          text not null check (label = btrim(label) and char_length(label) between 1 and 40),
  account_name   text not null default '' check (account_name = btrim(account_name) and char_length(account_name) <= 80),
  account_number text not null default '' check (account_number = btrim(account_number) and char_length(account_number) <= 60),
  qr_path        text constraint platform_payment_accounts_qr_path check (
    qr_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$'
  ),
  position       integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.platform_payment_accounts is
  'Where venues pay Plotline''s invoices (T26.3): a label, the account name and number, and an optional QR image (an object name in the private platform-billing bucket). Platform admins only.';

create index platform_payment_accounts_position_idx on public.platform_payment_accounts (position);

create trigger platform_payment_accounts_set_updated_at
  before update on public.platform_payment_accounts
  for each row execute function private.set_updated_at();

-- A new account goes last, and there are at most 5. The advisory lock serializes concurrent inserts. Runs as the
-- inserting platform admin, who can read every account.
create function private.platform_payment_accounts_append()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.platform_payment_accounts'));
  if (select count(*) from public.platform_payment_accounts) >= 5 then
    raise exception 'Plotline can list at most 5 payment accounts.' using errcode = 'P0001', hint = 'too_many';
  end if;
  new.position := coalesce((select max(a.position) + 1 from public.platform_payment_accounts a), 0);
  return new;
end;
$$;
revoke all on function private.platform_payment_accounts_append() from public, anon, authenticated;

create trigger platform_payment_accounts_append
  before insert on public.platform_payment_accounts
  for each row execute function private.platform_payment_accounts_append();

alter table public.platform_payment_accounts enable row level security;

revoke all on public.platform_payment_accounts from anon, authenticated;
grant select, delete on public.platform_payment_accounts to authenticated;
grant insert (label, account_name, account_number, qr_path) on public.platform_payment_accounts to authenticated;
grant update (label, account_name, account_number, qr_path) on public.platform_payment_accounts to authenticated;

create policy "Platform admins read platform payment accounts"
  on public.platform_payment_accounts for select to authenticated using ((select private.is_platform_admin()));
create policy "Platform admins insert platform payment accounts"
  on public.platform_payment_accounts for insert to authenticated with check ((select private.is_platform_admin()));
create policy "Platform admins update platform payment accounts"
  on public.platform_payment_accounts for update to authenticated
  using ((select private.is_platform_admin())) with check ((select private.is_platform_admin()));
create policy "Platform admins delete platform payment accounts"
  on public.platform_payment_accounts for delete to authenticated using ((select private.is_platform_admin()));

-- Every account in this order (as reorder_payment_accounts, T11.10).
create function public.reorder_platform_payment_accounts(p_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_platform_admin() then
    raise exception 'Only platform admins can reorder Plotline''s payment accounts.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_ids is null then
    raise exception 'Choose the accounts.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  perform 1 from public.platform_payment_accounts a order by a.id for update;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(a.id order by a.id) from public.platform_payment_accounts a)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The account list is out of date. Reload the page and try again.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.platform_payment_accounts a
  set position = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where a.id = o.id and a.position is distinct from o.ord - 1;
end;
$$;
revoke all on function public.reorder_platform_payment_accounts(uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_platform_payment_accounts(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The platform-billing bucket: private, 1 MB, PNG or JPG. Platform admins read (remove() needs it), upload at a
--    fresh top-level `<uuid>.png|jpg` (no update policy, so no upsert) and delete. The Edge Function reads with the
--    service role.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('platform-billing', 'platform-billing', false, 1024 * 1024, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Platform admins read billing QR"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'platform-billing' and (select private.is_platform_admin()));

create policy "Platform admins upload billing QR"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'platform-billing'
    and (select private.is_platform_admin())
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$'
  );

create policy "Platform admins delete billing QR"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'platform-billing' and (select private.is_platform_admin()));

-- ---------------------------------------------------------------------------
-- 3. invoice_sends: the send log. No client writes; the invoice-pdf function writes with the service role.
-- ---------------------------------------------------------------------------
create table public.invoice_sends (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  sent_by     uuid not null references auth.users (id),
  recipients  text[] not null check (cardinality(recipients) >= 1),
  kind        text not null check (kind in ('send', 'resend')),
  provider_id text,
  created_at  timestamptz not null default now()
);
comment on table public.invoice_sends is
  'One row per invoice email (T26.3), written by the invoice-pdf Edge Function with the service role. Platform admins read it.';

create index invoice_sends_invoice_id_idx on public.invoice_sends (invoice_id, created_at);
create index invoice_sends_sent_by_idx on public.invoice_sends (sent_by);

alter table public.invoice_sends enable row level security;
revoke all on public.invoice_sends from anon, authenticated;
grant select on public.invoice_sends to authenticated;

create policy "Platform admins read invoice sends"
  on public.invoice_sends for select to authenticated using ((select private.is_platform_admin()));

-- ---------------------------------------------------------------------------
-- 4. The console's invoice reads gain last_emailed_at and email_count. Bodies are unchanged from T14.10 / T17.18
--    except that they call private.invoice_admin_json.
-- ---------------------------------------------------------------------------
create function private.invoice_admin_json(p_invoice_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select j || jsonb_build_object(
    'last_emailed_at', (select max(e.created_at) from public.invoice_sends e where e.invoice_id = p_invoice_id),
    'email_count', (select count(*) from public.invoice_sends e where e.invoice_id = p_invoice_id)
  )
  from (select private.invoice_json(p_invoice_id) as j) t
  where j is not null
$$;
revoke all on function private.invoice_admin_json(uuid) from public, anon, authenticated;

create or replace function public.invoices_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can list invoices.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  return coalesce((
    select jsonb_agg(private.invoice_admin_json(i.id) order by i.billing_month desc, s.name, v.slug)
    from public.invoices i
    join public.venues v on v.id = i.venue_id
    join public.venue_settings s on s.venue_id = i.venue_id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.invoice_detail(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_json jsonb;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can read invoices.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  v_json := private.invoice_admin_json(p_invoice_id);
  if v_json is null then
    raise exception 'Invoice not found.' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  return v_json || jsonb_build_object('lines', coalesce((
    select jsonb_agg(jsonb_build_object(
             'charge_id', c.id,
             'booking_id', c.booking_id,
             'reference_code', b.reference_code,
             'kind', c.kind,
             'amount', c.amount,
             'charged_at', c.charged_at
           ) order by c.charged_at, c.id)
    from public.billing_charges c
    join public.bookings b on b.venue_id = c.venue_id and b.id = c.booking_id
    where c.invoice_id = p_invoice_id
  ), '[]'::jsonb));
end;
$$;

create or replace function public.invoices_page(
  p_search text default null,
  p_status text default null,
  p_month date default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_pattern text := private.console_search_pattern(p_search);
  v_status text := nullif(btrim(p_status), '');
  v_limit integer := private.console_limit(p_limit, 25);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can list invoices.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  if v_status is not null and v_status not in ('draft', 'sent', 'paid') then
    raise exception 'Unknown invoice status filter.' using errcode = 'P0001', hint = 'invalid_filter';
  end if;
  if p_month is not null and extract(day from p_month) <> 1 then
    raise exception 'The month filter must be the first day of a month.' using errcode = 'P0001', hint = 'invalid_filter';
  end if;

  select count(*) into v_total
  from public.invoices i
  join public.venues v on v.id = i.venue_id
  join public.venue_settings s on s.venue_id = i.venue_id
  where (v_status is null or i.status = v_status)
    and (p_month is null or i.billing_month = p_month)
    and (v_pattern is null or s.name ilike v_pattern escape '\' or v.slug ilike v_pattern escape '\');

  select coalesce(jsonb_agg(private.invoice_admin_json(p.id) order by p.billing_month desc, p.name, p.slug, p.id), '[]'::jsonb)
  into v_rows
  from (
    select i.id, i.billing_month, s.name, v.slug
    from public.invoices i
    join public.venues v on v.id = i.venue_id
    join public.venue_settings s on s.venue_id = i.venue_id
    where (v_status is null or i.status = v_status)
      and (p_month is null or i.billing_month = p_month)
      and (v_pattern is null or s.name ilike v_pattern escape '\' or v.slug ilike v_pattern escape '\')
    order by i.billing_month desc, s.name, v.slug, i.id
    limit v_limit offset v_offset
  ) p;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

create or replace function public.invoice_detail_page(
  p_invoice_id uuid,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_json jsonb;
  v_limit integer := private.console_limit(p_limit, 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can read invoices.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  v_json := private.invoice_admin_json(p_invoice_id);
  if v_json is null then
    raise exception 'Invoice not found.' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  return v_json || jsonb_build_object(
    'line_total', (
      select count(*) from public.billing_charges c
      join public.bookings b on b.venue_id = c.venue_id and b.id = c.booking_id
      where c.invoice_id = p_invoice_id
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'charge_id', l.id,
               'booking_id', l.booking_id,
               'reference_code', l.reference_code,
               'kind', l.kind,
               'amount', l.amount,
               'charged_at', l.charged_at
             ) order by l.charged_at, l.id)
      from (
        select c.id, c.booking_id, b.reference_code, c.kind, c.amount, c.charged_at
        from public.billing_charges c
        join public.bookings b on b.venue_id = c.venue_id and b.id = c.booking_id
        where c.invoice_id = p_invoice_id
        order by c.charged_at, c.id
        limit v_limit offset v_offset
      ) l
    ), '[]'::jsonb)
  );
end;
$$;
