-- T18.1: platform admins turn a venue's online payments on or off (SPEC §10 2026-11-10). Expand only: the deployed
-- frontend and create-paymongo-checkout already read venue_settings.online_payments_enabled; no data changes.
-- private.guard_online_payments() is unchanged: this function is security definer and owned by postgres, so its
-- update runs as postgres and passes the guard, while a direct update by any client (a platform admin included) is
-- still refused with hint forbidden.
create function public.set_online_payments(p_venue_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can change online payments.'
      using errcode = 'P0001', hint = 'not_platform_admin';
  end if;

  update public.venue_settings
  set online_payments_enabled = p_enabled
  where venue_id = p_venue_id;

  if not found then
    raise exception 'Venue not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
end;
$$;

revoke all on function public.set_online_payments(uuid, boolean) from public, anon;
grant execute on function public.set_online_payments(uuid, boolean) to authenticated;
