-- T14.7: the setup checklist of a draft venue and the RPC that publishes it (draft -> active).
-- Both are for the venue's admins and platform admins; the checklist rules live here so the UI and publish agree.

create function public.venue_setup_status(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_courts boolean;
  v_rates boolean;
  v_hours boolean;
  v_payment boolean;
  v_photos boolean;
  v_items jsonb;
begin
  if not (select private.is_venue_admin(p_venue_id)) then
    raise exception 'Only this venue''s admins can read its setup.' using errcode = 'P0001', hint = 'not_venue_admin';
  end if;

  select exists (select 1 from public.courts where venue_id = p_venue_id and is_active) into v_courts;
  select v_courts and not exists (
    select 1 from public.courts where venue_id = p_venue_id and is_active and default_hourly_rate <= 0
  ) into v_rates;
  select exists (select 1 from public.operating_hours where venue_id = p_venue_id and not is_closed) into v_hours;
  select exists (
    select 1 from public.venue_payment_accounts where venue_id = p_venue_id and btrim(account_number) <> ''
  ) into v_payment;
  select exists (select 1 from public.court_photos where venue_id = p_venue_id) into v_photos;

  v_items := jsonb_build_array(
    jsonb_build_object('key', 'courts', 'label', 'Add at least one active court', 'required', true, 'done', v_courts),
    jsonb_build_object('key', 'rates', 'label', 'Set a rate above zero on every active court', 'required', true, 'done', v_rates),
    jsonb_build_object('key', 'hours', 'label', 'Open on at least one day', 'required', true, 'done', v_hours),
    jsonb_build_object('key', 'payment', 'label', 'Add a payment account with an account number', 'required', true, 'done', v_payment),
    jsonb_build_object('key', 'photos', 'label', 'Add court photos', 'required', false, 'done', v_photos)
  );

  return jsonb_build_object(
    'items', v_items,
    'ready', v_courts and v_rates and v_hours and v_payment
  );
end;
$$;

create function public.publish_venue(p_venue_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_setup jsonb;
  v_missing text;
begin
  if not (select private.is_venue_admin(p_venue_id)) then
    raise exception 'Only this venue''s admins can publish it.' using errcode = 'P0001', hint = 'not_venue_admin';
  end if;

  select status into v_status from public.venues where id = p_venue_id for update;
  if not found then
    raise exception 'Venue not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft venue can be published.' using errcode = 'P0001', hint = 'not_draft';
  end if;

  v_setup := public.venue_setup_status(p_venue_id);
  select string_agg(i ->> 'key', ',' order by ord) into v_missing
  from jsonb_array_elements(v_setup -> 'items') with ordinality as t(i, ord)
  where (i ->> 'required')::boolean and not (i ->> 'done')::boolean;
  if v_missing is not null then
    raise exception 'The venue setup is incomplete.' using errcode = 'P0001', hint = 'setup_incomplete', detail = v_missing;
  end if;

  update public.venues set status = 'active' where id = p_venue_id;
end;
$$;

revoke all on function public.venue_setup_status(uuid) from public, anon;
revoke all on function public.publish_venue(uuid) from public, anon;
grant execute on function public.venue_setup_status(uuid) to authenticated;
grant execute on function public.publish_venue(uuid) to authenticated;
