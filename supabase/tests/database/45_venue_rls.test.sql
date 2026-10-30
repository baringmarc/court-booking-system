-- T12.4: RLS rewrite. Every policy on a venue-owned table is scoped by venue_id.
--   * public reads return only rows of ACTIVE venues (draft/suspended rows are visible to that venue's admins and platform admins)
--   * writes need private.is_venue_admin(venue_id), so staff of venue B can't touch venue A (even by inserting venue A's venue_id)
--   * private tables (bookings, payments, ...): owner rules unchanged, the admin branch is is_venue_admin(venue_id) of that row
--   * profiles: a venue admin reads profiles of users who booked at their venue; platform admins read all
-- Fixture: venue A (active), venue B (draft), venue C (suspended).
-- Roles: anon, player (P1, booked at A), legacy admin (profiles.role = 'admin', no membership), staff A, staff B, platform admin.
begin;
create extension if not exists pgtap with schema extensions;
select plan(513);

-- ---------------------------------------------------------------- helpers
-- rows visible to the caller for one table + venue (0 when the role has no privilege at all)
create function pg_temp.seen(p_table text, p_venue uuid) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where venue_id = %L', p_table, p_venue) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;
grant execute on function pg_temp.seen(text, uuid) to anon, authenticated;

-- rows affected by a write; -1 when it fails with a privilege/RLS error
create function pg_temp.rows(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
exception when insufficient_privilege then
  return -1;
end $$;
grant execute on function pg_temp.rows(text) to anon, authenticated;

-- true when the statement runs; false only on a privilege/RLS error (anything else raises and fails the test)
create function pg_temp.ok(p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when insufficient_privilege then
  return false;
end $$;
grant execute on function pg_temp.ok(text) to anon, authenticated;

create function pg_temp.court_of(p_venue uuid) returns uuid language sql as $$
  select case p_venue when 'a0000000-0000-0000-0000-00000000000a'::uuid then 'c0000000-0000-0000-0000-0000000000a1'::uuid
                      else 'c0000000-0000-0000-0000-0000000000b1'::uuid end $$;
grant execute on function pg_temp.court_of(uuid) to anon, authenticated;

-- (re)creates the rows the delete tests remove; run as postgres before every role
create function pg_temp.mk_disp() returns void language plpgsql as $$
declare v uuid; c uuid; s text;
begin
  foreach v in array array['a0000000-0000-0000-0000-00000000000a'::uuid, 'b0000000-0000-0000-0000-00000000000b'::uuid] loop
    c := pg_temp.court_of(v);
    s := case when v = 'a0000000-0000-0000-0000-00000000000a'::uuid then 'a' else 'b' end;
    if not exists (select 1 from public.courts where venue_id = v and name = 'E2E Disposable') then
      insert into public.courts (venue_id, name, sport, default_hourly_rate) values (v, 'E2E Disposable', 'tennis', 1);
    end if;
    insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values (v, c, 6, 20, 1) on conflict do nothing;
    insert into public.court_photos (venue_id, court_id, path, sort_order)
      values (v, c, v || '/courts/' || c || '/90000000-0000-0000-0000-00000000009' || (case s when 'a' then '1' else '2' end) || '.png', 99) on conflict do nothing;
    if not exists (select 1 from public.blackouts where venue_id = v and reason = 'E2E disposable') then
      insert into public.blackouts (venue_id, starts_at, ends_at, reason) values (v, now() + interval '300 days', now() + interval '300 days 1 hour', 'E2E disposable');
    end if;
    if not exists (select 1 from public.venue_amenities where venue_id = v and custom_name = 'E2E disp') then
      insert into public.venue_amenities (venue_id, custom_name) values (v, 'E2E disp');
    end if;
    if not exists (select 1 from public.venue_info_sections where venue_id = v and title = 'E2E disp') then
      insert into public.venue_info_sections (venue_id, title) values (v, 'E2E disp');
    end if;
    if not exists (select 1 from public.venue_payment_accounts where venue_id = v and label = 'E2E disp') then
      insert into public.venue_payment_accounts (venue_id, label, account_name, account_number) values (v, 'E2E disp', 'E2E', '1');
    end if;
    insert into public.venue_social_links (venue_id, platform, url) values (v, 'website', 'https://example.com/e2e') on conflict do nothing;
  end loop;
end $$;

-- read matrix for one role: 11 public catalog tables x 2 venues, courts x 2, suspended venue C, 5 private tables x 2 venues
create function pg_temp.read_matrix(p_label text, p_pub_a int, p_pub_b int, p_courts_a int, p_courts_b int, p_settings_c int,
                                    p_priv_a int[], p_priv_b int[]) returns setof text language plpgsql as $$
declare
  va constant uuid := 'a0000000-0000-0000-0000-00000000000a';
  vb constant uuid := 'b0000000-0000-0000-0000-00000000000b';
  vc constant uuid := 'c0000000-0000-0000-0000-00000000000c';
  pub text[] := array['court_rates','court_photos','blackouts','operating_hours','open_play_courts','open_play_sessions',
                      'venue_settings','venue_social_links','venue_amenities','venue_info_sections','venue_payment_accounts'];
  priv text[] := array['bookings','booking_changes','payments','email_outbox','paymongo_checkouts'];
  t text; i int;
begin
  foreach t in array pub loop
    return next is(pg_temp.seen(t, va), p_pub_a::bigint, p_label || ': ' || t || ' of venue A (active)');
  end loop;
  foreach t in array pub loop
    return next is(pg_temp.seen(t, vb), p_pub_b::bigint, p_label || ': ' || t || ' of venue B (draft)');
  end loop;
  return next is(pg_temp.seen('courts', va), p_courts_a::bigint, p_label || ': courts of venue A (one active, one inactive)');
  return next is(pg_temp.seen('courts', vb), p_courts_b::bigint, p_label || ': courts of venue B (draft)');
  return next is(pg_temp.seen('venue_settings', vc), p_settings_c::bigint, p_label || ': venue_settings of venue C (suspended)');
  for i in 1..5 loop
    return next is(pg_temp.seen(priv[i], va), p_priv_a[i]::bigint, p_label || ': ' || priv[i] || ' of venue A');
  end loop;
  for i in 1..5 loop
    return next is(pg_temp.seen(priv[i], vb), p_priv_b[i]::bigint, p_label || ': ' || priv[i] || ' of venue B');
  end loop;
end $$;
grant execute on function pg_temp.read_matrix(text, int, int, int, int, int, int[], int[]) to anon, authenticated;

-- update / insert / delete matrix for one role. p_tag (1..6) keeps inserted keys unique per role.
create function pg_temp.write_matrix(p_label text, p_can_a boolean, p_can_b boolean, p_tag int) returns setof text language plpgsql as $$
declare
  va constant uuid := 'a0000000-0000-0000-0000-00000000000a';
  vb constant uuid := 'b0000000-0000-0000-0000-00000000000b';
  v uuid; side text; c uuid; can boolean; sql text;
  upd text[] := array[
    'update public.courts set name = name where venue_id = %L',
    'update public.court_rates set price = price where venue_id = %L',
    'update public.court_photos set sort_order = sort_order where venue_id = %L',
    'update public.blackouts set reason = reason where venue_id = %L',
    'update public.operating_hours set open_time = open_time where venue_id = %L',
    'update public.venue_info_sections set title = title where venue_id = %L',
    'update public.venue_social_links set url = url where venue_id = %L',
    'update public.venue_settings set name = name where venue_id = %L'];
  updn text[] := array['courts','court_rates','court_photos','blackouts','operating_hours','venue_info_sections','venue_social_links','venue_settings'];
  amen text[] := array['restrooms','parking','showers','canteen','cafe','tables'];
  plat text[] := array['facebook','instagram','tiktok','youtube','x','messenger'];
  purl text[] := array['https://facebook.com/e2e','https://instagram.com/e2e','https://tiktok.com/e2e','https://youtube.com/e2e','https://x.com/e2e','https://m.me/e2e'];
  insn text[] := array['courts','court_rates','court_photos','blackouts','venue_amenities','venue_info_sections','venue_social_links'];
  deln text[] := array['courts','court_rates','court_photos','blackouts','venue_amenities','venue_info_sections','venue_payment_accounts','venue_social_links'];
  dels text[] := array[
    'delete from public.courts where venue_id = %L and name = ''E2E Disposable''',
    'delete from public.court_rates where venue_id = %L and day_of_week = 6',
    'delete from public.court_photos where venue_id = %L and sort_order = 99',
    'delete from public.blackouts where venue_id = %L and reason = ''E2E disposable''',
    'delete from public.venue_amenities where venue_id = %L and custom_name = ''E2E disp''',
    'delete from public.venue_info_sections where venue_id = %L and title = ''E2E disp''',
    'delete from public.venue_payment_accounts where venue_id = %L and label = ''E2E disp''',
    'delete from public.venue_social_links where venue_id = %L and platform = ''website'''];
  i int;
begin
  -- updates
  foreach side in array array['A','B'] loop
    v := case side when 'A' then va else vb end;
    can := case side when 'A' then p_can_a else p_can_b end;
    for i in 1..array_length(upd, 1) loop
      return next is(pg_temp.rows(format(upd[i], v)) > 0, can, p_label || ': update ' || updn[i] || ' of venue ' || side || (case when can then ' allowed' else ' blocked' end));
    end loop;
  end loop;
  -- inserts
  foreach side in array array['A','B'] loop
    v := case side when 'A' then va else vb end;
    can := case side when 'A' then p_can_a else p_can_b end;
    c := pg_temp.court_of(v);
    for i in 1..array_length(insn, 1) loop
      sql := case insn[i]
        when 'courts' then format('insert into public.courts (venue_id, name, sport, default_hourly_rate) values (%L, ''E2E Ins %s'', ''tennis'', 1)', v, p_tag)
        when 'court_rates' then format('insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values (%L, %L, 1, %s, 1)', v, c, p_tag)
        when 'court_photos' then format('insert into public.court_photos (venue_id, court_id, path, sort_order) values (%L, %L, %L, 1)', v, c,
                                  v || '/courts/' || c || '/80000000-0000-0000-0000-00000000000' || p_tag || '.png')
        when 'blackouts' then format('insert into public.blackouts (venue_id, starts_at, ends_at, reason) values (%L, now() + interval ''200 days'', now() + interval ''200 days 1 hour'', ''E2E ins'')', v)
        when 'venue_amenities' then format('insert into public.venue_amenities (venue_id, builtin_key) values (%L, %L)', v, amen[p_tag])
        when 'venue_info_sections' then format('insert into public.venue_info_sections (venue_id, title) values (%L, ''E2E ins'')', v)
        when 'venue_social_links' then format('insert into public.venue_social_links (venue_id, platform, url) values (%L, %L, %L)', v, plat[p_tag], purl[p_tag])
      end;
      return next is(pg_temp.ok(sql), can, p_label || ': insert ' || insn[i] || ' into venue ' || side || (case when can then ' allowed' else ' blocked' end));
    end loop;
  end loop;
  -- deletes
  foreach side in array array['A','B'] loop
    v := case side when 'A' then va else vb end;
    can := case side when 'A' then p_can_a else p_can_b end;
    for i in 1..array_length(dels, 1) loop
      return next is(pg_temp.rows(format(dels[i], v)) > 0, can, p_label || ': delete ' || deln[i] || ' of venue ' || side || (case when can then ' allowed' else ' blocked' end));
    end loop;
  end loop;
end $$;
grant execute on function pg_temp.write_matrix(text, boolean, boolean, int) to anon, authenticated;

-- ---------------------------------------------------------------- fixtures (as postgres)
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player-p1@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'staff-a@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'owner-a@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'platform@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'staff-b@test.local'),
  ('88888888-8888-8888-8888-888888888888', 'player-p2@test.local'),
  ('99999999-9999-9999-9999-999999999999', 'player-p3@test.local'),
  ('66666666-6666-6666-6666-666666666666', 'legacy-admin@test.local');

insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'e2e-rls-a', 'active'),
  ('b0000000-0000-0000-0000-00000000000b', 'e2e-rls-b', 'draft'),
  ('c0000000-0000-0000-0000-00000000000c', 'e2e-rls-c', 'suspended');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('a0000000-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333', 'owner'),
  ('b0000000-0000-0000-0000-00000000000b', '77777777-7777-7777-7777-777777777777', 'staff');
insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');

insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'E2E Court A1', 'tennis', 500, true),
  ('c0000000-0000-0000-0000-0000000000a2', 'a0000000-0000-0000-0000-00000000000a', 'E2E Court A2 inactive', 'tennis', 500, false),
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E Court B1', 'tennis', 600, true),
  ('c0000000-0000-0000-0000-0000000000c1', 'c0000000-0000-0000-0000-00000000000c', 'E2E Court C1', 'tennis', 700, true);
insert into public.venue_settings (venue_id, name) values
  ('a0000000-0000-0000-0000-00000000000a', 'E2E Venue A'),
  ('b0000000-0000-0000-0000-00000000000b', 'E2E Venue B'),
  ('c0000000-0000-0000-0000-00000000000c', 'E2E Venue C');
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time) values
  ('a0000000-0000-0000-0000-00000000000a', 1, '08:00', '22:00'),
  ('b0000000-0000-0000-0000-00000000000b', 1, '08:00', '22:00');
insert into public.court_rates (court_id, day_of_week, start_hour, price) values
  ('c0000000-0000-0000-0000-0000000000a1', 1, 9, 550),
  ('c0000000-0000-0000-0000-0000000000b1', 1, 9, 650);
insert into public.court_photos (id, court_id, path, sort_order) values
  ('a2000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a/courts/c0000000-0000-0000-0000-0000000000a1/a2000000-0000-0000-0000-0000000000a1.png', 0),
  ('a2000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b/courts/c0000000-0000-0000-0000-0000000000b1/a2000000-0000-0000-0000-0000000000b1.png', 0);
insert into public.blackouts (venue_id, starts_at, ends_at, reason) values
  ('a0000000-0000-0000-0000-00000000000a', now() + interval '20 days', now() + interval '20 days 1 hour', 'E2E fixture'),
  ('b0000000-0000-0000-0000-00000000000b', now() + interval '20 days', now() + interval '20 days 1 hour', 'E2E fixture');
insert into public.open_play_sessions (id, venue_id, title, starts_at, ends_at) values
  ('e0000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'E2E Open Play A', now() + interval '12 days', now() + interval '12 days 2 hours'),
  ('e0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E Open Play B', now() + interval '12 days', now() + interval '12 days 2 hours');
insert into public.open_play_courts (session_id, court_id, during) values
  ('e0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', tstzrange(now() + interval '12 days', now() + interval '12 days 2 hours')),
  ('e0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', tstzrange(now() + interval '12 days', now() + interval '12 days 2 hours'));
insert into public.venue_social_links (venue_id, platform, url) values
  ('a0000000-0000-0000-0000-00000000000a', 'instagram', 'https://instagram.com/e2e-a'),
  ('b0000000-0000-0000-0000-00000000000b', 'instagram', 'https://instagram.com/e2e-b');
insert into public.venue_amenities (venue_id, builtin_key) values
  ('a0000000-0000-0000-0000-00000000000a', 'wifi'),
  ('b0000000-0000-0000-0000-00000000000b', 'wifi');
insert into public.venue_info_sections (venue_id, title) values
  ('a0000000-0000-0000-0000-00000000000a', 'E2E Info A'),
  ('b0000000-0000-0000-0000-00000000000b', 'E2E Info B');
insert into public.venue_payment_accounts (venue_id, label, account_name, account_number) values
  ('a0000000-0000-0000-0000-00000000000a', 'E2E Account A', 'E2E', '1'),
  ('b0000000-0000-0000-0000-00000000000b', 'E2E Account B', 'E2E', '2');

insert into public.bookings (id, venue_id, reference_code, court_id, user_id, guest_name, during, total_amount, status) values
  ('b1000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-00000000000a', 'CB-BBBBB7', 'c0000000-0000-0000-0000-0000000000a1',
   '11111111-1111-1111-1111-111111111111', 'E2E P1', tstzrange(now() + interval '13 days', now() + interval '13 days 1 hour'), 550, 'confirmed'),
  ('b1000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'CB-BBBBB8', 'c0000000-0000-0000-0000-0000000000b1',
   '88888888-8888-8888-8888-888888888888', 'E2E P2', tstzrange(now() + interval '13 days', now() + interval '13 days 1 hour'), 650, 'confirmed');
insert into public.payments (booking_id, method, amount) values
  ('b1000000-0000-0000-0000-0000000000a1', 'cash', 550),
  ('b1000000-0000-0000-0000-0000000000b1', 'cash', 650);
insert into public.booking_changes (booking_id, old_court_id, old_during, new_court_id, new_during, reason) values
  ('b1000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', tstzrange(now() + interval '13 days', now() + interval '13 days 1 hour'),
   'c0000000-0000-0000-0000-0000000000a1', tstzrange(now() + interval '15 days', now() + interval '15 days 1 hour'), 'e2e'),
  ('b1000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', tstzrange(now() + interval '13 days', now() + interval '13 days 1 hour'),
   'c0000000-0000-0000-0000-0000000000b1', tstzrange(now() + interval '15 days', now() + interval '15 days 1 hour'), 'e2e');
insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos) values
  ('b1000000-0000-0000-0000-0000000000a1', 'cs_e2erls_a', 'https://example.com/cs', 55000),
  ('b1000000-0000-0000-0000-0000000000b1', 'cs_e2erls_b', 'https://example.com/cs', 65000);
insert into public.email_outbox (booking_id, kind, to_email, for_guest, data) values
  ('b1000000-0000-0000-0000-0000000000a1', 'booking_created', 'e2e-rls-a@example.com', true, '{}'),
  ('b1000000-0000-0000-0000-0000000000b1', 'booking_created', 'e2e-rls-b@example.com', true, '{}');
insert into public.guest_link_tokens (booking_id, token_hash) values
  ('b1000000-0000-0000-0000-0000000000a1', '\x00112233'::bytea);

-- fixture sanity as postgres: exactly one row per venue (so the counts below are not vacuous)
select is((select count(*) from public.bookings where venue_id = 'a0000000-0000-0000-0000-00000000000a'), 1::bigint, 'fixture: venue A has one booking');
select is((select count(*) from public.email_outbox where venue_id = 'a0000000-0000-0000-0000-00000000000a'), 1::bigint, 'fixture: venue A has one email_outbox row');
select is((select count(*) from public.payments where venue_id = 'b0000000-0000-0000-0000-00000000000b'), 1::bigint, 'fixture: venue B has one payment');

-- ---------------------------------------------------------------- reads, one role at a time
-- args: label, pubA, pubB, courtsA, courtsB, settingsC, privA[bookings,changes,payments,outbox,checkouts], privB[...]
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select * from pg_temp.read_matrix('anon', 1, 0, 1, 0, 0, array[0,0,0,0,0], array[0,0,0,0,0]);
select is((select count(*) from public.venues where id in ('a0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-00000000000c')), 1::bigint, 'anon: only the active venue is listed');
select is((select count(*) from public.platform_pricing), 1::bigint, 'anon: platform_pricing is still public');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select * from pg_temp.read_matrix('player', 1, 0, 1, 0, 0, array[1,1,1,0,0], array[0,0,0,0,0]);
select is((select count(*) from public.platform_pricing), 1::bigint, 'player: platform_pricing is still public');
select is(pg_temp.seen('guest_link_tokens', 'a0000000-0000-0000-0000-00000000000a'), 0::bigint, 'player: guest_link_tokens stay deny-all');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}', true);
select * from pg_temp.read_matrix('legacy profiles.role admin without membership', 1, 0, 1, 0, 0, array[0,0,0,0,0], array[0,0,0,0,0]);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select * from pg_temp.read_matrix('staff A', 1, 0, 2, 0, 0, array[1,1,1,1,1], array[0,0,0,0,0]);
select is(pg_temp.seen('guest_link_tokens', 'a0000000-0000-0000-0000-00000000000a'), 0::bigint, 'staff A: guest_link_tokens stay deny-all');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select * from pg_temp.read_matrix('staff B', 1, 1, 1, 1, 0, array[0,0,0,0,0], array[1,1,1,1,1]);

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select * from pg_temp.read_matrix('platform admin', 1, 1, 2, 1, 1, array[1,1,1,1,1], array[1,1,1,1,1]);
select is((select count(*) from public.venues where id in ('a0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000b','c0000000-0000-0000-0000-00000000000c')), 3::bigint, 'platform admin: sees all venues');

-- ---------------------------------------------------------------- profiles
-- ids: P1 booked at A, P2 booked at B, P3 no bookings
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.rows($$select 1 from public.profiles$$), -1::bigint, 'profiles: anon has no access at all');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is((select count(*) from public.profiles), 1::bigint, 'profiles: a player reads only their own profile');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is((select count(*) from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 1::bigint, 'profiles: staff A reads the profile of a user who booked at venue A');
select is((select count(*) from public.profiles where id = '88888888-8888-8888-8888-888888888888'), 0::bigint, 'profiles: staff A cannot read a profile that only has bookings at venue B');
select is((select count(*) from public.profiles where id = '99999999-9999-9999-9999-999999999999'), 0::bigint, 'profiles: staff A cannot read a profile with no bookings');
select is((select count(*) from public.profiles where id = '22222222-2222-2222-2222-222222222222'), 1::bigint, 'profiles: staff A still reads their own profile');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is((select count(*) from public.profiles where id = '88888888-8888-8888-8888-888888888888'), 1::bigint, 'profiles: staff B reads the profile of a user who booked at venue B');
select is((select count(*) from public.profiles where id = '11111111-1111-1111-1111-111111111111'), 0::bigint, 'profiles: staff B cannot read a profile that only has bookings at venue A');
select is((select count(*) from public.profiles where id = '99999999-9999-9999-9999-999999999999'), 0::bigint, 'profiles: staff B cannot read a profile with no bookings');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}', true);
select is((select count(*) from public.profiles where id in ('11111111-1111-1111-1111-111111111111','88888888-8888-8888-8888-888888888888','99999999-9999-9999-9999-999999999999')), 0::bigint, 'profiles: a legacy profiles.role admin without membership reads no one else');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is((select count(*) from public.profiles where id in ('11111111-1111-1111-1111-111111111111','88888888-8888-8888-8888-888888888888','99999999-9999-9999-9999-999999999999')), 3::bigint, 'profiles: a platform admin reads all profiles');

-- ---------------------------------------------------------------- venue_members
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is((select count(*) from public.venue_members where venue_id = 'a0000000-0000-0000-0000-00000000000a'), 1::bigint, 'venue_members: staff A reads only their own row');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is((select count(*) from public.venue_members where venue_id = 'a0000000-0000-0000-0000-00000000000a'), 2::bigint, 'venue_members: the owner of A reads all members of A');
select is((select count(*) from public.venue_members where venue_id = 'b0000000-0000-0000-0000-00000000000b'), 0::bigint, 'venue_members: the owner of A reads no member of B');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is((select count(*) from public.venue_members where venue_id = 'a0000000-0000-0000-0000-00000000000a'), 0::bigint, 'venue_members: staff B reads no member of A');

-- ---------------------------------------------------------------- writes (update, insert, delete), one role at a time
-- disposable rows are recreated as postgres before each role so a delete never passes or fails for the wrong reason
-- args: label, can write venue A, can write venue B, unique tag
reset role;
select pg_temp.mk_disp();
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select * from pg_temp.write_matrix('anon', false, false, 1);

reset role;
select pg_temp.mk_disp();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select * from pg_temp.write_matrix('player', false, false, 2);

reset role;
select pg_temp.mk_disp();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}', true);
select * from pg_temp.write_matrix('legacy profiles.role admin', false, false, 3);

reset role;
select pg_temp.mk_disp();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select * from pg_temp.write_matrix('staff A', true, false, 4);
-- moving a row to another venue is refused (the new row must also pass is_venue_admin)
select is(pg_temp.rows($$update public.venue_info_sections set venue_id = 'b0000000-0000-0000-0000-00000000000b' where venue_id = 'a0000000-0000-0000-0000-00000000000a' and title = 'E2E Info A'$$), -1::bigint,
  'staff A: cannot move a venue A row into venue B');
select is(pg_temp.rows($$update public.venue_settings set venue_id = 'c0000000-0000-0000-0000-00000000000c' where venue_id = 'a0000000-0000-0000-0000-00000000000a'$$), -1::bigint,
  'staff A: cannot move venue A settings into venue C');

reset role;
select pg_temp.mk_disp();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select * from pg_temp.write_matrix('staff B', false, true, 5);

reset role;
select pg_temp.mk_disp();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select * from pg_temp.write_matrix('platform admin', true, true, 6);

-- the write tests changed nothing outside what each role may touch: venue B rows survive staff A (checked as postgres)
reset role;
select ok(exists (select 1 from public.venue_settings where venue_id = 'b0000000-0000-0000-0000-00000000000b' and name = 'E2E Venue B'), 'writes: venue B settings were not touched by other roles');

select * from finish();
rollback;
