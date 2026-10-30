-- T12.6: RPC rewrite, the rest. The venue always comes from the row an RPC touches (court, session, booking), never from a
-- client-supplied venue id. The few RPCs that touch a whole venue (earnings, hours, reorders of lists) take an optional
-- trailing p_venue_id that only SELECTS the venue; everything is then filtered on it.
--   * private.admin_venue(p_venue default null): given id must pass is_venue_admin else forbidden; null -> the caller's only
--     venue_members venue; none -> forbidden; several -> venue_required
--   * create_open_play / update_open_play / delete_open_play, reschedule_booking, create_walk_in, delete_court,
--     reorder_court_photos, reorder_courts, private.booking_email_data (the outbox email)
--   * get_earnings, set_operating_hours, reorder_info_sections, reorder_payment_accounts (optional trailing p_venue_id;
--     the one-argument/old call shapes keep working for an admin of a single venue; each has exactly one signature)
-- Fixture: venue A (Asia/Manila, 06-22) and venue B (Pacific/Honolulu, 09-12), both active, each with its own staff;
-- a platform admin; a player; and MULTI, who is staff at both. Honolulu is UTC-10: 10:00 there is 04:00 the next day in
-- Manila, so code that reads the wrong venue's timezone or hours gives the wrong answer.
-- Existing tests of the old call shapes (13, 21, 22, 26, 29, 30, 31, 34, ...) must stay green.
begin;
create extension if not exists pgtap with schema extensions;
select plan(209);

-- ---------------------------------------------------------------- helpers
-- The HINT raised by a statement, or null when it succeeds ('sqlstate X' when it fails without a hint).
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

-- The single value of a query as text ('<null>' for null, 'ERR <hint or message>' when it raises).
create function pg_temp.val(p_sql text) returns text language plpgsql as $$
declare r text; h text;
begin
  execute p_sql into r;
  return coalesce(r, '<null>');
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || coalesce(nullif(h, ''), sqlerrm);
end $$;

-- Same two, but run as the table owner (security definer): for reading state through RLS and for the private schema.
-- request.jwt.claims still decides who auth.uid() is.
create function pg_temp.q(p_sql text) returns text language plpgsql security definer as $$
declare r text; h text;
begin
  execute p_sql into r;
  return coalesce(r, '<null>');
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return 'ERR ' || coalesce(nullif(h, ''), sqlerrm);
end $$;
create function pg_temp.qh(p_sql text) returns text language plpgsql security definer as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true)
$$;

-- State of a venue's lists. *_order is the order the app shows; the other is the raw id:position (for "untouched").
create function pg_temp.st(p_what text, p_venue uuid) returns text language plpgsql security definer as $$
declare r text;
begin
  if p_what = 'sections' then
    select string_agg(right(id::text, 4) || ':' || coalesce(sort_order::text, '-'), ',' order by id) into r
    from public.venue_info_sections where venue_id = p_venue;
  elsif p_what = 'sections_order' then
    select string_agg(title, ',' order by sort_order, id) into r from public.venue_info_sections where venue_id = p_venue;
  elsif p_what = 'accounts' then
    select string_agg(right(id::text, 4) || ':' || coalesce(position::text, '-'), ',' order by id) into r
    from public.venue_payment_accounts where venue_id = p_venue;
  elsif p_what = 'accounts_order' then
    select string_agg(label, ',' order by position, id) into r from public.venue_payment_accounts where venue_id = p_venue;
  elsif p_what = 'courts' then
    select string_agg(right(id::text, 2) || ':' || sort_order, ',' order by id) into r
    from public.courts where venue_id = p_venue and sport in ('tennis', 'badminton');
  elsif p_what = 'courts_order' then
    select string_agg(right(id::text, 2), ',' order by sort_order, id) into r
    from public.courts where venue_id = p_venue and sport = 'tennis';
  elsif p_what = 'photos' then
    select string_agg(right(id::text, 4) || ':' || sort_order, ',' order by id) into r
    from public.court_photos where venue_id = p_venue;
  elsif p_what = 'photos_order' then
    select string_agg(right(id::text, 4), ',' order by sort_order, id) into r from public.court_photos where venue_id = p_venue;
  elsif p_what = 'hours' then
    select string_agg(distinct to_char(open_time, 'HH24:MI') || '-' || to_char(close_time, 'HH24:MI'), ',') into r
    from public.operating_hours where venue_id = p_venue;
  end if;
  return coalesce(r, '<none>');
end $$;

create temp table snap (k text primary key, v text);
create function pg_temp.save(p_k text, p_what text, p_venue uuid) returns void language plpgsql security definer as $$
begin
  insert into snap values (p_k, pg_temp.st(p_what, p_venue)) on conflict (k) do update set v = excluded.v;
end $$;
create function pg_temp.same(p_k text, p_what text, p_venue uuid) returns text language plpgsql security definer as $$
declare r text := pg_temp.st(p_what, p_venue);
begin
  return case when r = (select s.v from snap s where s.k = p_k) then 'same' else 'changed: ' || r end;
end $$;

-- 7 days at the same hours
create function pg_temp.hours(p_open text, p_close text) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('day_of_week', d, 'open_time', p_open, 'close_time', p_close, 'is_closed', false) order by d)
  from generate_series(0, 6) d
$$;

-- digests of a get_earnings result
create function pg_temp.dig_tot(j jsonb) returns text language sql as $$
  select (j -> 'collected' ->> 'total')::numeric::int || '|' || (j -> 'collected' ->> 'count')
$$;
create function pg_temp.dig_hours(j jsonb) returns text language sql as $$
  select jsonb_array_length(j -> 'courts') || ' courts|open ' ||
         (select sum((c ->> 'open_hours')::numeric)::int from jsonb_array_elements(j -> 'courts') c) || '|sold ' ||
         (select sum((c ->> 'sold_hours')::numeric)::int from jsonb_array_elements(j -> 'courts') c) || '|blackout ' ||
         (select sum((c ->> 'blackout_hours')::numeric)::int from jsonb_array_elements(j -> 'courts') c) || '|open play ' ||
         (select sum((c ->> 'open_play_hours')::numeric)::int from jsonb_array_elements(j -> 'courts') c)
$$;
create function pg_temp.dig_meta(j jsonb) returns text language sql as $$
  select (j ->> 'timezone') || '|' || (j -> 'sports' -> 0 ->> 'sport') || '|' || (j -> 'courts' -> 0 ->> 'name')
$$;

-- ---------------------------------------------------------------- fixture
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player-p1@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'staff-a@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'staff-b@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'platform@test.local'),
  ('55555555-5555-5555-5555-555555555555', 'multi@test.local');

insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'e2e-vrr-a', 'active'),
  ('b0000000-0000-0000-0000-00000000000b', 'e2e-vrr-b', 'active');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', '77777777-7777-7777-7777-777777777777', 'staff'),
  ('a0000000-0000-0000-0000-00000000000a', '55555555-5555-5555-5555-555555555555', 'staff'),
  ('b0000000-0000-0000-0000-00000000000b', '55555555-5555-5555-5555-555555555555', 'staff');
insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');

insert into public.venue_settings (venue_id, name, timezone, sport_order) values
  ('a0000000-0000-0000-0000-00000000000a', 'E2E VRR A', 'Asia/Manila',
   array['tennis', 'basketball', 'pickleball', 'badminton']::public.sport[]),
  ('b0000000-0000-0000-0000-00000000000b', 'E2E VRR B', 'Pacific/Honolulu', enum_range(null::public.sport));

insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v, d, case when v = 'b0000000-0000-0000-0000-00000000000b' then time '09:00' else time '06:00' end,
             case when v = 'b0000000-0000-0000-0000-00000000000b' then time '12:00' else time '22:00' end
from unnest(array['a0000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000b']::uuid[]) v,
     generate_series(0, 6) d;

-- A1/A2/B1/B2 are tennis, A3/B3 badminton; the *4/*5 pickleball courts are inactive and only there to be deleted
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, sort_order, is_active) values
  ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'E2E VRR A1', 'tennis', 500, 0, true),
  ('c0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-00000000000a', 'E2E VRR A2', 'tennis', 500, 1, true),
  ('c0000000-0000-0000-0000-0000000000a3', 'a0000000-0000-0000-0000-00000000000a', 'E2E VRR A3', 'badminton', 500, 0, true),
  ('c0000000-0000-0000-0000-0000000000a4', 'a0000000-0000-0000-0000-00000000000a', 'E2E VRR A4', 'pickleball', 500, 0, false),
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E VRR B1', 'tennis', 600, 0, true),
  ('c0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-00000000000b', 'E2E VRR B2', 'tennis', 600, 1, true),
  ('c0000000-0000-0000-0000-0000000000b3', 'b0000000-0000-0000-0000-00000000000b', 'E2E VRR B3', 'badminton', 600, 0, true),
  ('c0000000-0000-0000-0000-0000000000b4', 'b0000000-0000-0000-0000-00000000000b', 'E2E VRR B4', 'pickleball', 600, 0, false),
  ('c0000000-0000-0000-0000-0000000000b5', 'b0000000-0000-0000-0000-00000000000b', 'E2E VRR B5', 'pickleball', 600, 1, false);

-- Instants in each venue's own clock, computed without the code under test.
create temp table fx as
with d as (select (now() at time zone 'Asia/Manila')::date as ma, (now() at time zone 'Pacific/Honolulu')::date as hn)
select ma, hn, ma + 2 as da, hn + 2 as db,
  ((ma + 2) + time '04:00') at time zone 'Asia/Manila' as ta04,
  ((ma + 2) + time '06:00') at time zone 'Asia/Manila' as ta06,
  ((ma + 2) + time '10:00') at time zone 'Asia/Manila' as ta10,
  ((ma + 2) + time '13:00') at time zone 'Asia/Manila' as ta13,
  ((ma + 2) + time '21:00') at time zone 'Asia/Manila' as ta21,
  ((ma + 2) + time '22:00') at time zone 'Asia/Manila' as ta22,
  ((ma + 6) + time '10:00') at time zone 'Asia/Manila' as ta6,
  ((hn + 2) + time '09:00') at time zone 'Pacific/Honolulu' as tb09,
  ((hn + 2) + time '10:00') at time zone 'Pacific/Honolulu' as tb10,
  ((hn + 2) + time '11:00') at time zone 'Pacific/Honolulu' as tb11,
  ((hn + 2) + time '12:00') at time zone 'Pacific/Honolulu' as tb12,
  ((hn + 2) + time '13:00') at time zone 'Pacific/Honolulu' as tb13,
  ((hn + 5) + time '10:00') at time zone 'Pacific/Honolulu' as tb5
from d;
create temp table res (label text primary key, id uuid);
create temp table b (label text primary key, id uuid, ref text);
grant select on fx to anon, authenticated, service_role;
grant select, insert on res to anon, authenticated, service_role;
grant select on b to anon, authenticated, service_role;

-- A confirmed online booking, inserted directly (the venue comes from the court)
create function pg_temp.mk(p_label text, p_court uuid, p_from timestamptz) returns void language plpgsql as $$
declare
  v_ref text := 'CB-' || translate(upper(substr(md5(p_label), 1, 6)), '01', '23');
  v_id  uuid;
begin
  insert into public.bookings (reference_code, court_id, guest_name, guest_email, during, total_amount, status, source)
  values (v_ref, p_court, 'Test ' || p_label, 'e2e-vrr@example.com', tstzrange(p_from, p_from + interval '1 hour'), 500,
          'confirmed', 'online')
  returning id into v_id;
  insert into b values (p_label, v_id, v_ref);
end $$;

-- Earnings: A has two paid bookings (500 gcash, 300 cash) on day +2 at 06:00 Manila, B one (1000 cash) at 09:00 Honolulu.
select pg_temp.mk('eA1', 'c0000000-0000-0000-0000-0000000000a1', ta06) from fx;
select pg_temp.mk('eA2', 'c0000000-0000-0000-0000-0000000000a2', ta06) from fx;
select pg_temp.mk('eB1', 'c0000000-0000-0000-0000-0000000000b1', tb09) from fx;
insert into public.payments (booking_id, method, amount, review_status, reviewed_at)
select id, 'gcash', 500, 'approved', now() from b where label = 'eA1';
insert into public.payments (booking_id, method, amount, review_status, reviewed_at)
select id, 'cash', 300, 'approved', now() from b where label = 'eA2';
insert into public.payments (booking_id, method, amount, review_status, reviewed_at)
select id, 'cash', 1000, 'approved', now() from b where label = 'eB1';
-- Blackouts: A's own 10:00-12:00 Manila (2 h x 3 courts = 6) and B's own 11:00-12:00 Honolulu (1 h x 3 = 3). The foreign
-- ones sit inside the OTHER venue's opening hours, so an earnings query that forgets the venue filter counts them:
-- B's at 12:00-13:00 Manila (inside A's hours) and A's at 09:00-10:00 Honolulu (inside B's hours).
insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
select 'a0000000-0000-0000-0000-00000000000a', null, ta10, ta10 + interval '2 hours', 'E2E A own' from fx;
insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
select 'b0000000-0000-0000-0000-00000000000b', null, tb11, tb12, 'E2E B own' from fx;
insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
select 'b0000000-0000-0000-0000-00000000000b', null, ta10 + interval '2 hours', ta10 + interval '3 hours', 'E2E B in A hours' from fx;
insert into public.blackouts (venue_id, court_id, starts_at, ends_at, reason)
select 'a0000000-0000-0000-0000-00000000000a', null, tb09, tb10, 'E2E A in B hours' from fx;
-- Open play: A1 21:00-22:00 Manila, B1 11:00-12:00 Honolulu
insert into public.open_play_sessions (id, venue_id, title, starts_at, ends_at)
select 'e1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'E2E OP fixture A', ta21, ta22 from fx;
insert into public.open_play_courts (session_id, court_id, during)
select 'e1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', tstzrange(ta21, ta22) from fx;
insert into public.open_play_sessions (id, venue_id, title, starts_at, ends_at)
select 'e1000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E OP fixture B', tb11, tb12 from fx;
insert into public.open_play_courts (session_id, court_id, during)
select 'e1000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', tstzrange(tb11, tb12) from fx;

-- Bookings to move, and two whose outbox emails are checked
select pg_temp.mk('rsA_ok', 'c0000000-0000-0000-0000-0000000000a1', ta6) from fx;
select pg_temp.mk('rsA_b',  'c0000000-0000-0000-0000-0000000000a1', ta6 + interval '2 hours') from fx;
select pg_temp.mk('rsB_ok', 'c0000000-0000-0000-0000-0000000000b1', tb5) from fx;
select pg_temp.mk('rsB_b',  'c0000000-0000-0000-0000-0000000000b1', tb5 + interval '1 hour') from fx;
select pg_temp.mk('mailA',  'c0000000-0000-0000-0000-0000000000a3', now() + interval '20 days');
select pg_temp.mk('mailB',  'c0000000-0000-0000-0000-0000000000b3', now() + interval '20 days');

-- Lists: three info sections and payment accounts for A, two for B; two photos on A1 and on B1
insert into public.venue_info_sections (id, venue_id, title) values ('d0000000-0000-0000-0000-00000000a001', 'a0000000-0000-0000-0000-00000000000a', 'Sa1');
insert into public.venue_info_sections (id, venue_id, title) values ('d0000000-0000-0000-0000-00000000a002', 'a0000000-0000-0000-0000-00000000000a', 'Sa2');
insert into public.venue_info_sections (id, venue_id, title) values ('d0000000-0000-0000-0000-00000000a003', 'a0000000-0000-0000-0000-00000000000a', 'Sa3');
insert into public.venue_info_sections (id, venue_id, title) values ('d0000000-0000-0000-0000-00000000b001', 'b0000000-0000-0000-0000-00000000000b', 'Sb1');
insert into public.venue_info_sections (id, venue_id, title) values ('d0000000-0000-0000-0000-00000000b002', 'b0000000-0000-0000-0000-00000000000b', 'Sb2');
insert into public.venue_payment_accounts (id, venue_id, label) values ('f0000000-0000-0000-0000-00000000a001', 'a0000000-0000-0000-0000-00000000000a', 'Pa1');
insert into public.venue_payment_accounts (id, venue_id, label) values ('f0000000-0000-0000-0000-00000000a002', 'a0000000-0000-0000-0000-00000000000a', 'Pa2');
insert into public.venue_payment_accounts (id, venue_id, label) values ('f0000000-0000-0000-0000-00000000a003', 'a0000000-0000-0000-0000-00000000000a', 'Pa3');
insert into public.venue_payment_accounts (id, venue_id, label) values ('f0000000-0000-0000-0000-00000000b001', 'b0000000-0000-0000-0000-00000000000b', 'Pb1');
insert into public.venue_payment_accounts (id, venue_id, label) values ('f0000000-0000-0000-0000-00000000b002', 'b0000000-0000-0000-0000-00000000000b', 'Pb2');
insert into public.court_photos (id, venue_id, court_id, path, sort_order) values
  ('e2000000-0000-0000-0000-00000000a001', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1',
   'courts/c0000000-0000-0000-0000-0000000000a1/00000000-0000-0000-0000-00000000a001.jpg', 0),
  ('e2000000-0000-0000-0000-00000000a002', 'a0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000a1',
   'courts/c0000000-0000-0000-0000-0000000000a1/00000000-0000-0000-0000-00000000a002.jpg', 1),
  ('e2000000-0000-0000-0000-00000000b001', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b1',
   'courts/c0000000-0000-0000-0000-0000000000b1/00000000-0000-0000-0000-00000000b001.jpg', 0),
  ('e2000000-0000-0000-0000-00000000b002', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b1',
   'courts/c0000000-0000-0000-0000-0000000000b1/00000000-0000-0000-0000-00000000b002.jpg', 1);

-- ---------------------------------------------------------------- shape: signatures
select has_function('private', 'admin_venue', array['uuid'], 'private.admin_venue(p_venue uuid) exists');
select has_function('public', 'get_earnings', array['date', 'date', 'uuid'], 'get_earnings(p_from, p_to, p_venue_id)');
select hasnt_function('public', 'get_earnings', array['date', 'date'], 'the two-argument get_earnings is dropped (one signature)');
select has_function('public', 'set_operating_hours', array['jsonb', 'uuid'], 'set_operating_hours(p_hours, p_venue_id)');
select hasnt_function('public', 'set_operating_hours', array['jsonb'], 'the one-argument set_operating_hours is dropped');
select has_function('public', 'reorder_info_sections', array['uuid[]', 'uuid'], 'reorder_info_sections(p_ids, p_venue_id)');
select hasnt_function('public', 'reorder_info_sections', array['uuid[]'], 'the one-argument reorder_info_sections is dropped');
select has_function('public', 'reorder_payment_accounts', array['uuid[]', 'uuid'], 'reorder_payment_accounts(p_ids, p_venue_id)');
select hasnt_function('public', 'reorder_payment_accounts', array['uuid[]'], 'the one-argument reorder_payment_accounts is dropped');
select has_function('private', 'save_open_play',
  array['uuid', 'uuid', 'uuid[]', 'timestamp with time zone', 'timestamp with time zone', 'text', 'text', 'jsonb'],
  'private.save_open_play takes the venue as its first argument');
select hasnt_function('private', 'save_open_play',
  array['uuid', 'uuid[]', 'timestamp with time zone', 'timestamp with time zone', 'text', 'text', 'jsonb'],
  'the old save_open_play without a venue is dropped');

-- ---------------------------------------------------------------- private.admin_venue
-- (security definer helpers: the private schema is not callable by clients; request.jwt.claims still sets auth.uid())
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.q($$ select private.admin_venue() $$), 'a0000000-0000-0000-0000-00000000000a',
  'admin_venue: staff A with no argument gets their only venue, A');
select is(pg_temp.q($$ select private.admin_venue('a0000000-0000-0000-0000-00000000000a') $$), 'a0000000-0000-0000-0000-00000000000a',
  'admin_venue: staff A may name A');
select is(pg_temp.qh($$ select private.admin_venue('b0000000-0000-0000-0000-00000000000b') $$), 'forbidden',
  'admin_venue: staff A naming B is forbidden');
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.q($$ select private.admin_venue() $$), 'b0000000-0000-0000-0000-00000000000b',
  'admin_venue: staff B with no argument gets B');
select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(pg_temp.qh($$ select private.admin_venue() $$), 'venue_required',
  'admin_venue: a member of two venues must name one');
select is(pg_temp.q($$ select private.admin_venue('a0000000-0000-0000-0000-00000000000a') $$), 'a0000000-0000-0000-0000-00000000000a',
  'admin_venue: that member may name A');
select is(pg_temp.q($$ select private.admin_venue('b0000000-0000-0000-0000-00000000000b') $$), 'b0000000-0000-0000-0000-00000000000b',
  'admin_venue: that member may name B');
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.qh($$ select private.admin_venue() $$), 'forbidden',
  'admin_venue: a platform admin with no memberships and no argument is forbidden');
select is(pg_temp.q($$ select private.admin_venue('a0000000-0000-0000-0000-00000000000a') $$), 'a0000000-0000-0000-0000-00000000000a',
  'admin_venue: a platform admin may name A');
select is(pg_temp.q($$ select private.admin_venue('b0000000-0000-0000-0000-00000000000b') $$), 'b0000000-0000-0000-0000-00000000000b',
  'admin_venue: a platform admin may name B');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.qh($$ select private.admin_venue() $$), 'forbidden', 'admin_venue: a player with no argument is forbidden');
select is(pg_temp.qh($$ select private.admin_venue('a0000000-0000-0000-0000-00000000000a') $$), 'forbidden',
  'admin_venue: a player naming A is forbidden');
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.qh($$ select private.admin_venue() $$), 'forbidden', 'admin_venue: anon is forbidden');

set local role authenticated;

-- ---------------------------------------------------------------- get_earnings
-- Venue A: 06-22 Manila, range = 5 days around day +2 (every payment happened now). 3 active courts x 5 days x 16 h = 240.
-- Venue B: 09-12 Honolulu, 3 courts x 5 days x 3 h = 45.
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.val($$ select pg_temp.dig_tot(public.get_earnings((select ma - 1 from fx), (select ma + 3 from fx))) $$), '800|2',
  'earnings: staff A (old call shape) sees only A''s payments: 500 + 300, 2 of them (B''s 1000 is not counted)');
select is(pg_temp.val($$ select pg_temp.dig_hours(public.get_earnings((select ma - 1 from fx), (select ma + 3 from fx))) $$),
  '3 courts|open 240|sold 2|blackout 6|open play 1',
  'earnings: A''s courts, hours, bookings, blackouts and open play are A''s alone (B''s blackout inside A''s hours is not counted)');
select is(pg_temp.val($$ select pg_temp.dig_meta(public.get_earnings((select ma - 1 from fx), (select ma + 3 from fx))) $$),
  'Asia/Manila|tennis|E2E VRR A1', 'earnings: A''s timezone and A''s own sport_order (tennis first)');
select is(pg_temp.val($$ select pg_temp.dig_tot(public.get_earnings(p_from => (select ma - 1 from fx), p_to => (select ma + 3 from fx),
  p_venue_id => 'a0000000-0000-0000-0000-00000000000a')) $$), '800|2', 'earnings: staff A may name A');
select is(pg_temp.val($$ select public.get_earnings(p_from => (select hn - 1 from fx), p_to => (select hn + 3 from fx),
  p_venue_id => 'b0000000-0000-0000-0000-00000000000b')::text $$), 'ERR forbidden', 'earnings: staff A naming B is forbidden');
select is(pg_temp.hint_of($$ select public.get_earnings((select ma + 3 from fx), (select ma - 1 from fx)) $$), 'invalid_input',
  'earnings: a reversed range is still invalid_input');

select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.val($$ select pg_temp.dig_tot(public.get_earnings((select hn - 1 from fx), (select hn + 3 from fx))) $$), '1000|1',
  'earnings: staff B (old call shape) sees only B''s payment: 1000');
select is(pg_temp.val($$ select pg_temp.dig_hours(public.get_earnings((select hn - 1 from fx), (select hn + 3 from fx))) $$),
  '3 courts|open 45|sold 1|blackout 3|open play 1',
  'earnings: B''s hours are 09-12 Honolulu and A''s blackout inside them is not counted');
select is(pg_temp.val($$ select pg_temp.dig_meta(public.get_earnings((select hn - 1 from fx), (select hn + 3 from fx))) $$),
  'Pacific/Honolulu|badminton|E2E VRR B3', 'earnings: B''s timezone and B''s sport_order (badminton first)');
select is(pg_temp.val($$ select public.get_earnings((select ma - 1 from fx), (select ma + 3 from fx), 'a0000000-0000-0000-0000-00000000000a')::text $$),
  'ERR forbidden', 'earnings: staff B naming A (positional p_venue_id) is forbidden');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.get_earnings((select ma - 1 from fx), (select ma + 3 from fx)) $$), 'forbidden',
  'earnings: a player is forbidden');
select throws_ok($$ select public.get_earnings((select ma - 1 from fx), (select ma + 3 from fx)) $$, 'P0001', null,
  'earnings: the refusal is P0001');

select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(pg_temp.hint_of($$ select public.get_earnings((select ma - 1 from fx), (select ma + 3 from fx)) $$), 'venue_required',
  'earnings: a member of two venues must name one');
select is(pg_temp.val($$ select pg_temp.dig_tot(public.get_earnings((select ma - 1 from fx), (select ma + 3 from fx),
  'a0000000-0000-0000-0000-00000000000a')) $$), '800|2', 'earnings: that member names A: A''s totals');
select is(pg_temp.val($$ select pg_temp.dig_tot(public.get_earnings((select hn - 1 from fx), (select hn + 3 from fx),
  'b0000000-0000-0000-0000-00000000000b')) $$), '1000|1', 'earnings: that member names B: B''s totals');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ select public.get_earnings((select ma - 1 from fx), (select ma + 3 from fx)) $$), 'forbidden',
  'earnings: a platform admin with no venue and no membership is forbidden');
select is(pg_temp.val($$ select pg_temp.dig_tot(public.get_earnings((select ma - 1 from fx), (select ma + 3 from fx),
  'a0000000-0000-0000-0000-00000000000a')) $$), '800|2', 'earnings: a platform admin names A');
select is(pg_temp.val($$ select pg_temp.dig_hours(public.get_earnings((select hn - 1 from fx), (select hn + 3 from fx),
  'b0000000-0000-0000-0000-00000000000b')) $$), '3 courts|open 45|sold 1|blackout 3|open play 1',
  'earnings: a platform admin names B');

-- ---------------------------------------------------------------- open play
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.hint_of($$ insert into res select 'opA', public.create_open_play(
    array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a2']::uuid[], ta13, ta13 + interval '1 hour', 'E2E OP A')
  from fx $$), null, 'open play: staff A creates a session on A''s two courts');
select is(pg_temp.q($$ select s.venue_id::text || '/' || (select count(*) from public.open_play_courts oc
    where oc.session_id = s.id and oc.venue_id = s.venue_id) from public.open_play_sessions s where s.id = (select id from res where label = 'opA') $$),
  'a0000000-0000-0000-0000-00000000000a/2', 'open play: the session and both open_play_courts rows carry venue A');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000a1']::uuid[],
    ta04, ta04 + interval '1 hour', 'E2E too early') from fx $$), 'outside_hours',
  'open play: A''s hours apply, 04:00 Manila is before A''s opening (early morning)');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000b1']::uuid[],
    tb10, tb10 + interval '1 hour', 'E2E not mine') from fx $$), 'forbidden', 'open play: staff A cannot create on B''s court');

select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ insert into res select 'opB', public.create_open_play(array['c0000000-0000-0000-0000-0000000000b2']::uuid[],
    tb10, tb10 + interval '1 hour', 'E2E OP B') from fx $$), null,
  'open play: staff B creates a session at 10:00 Honolulu (04:00 Manila would be closed)');
select is(pg_temp.q($$ select s.venue_id::text || '/' || (select count(*) from public.open_play_courts oc
    where oc.session_id = s.id and oc.venue_id = s.venue_id) from public.open_play_sessions s where s.id = (select id from res where label = 'opB') $$),
  'b0000000-0000-0000-0000-00000000000b/1', 'open play: B''s session and its court row carry venue B');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000b2']::uuid[],
    tb13, tb13 + interval '1 hour', 'E2E too late') from fx $$), 'outside_hours',
  'open play: B''s hours apply, 13:00 Honolulu is after B''s closing (07:00 Manila would be open)');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000a1']::uuid[],
    ta13 + interval '2 hours', ta13 + interval '3 hours', 'E2E not mine') from fx $$), 'forbidden',
  'open play: staff B cannot create on A''s court');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000a1']::uuid[],
    ta13 + interval '2 hours', ta13 + interval '3 hours', 'E2E player') from fx $$), 'forbidden', 'open play: a player cannot create');

select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(pg_temp.hint_of($$ select public.create_open_play(array['c0000000-0000-0000-0000-0000000000a3', 'c0000000-0000-0000-0000-0000000000b3']::uuid[],
    ta13, ta13 + interval '1 hour', 'E2E two venues') from fx $$), 'invalid_input',
  'open play: court ids from two venues are invalid_input, even for an admin of both');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ insert into res select 'opP', public.create_open_play(array['c0000000-0000-0000-0000-0000000000b1']::uuid[],
    tb10, tb10 + interval '1 hour', 'E2E OP P') from fx $$), null, 'open play: a platform admin creates on B''s court');
select is(pg_temp.q($$ select venue_id::text from public.open_play_sessions where id = (select id from res where label = 'opP') $$),
  'b0000000-0000-0000-0000-00000000000b', 'open play: that session carries venue B');

-- update
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.update_open_play((select id from res where label = 'opA'),
    array['c0000000-0000-0000-0000-0000000000a1']::uuid[], ta13, ta13 + interval '1 hour', 'E2E hijack') from fx $$), 'forbidden',
  'update open play: staff B cannot edit A''s session');
select is(pg_temp.q($$ select title from public.open_play_sessions where id = (select id from res where label = 'opA') $$), 'E2E OP A',
  'update open play: A''s session is unchanged after the refusal');
select is(pg_temp.hint_of($$ select public.update_open_play((select id from res where label = 'opB'),
    array['c0000000-0000-0000-0000-0000000000b2']::uuid[], tb10, tb10 + interval '1 hour', 'E2E OP B2') from fx $$), null,
  'update open play: staff B edits B''s session');
select is(pg_temp.q($$ select title from public.open_play_sessions where id = (select id from res where label = 'opB') $$), 'E2E OP B2',
  'update open play: B''s new title is saved');

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.hint_of($$ select public.update_open_play((select id from res where label = 'opB'),
    array['c0000000-0000-0000-0000-0000000000b2']::uuid[], tb10, tb10 + interval '1 hour', 'E2E hijack') from fx $$), 'forbidden',
  'update open play: staff A cannot edit B''s session');
select is(pg_temp.q($$ select title from public.open_play_sessions where id = (select id from res where label = 'opB') $$), 'E2E OP B2',
  'update open play: B''s session is unchanged after the refusal');
select is(pg_temp.hint_of($$ select public.update_open_play((select id from res where label = 'opA'),
    array['c0000000-0000-0000-0000-0000000000a1']::uuid[], ta13 + interval '1 hour', ta13 + interval '2 hours', 'E2E OP A2') from fx $$), null,
  'update open play: staff A edits A''s session (one court, a later hour)');
select is(pg_temp.q($$ select s.title || '/' || s.venue_id::text || '/' || (select count(*) from public.open_play_courts oc
    where oc.session_id = s.id and oc.venue_id = s.venue_id) from public.open_play_sessions s where s.id = (select id from res where label = 'opA') $$),
  'E2E OP A2/a0000000-0000-0000-0000-00000000000a/1', 'update open play: A''s title, venue and single court row are saved');

select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(pg_temp.hint_of($$ select public.update_open_play((select id from res where label = 'opB'),
    array['c0000000-0000-0000-0000-0000000000a3']::uuid[], tb10, tb10 + interval '1 hour', 'E2E moved venues') from fx $$), 'invalid_input',
  'update open play: a session cannot be moved onto another venue''s court');
select is(pg_temp.q($$ select s.title || '/' || (select string_agg(right(oc.court_id::text, 2), ',') from public.open_play_courts oc
    where oc.session_id = s.id) from public.open_play_sessions s where s.id = (select id from res where label = 'opB') $$),
  'E2E OP B2/b2', 'update open play: B''s session still has its title and its B2 court after the refusal');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.update_open_play((select id from res where label = 'opA'),
    array['c0000000-0000-0000-0000-0000000000a1']::uuid[], ta13, ta13 + interval '1 hour', 'E2E player') from fx $$), 'forbidden',
  'update open play: a player cannot edit');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ select public.update_open_play((select id from res where label = 'opP'),
    array['c0000000-0000-0000-0000-0000000000b1']::uuid[], tb10, tb10 + interval '1 hour', 'E2E OP P2') from fx $$), null,
  'update open play: a platform admin edits B''s session');

-- delete
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.delete_open_play((select id from res where label = 'opA')) $$), 'forbidden',
  'delete open play: staff B cannot delete A''s session');
select is(pg_temp.q($$ select count(*) from public.open_play_sessions where id = (select id from res where label = 'opA') $$), '1',
  'delete open play: A''s session is still there');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.delete_open_play((select id from res where label = 'opA')) $$), 'forbidden',
  'delete open play: a player cannot delete');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.hint_of($$ select public.delete_open_play((select id from res where label = 'opB')) $$), 'forbidden',
  'delete open play: staff A cannot delete B''s session');
select is(pg_temp.q($$ select count(*) from public.open_play_sessions where id = (select id from res where label = 'opB') $$), '1',
  'delete open play: B''s session is still there');
select is(pg_temp.hint_of($$ select public.delete_open_play((select id from res where label = 'opA')) $$), null,
  'delete open play: staff A deletes A''s session');
select is(pg_temp.q($$ select (select count(*) from public.open_play_sessions where id = (select id from res where label = 'opA'))
  || '/' || (select count(*) from public.open_play_courts where session_id = (select id from res where label = 'opA')) $$), '0/0',
  'delete open play: the session and its court rows are gone');
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.delete_open_play((select id from res where label = 'opB')) $$), null,
  'delete open play: staff B deletes B''s session');
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ select public.delete_open_play((select id from res where label = 'opP')) $$), null,
  'delete open play: a platform admin deletes B''s other session');

-- ---------------------------------------------------------------- reschedule_booking
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.reschedule_booking((select id from b where label = 'rsA_ok'), ta6,
    'c0000000-0000-0000-0000-0000000000a2', ta6, 'E2E move') from fx $$), 'forbidden', 'reschedule: staff B cannot move a venue A booking');
select is(pg_temp.q($$ select right(court_id::text, 2) from public.bookings where id = (select id from b where label = 'rsA_ok') $$), 'a1',
  'reschedule: the venue A booking stayed on A1');
select is(pg_temp.hint_of($$ select public.reschedule_booking((select id from b where label = 'rsB_b'), tb5 + interval '1 hour',
    'c0000000-0000-0000-0000-0000000000b2', tb5 + interval '3 hours', 'E2E move') from fx $$), 'outside_hours',
  'reschedule: B''s hours apply, 13:00 Honolulu is after B''s closing (07:00 Manila would be open)');
select is(pg_temp.hint_of($$ select public.reschedule_booking((select id from b where label = 'rsB_ok'), tb5,
    'c0000000-0000-0000-0000-0000000000b2', tb5, 'E2E move') from fx $$), null,
  'reschedule: staff B moves a venue B booking to B2 at 10:00 Honolulu');
select is(pg_temp.q($$ select right(court_id::text, 2) from public.bookings where id = (select id from b where label = 'rsB_ok') $$), 'b2',
  'reschedule: the venue B booking is on B2');

select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.hint_of($$ select public.reschedule_booking((select id from b where label = 'rsB_b'), tb5 + interval '1 hour',
    'c0000000-0000-0000-0000-0000000000b2', tb5 + interval '1 hour', 'E2E move') from fx $$), 'forbidden',
  'reschedule: staff A cannot move a venue B booking');
select is(pg_temp.q($$ select right(court_id::text, 2) from public.bookings where id = (select id from b where label = 'rsB_b') $$), 'b1',
  'reschedule: the venue B booking stayed on B1');
select is(pg_temp.hint_of($$ select public.reschedule_booking((select id from b where label = 'rsA_ok'), ta6,
    'c0000000-0000-0000-0000-0000000000a2', ta6, 'E2E move') from fx $$), null, 'reschedule: staff A moves a venue A booking to A2');
select is(pg_temp.q($$ select right(court_id::text, 2) from public.bookings where id = (select id from b where label = 'rsA_ok') $$), 'a2',
  'reschedule: the venue A booking is on A2');
select is(pg_temp.hint_of($$ select public.reschedule_booking((select id from b where label = 'rsA_b'), ta6 + interval '2 hours',
    'c0000000-0000-0000-0000-0000000000b1', ta6 + interval '2 hours', 'E2E move') from fx $$), 'invalid_input',
  'reschedule: moving a venue A booking onto a venue B court is invalid_input');
select is(pg_temp.q($$ select right(court_id::text, 2) from public.bookings where id = (select id from b where label = 'rsA_b') $$), 'a1',
  'reschedule: the booking did not move');

select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(pg_temp.hint_of($$ select public.reschedule_booking((select id from b where label = 'rsA_b'), ta6 + interval '2 hours',
    'c0000000-0000-0000-0000-0000000000b1', ta6 + interval '2 hours', 'E2E move') from fx $$), 'invalid_input',
  'reschedule: an admin of both venues still cannot move a booking across venues');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.reschedule_booking((select id from b where label = 'rsA_b'), ta6 + interval '2 hours',
    'c0000000-0000-0000-0000-0000000000a2', ta6 + interval '2 hours', 'E2E move') from fx $$), 'forbidden', 'reschedule: a player is forbidden');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ select public.reschedule_booking((select id from b where label = 'rsA_b'), ta6 + interval '2 hours',
    'c0000000-0000-0000-0000-0000000000b1', ta6 + interval '2 hours', 'E2E move') from fx $$), 'invalid_input',
  'reschedule: a platform admin cannot move a booking across venues either');
select is(pg_temp.hint_of($$ select public.reschedule_booking((select id from b where label = 'rsA_b'), ta6 + interval '2 hours',
    'c0000000-0000-0000-0000-0000000000a2', ta6 + interval '2 hours', 'E2E move') from fx $$), null,
  'reschedule: a platform admin moves a venue A booking within A');

-- ---------------------------------------------------------------- create_walk_in
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.hint_of($$ insert into res select 'wA', r.id from fx, public.create_walk_in(
    'c0000000-0000-0000-0000-0000000000a3', ta21, 1, 'E2E Walk A') r $$), null, 'walk-in: staff A records a walk-in on A3 at 21:00 Manila');
select is(pg_temp.q($$ select venue_id::text || '/' || total_amount::int from public.bookings where id = (select id from res where label = 'wA') $$),
  'a0000000-0000-0000-0000-00000000000a/500', 'walk-in: the booking carries venue A and A3''s price');
select is(pg_temp.hint_of($$ select * from fx, public.create_walk_in('c0000000-0000-0000-0000-0000000000b3', tb09, 1, 'E2E Walk X') $$),
  'forbidden', 'walk-in: staff A cannot record a walk-in on B''s court');
select is(pg_temp.hint_of($$ select * from fx, public.create_walk_in('c0000000-0000-0000-0000-0000000000a3', ta04, 1, 'E2E Walk X') $$),
  'outside_hours', 'walk-in: A is closed at 04:00 Manila (early morning)');
select is(pg_temp.hint_of($$ select * from fx, public.create_walk_in('c0000000-0000-0000-0000-0000000000a3', ta22, 1, 'E2E Walk X') $$),
  'outside_hours', 'walk-in: A is closed from 22:00 Manila (late night)');

select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ insert into res select 'wB', r.id from fx, public.create_walk_in(
    'c0000000-0000-0000-0000-0000000000b3', tb10, 1, 'E2E Walk B') r $$), null,
  'walk-in: staff B records a walk-in at 10:00 Honolulu (no per-venue refusal; 04:00 Manila would be closed)');
select is(pg_temp.q($$ select venue_id::text || '/' || total_amount::int from public.bookings where id = (select id from res where label = 'wB') $$),
  'b0000000-0000-0000-0000-00000000000b/600', 'walk-in: the booking carries venue B and B3''s price');
select is(pg_temp.q($$ select p.venue_id::text || '/' || p.amount::int from public.payments p where p.booking_id = (select id from res where label = 'wB') $$),
  'b0000000-0000-0000-0000-00000000000b/600', 'walk-in: its payment carries venue B and B3''s price');
select is(pg_temp.hint_of($$ select * from fx, public.create_walk_in('c0000000-0000-0000-0000-0000000000b3', tb12, 1, 'E2E Walk X') $$),
  'outside_hours', 'walk-in: B is closed from 12:00 Honolulu');
select is(pg_temp.hint_of($$ select * from fx, public.create_walk_in('c0000000-0000-0000-0000-0000000000b3', tb13, 1, 'E2E Walk X') $$),
  'outside_hours', 'walk-in: B is closed at 13:00 Honolulu (07:00 Manila would be open)');
select is(pg_temp.hint_of($$ select * from fx, public.create_walk_in('c0000000-0000-0000-0000-0000000000a3', ta13, 1, 'E2E Walk X') $$),
  'forbidden', 'walk-in: staff B cannot record a walk-in on A''s court');

select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select * from fx, public.create_walk_in('c0000000-0000-0000-0000-0000000000a3', ta13, 1, 'E2E Walk X') $$),
  'forbidden', 'walk-in: a player is forbidden');

select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(pg_temp.hint_of($$ insert into res select 'wM', r.id from fx, public.create_walk_in(
    'c0000000-0000-0000-0000-0000000000b3', tb09, 1, 'E2E Walk M') r $$), null,
  'walk-in: an admin of both venues records one on B3 (the court names the venue; A''s blackout at that instant does not apply)');
select is(pg_temp.q($$ select venue_id::text from public.bookings where id = (select id from res where label = 'wM') $$),
  'b0000000-0000-0000-0000-00000000000b', 'walk-in: that booking carries venue B');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ insert into res select 'wP', r.id from fx, public.create_walk_in(
    'c0000000-0000-0000-0000-0000000000a2', ta21, 1, 'E2E Walk P') r $$), null, 'walk-in: a platform admin records one on A2');
select is(pg_temp.q($$ select venue_id::text from public.bookings where id = (select id from res where label = 'wP') $$),
  'a0000000-0000-0000-0000-00000000000a', 'walk-in: that booking carries venue A');

-- ---------------------------------------------------------------- outbox email data
select is(pg_temp.q($$ select data ->> 'venue_name' || '/' || (data ->> 'timezone') || '/' || venue_id::text from public.email_outbox
    where booking_id = (select id from b where label = 'mailA') and kind = 'booking_created' $$),
  'E2E VRR A/Asia/Manila/a0000000-0000-0000-0000-00000000000a', 'outbox: a venue A booking''s email names venue A and its timezone');
select is(pg_temp.q($$ select data ->> 'venue_name' || '/' || (data ->> 'timezone') || '/' || venue_id::text from public.email_outbox
    where booking_id = (select id from b where label = 'mailB') and kind = 'booking_created' $$),
  'E2E VRR B/Pacific/Honolulu/b0000000-0000-0000-0000-00000000000b', 'outbox: a venue B booking''s email names venue B and its timezone');
select is(pg_temp.q($$ select private.booking_email_data(bk) ->> 'venue_name' from public.bookings bk where bk.id = (select id from b where label = 'mailA') $$),
  'E2E VRR A', 'booking_email_data: venue name from the booking''s venue (A)');
select is(pg_temp.q($$ select private.booking_email_data(bk) ->> 'timezone' from public.bookings bk where bk.id = (select id from b where label = 'mailB') $$),
  'Pacific/Honolulu', 'booking_email_data: timezone from the booking''s venue (B)');

-- ---------------------------------------------------------------- delete_court
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.delete_court('c0000000-0000-0000-0000-0000000000a4') $$), 'forbidden',
  'delete court: staff B cannot delete A''s court');
select is(pg_temp.q($$ select count(*) from public.courts where id = 'c0000000-0000-0000-0000-0000000000a4' $$), '1', 'delete court: A''s court is still there');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.delete_court('c0000000-0000-0000-0000-0000000000a4') $$), 'forbidden', 'delete court: a player cannot delete');
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.hint_of($$ select public.delete_court('c0000000-0000-0000-0000-0000000000b4') $$), 'forbidden',
  'delete court: staff A cannot delete B''s court');
select is(pg_temp.q($$ select count(*) from public.courts where id = 'c0000000-0000-0000-0000-0000000000b4' $$), '1', 'delete court: B''s court is still there');
select is(pg_temp.hint_of($$ select public.delete_court('c0000000-0000-0000-0000-0000000000a1') $$), 'court_has_bookings',
  'delete court: a booked court is still refused for its own staff');
select is(pg_temp.hint_of($$ select public.delete_court('c0000000-0000-0000-0000-0000000000a4') $$), null, 'delete court: staff A deletes A''s court');
select is(pg_temp.q($$ select count(*) from public.courts where id = 'c0000000-0000-0000-0000-0000000000a4' $$), '0', 'delete court: A''s court is gone');
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.delete_court('c0000000-0000-0000-0000-0000000000b4') $$), null, 'delete court: staff B deletes B''s court');
select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ select public.delete_court('c0000000-0000-0000-0000-0000000000b5') $$), null, 'delete court: a platform admin deletes B''s other court');

-- ---------------------------------------------------------------- reorder_court_photos
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.save('ph_b', 'photos', 'b0000000-0000-0000-0000-00000000000b');
select is(pg_temp.hint_of($$ select public.reorder_court_photos('c0000000-0000-0000-0000-0000000000b1',
    array['e2000000-0000-0000-0000-00000000b002', 'e2000000-0000-0000-0000-00000000b001']::uuid[]) $$), 'forbidden',
  'photos: staff A cannot reorder B''s court photos');
select is(pg_temp.same('ph_b', 'photos', 'b0000000-0000-0000-0000-00000000000b'), 'same', 'photos: B''s photos are untouched');
select is(pg_temp.hint_of($$ select public.reorder_court_photos('c0000000-0000-0000-0000-0000000000a1',
    array['e2000000-0000-0000-0000-00000000b001', 'e2000000-0000-0000-0000-00000000b002']::uuid[]) $$), 'invalid_input',
  'photos: another venue''s photo ids are an out-of-date list');
select is(pg_temp.hint_of($$ select public.reorder_court_photos('c0000000-0000-0000-0000-0000000000a1',
    array['e2000000-0000-0000-0000-00000000a002', 'e2000000-0000-0000-0000-00000000a001']::uuid[]) $$), null,
  'photos: staff A reorders A''s court photos');
select is(pg_temp.st('photos_order', 'a0000000-0000-0000-0000-00000000000a'), 'a002,a001', 'photos: A''s photos are in the new order');
select is(pg_temp.same('ph_b', 'photos', 'b0000000-0000-0000-0000-00000000000b'), 'same', 'photos: B''s photos are still untouched');
select pg_temp.save('ph_a', 'photos', 'a0000000-0000-0000-0000-00000000000a');
select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.reorder_court_photos('c0000000-0000-0000-0000-0000000000a1',
    array['e2000000-0000-0000-0000-00000000a001', 'e2000000-0000-0000-0000-00000000a002']::uuid[]) $$), 'forbidden',
  'photos: staff B cannot reorder A''s court photos');
select is(pg_temp.same('ph_a', 'photos', 'a0000000-0000-0000-0000-00000000000a'), 'same', 'photos: A''s photos are untouched by staff B');
select is(pg_temp.hint_of($$ select public.reorder_court_photos('c0000000-0000-0000-0000-0000000000b1',
    array['e2000000-0000-0000-0000-00000000b002', 'e2000000-0000-0000-0000-00000000b001']::uuid[]) $$), null,
  'photos: staff B reorders B''s court photos');
select is(pg_temp.st('photos_order', 'b0000000-0000-0000-0000-00000000000b'), 'b002,b001', 'photos: B''s photos are in the new order');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.reorder_court_photos('c0000000-0000-0000-0000-0000000000a1',
    array['e2000000-0000-0000-0000-00000000a001', 'e2000000-0000-0000-0000-00000000a002']::uuid[]) $$), 'forbidden', 'photos: a player cannot reorder');

-- ---------------------------------------------------------------- reorder_courts
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.save('co_a', 'courts', 'a0000000-0000-0000-0000-00000000000a');
select pg_temp.save('co_b', 'courts', 'b0000000-0000-0000-0000-00000000000b');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis',
    array['c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000a1']::uuid[]) $$), null, 'courts: staff A reorders A''s tennis courts');
select is(pg_temp.st('courts_order', 'a0000000-0000-0000-0000-00000000000a'), 'a2,a1', 'courts: A''s tennis courts are in the new order');
select is(pg_temp.same('co_b', 'courts', 'b0000000-0000-0000-0000-00000000000b'), 'same', 'courts: B''s sort_order is untouched');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis',
    array['c0000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-0000000000b1']::uuid[]) $$), 'forbidden',
  'courts: staff A cannot reorder B''s courts');
select is(pg_temp.same('co_b', 'courts', 'b0000000-0000-0000-0000-00000000000b'), 'same', 'courts: B''s sort_order is still untouched');
select pg_temp.save('co_a', 'courts', 'a0000000-0000-0000-0000-00000000000a');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis',
    array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000b1']::uuid[]) $$), 'invalid_input',
  'courts: a list that mixes in another venue''s court is out of date');
select is(pg_temp.same('co_a', 'courts', 'a0000000-0000-0000-0000-00000000000a') || '/' || pg_temp.same('co_b', 'courts', 'b0000000-0000-0000-0000-00000000000b'),
  'same/same', 'courts: neither venue changed');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis', array[]::uuid[]) $$), 'invalid_input',
  'courts: an empty list for a single-venue admin is compared with their own venue and is out of date');
select is(pg_temp.hint_of($$ select public.reorder_courts('badminton', array['c0000000-0000-0000-0000-0000000000a1']::uuid[]) $$), 'invalid_input',
  'courts: a court of another sport is out of date');
select is(pg_temp.same('co_a', 'courts', 'a0000000-0000-0000-0000-00000000000a'), 'same', 'courts: A is unchanged after the refusals');

select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis',
    array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a2']::uuid[]) $$), 'forbidden',
  'courts: staff B cannot reorder A''s courts');
select is(pg_temp.same('co_a', 'courts', 'a0000000-0000-0000-0000-00000000000a'), 'same', 'courts: A''s sort_order is untouched by staff B');

select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis', array[]::uuid[]) $$), 'venue_required',
  'courts: an empty list from a member of two venues has no venue to name');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis',
    array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000b1']::uuid[]) $$), 'invalid_input',
  'courts: an admin of both still cannot reorder across venues (the first id picks A, B1 is not in A''s list)');
select is(pg_temp.same('co_a', 'courts', 'a0000000-0000-0000-0000-00000000000a') || '/' || pg_temp.same('co_b', 'courts', 'b0000000-0000-0000-0000-00000000000b'),
  'same/same', 'courts: neither venue changed after the mixed list');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis',
    array['c0000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-0000000000b1']::uuid[]) $$), null,
  'courts: that member reorders B''s courts (the venue comes from the first court)');
select is(pg_temp.st('courts_order', 'b0000000-0000-0000-0000-00000000000b'), 'b2,b1', 'courts: B''s tennis courts are in the new order');
select is(pg_temp.same('co_a', 'courts', 'a0000000-0000-0000-0000-00000000000a'), 'same', 'courts: A''s sort_order is untouched by B''s reorder');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis',
    array['c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a2']::uuid[]) $$), null,
  'courts: a platform admin reorders A''s courts');
select is(pg_temp.st('courts_order', 'a0000000-0000-0000-0000-00000000000a'), 'a1,a2', 'courts: A''s tennis courts are in the platform admin''s order');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.reorder_courts('tennis',
    array['c0000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000a1']::uuid[]) $$), 'forbidden', 'courts: a player cannot reorder');

-- ---------------------------------------------------------------- reorder_info_sections
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.save('se_b', 'sections', 'b0000000-0000-0000-0000-00000000000b');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(array['d0000000-0000-0000-0000-00000000a003', 'd0000000-0000-0000-0000-00000000a002',
    'd0000000-0000-0000-0000-00000000a001']::uuid[]) $$), null, 'sections: staff A reorders A''s sections with the old call shape');
select is(pg_temp.st('sections_order', 'a0000000-0000-0000-0000-00000000000a'), 'Sa3,Sa2,Sa1', 'sections: A''s sections are in the new order');
select is(pg_temp.same('se_b', 'sections', 'b0000000-0000-0000-0000-00000000000b'), 'same', 'sections: B''s sections are untouched');
select pg_temp.save('se_a', 'sections', 'a0000000-0000-0000-0000-00000000000a');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(p_ids => array['d0000000-0000-0000-0000-00000000b002', 'd0000000-0000-0000-0000-00000000b001']::uuid[],
    p_venue_id => 'b0000000-0000-0000-0000-00000000000b') $$), 'forbidden', 'sections: staff A naming B is forbidden');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(array['d0000000-0000-0000-0000-00000000b002', 'd0000000-0000-0000-0000-00000000b001']::uuid[]) $$),
  'invalid_input', 'sections: staff A sending B''s ids gets an out-of-date list (the id only selects; A''s rows are compared)');
select is(pg_temp.same('se_b', 'sections', 'b0000000-0000-0000-0000-00000000000b'), 'same', 'sections: B''s sections are still untouched');
select is(pg_temp.same('se_a', 'sections', 'a0000000-0000-0000-0000-00000000000a'), 'same', 'sections: A''s sections are untouched by the refusals');

select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(array['d0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-00000000a002',
    'd0000000-0000-0000-0000-00000000a003']::uuid[]) $$), 'invalid_input', 'sections: staff B sending A''s ids gets an out-of-date list');
select is(pg_temp.same('se_a', 'sections', 'a0000000-0000-0000-0000-00000000000a'), 'same', 'sections: A''s sections are untouched by staff B');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(p_ids => array['d0000000-0000-0000-0000-00000000a001']::uuid[],
    p_venue_id => 'a0000000-0000-0000-0000-00000000000a') $$), 'forbidden', 'sections: staff B naming A is forbidden');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(array['d0000000-0000-0000-0000-00000000b002', 'd0000000-0000-0000-0000-00000000b001']::uuid[]) $$),
  null, 'sections: staff B reorders B''s sections');
select is(pg_temp.st('sections_order', 'b0000000-0000-0000-0000-00000000000b'), 'Sb2,Sb1', 'sections: B''s sections are in the new order');
select is(pg_temp.same('se_a', 'sections', 'a0000000-0000-0000-0000-00000000000a'), 'same', 'sections: A''s sections are still untouched');

select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(array['d0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-00000000a002',
    'd0000000-0000-0000-0000-00000000a003']::uuid[]) $$), 'venue_required', 'sections: a member of two venues must name one');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(array['d0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-00000000a002',
    'd0000000-0000-0000-0000-00000000a003']::uuid[], 'a0000000-0000-0000-0000-00000000000a') $$), null,
  'sections: that member names A (positional p_venue_id)');
select is(pg_temp.st('sections_order', 'a0000000-0000-0000-0000-00000000000a'), 'Sa1,Sa2,Sa3', 'sections: A''s sections are back in their first order');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(array['d0000000-0000-0000-0000-00000000b001', 'd0000000-0000-0000-0000-00000000b002']::uuid[]) $$),
  'forbidden', 'sections: a platform admin with no venue and no membership is forbidden');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(p_ids => array['d0000000-0000-0000-0000-00000000b001', 'd0000000-0000-0000-0000-00000000b002']::uuid[],
    p_venue_id => 'b0000000-0000-0000-0000-00000000000b') $$), null, 'sections: a platform admin names B');
select is(pg_temp.st('sections_order', 'b0000000-0000-0000-0000-00000000000b'), 'Sb1,Sb2', 'sections: B''s sections are in the platform admin''s order');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.reorder_info_sections(array['d0000000-0000-0000-0000-00000000a001', 'd0000000-0000-0000-0000-00000000a002',
    'd0000000-0000-0000-0000-00000000a003']::uuid[]) $$), 'forbidden', 'sections: a player is forbidden');

-- ---------------------------------------------------------------- reorder_payment_accounts
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select pg_temp.save('ac_b', 'accounts', 'b0000000-0000-0000-0000-00000000000b');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(array['f0000000-0000-0000-0000-00000000a003', 'f0000000-0000-0000-0000-00000000a002',
    'f0000000-0000-0000-0000-00000000a001']::uuid[]) $$), null, 'accounts: staff A reorders A''s accounts with the old call shape');
select is(pg_temp.st('accounts_order', 'a0000000-0000-0000-0000-00000000000a'), 'Pa3,Pa2,Pa1', 'accounts: A''s accounts are in the new order');
select is(pg_temp.same('ac_b', 'accounts', 'b0000000-0000-0000-0000-00000000000b'), 'same', 'accounts: B''s accounts are untouched');
select pg_temp.save('ac_a', 'accounts', 'a0000000-0000-0000-0000-00000000000a');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(array['f0000000-0000-0000-0000-00000000b002', 'f0000000-0000-0000-0000-00000000b001']::uuid[],
    'b0000000-0000-0000-0000-00000000000b') $$), 'forbidden', 'accounts: staff A naming B (positional p_venue_id) is forbidden');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(array['f0000000-0000-0000-0000-00000000b002', 'f0000000-0000-0000-0000-00000000b001']::uuid[]) $$),
  'invalid_input', 'accounts: staff A sending B''s ids gets an out-of-date list');
select is(pg_temp.same('ac_b', 'accounts', 'b0000000-0000-0000-0000-00000000000b') || '/' || pg_temp.same('ac_a', 'accounts', 'a0000000-0000-0000-0000-00000000000a'),
  'same/same', 'accounts: neither venue changed after the refusals');

select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(array['f0000000-0000-0000-0000-00000000a001', 'f0000000-0000-0000-0000-00000000a002',
    'f0000000-0000-0000-0000-00000000a003']::uuid[]) $$), 'invalid_input', 'accounts: staff B sending A''s ids gets an out-of-date list');
select is(pg_temp.same('ac_a', 'accounts', 'a0000000-0000-0000-0000-00000000000a'), 'same', 'accounts: A''s accounts are untouched by staff B');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(p_ids => array['f0000000-0000-0000-0000-00000000a001']::uuid[],
    p_venue_id => 'a0000000-0000-0000-0000-00000000000a') $$), 'forbidden', 'accounts: staff B naming A is forbidden');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(array['f0000000-0000-0000-0000-00000000b002', 'f0000000-0000-0000-0000-00000000b001']::uuid[]) $$),
  null, 'accounts: staff B reorders B''s accounts');
select is(pg_temp.st('accounts_order', 'b0000000-0000-0000-0000-00000000000b'), 'Pb2,Pb1', 'accounts: B''s accounts are in the new order');
select is(pg_temp.same('ac_a', 'accounts', 'a0000000-0000-0000-0000-00000000000a'), 'same', 'accounts: A''s accounts are still untouched');

select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(array['f0000000-0000-0000-0000-00000000a001', 'f0000000-0000-0000-0000-00000000a002',
    'f0000000-0000-0000-0000-00000000a003']::uuid[]) $$), 'venue_required', 'accounts: a member of two venues must name one');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(p_ids => array['f0000000-0000-0000-0000-00000000a001', 'f0000000-0000-0000-0000-00000000a002',
    'f0000000-0000-0000-0000-00000000a003']::uuid[], p_venue_id => 'a0000000-0000-0000-0000-00000000000a') $$), null, 'accounts: that member names A');
select is(pg_temp.st('accounts_order', 'a0000000-0000-0000-0000-00000000000a'), 'Pa1,Pa2,Pa3', 'accounts: A''s accounts are back in their first order');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(array['f0000000-0000-0000-0000-00000000b001', 'f0000000-0000-0000-0000-00000000b002']::uuid[]) $$),
  'forbidden', 'accounts: a platform admin with no venue and no membership is forbidden');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(array['f0000000-0000-0000-0000-00000000b001', 'f0000000-0000-0000-0000-00000000b002']::uuid[],
    'b0000000-0000-0000-0000-00000000000b') $$), null, 'accounts: a platform admin names B');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.reorder_payment_accounts(array['f0000000-0000-0000-0000-00000000a001', 'f0000000-0000-0000-0000-00000000a002',
    'f0000000-0000-0000-0000-00000000a003']::uuid[]) $$), 'forbidden', 'accounts: a player is forbidden');

-- ---------------------------------------------------------------- set_operating_hours (last: it changes the hours)
select pg_temp.as_user('22222222-2222-2222-2222-222222222222');
select is(pg_temp.st('hours', 'a0000000-0000-0000-0000-00000000000a') || ' | ' || pg_temp.st('hours', 'b0000000-0000-0000-0000-00000000000b'),
  '06:00-22:00 | 09:00-12:00', 'hours: the fixture starts at A 06-22 and B 09-12');
select is(pg_temp.hint_of($$ select public.set_operating_hours(pg_temp.hours('07:00', '21:00')) $$), null,
  'hours: staff A changes A''s hours with the old call shape');
select is(pg_temp.st('hours', 'a0000000-0000-0000-0000-00000000000a') || ' | ' || pg_temp.st('hours', 'b0000000-0000-0000-0000-00000000000b'),
  '07:00-21:00 | 09:00-12:00', 'hours: all seven days of A changed, B is untouched');
select is(pg_temp.hint_of($$ select public.set_operating_hours(pg_temp.hours('05:00', '23:00'), 'b0000000-0000-0000-0000-00000000000b') $$), 'forbidden',
  'hours: staff A naming B is forbidden');
select is(pg_temp.st('hours', 'b0000000-0000-0000-0000-00000000000b'), '09:00-12:00', 'hours: B is untouched after the refusal');
select is(pg_temp.hint_of($$ select public.set_operating_hours(pg_temp.hours('07:00', '08:00')) $$), null,
  'hours: a valid week for A is accepted again (sanity: the old shape still works)');
select is(pg_temp.hint_of($$ select public.set_operating_hours('[]'::jsonb) $$), 'invalid_input', 'hours: the seven-day rule is unchanged');

select pg_temp.as_user('77777777-7777-7777-7777-777777777777');
select is(pg_temp.hint_of($$ select public.set_operating_hours(p_hours => pg_temp.hours('05:00', '23:00'), p_venue_id => 'a0000000-0000-0000-0000-00000000000a') $$),
  'forbidden', 'hours: staff B naming A is forbidden');
select is(pg_temp.st('hours', 'a0000000-0000-0000-0000-00000000000a'), '07:00-08:00', 'hours: A is untouched by staff B');
select is(pg_temp.hint_of($$ select public.set_operating_hours(pg_temp.hours('10:00', '11:00')) $$), null,
  'hours: staff B changes B''s hours with the old call shape');
select is(pg_temp.st('hours', 'a0000000-0000-0000-0000-00000000000a') || ' | ' || pg_temp.st('hours', 'b0000000-0000-0000-0000-00000000000b'),
  '07:00-08:00 | 10:00-11:00', 'hours: B changed and A did not');

select pg_temp.as_user('55555555-5555-5555-5555-555555555555');
select is(pg_temp.hint_of($$ select public.set_operating_hours(pg_temp.hours('01:00', '02:00')) $$), 'venue_required',
  'hours: a member of two venues must name one');
select is(pg_temp.st('hours', 'a0000000-0000-0000-0000-00000000000a') || ' | ' || pg_temp.st('hours', 'b0000000-0000-0000-0000-00000000000b'),
  '07:00-08:00 | 10:00-11:00', 'hours: nothing changed after venue_required');
select is(pg_temp.hint_of($$ select public.set_operating_hours(pg_temp.hours('08:00', '12:00'), 'b0000000-0000-0000-0000-00000000000b') $$), null,
  'hours: that member names B (positional p_venue_id)');
select is(pg_temp.st('hours', 'a0000000-0000-0000-0000-00000000000a') || ' | ' || pg_temp.st('hours', 'b0000000-0000-0000-0000-00000000000b'),
  '07:00-08:00 | 08:00-12:00', 'hours: only B changed');

select pg_temp.as_user('44444444-4444-4444-4444-444444444444');
select is(pg_temp.hint_of($$ select public.set_operating_hours(pg_temp.hours('06:00', '22:00')) $$), 'forbidden',
  'hours: a platform admin with no venue and no membership is forbidden');
select is(pg_temp.hint_of($$ select public.set_operating_hours(pg_temp.hours('06:00', '22:00'), 'a0000000-0000-0000-0000-00000000000a') $$), null,
  'hours: a platform admin names A');
select is(pg_temp.st('hours', 'a0000000-0000-0000-0000-00000000000a') || ' | ' || pg_temp.st('hours', 'b0000000-0000-0000-0000-00000000000b'),
  '06:00-22:00 | 08:00-12:00', 'hours: A is back to 06-22 and B kept its own');
select pg_temp.as_user('11111111-1111-1111-1111-111111111111');
select is(pg_temp.hint_of($$ select public.set_operating_hours(pg_temp.hours('06:00', '22:00')) $$), 'forbidden', 'hours: a player is forbidden');

select * from finish();
rollback;
