-- T14.10: the console's invoice review. Platform admins list invoices with their totals and overdue flag, open one with
-- its lines, and mark it sent and paid. The grace period is data (SAAS-PLAN §5), read live.

alter table public.platform_pricing
  add column invoice_grace_days integer not null default 7 check (invoice_grace_days between 0 and 90);
comment on column public.platform_pricing.invoice_grace_days is
  'Days a sent invoice may stay unpaid before it is flagged overdue (T14.10, SAAS-PLAN §5).';

-- One invoice as jsonb: its fields, charge totals and overdue flag. Internal; callers check the role first.
create function private.invoice_json(p_invoice_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'invoice_id', i.id,
    'venue_id', i.venue_id,
    'slug', v.slug,
    'name', s.name,
    'billing_month', to_char(i.billing_month, 'YYYY-MM-DD'),
    'status', i.status,
    'sent_at', i.sent_at,
    'paid_at', i.paid_at,
    'paid_method', i.paid_method,
    'paid_reference', i.paid_reference,
    'fee_count', t.fee_count,
    'fee_total', t.fee_total,
    'adjustment_total', t.adjustment_total,
    'total', t.fee_total + t.adjustment_total,
    'due_at', i.sent_at + make_interval(days => g.days),
    'overdue', i.status = 'sent' and now() > i.sent_at + make_interval(days => g.days)
  )
  from public.invoices i
  join public.venues v on v.id = i.venue_id
  join public.venue_settings s on s.venue_id = i.venue_id
  cross join (select invoice_grace_days as days from public.platform_pricing) g
  cross join lateral (
    select count(*) filter (where c.kind = 'booking_fee') as fee_count,
           coalesce(sum(c.amount) filter (where c.kind = 'booking_fee'), 0) as fee_total,
           coalesce(sum(c.amount) filter (where c.kind = 'adjustment'), 0) as adjustment_total
    from public.billing_charges c where c.invoice_id = i.id
  ) t
  where i.id = p_invoice_id
$$;
revoke all on function private.invoice_json(uuid) from public, anon, authenticated;

create function public.invoices_overview()
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
    select jsonb_agg(private.invoice_json(i.id) order by i.billing_month desc, s.name, v.slug)
    from public.invoices i
    join public.venues v on v.id = i.venue_id
    join public.venue_settings s on s.venue_id = i.venue_id
  ), '[]'::jsonb);
end;
$$;

create function public.invoice_detail(p_invoice_id uuid)
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
  v_json := private.invoice_json(p_invoice_id);
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

create function public.mark_invoice_sent(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can send invoices.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  select status into v_status from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft invoice can be marked sent.' using errcode = 'P0001', hint = 'invalid_status';
  end if;
  update public.invoices set status = 'sent', sent_at = now() where id = p_invoice_id;
end;
$$;

create function public.mark_invoice_paid(p_invoice_id uuid, p_method text, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_method text := nullif(btrim(p_method), '');
  v_reference text := nullif(btrim(p_reference), '');
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can record payments.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  select status into v_status from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found.' using errcode = 'P0001', hint = 'invoice_not_found';
  end if;
  if v_status <> 'sent' then
    raise exception 'Only a sent invoice can be marked paid.' using errcode = 'P0001', hint = 'invalid_status';
  end if;
  if v_method is null then
    raise exception 'Say how it was paid.' using errcode = 'P0001', hint = 'method_required';
  end if;
  update public.invoices
  set status = 'paid', paid_at = now(), paid_method = v_method, paid_reference = v_reference
  where id = p_invoice_id;
end;
$$;

revoke all on function public.invoices_overview() from public, anon;
revoke all on function public.invoice_detail(uuid) from public, anon;
revoke all on function public.mark_invoice_sent(uuid) from public, anon;
revoke all on function public.mark_invoice_paid(uuid, text, text) from public, anon;
grant execute on function public.invoices_overview() to authenticated;
grant execute on function public.invoice_detail(uuid) to authenticated;
grant execute on function public.mark_invoice_sent(uuid) to authenticated;
grant execute on function public.mark_invoice_paid(uuid, text, text) to authenticated;
