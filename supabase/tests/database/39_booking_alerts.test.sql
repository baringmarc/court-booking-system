-- T11.21: booking alerts. A trigger on bookings broadcasts { booking_id, status, old_status, source } on the private
-- topic 'admin:bookings' (event 'booking_changed'); only admins may read those messages (RLS on realtime.messages).
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
-- Rows the current role can read from realtime.messages (0 when the role has no access at all).
create function pg_temp.visible_messages() returns int language plpgsql as $$
declare n int;
begin
  select count(*)::int into n from realtime.messages where topic = 'admin:bookings';
  return n;
exception when insufficient_privilege then
  return 0;
end $$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "anon"}', true)
$$;
create function pg_temp.as_player() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true)
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true)
$$;
grant execute on function pg_temp.as_anon() to anon, authenticated, service_role;
grant execute on function pg_temp.as_player() to anon, authenticated, service_role;
grant execute on function pg_temp.as_admin() to anon, authenticated, service_role;
grant execute on function pg_temp.visible_messages() to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000039a1', 'Alert Court 1', 'tennis', 300);

delete from realtime.messages where topic = 'admin:bookings';

-- ---------------------------------------------------------------------------
-- The function and the trigger
-- ---------------------------------------------------------------------------
select has_function('private', 'broadcast_booking_change', array[]::text[], 'private.broadcast_booking_change() exists');
select is((select prosecdef from pg_proc where oid = 'private.broadcast_booking_change()'::regprocedure), true, 'it is security definer');
select is((select proconfig from pg_proc where oid = 'private.broadcast_booking_change()'::regprocedure), array['search_path=""'], 'it pins search_path to empty');
select ok(not has_function_privilege('anon', 'private.broadcast_booking_change()', 'execute')
      and not has_function_privilege('authenticated', 'private.broadcast_booking_change()', 'execute'),
  'anon and authenticated cannot execute it');
select has_trigger('public', 'bookings', 'bookings_broadcast_change', 'bookings has the bookings_broadcast_change trigger');
select is((select tgtype & 1 from pg_trigger where tgname = 'bookings_broadcast_change' and tgrelid = 'public.bookings'::regclass), 1, 'it is a row-level trigger');
select is((select tgtype & 4 from pg_trigger where tgname = 'bookings_broadcast_change' and tgrelid = 'public.bookings'::regclass), 4, 'it fires on insert');
select is((select tgtype & 16 from pg_trigger where tgname = 'bookings_broadcast_change' and tgrelid = 'public.bookings'::regclass), 16, 'it fires on update');
select is((select tgtype & 2 from pg_trigger where tgname = 'bookings_broadcast_change' and tgrelid = 'public.bookings'::regclass), 0, 'it fires after, not before');
select is((select tgattr::text from pg_trigger where tgname = 'bookings_broadcast_change' and tgrelid = 'public.bookings'::regclass) <> '', true, 'the update is limited to specific columns (status)');

-- ---------------------------------------------------------------------------
-- What it sends
-- ---------------------------------------------------------------------------
insert into public.bookings (id, reference_code, court_id, guest_name, guest_email, guest_phone, during, total_amount, source, status, expires_at)
values ('b0000000-0000-0000-0000-0000000039b1', 'CB-AAAAA2', 'c0000000-0000-0000-0000-0000000039a1', 'Secret Guest', 'secret@example.com', '09171234567',
  tstzrange(now() + interval '60 days', now() + interval '60 days 1 hour'), 300, 'online', 'pending_payment', now() + interval '15 minutes');

select is((select count(*)::int from realtime.messages where topic = 'admin:bookings'), 1, 'an insert sends exactly one message');
select is((select payload - 'id' from realtime.messages where topic = 'admin:bookings'),
  '{"booking_id": "b0000000-0000-0000-0000-0000000039b1", "status": "pending_payment", "old_status": null, "source": "online"}'::jsonb,
  'an insert sends { booking_id, status, old_status: null, source } and nothing else');
select is((select event from realtime.messages where topic = 'admin:bookings'), 'booking_changed', 'the event is booking_changed');
select is((select extension from realtime.messages where topic = 'admin:bookings'), 'broadcast', 'the extension is broadcast');
select is((select private from realtime.messages where topic = 'admin:bookings'), true, 'the message is private');
select is((select payload::text ~* '(secret|example\.com|0917|token|guest)' from realtime.messages where topic = 'admin:bookings'), false,
  'the payload carries no name, email, phone or token');

update public.bookings set status = 'payment_submitted', expires_at = null where id = 'b0000000-0000-0000-0000-0000000039b1';
select is((select count(*)::int from realtime.messages where topic = 'admin:bookings'), 2, 'a status change sends one more message');
select is((select payload from realtime.messages where topic = 'admin:bookings' order by inserted_at desc, id limit 1)->>'old_status', 'pending_payment', 'old_status is the previous status');
select is((select payload from realtime.messages where topic = 'admin:bookings' order by inserted_at desc, id limit 1)->>'status', 'payment_submitted', 'status is the new status');

update public.bookings set guest_name = 'Renamed Guest' where id = 'b0000000-0000-0000-0000-0000000039b1';
select is((select count(*)::int from realtime.messages where topic = 'admin:bookings'), 2, 'an update that does not touch status sends nothing');

update public.bookings set status = 'confirmed' where id = 'b0000000-0000-0000-0000-0000000039b1';
select is((select count(*)::int from realtime.messages where topic = 'admin:bookings'), 3, 'an approval (payment_submitted to confirmed) sends one more message');

insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, source, status)
values ('b0000000-0000-0000-0000-0000000039b2', 'CB-AAAAA3', 'c0000000-0000-0000-0000-0000000039a1', 'Walk In',
  tstzrange(now() + interval '61 days', now() + interval '61 days 1 hour'), 300, 'walk_in', 'confirmed');
select is((select payload - 'id' from realtime.messages where topic = 'admin:bookings' order by inserted_at desc, id limit 1),
  '{"booking_id": "b0000000-0000-0000-0000-0000000039b2", "status": "confirmed", "old_status": null, "source": "walk_in"}'::jsonb,
  'a walk-in insert reports source walk_in');

-- ---------------------------------------------------------------------------
-- RLS on realtime.messages
-- ---------------------------------------------------------------------------
select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'Admins receive booking changes' and cmd = 'SELECT'), 1,
  'the policy "Admins receive booking changes" is a SELECT policy');
select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages' and cmd in ('INSERT', 'ALL', 'UPDATE', 'DELETE')), 0,
  'there is no write policy on realtime.messages');

select set_config('realtime.topic', 'admin:bookings', true);
set local role authenticated;
select pg_temp.as_admin();
select is(pg_temp.visible_messages(), 4, 'an admin on the admin:bookings topic sees the messages');
select set_config('realtime.topic', 'some:other', true);
select is(pg_temp.visible_messages(), 0, 'an admin on another topic sees none');
select set_config('realtime.topic', 'admin:bookings', true);
select pg_temp.as_player();
select is(pg_temp.visible_messages(), 0, 'a player sees none');
select is(pg_temp.sqlstate_of($$ insert into realtime.messages (topic, extension, payload, event, private) values ('admin:bookings', 'broadcast', '{}'::jsonb, 'booking_changed', true) $$), '42501',
  'a signed-in user cannot write messages');
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.visible_messages(), 0, 'anon sees none');
reset role;

select * from finish();
rollback;
