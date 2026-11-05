-- T17.21: the venue admin's statement, paged, alongside the unchanged venue_statement. statement_summary gives a
-- month's full totals, this month's accrual and the amount due (sent invoices only); statement_charges_page and
-- statement_invoices_page are bounded pages ({"total", "rows"}) whose totals never depend on the page. Read-only; the
-- caller's own venue only (private.admin_venue). Invoice amounts, due dates and overdue use private.invoice_json.

-- A statement month: the venue-local current month when null, otherwise it must be the first day of a month.
create function private.statement_month(p_venue uuid, p_month date)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_month is null then
    return private.billing_month(p_venue, now());
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception 'The month must be the first day of a month.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  return p_month;
end;
$$;
revoke all on function private.statement_month(uuid, date) from public, anon, authenticated;

-- One month's charge totals for a venue.
create function private.statement_totals(p_venue uuid, p_month date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'fee_count', t.fee_count,
    'fee_total', t.fee_total,
    'adjustment_total', t.adjustment_total,
    'total', t.fee_total + t.adjustment_total
  )
  from (
    select count(*) filter (where c.kind = 'booking_fee') as fee_count,
           coalesce(sum(c.amount) filter (where c.kind = 'booking_fee'), 0) as fee_total,
           coalesce(sum(c.amount) filter (where c.kind = 'adjustment'), 0) as adjustment_total
    from public.billing_charges c where c.venue_id = p_venue and c.billing_month = p_month
  ) t
$$;
revoke all on function private.statement_totals(uuid, date) from public, anon, authenticated;

create function public.statement_summary(p_venue_id uuid default null, p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.admin_venue(p_venue_id);
  v_month date := private.statement_month(v_venue, p_month);
begin
  return private.statement_totals(v_venue, v_month) || jsonb_build_object(
    'month', to_char(v_month, 'YYYY-MM-DD'),
    'by_method', coalesce((
      select jsonb_agg(jsonb_build_object('method', m.method, 'paid_with', m.paid_with, 'count', m.n, 'fee_total', m.total)
                       order by m.method nulls last, m.paid_with nulls last)
      from (
        select p.method::text as method, p.paid_with, count(*) as n, sum(c.amount) as total
        from public.billing_charges c
        left join public.payments p on p.booking_id = c.booking_id and p.review_status = 'approved'
        where c.venue_id = v_venue and c.billing_month = v_month and c.kind = 'booking_fee'
        group by p.method, p.paid_with
      ) m
    ), '[]'::jsonb),
    -- This month so far: not yet invoiced, so never part of the amount due.
    'accrual', private.statement_totals(v_venue, private.billing_month(v_venue, now())),
    -- Only sent invoices are due; drafts are not issued yet and paid ones are settled.
    'amount_due', (
      select jsonb_build_object(
        'total', coalesce(sum((d.j ->> 'total')::numeric), 0),
        'count', count(*),
        'invoices', coalesce(jsonb_agg(jsonb_build_object(
            'invoice_id', d.j -> 'invoice_id', 'billing_month', d.j -> 'billing_month', 'total', d.j -> 'total',
            'sent_at', d.j -> 'sent_at', 'due_at', d.j -> 'due_at', 'overdue', d.j -> 'overdue'
          ) order by d.billing_month, d.id), '[]'::jsonb)
      )
      from (
        select i.id, i.billing_month, private.invoice_json(i.id) as j
        from public.invoices i where i.venue_id = v_venue and i.status = 'sent'
      ) d
    )
  );
end;
$$;

create function public.statement_charges_page(
  p_venue_id uuid default null,
  p_month date default null,
  p_search text default null,
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
  v_venue uuid := private.admin_venue(p_venue_id);
  v_month date := private.statement_month(v_venue, p_month);
  v_pattern text := private.console_search_pattern(p_search);
  v_limit integer := private.console_limit(p_limit, 25);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  select count(*) into v_total
  from public.billing_charges c
  join public.bookings b on b.venue_id = c.venue_id and b.id = c.booking_id
  where c.venue_id = v_venue and c.billing_month = v_month
    and (v_pattern is null or b.reference_code ilike v_pattern escape '\');

  select coalesce(jsonb_agg(jsonb_build_object(
           'charge_id', p.id, 'booking_id', p.booking_id, 'reference_code', p.reference_code, 'kind', p.kind,
           'amount', p.amount, 'charged_at', p.charged_at, 'invoice_id', p.invoice_id
         ) order by p.charged_at desc, p.id desc), '[]'::jsonb)
  into v_rows
  from (
    select c.id, c.booking_id, b.reference_code, c.kind, c.amount, c.charged_at, c.invoice_id
    from public.billing_charges c
    join public.bookings b on b.venue_id = c.venue_id and b.id = c.booking_id
    where c.venue_id = v_venue and c.billing_month = v_month
      and (v_pattern is null or b.reference_code ilike v_pattern escape '\')
    order by c.charged_at desc, c.id desc
    limit v_limit offset v_offset
  ) p;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

create function public.statement_invoices_page(
  p_venue_id uuid default null,
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
  v_venue uuid := private.admin_venue(p_venue_id);
  v_status text := nullif(btrim(p_status), '');
  v_limit integer := private.console_limit(p_limit, 25);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total integer;
  v_rows jsonb;
begin
  if v_status is not null and v_status not in ('draft', 'sent', 'paid') then
    raise exception 'Unknown invoice status filter.' using errcode = 'P0001', hint = 'invalid_filter';
  end if;

  select count(*) into v_total
  from public.invoices i
  where i.venue_id = v_venue and (v_status is null or i.status = v_status);

  select coalesce(jsonb_agg(private.invoice_json(p.id) - array['venue_id', 'slug', 'name', 'fee_count']
                            order by p.billing_month desc, p.id desc), '[]'::jsonb)
  into v_rows
  from (
    select i.id, i.billing_month
    from public.invoices i
    where i.venue_id = v_venue and (v_status is null or i.status = v_status)
    order by i.billing_month desc, i.id desc
    limit v_limit offset v_offset
  ) p;

  return jsonb_build_object('total', v_total, 'rows', v_rows);
end;
$$;

revoke all on function public.statement_summary(uuid, date) from public, anon;
revoke all on function public.statement_charges_page(uuid, date, text, integer, integer) from public, anon;
revoke all on function public.statement_invoices_page(uuid, text, integer, integer) from public, anon;
grant execute on function public.statement_summary(uuid, date) to authenticated;
grant execute on function public.statement_charges_page(uuid, date, text, integer, integer) to authenticated;
grant execute on function public.statement_invoices_page(uuid, text, integer, integer) to authenticated;
