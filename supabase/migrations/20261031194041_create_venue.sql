-- T14.4: platform admins create a venue (SAAS-PLAN Phase 3). The venue starts as 'draft' with its settings row and
-- default opening hours; courts, members and the owner invite come later (T14.5, T14.7).

create function public.create_venue(p_slug text, p_name text, p_timezone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can create venues.' using errcode = 'P0001', hint = 'not_platform_admin';
  end if;

  if p_slug is null or p_slug !~ '^[a-z0-9-]{3,40}$' then
    raise exception 'The slug must be 3 to 40 lowercase letters, digits or hyphens.' using errcode = 'P0001', hint = 'slug_invalid';
  end if;
  if p_slug = any (array['www', 'app', 'api', 'admin', 'mail', 'demo', 'plotline', 'support', 'status', 'staging', 'help', 'blog']) then
    raise exception 'That slug is reserved.' using errcode = 'P0001', hint = 'slug_reserved';
  end if;
  if exists (select 1 from public.venues where slug = p_slug) then
    raise exception 'That slug is already taken.' using errcode = 'P0001', hint = 'slug_taken';
  end if;

  if char_length(v_name) not between 2 and 80 then
    raise exception 'The venue name must be 2 to 80 characters.' using errcode = 'P0001', hint = 'name_invalid';
  end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'Unknown timezone.' using errcode = 'P0001', hint = 'timezone_invalid';
  end if;

  insert into public.venues (slug, status) values (p_slug, 'draft') returning id into v_id;
  insert into public.venue_settings (venue_id, name, timezone) values (v_id, v_name, p_timezone);
  insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
  select v_id, d, time '06:00', time '22:00' from generate_series(0, 6) as d;
  return v_id;
exception when unique_violation then
  raise exception 'That slug is already taken.' using errcode = 'P0001', hint = 'slug_taken';
end;
$$;

revoke all on function public.create_venue(text, text, text) from public, anon;
grant execute on function public.create_venue(text, text, text) to authenticated;
