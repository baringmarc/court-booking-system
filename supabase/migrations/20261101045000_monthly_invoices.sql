-- T14.9: monthly draft invoices (SPEC §10, RESEARCH M14 "pg_cron: monthly invoices").
-- A daily job gives every venue a draft invoice for each venue-local month that has already ended and attaches
-- that month's unattached charges. Idempotent and self-healing: a missed day or a venue in another timezone is
-- caught up on the next run. Runs as the job owner (no auth.uid()), like private.expire_holds.

create function private.generate_invoices()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_created integer := 0;
  v_rows integer;
  v_venue record;
  v_last date;
  v_first date;
begin
  for v_venue in select v.id, v.created_at from public.venues v loop
    -- The last month that has ended in the venue's timezone.
    v_last := (private.billing_month(v_venue.id, now()) - interval '1 month')::date;
    select least(
      private.billing_month(v_venue.id, v_venue.created_at),
      (select min(c.billing_month) from public.billing_charges c where c.venue_id = v_venue.id)
    ) into v_first;

    if v_first <= v_last then
      insert into public.invoices (venue_id, billing_month)
      select v_venue.id, m::date
      from generate_series(v_first, v_last, interval '1 month') as m
      on conflict (venue_id, billing_month) do nothing;
      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;
    end if;

    -- Only draft invoices take charges; sent and paid ones are never touched.
    update public.billing_charges c
    set invoice_id = i.id
    from public.invoices i
    where c.venue_id = v_venue.id
      and c.invoice_id is null
      and i.venue_id = c.venue_id
      and i.billing_month = c.billing_month
      and i.status = 'draft'
      and c.billing_month <= v_last;
  end loop;
  return v_created;
end;
$$;

revoke all on function private.generate_invoices() from public, anon, authenticated;

select cron.schedule('monthly-invoices', '0 1 * * *', 'select private.generate_invoices()');
