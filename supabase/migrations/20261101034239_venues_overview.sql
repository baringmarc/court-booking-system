-- T14.8: the console's venues list and the platform admin's suspend / reactivate switches.

create function public.venues_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can list venues.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;

  return coalesce((
    select jsonb_agg(row order by row ->> 'name', row ->> 'slug')
    from (
      select jsonb_build_object(
        'venue_id', v.id,
        'slug', v.slug,
        'name', s.name,
        'status', v.status,
        'month_transactions', (
          select count(*) from public.billing_charges c
          where c.venue_id = v.id and c.kind = 'booking_fee' and c.billing_month = private.billing_month(v.id, now())
        ),
        'month_total', (
          select coalesce(sum(c.amount), 0) from public.billing_charges c
          where c.venue_id = v.id and c.billing_month = private.billing_month(v.id, now())
        ),
        'open_invoices', (
          select count(*) from public.invoices i where i.venue_id = v.id and i.status in ('draft', 'sent')
        )
      ) as row
      from public.venues v
      join public.venue_settings s on s.venue_id = v.id
    ) t
  ), '[]'::jsonb);
end;
$$;

create function public.suspend_venue(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can suspend venues.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  select status into v_status from public.venues where id = p_venue_id for update;
  if not found then
    raise exception 'Venue not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
  if v_status <> 'active' then
    raise exception 'Only an active venue can be suspended.' using errcode = 'P0001', hint = 'not_active';
  end if;
  update public.venues set status = 'suspended' where id = p_venue_id;
end;
$$;

create function public.reactivate_venue(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can reactivate venues.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;
  select status into v_status from public.venues where id = p_venue_id for update;
  if not found then
    raise exception 'Venue not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
  if v_status <> 'suspended' then
    raise exception 'Only a suspended venue can be reactivated.' using errcode = 'P0001', hint = 'not_suspended';
  end if;
  update public.venues set status = 'active' where id = p_venue_id;
end;
$$;

revoke all on function public.venues_overview() from public, anon;
revoke all on function public.suspend_venue(uuid) from public, anon;
revoke all on function public.reactivate_venue(uuid) from public, anon;
grant execute on function public.venues_overview() to authenticated;
grant execute on function public.suspend_venue(uuid) to authenticated;
grant execute on function public.reactivate_venue(uuid) to authenticated;
