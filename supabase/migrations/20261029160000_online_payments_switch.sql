-- T11.22: the online payments switch (SPEC §10 2026-10-28). Manual proof upload is always on; this flag only adds
-- "Pay online with PayMongo". Turning it on depends on the venue's PayMongo account being set up and verified, so
-- only Plotline changes it: the service role or postgres (`npx supabase db query --linked` for now; SaaS gets a
-- Plotline control). Venue admins keep editing every other setting through the existing UPDATE policy.
-- Expand only: the deployed frontend still shows the button; create-paymongo-checkout refuses when the flag is off.

alter table public.venue_settings
  add column online_payments_enabled boolean not null default false;
comment on column public.venue_settings.online_payments_enabled is
  'PayMongo checkout for this venue (T11.22). New venues start off; only Plotline (service role or postgres) changes it.';

-- Claudex Courts already takes PayMongo payments (the live site, the PayMongo e2e and smoke tests).
update public.venue_settings set online_payments_enabled = true;

-- Security invoker on purpose: current_user is the caller (authenticated for a venue admin's update).
create function private.guard_online_payments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.online_payments_enabled is distinct from old.online_payments_enabled
     and current_user not in ('postgres', 'service_role') then
    raise exception 'Online payments are managed by Plotline.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_online_payments() from public, anon, authenticated;

create trigger venue_settings_guard_online_payments
  before update on public.venue_settings
  for each row execute function private.guard_online_payments();
