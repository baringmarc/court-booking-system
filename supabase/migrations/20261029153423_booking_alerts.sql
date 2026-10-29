-- T11.21: tell open admin tabs about booking changes (SPEC §10 2026-10-28 and 2026-10-29, RESEARCH M11 "Admin alerts
-- with Realtime (T11.16)"). Broadcast from the database, not Postgres Changes: the trigger sees the old status, and
-- the message carries ids and statuses only, never contact details.
--   1. An AFTER trigger on bookings sends booking_changed to the private topic admin:bookings. realtime.send swallows
--      its own errors (a WARNING), so a failed send never rolls back a booking. The payload has no "id" key: realtime
--      would use it as the message id, and a second change to the same booking would collide and be dropped.
--   2. Only admins may receive the topic (a SELECT policy on realtime.messages). No INSERT policy: clients can't send.
--   M12 makes the topic per venue (venue:<id>:bookings) and checks membership in the policy.

create function private.broadcast_booking_change()
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
    'admin:bookings',
    true
  );
  return null;
end;
$$;
revoke all on function private.broadcast_booking_change() from public, anon, authenticated;

create trigger bookings_broadcast_change
  after insert or update of status on public.bookings
  for each row execute function private.broadcast_booking_change();

create policy "Admins receive booking changes"
  on realtime.messages
  for select
  to authenticated
  using (
    private.is_admin()
    and realtime.topic() = 'admin:bookings'
    and realtime.messages.extension = 'broadcast'
  );
