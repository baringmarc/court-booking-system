-- T29.5: the `stack-live` Edge Function creates plotline.fit stacks (no venue) with the service role. The `private`
-- schema is not exposed through the API, so this public wrapper is the function's door to
-- private.create_live_stack. Executable by service_role only; hints as private.create_live_stack
-- (`invalid_input`, `busy`).
create function public.create_site_live_stack(p_title text, p_courts integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  return private.create_live_stack(p_title, p_courts, null, null);
end;
$$;

revoke all on function public.create_site_live_stack(text, integer) from public, anon, authenticated;
grant execute on function public.create_site_live_stack(text, integer) to service_role;
