-- T18.3: per-venue walk-ins (SPEC §5.8, §10 2026-11-10). Plotline alone turns them on; every venue, Claudex Courts
-- included, starts off. Walk-ins stay unbilled. create_walk_in refuses with walk_ins_off while a venue's flag is off.
-- Rollout: production builds have VITE_FEATURE_WALK_INS off, so no client there calls create_walk_in.

alter table public.venue_settings
  add column walk_ins_enabled boolean not null default false;
comment on column public.venue_settings.walk_ins_enabled is
  'Walk-in bookings for this venue (T18.3). Off by default; only Plotline changes it (set_walk_ins, service role or postgres).';

-- Security invoker on purpose, like guard_online_payments: current_user is the caller (authenticated for a venue
-- admin's update, postgres inside the security definer set_walk_ins).
create function private.guard_walk_ins()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.walk_ins_enabled is distinct from old.walk_ins_enabled
     and current_user not in ('postgres', 'service_role') then
    raise exception 'Walk-ins are managed by Plotline.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_walk_ins() from public, anon, authenticated;

create trigger venue_settings_guard_walk_ins
  before update on public.venue_settings
  for each row execute function private.guard_walk_ins();

-- Owned by postgres, so its update passes guard_walk_ins; the same shape as set_online_payments (T18.1).
create function public.set_walk_ins(p_venue_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_platform_admin()) then
    raise exception 'Only platform admins can change walk-ins.'
      using errcode = 'P0001', hint = 'not_platform_admin';
  end if;

  update public.venue_settings
  set walk_ins_enabled = p_enabled
  where venue_id = p_venue_id;

  if not found then
    raise exception 'Venue not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
end;
$$;

revoke all on function public.set_walk_ins(uuid, boolean) from public, anon;
grant execute on function public.set_walk_ins(uuid, boolean) to authenticated;

-- From 20261030081005_venue_aware_remaining_rpcs.sql, plus the walk_ins_off check after the staff check and before
-- any slot check. Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.create_walk_in(p_court_id uuid, p_start timestamp with time zone, p_slots integer, p_name text, p_phone text DEFAULT NULL::text, p_method payment_method DEFAULT 'cash'::payment_method, p_amount numeric DEFAULT NULL::numeric, p_reference_number text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, reference_code text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_admin      uuid := auth.uid();
  v_during     tstzrange;
  v_name       text := nullif(trim(p_name), '');
  v_phone      text := nullif(trim(p_phone), '');
  v_reference  text := nullif(trim(p_reference_number), '');
  v_price      numeric;
  v_amount     numeric;
  v_id         uuid;
  v_ref        text;
  v_constraint text;
  v_venue      uuid;
begin
  if v_admin is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can record walk-ins.' using errcode = 'P0001', hint = 'forbidden';
  end if;

  select c.venue_id into v_venue from public.courts c where c.id = p_court_id;
  if v_venue is not null and not private.is_venue_admin(v_venue) then
    raise exception 'Only staff can record walk-ins.' using errcode = 'P0001', hint = 'forbidden';
  end if;

  -- T18.3: refused while Plotline has walk-ins off for this venue, before any slot check.
  if v_venue is not null and not coalesce(
    (select s.walk_ins_enabled from public.venue_settings s where s.venue_id = v_venue), false
  ) then
    raise exception 'Walk-ins are off for this venue.' using errcode = 'P0001', hint = 'walk_ins_off';
  end if;

  -- Serialize with open play sessions on this court; validate_booking_slot then checks a fresh snapshot.
  perform private.lock_court_slots(p_court_id);
  v_during := private.validate_booking_slot(p_court_id, p_start, p_slots, true);

  if v_name is null then
    raise exception 'Enter the customer''s name.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if length(v_name) > 100 or length(v_phone) > 30 or length(v_reference) > 100 then
    raise exception 'Name, phone or reference is too long.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if p_method is null then
    raise exception 'Choose how the customer paid.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  v_price := private.range_price(p_court_id, v_during);
  v_amount := round(coalesce(p_amount, v_price), 2);
  if v_amount < 0 or v_amount > 1000000 then
    raise exception 'Enter the amount received.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Same lazy expiry as create_booking: release overlapping stale holds first.
  update public.bookings b
  set status = 'expired'
  where b.court_id = p_court_id
    and b.status = 'pending_payment'
    and b.expires_at <= now()
    and b.during && v_during;

  for attempt in 1..5 loop
    begin
      insert into public.bookings as b (
        reference_code, court_id, user_id, guest_name, guest_phone,
        during, total_amount, status, source, created_by
      ) values (
        private.new_reference_code(), p_court_id, null, v_name, v_phone,
        v_during, v_price, 'confirmed', 'walk_in', v_admin
      )
      returning b.id, b.reference_code into v_id, v_ref;
      exit;
    exception
      when exclusion_violation then
        raise exception 'That court is already booked for part of this time.'
          using errcode = 'P0001', hint = 'slot_unavailable';
      when foreign_key_violation then
        raise exception 'This court is not available for booking.' using errcode = 'P0001', hint = 'court_inactive';
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint <> 'bookings_reference_code_key' or attempt = 5 then
          raise;
        end if;
    end;
  end loop;

  insert into public.payments (
    booking_id, method, amount, reference_number, recorded_by,
    review_status, reviewed_by, reviewed_at
  ) values (
    v_id, p_method, v_amount, v_reference, v_admin,
    'approved', v_admin, now()
  );

  return query select v_id, v_ref;
end;
$function$;
