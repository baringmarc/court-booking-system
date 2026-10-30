-- T12.11 (contract): removes what the M12 expand migrations kept for the pre-T12.10 frontend, now that production
-- runs the venue-membership frontend. Admin rights come only from venue_members and platform_admins.
-- private.default_venue_id() stays: resolve_public_venue still defaults the public slug to claudex-courts (SPEC §10
-- 2026-10-30, removed in Phase 2). Rollback: re-create the dropped objects from the T12.3, T12.7 and T11.21 migrations.

-- 1. Realtime: one private topic per venue, admin:bookings:<venue_id>, readable by that venue's admins.
drop policy "Admins receive booking changes" on realtime.messages;

create or replace function private.broadcast_booking_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- UPDATE OF status also fires when status is set to its own value; that isn't a change.
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return null;
  end if;
  perform realtime.send(
    jsonb_build_object(
      'booking_id', new.id,
      'status',     new.status,
      'old_status', case when tg_op = 'UPDATE' then old.status end,
      'source',     new.source
    ),
    'booking_changed',
    'admin:bookings:' || new.venue_id::text,
    true
  );
  return null;
end;
$$;
revoke all on function private.broadcast_booking_change() from public, anon, authenticated;

create policy "Venue admins receive booking changes"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() ~ '^admin:bookings:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (select private.is_venue_admin(split_part(realtime.topic(), ':', 3)::uuid))
  );

-- 2. Legacy storage policies (T6/T11, checked is_admin() with unprefixed paths). The "Venue admins …" policies stay.
drop policy "Admins delete payment QR codes" on storage.objects;
drop policy "Admins delete venue media" on storage.objects;
drop policy "Admins read payment QR codes" on storage.objects;
drop policy "Admins read venue media" on storage.objects;
drop policy "Admins update venue media" on storage.objects;
drop policy "Admins upload payment QR codes" on storage.objects;
drop policy "Admins upload venue media" on storage.objects;

-- 3. profiles.role and is_admin(). Nothing else reads either (no policy, function or view).
drop function private.is_admin();
alter table public.profiles drop column role;
drop type public.user_role;
comment on table public.profiles is 'One row per auth user. Admin rights come from venue_members and platform_admins.';

-- 4. Singleton paths.
alter table public.venue_settings drop column id;

do $$
declare
  t text;
begin
  foreach t in array array['courts', 'blackouts', 'open_play_sessions', 'operating_hours', 'venue_amenities',
                           'venue_info_sections', 'venue_payment_accounts', 'venue_settings', 'venue_social_links']
  loop
    execute format('alter table public.%I alter column venue_id drop default', t);
  end loop;
end;
$$;

-- The no-venue time helpers. Every caller uses the (p_venue uuid, …) overloads since T12.5/T12.6.
drop function private.local_day_bounds(date);
drop function private.in_booking_window(date);
drop function private.local_dow_hour(timestamptz);
drop function private.operating_day_of(timestamptz);
drop function private.operating_day_range(date);
drop function private.operating_today();
drop function private.local_today();
drop function private.venue_tz();

-- 5. Stored media paths must sit under the row's own venue (the T12.7 copy moved every legacy path).
alter table public.court_photos drop constraint court_photos_path_check;
alter table public.court_photos add constraint court_photos_path_check
  check (path ~ ('^' || venue_id::text || '/courts/' || court_id::text || '/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'));

alter table public.venue_settings drop constraint venue_settings_banner_path_check;
alter table public.venue_settings add constraint venue_settings_banner_path_check
  check (banner_path ~ ('^' || venue_id::text || '/banner/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'));

alter table public.venue_payment_accounts drop constraint venue_payment_accounts_qr_path;
alter table public.venue_payment_accounts add constraint venue_payment_accounts_qr_path
  check (qr_path ~ ('^' || venue_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$'));
