-- T12.11: contract. profiles.role, user_role, private.is_admin(), venue_settings.id, the venue_id column defaults,
-- the no-venue time helpers and the legacy storage policies are gone; media paths need the venue prefix; the
-- Realtime topic is admin:bookings:<venue_id>, readable only by that venue's admins.
begin;
create extension if not exists pgtap with schema extensions;
select plan(61);

create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
-- Rows of realtime.messages on one topic that the current role can read, with realtime.topic() set to that topic.
create function pg_temp.visible(p_topic text) returns int language plpgsql as $$
declare n int;
begin
  perform set_config('realtime.topic', p_topic, true);
  select count(*)::int into n from realtime.messages where topic = p_topic;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;
create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;
grant execute on function pg_temp.sqlstate_of(text) to anon, authenticated, service_role;
grant execute on function pg_temp.visible(text) to anon, authenticated, service_role;
grant execute on function pg_temp.as_user(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixture
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'staff-a@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'staff-b@test.local');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'e2e-contract-a', 'active'),
  ('b0000000-0000-0000-0000-00000000000b', 'e2e-contract-b', 'active');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', '77777777-7777-7777-7777-777777777777', 'staff');
insert into public.venue_settings (venue_id, name) values ('a0000000-0000-0000-0000-00000000000a', 'E2E Contract A');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'E2E Contract A1', 'tennis', 500),
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E Contract B1', 'tennis', 600);

-- ---------------------------------------------------------------- legacy role gone
select hasnt_column('public', 'profiles', 'role', 'profiles.role is dropped');
select hasnt_type('public', 'user_role', 'the user_role enum is dropped');
select is(to_regprocedure('private.is_admin()'), null, 'private.is_admin() is dropped');
select has_function('private', 'is_venue_admin', array['uuid'], 'private.is_venue_admin(uuid) stays');
select has_function('private', 'is_platform_admin', array[]::text[], 'private.is_platform_admin() stays');
select is((select count(*)::int from pg_policies where schemaname = 'public' and qual ~ 'is_admin\(\)'), 0,
  'no public policy still calls is_admin()');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.proname <> 'is_admin'
              and case when p.prokind in ('f', 'p') then pg_get_functiondef(p.oid) end ~ 'is_admin\(\)'), 0,
  'no function body still calls is_admin()');
select lives_ok($$ insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'signup@test.local') $$,
  'signup (the profile trigger) still works without profiles.role');
select is((select count(*)::int from public.profiles where id = '99999999-9999-9999-9999-999999999999'), 1, 'the new user got a profile');

-- ---------------------------------------------------------------- venue_settings.id gone
select hasnt_column('public', 'venue_settings', 'id', 'venue_settings has no id column');
select is((select string_agg(a.attname, ',' order by a.attname) from pg_constraint c
            join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
            where c.conrelid = 'public.venue_settings'::regclass and c.contype = 'p'), 'venue_id',
  'venue_settings primary key is (venue_id)');

-- ---------------------------------------------------------------- venue_id defaults gone
select is((select count(*)::int from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
            where a.attname = 'venue_id' and d.adrelid = any (array[
              'public.courts'::regclass, 'public.blackouts'::regclass, 'public.open_play_sessions'::regclass,
              'public.operating_hours'::regclass, 'public.venue_amenities'::regclass, 'public.venue_info_sections'::regclass,
              'public.venue_payment_accounts'::regclass, 'public.venue_settings'::regclass, 'public.venue_social_links'::regclass])), 0,
  'none of the nine venue_id columns has a default');
select is(pg_temp.sqlstate_of($$ insert into public.courts (name, sport, default_hourly_rate) values ('E2E NoVenue', 'tennis', 100) $$), '23502',
  'courts: insert without venue_id is a not-null violation');
select is(pg_temp.sqlstate_of($$ insert into public.blackouts (starts_at, ends_at, reason) values (now(), now() + interval '1 hour', 'x') $$), '23502',
  'blackouts: insert without venue_id is a not-null violation');
select is(pg_temp.sqlstate_of($$ insert into public.open_play_sessions (title, starts_at, ends_at) values ('E2E', now(), now() + interval '1 hour') $$), '23502',
  'open_play_sessions: insert without venue_id is a not-null violation');
select is(pg_temp.sqlstate_of($$ insert into public.venue_payment_accounts (label) values ('E2E NoVenue') $$), '23502',
  'venue_payment_accounts: insert without venue_id is a not-null violation');
select is(pg_temp.sqlstate_of($$ insert into public.venue_amenities (custom_name) values ('E2E NoVenue') $$), '23502',
  'venue_amenities: insert without venue_id is a not-null violation');
select is(pg_temp.sqlstate_of($$ insert into public.venue_info_sections (title, body) values ('E2E', 'x') $$), '23502',
  'venue_info_sections: insert without venue_id is a not-null violation');
select is(pg_temp.sqlstate_of($$ insert into public.venue_social_links (platform, url) values ('instagram', 'https://example.com/e2e') $$), '23502',
  'venue_social_links: insert without venue_id is a not-null violation');
select is(pg_temp.sqlstate_of($$ insert into public.venue_settings (name) values ('E2E NoVenue') $$), '23502',
  'venue_settings: insert without venue_id is a not-null violation');
select is(pg_temp.sqlstate_of($$ insert into public.operating_hours (day_of_week, open_time, close_time) values (1, '08:00', '20:00') $$), '23502',
  'operating_hours: insert without venue_id is a not-null violation');
select has_function('private', 'default_venue_id', array[]::text[], 'private.default_venue_id() stays');
select has_function('private', 'resolve_public_venue', array['text'], 'private.resolve_public_venue(text) stays');
select is(private.resolve_public_venue('e2e-contract-a'), 'a0000000-0000-0000-0000-00000000000a'::uuid,
  'resolve_public_venue still resolves a slug');
select is(pg_temp.sqlstate_of($$ select private.resolve_public_venue(null) $$), 'P0001',
  'no slug asks which venue, whatever is active (venue_required)');

-- ---------------------------------------------------------------- no-venue time helpers gone
select is(to_regprocedure('private.venue_tz()'), null, 'venue_tz() is dropped');
select is(to_regprocedure('private.local_today()'), null, 'local_today() is dropped');
select is(to_regprocedure('private.operating_today()'), null, 'operating_today() is dropped');
select is(to_regprocedure('private.in_booking_window(date)'), null, 'in_booking_window(date) is dropped');
select is(to_regprocedure('private.local_dow_hour(timestamptz)'), null, 'local_dow_hour(timestamptz) is dropped');
select is(to_regprocedure('private.operating_day_of(timestamptz)'), null, 'operating_day_of(timestamptz) is dropped');
select is(to_regprocedure('private.operating_day_range(date)'), null, 'operating_day_range(date) is dropped');
select is((select count(*)::int from pg_proc where pronamespace = 'private'::regnamespace and proname = 'local_day_bounds'), 0,
  'no local_day_bounds overload remains');
select isnt(to_regprocedure('private.venue_tz(uuid)'), null, 'venue_tz(uuid) stays');
select isnt(to_regprocedure('private.local_today(uuid)'), null, 'local_today(uuid) stays');
select isnt(to_regprocedure('private.operating_today(uuid)'), null, 'operating_today(uuid) stays');
select isnt(to_regprocedure('private.in_booking_window(uuid,date)'), null, 'in_booking_window(uuid, date) stays');
select isnt(to_regprocedure('private.operating_day_range(uuid,date)'), null, 'operating_day_range(uuid, date) stays');
select isnt(to_regprocedure('private.operating_day_of(uuid,timestamptz)'), null, 'operating_day_of(uuid, timestamptz) stays');

-- ---------------------------------------------------------------- legacy storage policies gone
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in (
  'Admins delete payment QR codes', 'Admins delete venue media', 'Admins read payment QR codes', 'Admins read venue media',
  'Admins update venue media', 'Admins upload payment QR codes', 'Admins upload venue media')), 0,
  'the seven legacy admin storage policies are dropped');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in (
  'Venue admins read media', 'Venue admins upload media', 'Venue admins update media', 'Venue admins delete media',
  'Venue admins read payment QR', 'Venue admins upload payment QR', 'Venue admins delete payment QR')), 7,
  'the seven venue admin storage policies stay');

-- ---------------------------------------------------------------- venue-prefixed paths only
select is(pg_temp.sqlstate_of($$ insert into public.court_photos (court_id, path, sort_order)
  values ('c0000000-0000-0000-0000-0000000000a1', 'courts/c0000000-0000-0000-0000-0000000000a1/a2000000-0000-0000-0000-0000000000c1.png', 1) $$), '23514',
  'court photo: an unprefixed path is a check violation');
select is(pg_temp.sqlstate_of($$ insert into public.court_photos (court_id, path, sort_order)
  values ('c0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-00000000000b/courts/c0000000-0000-0000-0000-0000000000a1/a2000000-0000-0000-0000-0000000000c1.png', 1) $$), '23514',
  'court photo: another venue''s prefix is a check violation');
select lives_ok($$ insert into public.court_photos (court_id, path, sort_order)
  values ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a/courts/c0000000-0000-0000-0000-0000000000a1/a2000000-0000-0000-0000-0000000000c2.png', 2) $$,
  'court photo: {venue_id}/courts/{court_id}/{uuid}.png is accepted');
select is(pg_temp.sqlstate_of($$ update public.venue_settings set banner_alt = 'x', banner_path = 'banner/a2000000-0000-0000-0000-0000000000c3.webp'
  where venue_id = 'a0000000-0000-0000-0000-00000000000a' $$), '23514', 'banner: an unprefixed path is a check violation');
select lives_ok($$ update public.venue_settings set banner_alt = 'x', banner_path = 'a0000000-0000-0000-0000-00000000000a/banner/a2000000-0000-0000-0000-0000000000c3.webp'
  where venue_id = 'a0000000-0000-0000-0000-00000000000a' $$, 'banner: {venue_id}/banner/{uuid}.webp is accepted');
select is(pg_temp.sqlstate_of($$ insert into public.venue_payment_accounts (venue_id, label, qr_path)
  values ('a0000000-0000-0000-0000-00000000000a', 'E2E Bare', 'a2000000-0000-4000-8000-0000000000c4.png') $$), '23514',
  'payment QR: an unprefixed path is a check violation');
select lives_ok($$ insert into public.venue_payment_accounts (venue_id, label, qr_path)
  values ('a0000000-0000-0000-0000-00000000000a', 'E2E Prefixed', 'a0000000-0000-0000-0000-00000000000a/a2000000-0000-4000-8000-0000000000c5.png') $$,
  'payment QR: {venue_id}/{uuid}.png is accepted');

-- ---------------------------------------------------------------- Realtime topic per venue
delete from realtime.messages where topic like 'admin:bookings%';
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, source, status)
values ('b0000000-0000-0000-0000-0000000053a1', 'CB-CTRAA2', 'c0000000-0000-0000-0000-0000000000a1', 'Walk A',
  tstzrange(now() + interval '60 days', now() + interval '60 days 1 hour'), 500, 'walk_in', 'confirmed');
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, source, status)
values ('b0000000-0000-0000-0000-0000000053b1', 'CB-CTRBB3', 'c0000000-0000-0000-0000-0000000000b1', 'Walk B',
  tstzrange(now() + interval '60 days', now() + interval '60 days 1 hour'), 600, 'walk_in', 'confirmed');
-- a message on the retired topic, as the old trigger would have written it
insert into realtime.messages (topic, extension, payload, event, private)
values ('admin:bookings', 'broadcast', '{"booking_id": "x"}'::jsonb, 'booking_changed', true);

select is((select count(*)::int from realtime.messages where topic = 'admin:bookings:a0000000-0000-0000-0000-00000000000a'), 1,
  'a booking in venue A is sent on admin:bookings:<venue A>');
select is((select count(*)::int from realtime.messages where topic = 'admin:bookings:b0000000-0000-0000-0000-00000000000b'), 1,
  'a booking in venue B is sent on admin:bookings:<venue B>');
select is((select payload->>'booking_id' from realtime.messages where topic = 'admin:bookings:a0000000-0000-0000-0000-00000000000a'),
  'b0000000-0000-0000-0000-0000000053a1', 'the venue A message carries the venue A booking');
select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages'
            and policyname = 'Venue admins receive booking changes' and cmd = 'SELECT'), 1,
  'the policy "Venue admins receive booking changes" is a SELECT policy');
select is((select count(*)::int from pg_policies where schemaname = 'realtime' and tablename = 'messages'
            and policyname = 'Admins receive booking changes'), 0, 'the old "Admins receive booking changes" policy is gone');

set local role authenticated;
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.visible('admin:bookings:a0000000-0000-0000-0000-00000000000a'), 1, 'staff of A read venue A''s topic');
select is(pg_temp.visible('admin:bookings:b0000000-0000-0000-0000-00000000000b'), 0, 'staff of A cannot read venue B''s topic');
select is(pg_temp.visible('admin:bookings'), 0, 'staff of A cannot read the old admin:bookings topic');
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.visible('admin:bookings:b0000000-0000-0000-0000-00000000000b'), 1, 'staff of B read venue B''s topic');
select is(pg_temp.visible('admin:bookings:a0000000-0000-0000-0000-00000000000a'), 0, 'staff of B cannot read venue A''s topic');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.visible('admin:bookings:a0000000-0000-0000-0000-00000000000a'), 0, 'a player reads no venue topic');
select is(pg_temp.sqlstate_of($$ insert into realtime.messages (topic, extension, payload, event, private)
  values ('admin:bookings:a0000000-0000-0000-0000-00000000000a', 'broadcast', '{}'::jsonb, 'booking_changed', true) $$), '42501',
  'a signed-in user cannot write messages');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.visible('admin:bookings:a0000000-0000-0000-0000-00000000000a'), 0, 'anon reads no venue topic');
reset role;

select * from finish();
rollback;
