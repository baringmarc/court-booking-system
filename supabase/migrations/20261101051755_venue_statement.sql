-- T14.11: the venue admin's statement (SAAS-PLAN §5). This month so far (fees by payment method, venue cancellations
-- credited, running total, every line with its booking) and the venue's invoices. Read-only; one venue only.

create function public.venue_statement(p_venue_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_venue uuid := private.admin_venue(p_venue_id);
  v_month date := date_trunc('month', now() at time zone private.venue_tz(v_venue))::date;
begin
  return (
    select jsonb_build_object(
      'month', to_char(v_month, 'YYYY-MM-DD'),
      'fee_count', t.fee_count,
      'fee_total', t.fee_total,
      'adjustment_total', t.adjustment_total,
      'total', t.fee_total + t.adjustment_total,
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
      'lines', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'charge_id', c.id, 'booking_id', c.booking_id, 'reference_code', b.reference_code,
                 'kind', c.kind, 'amount', c.amount, 'charged_at', c.charged_at
               ) order by c.charged_at, c.id)
        from public.billing_charges c
        join public.bookings b on b.venue_id = c.venue_id and b.id = c.booking_id
        where c.venue_id = v_venue and c.billing_month = v_month
      ), '[]'::jsonb),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'invoice_id', i.id, 'billing_month', to_char(i.billing_month, 'YYYY-MM-DD'), 'status', i.status,
                 'total', coalesce((select sum(c.amount) from public.billing_charges c where c.invoice_id = i.id), 0),
                 'sent_at', i.sent_at, 'paid_at', i.paid_at
               ) order by i.billing_month desc)
        from public.invoices i where i.venue_id = v_venue
      ), '[]'::jsonb)
    )
    from (
      select count(*) filter (where c.kind = 'booking_fee') as fee_count,
             coalesce(sum(c.amount) filter (where c.kind = 'booking_fee'), 0) as fee_total,
             coalesce(sum(c.amount) filter (where c.kind = 'adjustment'), 0) as adjustment_total
      from public.billing_charges c where c.venue_id = v_venue and c.billing_month = v_month
    ) t
  );
end;
$$;

revoke all on function public.venue_statement(uuid) from public, anon;
grant execute on function public.venue_statement(uuid) to authenticated;
