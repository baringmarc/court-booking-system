-- T17.18: bounded, paginated console reads alongside the unchanged venues_overview, invoices_overview and
-- invoice_detail. Each returns {"total", "rows"} (or the invoice with "lines" and "line_total"), where the total counts
-- every row matching the filters regardless of the page. Order always ends in a unique id. Platform admins only.

-- A LIKE pattern matching p_search as a literal, case-insensitive substring (with escape '\'); null when blank.
create function private.console_search_pattern(p_search text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when nullif(btrim(p_search), '') is null then null
    else '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%' end
$$;
revoke all on function private.console_search_pattern(text) from public, anon, authenticated;

-- Page size 1..100 (null: 25) and an offset of at least 0.
create function private.console_limit(p_limit integer, p_default integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(greatest(coalesce(p_limit, p_default), 1), 100)
$$;
revoke all on function private.console_limit(integer, integer) from public, anon, authenticated;

create function public.venues_page(
  p_search text default null,
  p_status text default null,
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
    raise exception 'Only platform admins can list venues.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  if v_status is not null and v_status not in ('draft', 'active', 'suspended', 'closed') then
    raise exception 'Unknown venue status filter.' using errcode = 'P0001', hint = 'invalid_filter';
  end if;

  select count(*) into v_total
  from public.venues v
  join public.venue_settings s on s.venue_id = v.id
  where (v_status is null or v.status = v_status)
    and (v_pattern is null or s.name ilike v_pattern escape '\' or v.slug ilike v_pattern escape '\');

  select coalesce(jsonb_agg(jsonb_build_object(
           'venue_id', p.id,
           'slug', p.slug,
           'name', p.name,
           'status', p.status,
           'month_transactions', (
             select count(*) from public.billing_charges c
             where c.venue_id = p.id and c.kind = 'booking_fee' and c.billing_month = private.billing_month(p.id, now())
           ),
           'month_total', (
             select coalesce(sum(c.amount), 0) from public.billing_charges c
             where c.venue_id = p.id and c.billing_month = private.billing_month(p.id, now())
           ),
           'open_invoices', (
             select count(*) from public.invoices i where i.venue_id = p.id and i.status in ('draft', 'sent')
           )
         ) order by p.name, p.slug, p.id), '[]'::jsonb)
  into v_rows
  from (
    select v.id, v.slug, v.status, s.name
    from public.venues v
    join public.venue_settings s on s.venue_id = v.id
    where (v_status is null or v.status = v_status)
      and (v_pattern is null or s.name ilike v_pattern escape '\' or v.slug ilike v_pattern escape '\')
    order by s.name, v.slug, v.id
    limit v_limit offset v_offset
  ) p;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

create function public.invoices_page(
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

  select coalesce(jsonb_agg(private.invoice_json(p.id) order by p.billing_month desc, p.name, p.slug, p.id), '[]'::jsonb)
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

create function public.invoice_detail_page(
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
  v_json := private.invoice_json(p_invoice_id);
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

revoke all on function public.venues_page(text, text, integer, integer) from public, anon;
revoke all on function public.invoices_page(text, text, date, integer, integer) from public, anon;
revoke all on function public.invoice_detail_page(uuid, integer, integer) from public, anon;
grant execute on function public.venues_page(text, text, integer, integer) to authenticated;
grant execute on function public.invoices_page(text, text, date, integer, integer) to authenticated;
grant execute on function public.invoice_detail_page(uuid, integer, integer) to authenticated;
