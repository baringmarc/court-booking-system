-- T29.4: live stacks. public.live_stacks (RLS on, no grants), private.create_live_stack (service_role only, 300 cap),
-- public.get_live_stack (anyone), public.publish_live_stack (anyone holding the secret; hints in a fixed order),
-- public.create_venue_live_stack (admin of the session's venue; a second call keeps the code and rotates the secret),
-- the hourly purge-live-stacks job and what deleting a venue or a session does to a stack.
-- Inside one transaction now() is constant, so "just published" and "published a while ago" are set by moving
-- updated_at relative to clock_timestamp() as the table owner (pg_temp.hot / pg_temp.cool), never by sleeping.
begin;
create extension if not exists pgtap with schema extensions;
select plan(121);

-- ---------------------------------------------------------------- helpers
create temp table stk (name text primary key, code text, secret text, raw jsonb);
create temp table mark (k text primary key, v text);
grant all on stk, mark to anon, authenticated, service_role;

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

-- publish as whoever is the current role, with the secret of stack p_name unless one is given
create function pg_temp.pub(p_name text, p_ver int, p_snap jsonb, p_end boolean default false, p_secret text default null)
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  select public.publish_live_stack((select code from stk where name = p_name),
    coalesce(p_secret, (select secret from stk where name = p_name)), p_ver, p_snap, p_end) into r;
  return r;
end $$;
create function pg_temp.get(p_name text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  select public.get_live_stack((select code from stk where name = p_name)) into r;
  return r;
end $$;
-- a snapshot object whose jsonb text is exactly p_len characters (ASCII, so bytes)
create function pg_temp.snap(p_v int, p_len int) returns jsonb language plpgsql as $$
declare base int;
begin
  base := length(jsonb_build_object('v', p_v, 'pad', '')::text);
  return jsonb_build_object('v', p_v, 'pad', repeat('x', p_len - base));
end $$;

-- table-owner helpers (security definer, so a test can call them while acting as anon or a player)
create function pg_temp.col(p_name text, p_col text) returns text language plpgsql security definer as $$
declare r text;
begin
  execute format('select %I::text from public.live_stacks where code = (select code from stk where name = %L)', p_col, p_name) into r;
  return r;
end $$;
create function pg_temp.hot(p_name text) returns void language plpgsql security definer as $$
begin
  update public.live_stacks set updated_at = clock_timestamp() where code = (select code from stk where name = p_name);
end $$;
create function pg_temp.cool(p_name text) returns void language plpgsql security definer as $$
begin
  update public.live_stacks set updated_at = clock_timestamp() - interval '5 seconds' where code = (select code from stk where name = p_name);
end $$;
create function pg_temp.age(p_name text, p_age interval) returns void language plpgsql security definer as $$
begin
  update public.live_stacks set updated_at = now() - p_age, expires_at = now() - p_age + interval '24 hours'
   where code = (select code from stk where name = p_name);
end $$;
create function pg_temp.setexp(p_name text, p_from_now interval) returns void language plpgsql security definer as $$
begin
  update public.live_stacks set expires_at = now() + p_from_now where code = (select code from stk where name = p_name);
end $$;
create function pg_temp.setcount(p_name text, p_n int) returns void language plpgsql security definer as $$
begin
  update public.live_stacks set publish_count = p_n where code = (select code from stk where name = p_name);
end $$;
grant execute on function pg_temp.hint_of(text), pg_temp.pub(text, int, jsonb, boolean, text), pg_temp.get(text),
  pg_temp.snap(int, int), pg_temp.col(text, text), pg_temp.hot(text), pg_temp.cool(text), pg_temp.age(text, interval),
  pg_temp.setexp(text, interval), pg_temp.setcount(text, int) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- fixture
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'e2e-ls-player@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'e2e-ls-staff-a@example.com'),
  ('77777777-7777-7777-7777-777777777777', 'e2e-ls-staff-b@example.com'),
  ('33333333-3333-3333-3333-333333333333', 'e2e-ls-platform@example.com');
insert into public.platform_admins (user_id) values ('33333333-3333-3333-3333-333333333333');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000000a9', 'e2e-ls-a', 'active'),
  ('b0000000-0000-0000-0000-0000000000b9', 'e2e-ls-b', 'active'),
  ('c0000000-0000-0000-0000-0000000000c9', 'e2e-ls-c', 'active'),
  ('d0000000-0000-0000-0000-0000000000d9', 'e2e-ls-d', 'active');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-0000000000a9', 'E2E Live Stacks A', 'Asia/Manila'),
  ('b0000000-0000-0000-0000-0000000000b9', 'E2E Live Stacks B', 'Asia/Manila'),
  ('c0000000-0000-0000-0000-0000000000c9', 'E2E Live Stacks C', 'Asia/Manila');
update public.venue_settings
   set logo_path = 'a0000000-0000-0000-0000-0000000000a9/logo/11111111-cccc-cccc-cccc-cccccccccccc.webp'
 where venue_id = 'a0000000-0000-0000-0000-0000000000a9';
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000000a9', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('b0000000-0000-0000-0000-0000000000b9', '77777777-7777-7777-7777-777777777777', 'staff');

insert into public.courts (venue_id, id, name, sport, default_hourly_rate, is_active) values
  ('a0000000-0000-0000-0000-0000000000a9', 'c0000000-0000-0000-0000-0000000000a1', 'LS Court 1', 'pickleball', 300, true),
  ('a0000000-0000-0000-0000-0000000000a9', 'c0000000-0000-0000-0000-0000000000a2', 'LS Court 2', 'pickleball', 300, true),
  ('a0000000-0000-0000-0000-0000000000a9', 'c0000000-0000-0000-0000-0000000000a3', 'LS Court 3', 'pickleball', 300, true);
insert into public.courts (venue_id, id, name, sport, default_hourly_rate, is_active)
select 'a0000000-0000-0000-0000-0000000000a9', ('c1000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid, 'LS Big ' || i, 'pickleball', 300, true
  from generate_series(1, 13) i;

-- sessions of venue A: s1 (2 courts), s0 (no court rows), sl (80-char title, 1 court), sb (13 courts), se (already ended),
-- sc (a fresh one for the 300 cap, no stack yet)
insert into public.open_play_sessions (venue_id, id, title, starts_at, ends_at) values
  ('a0000000-0000-0000-0000-0000000000a9', 'e0000000-0000-0000-0000-000000000001', 'E2E Saturday open play', now() + interval '3 days', now() + interval '3 days 1 hour'),
  ('a0000000-0000-0000-0000-0000000000a9', 'e0000000-0000-0000-0000-000000000002', 'E2E Courtless', now() + interval '4 days', now() + interval '4 days 1 hour'),
  ('a0000000-0000-0000-0000-0000000000a9', 'e0000000-0000-0000-0000-000000000003', repeat('E2E ', 20), now() + interval '5 days', now() + interval '5 days 1 hour'),
  ('a0000000-0000-0000-0000-0000000000a9', 'e0000000-0000-0000-0000-000000000004', 'E2E Big session', now() + interval '6 days', now() + interval '6 days 1 hour'),
  ('a0000000-0000-0000-0000-0000000000a9', 'e0000000-0000-0000-0000-000000000005', 'E2E Ended session', now() - interval '2 hours', now() - interval '1 hour'),
  ('a0000000-0000-0000-0000-0000000000a9', 'e0000000-0000-0000-0000-000000000006', 'E2E Cap session', now() + interval '7 days', now() + interval '7 days 1 hour');
insert into public.open_play_courts (session_id, court_id, during) values
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', tstzrange(now() + interval '3 days', now() + interval '3 days 1 hour')),
  ('e0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a2', tstzrange(now() + interval '3 days', now() + interval '3 days 1 hour')),
  ('e0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a3', tstzrange(now() + interval '5 days', now() + interval '5 days 1 hour')),
  ('e0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-0000000000a3', tstzrange(now() - interval '2 hours', now() - interval '1 hour')),
  ('e0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-0000000000a2', tstzrange(now() + interval '7 days', now() + interval '7 days 1 hour'));
insert into public.open_play_courts (session_id, court_id, during)
select 'e0000000-0000-0000-0000-000000000004', ('c1000000-0000-0000-0000-' || lpad(i::text, 12, '0'))::uuid,
       tstzrange(now() + interval '6 days', now() + interval '6 days 1 hour')
  from generate_series(1, 13) i;

-- stacks made through the service-role function: p (plotline.fit, no venue), b (venue B), c and d (venue-only, no session),
-- q (raising updated_at), e (ended), l (publish limit), x (expiry), k (second expired one for the purge)
set local role service_role;
insert into stk
select n, r ->> 'code', r ->> 'secret', r
  from (select 'p' n, private.create_live_stack('E2E Paddle Stack', 4, null, null) r
        union all select 'b', private.create_live_stack('E2E Venue B stack', 2, 'b0000000-0000-0000-0000-0000000000b9', null)
        union all select 'c', private.create_live_stack('E2E Venue C stack', 1, 'c0000000-0000-0000-0000-0000000000c9', null)
        union all select 'd', private.create_live_stack('E2E Venue D stack', 1, 'd0000000-0000-0000-0000-0000000000d9', null)
        union all select 'q', private.create_live_stack('E2E q', 2, null, null)
        union all select 'e', private.create_live_stack('E2E e', 2, null, null)
        union all select 'l', private.create_live_stack('E2E l', 2, null, null)
        union all select 'x', private.create_live_stack('E2E x', 2, null, null)
        union all select 'k', private.create_live_stack('E2E k', 2, null, null)) s;
reset role;

-- ---------------------------------------------------------------- table: shape and constraints
select has_table('public', 'live_stacks', 'public.live_stacks exists');
select is(
  (select string_agg(column_name::text, ',' order by column_name) from information_schema.columns
    where table_schema = 'public' and table_name = 'live_stacks'),
  'code,courts,created_at,ended_at,expires_at,id,open_play_session_id,publish_count,secret_hash,snapshot,title,updated_at,venue_id,version',
  'live_stacks has exactly the planned columns (no plain secret column)');
select ok((select relrowsecurity from pg_class where oid = 'public.live_stacks'::regclass), 'RLS is enabled on live_stacks');
select ok(
  not has_table_privilege('anon', 'public.live_stacks', 'select') and not has_table_privilege('anon', 'public.live_stacks', 'insert')
  and not has_table_privilege('anon', 'public.live_stacks', 'update') and not has_table_privilege('anon', 'public.live_stacks', 'delete')
  and not has_table_privilege('authenticated', 'public.live_stacks', 'select') and not has_table_privilege('authenticated', 'public.live_stacks', 'insert')
  and not has_table_privilege('authenticated', 'public.live_stacks', 'update') and not has_table_privilege('authenticated', 'public.live_stacks', 'delete'),
  'anon and authenticated hold no privilege on live_stacks');
select ok(
  (select bool_and(attnotnull) from pg_attribute
    where attrelid = 'public.live_stacks'::regclass and attname in ('code', 'secret_hash', 'version', 'publish_count') and not attisdropped),
  'code, secret_hash, version and publish_count are not null');
select throws_ok(
  $$ insert into public.live_stacks (code, secret_hash, courts, title, expires_at)
     values ('e2eshape0000000000000001', 'h', 0, 't', now() + interval '1 hour') $$,
  '23514', null, 'courts below 1 violates the check');
select throws_ok(
  $$ insert into public.live_stacks (code, secret_hash, courts, title, expires_at)
     values ('e2eshape0000000000000002', 'h', 13, 't', now() + interval '1 hour') $$,
  '23514', null, 'courts above 12 violates the check');
select throws_ok(
  $$ insert into public.live_stacks (code, secret_hash, courts, title, expires_at)
     values ('e2eshape0000000000000003', 'h', 2, repeat('t', 61), now() + interval '1 hour') $$,
  '23514', null, 'a title over 60 characters violates the check');
select throws_ok(
  $$ insert into public.live_stacks (code, secret_hash, courts, title, expires_at)
     select code, 'h', 2, 't', now() + interval '1 hour' from stk where name = 'p' $$,
  '23505', null, 'a code is unique');

-- ---------------------------------------------------------------- no direct table access
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select * from public.live_stacks $$, '42501', null, 'anon cannot select live_stacks');
select throws_ok(
  $$ insert into public.live_stacks (code, secret_hash, courts) values ('e2eanon000000000000000001', 'h', 2) $$,
  '42501', null, 'anon cannot insert live_stacks');
select throws_ok($$ update public.live_stacks set title = 'hacked' $$, '42501', null, 'anon cannot update live_stacks');
select throws_ok($$ delete from public.live_stacks $$, '42501', null, 'anon cannot delete live_stacks');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok($$ select * from public.live_stacks $$, '42501', null, 'a player cannot select live_stacks');
select throws_ok(
  $$ insert into public.live_stacks (code, secret_hash, courts) values ('e2eplayer00000000000000001', 'h', 2) $$,
  '42501', null, 'a player cannot insert live_stacks');
select throws_ok($$ update public.live_stacks set title = 'hacked' $$, '42501', null, 'a player cannot update live_stacks');
select throws_ok($$ delete from public.live_stacks $$, '42501', null, 'a player cannot delete live_stacks');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select throws_ok($$ select * from public.live_stacks $$, '42501', null, 'a venue admin cannot select live_stacks either');
reset role;

-- ---------------------------------------------------------------- private.create_live_stack
select ok(
  not has_function_privilege('anon', 'private.create_live_stack(text, integer, uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.create_live_stack(text, integer, uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'private.create_live_stack(text, integer, uuid, uuid)', 'execute'),
  'create_live_stack is executable by service_role only');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select private.create_live_stack('t', 1, null, null) $$, '42501', null, 'anon cannot create a stack directly');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select throws_ok($$ select private.create_live_stack('t', 1, null, null) $$, '42501', null, 'an admin cannot create a stack directly');
reset role;
select ok((select bool_and(code ~ '^[A-Za-z0-9_-]{22,}$') from stk), 'every code is at least 22 URL-safe characters');
select is((select count(distinct code)::int from stk), (select count(*)::int from stk), 'every stack gets its own code');
select is((select array_agg(k order by k) from stk, jsonb_object_keys(raw) k where name = 'p'), array['code', 'secret'], 'it returns exactly code and secret');
select is(
  (select concat_ws('|', title, courts, (venue_id is null)::text, (open_play_session_id is null)::text, version, publish_count, (snapshot is null)::text, (ended_at is null)::text)
     from public.live_stacks where code = (select code from stk where name = 'p')),
  'E2E Paddle Stack|4|true|true|0|0|true|true',
  'a new plotline stack has its title and courts, no venue or session, version 0, no snapshot, not ended');
select is(
  (select expires_at - updated_at from public.live_stacks where code = (select code from stk where name = 'p')),
  interval '24 hours', 'a new stack expires 24 hours after updated_at');
select is(
  (select concat_ws('|', venue_id, open_play_session_id) from public.live_stacks where code = (select code from stk where name = 'b')),
  'b0000000-0000-0000-0000-0000000000b9', 'a venue stack stores its venue_id');
select is((select count(*)::int from public.live_stacks l, stk s where l.secret_hash = s.secret), 0, 'no secret_hash equals a returned secret');
select ok(
  (select bool_and(l.secret_hash ~ '^[0-9a-f]{64}$' and l.secret_hash <> s.secret) from public.live_stacks l join stk s on s.code = l.code),
  'secret_hash is a 64-character hex digest, not the secret');
select is((select count(*)::int from public.live_stacks l, stk s where strpos(l::text, s.secret) > 0), 0,
  'a returned secret appears in no column of any row');

-- ---------------------------------------------------------------- get_live_stack
select ok(
  has_function_privilege('anon', 'public.get_live_stack(text)', 'execute') and has_function_privilege('authenticated', 'public.get_live_stack(text)', 'execute'),
  'anon and authenticated can execute get_live_stack');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.get('p')) k),
  array['courts', 'ended', 'expires_at', 'snapshot', 'title', 'venue', 'version'], 'get_live_stack returns exactly the seven planned keys (no secret_hash)');
select is(
  (select concat_ws('|', r ->> 'title', r ->> 'courts', r ->> 'version', r ->> 'ended', jsonb_typeof(r -> 'snapshot'), jsonb_typeof(r -> 'venue'))
     from (select pg_temp.get('p') r) s),
  'E2E Paddle Stack|4|0|false|null|null', 'a fresh plotline stack reads with a JSON null snapshot and a JSON null venue');
select is(((pg_temp.get('p') ->> 'expires_at')::timestamptz), pg_temp.col('p', 'expires_at')::timestamptz, 'it returns the stored expires_at');
select is(pg_temp.get('b') -> 'venue', '{"name": "E2E Live Stacks B", "slug": "e2e-ls-b", "logo_path": null}'::jsonb,
  'a venue stack returns the venue name, slug and a null logo_path when it has none');
select is(pg_temp.hint_of($$ select public.get_live_stack('e2e-no-such-code-0000000000') $$), 'not_found', 'an unknown code is not_found');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.get('p') ->> 'title', 'E2E Paddle Stack', 'a signed-in player reads a stack too');
reset role;
select pg_temp.setexp('x', interval '-1 second');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select pg_temp.get('x') $$), 'not_found', 'a stack whose expires_at has passed is not_found');
reset role;
select pg_temp.setexp('x', interval '0');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select pg_temp.get('x') $$), 'not_found', 'a stack with expires_at = now() is already expired');
reset role;
select pg_temp.setexp('x', interval '1 minute');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.get('x') ->> 'title', 'E2E x', 'a stack that expires in the future reads');

-- ---------------------------------------------------------------- publish_live_stack (as anon, holding the secret)
select ok(has_function_privilege('anon', 'public.publish_live_stack(text, text, integer, jsonb, boolean)', 'execute'),
  'anon can execute publish_live_stack');
select is(pg_temp.hint_of($$ select public.publish_live_stack('e2e-no-such-code-0000000000', 'wrong', 1, '{"v":1}', false) $$), 'not_found',
  'an unknown code is not_found, even with a wrong secret (not_found comes before forbidden)');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 1, '{"v":1}', false, 'not-the-secret') $$), 'forbidden', 'a wrong secret is forbidden');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 1, '{"v":1}', false, '') $$), 'forbidden', 'an empty secret is forbidden');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 1, '{"v":1}', false, (select secret from stk where name = 'b')) $$), 'forbidden',
  'another stack''s secret is forbidden');
select is(pg_temp.pub('p', 1, '{"v":1,"players":["Ann"]}') ->> 'version', '1',
  'the first publish is never too_fast and returns the new version');
select is(pg_temp.get('p') -> 'snapshot', '{"v":1,"players":["Ann"]}'::jsonb, 'the snapshot is stored and read back');
select is(pg_temp.col('p', 'version') || '|' || pg_temp.col('p', 'publish_count') || '|' || coalesce(pg_temp.col('p', 'ended_at'), 'open'),
  '1|1|open', 'a publish sets the version, counts one publish and does not end the stack');
select is(pg_temp.col('p', 'expires_at')::timestamptz - pg_temp.col('p', 'updated_at')::timestamptz, interval '24 hours',
  'after a publish expires_at is updated_at + 24 hours');
reset role;
select pg_temp.age('q', interval '23 hours');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.pub('q', 1, '{"v":1}') ->> 'version', '1', 'a publish on a stack aged 23 hours succeeds');
select ok(
  pg_temp.col('q', 'updated_at')::timestamptz >= now() and pg_temp.col('q', 'expires_at')::timestamptz > now() + interval '23 hours 59 minutes',
  'a publish raises updated_at to now and expires_at to a full 24 hours ahead');
reset role;

-- too_fast: the stack was "just published"
select pg_temp.hot('p');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 1, '[1]', false, 'not-the-secret') $$), 'forbidden',
  'forbidden comes before stale_version, too_fast and the snapshot checks');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 2, '{"v":2}') $$), 'too_fast', 'a second publish under a second after the last is too_fast');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 1, '{"v":1}') $$), 'stale_version', 'an equal version is stale_version, which comes before too_fast');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 0, '{"v":0}') $$), 'stale_version', 'a lower version is stale_version');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 2, pg_temp.snap(2, 65537)) $$), 'too_fast', 'too_fast comes before too_large');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 2, '[1]') $$), 'too_fast', 'too_fast comes before invalid_snapshot');
reset role;

-- a publish after the gap
select pg_temp.cool('p');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.pub('p', 2, '{"v":2}') ->> 'version', '2', 'a publish more than a second after the last succeeds');
select is(pg_temp.col('p', 'publish_count'), '2', 'each good publish counts');
reset role;

-- too_large: the limit is 65536 bytes of snapshot text
select pg_temp.cool('p');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(length(pg_temp.snap(3, 65536)::text), 65536, 'the test helper builds a snapshot of exactly 65536 characters');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 3, pg_temp.snap(3, 65537)) $$), 'too_large', 'a snapshot of 65537 bytes is too_large');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 3, to_jsonb(repeat('x', 70000))) $$), 'too_large',
  'too_large comes before invalid_snapshot (an oversized non-object)');
select is(pg_temp.pub('p', 3, pg_temp.snap(3, 65536)) ->> 'version', '3', 'a snapshot of exactly 65536 bytes is accepted');
reset role;

-- invalid_snapshot
select pg_temp.cool('p');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 4, '[{"v":4}]') $$), 'invalid_snapshot', 'an array is invalid_snapshot');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 4, '"text"') $$), 'invalid_snapshot', 'a string is invalid_snapshot');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 4, 'null'::jsonb) $$), 'invalid_snapshot', 'a JSON null is invalid_snapshot');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 4, '{"a":1}') $$), 'invalid_snapshot', 'an object without v is invalid_snapshot');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 4, '{"v":"4"}') $$), 'invalid_snapshot', 'a string v is invalid_snapshot');
select is(pg_temp.hint_of($$ select pg_temp.pub('p', 4, '{"v":4.5}') $$), 'invalid_snapshot', 'a fractional v is invalid_snapshot');
select is(pg_temp.col('p', 'version') || '|' || pg_temp.col('p', 'publish_count'), '3|3', 'refused publishes change neither the version nor the count');
reset role;

-- limit_reached: 5000 publishes a stack
select pg_temp.cool('l');
select pg_temp.setcount('l', 5000);
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select pg_temp.pub('l', 1, '{"v":1}') $$), 'limit_reached', 'a stack with 5000 publishes gets limit_reached');
select is(pg_temp.hint_of($$ select pg_temp.pub('l', 1, '[1]') $$), 'invalid_snapshot', 'invalid_snapshot comes before limit_reached');
reset role;
select pg_temp.setcount('l', 4999);
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.pub('l', 1, '{"v":1}') ->> 'version', '1', 'the 5000th publish is accepted');
select is(pg_temp.col('l', 'publish_count'), '5000', 'and brings publish_count to 5000');
reset role;

-- ending a stack
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.pub('e', 1, '{"v":1,"final":true}', true) ->> 'version', '1', 'p_end publishes and ends in one call');
select ok(pg_temp.col('e', 'ended_at') is not null, 'p_end sets ended_at');
select is(
  (select concat_ws('|', r ->> 'ended', r ->> 'version', r -> 'snapshot') from (select pg_temp.get('e') r) s),
  'true|1|{"v": 1, "final": true}', 'an ended stack still reads, with ended = true and its last snapshot');
select is(pg_temp.hint_of($$ select pg_temp.pub('e', 2, '{"v":2}') $$), 'ended', 'a publish to an ended stack is ended, even right after the end (before too_fast)');
select is(pg_temp.hint_of($$ select pg_temp.pub('e', 1, '{"v":1}') $$), 'ended', 'ended comes before stale_version');
select is(pg_temp.hint_of($$ select pg_temp.pub('e', 2, '{"v":2}', false, 'not-the-secret') $$), 'forbidden', 'forbidden comes before ended');
reset role;

-- ---------------------------------------------------------------- create_venue_live_stack
select ok(
  not has_function_privilege('anon', 'public.create_venue_live_stack(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.create_venue_live_stack(uuid)', 'execute'),
  'create_venue_live_stack is for authenticated only');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.create_venue_live_stack('e0000000-0000-0000-0000-000000000001') $$, '42501', null,
  'anon cannot call create_venue_live_stack');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.create_venue_live_stack('e0000000-0000-0000-0000-000000000001') $$), 'forbidden',
  'a player cannot start a venue stack');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "77777777-7777-7777-7777-777777777777", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.create_venue_live_stack('e0000000-0000-0000-0000-000000000001') $$), 'forbidden',
  'staff of another venue cannot start a stack for venue A''s session');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.create_venue_live_stack('e0000000-0000-0000-0000-0000000000ff') $$), 'not_found',
  'a missing session id is not_found');
select is(pg_temp.hint_of($$ select public.create_venue_live_stack('e0000000-0000-0000-0000-000000000005') $$), 'session_ended',
  'a session that has ended is session_ended');
insert into stk
select n, r ->> 'code', r ->> 'secret', r
  from (select 'v' n, public.create_venue_live_stack('e0000000-0000-0000-0000-000000000001') r
        union all select 'v0', public.create_venue_live_stack('e0000000-0000-0000-0000-000000000002')
        union all select 'vl', public.create_venue_live_stack('e0000000-0000-0000-0000-000000000003')
        union all select 'vb', public.create_venue_live_stack('e0000000-0000-0000-0000-000000000004')) s;
reset role;

select is(
  (select concat_ws('|', venue_id, open_play_session_id, title, courts) from public.live_stacks where code = (select code from stk where name = 'v')),
  'a0000000-0000-0000-0000-0000000000a9|e0000000-0000-0000-0000-000000000001|E2E Saturday open play|2',
  'an admin of venue A gets a stack tied to the venue and session, with the session title and its 2 courts');
select is((select courts::int from public.live_stacks where code = (select code from stk where name = 'v0')), 1, 'a session with no court rows gives courts = 1');
select is(
  (select concat_ws('|', length(title), (title = btrim(left(repeat('E2E ', 20), 60)))::text, courts) from public.live_stacks where code = (select code from stk where name = 'vl')),
  '59|true|1', 'an 80-character session title is cut to 60 characters and trimmed');
select is((select courts::int from public.live_stacks where code = (select code from stk where name = 'vb')), 12, 'a session with 13 court rows gives courts = 12');
select is((select count(*)::int from public.live_stacks l, stk s where l.secret_hash = s.secret), 0, 'venue stacks do not store their secrets either');
select ok(
  (select bool_and(l.secret_hash ~ '^[0-9a-f]{64}$') from public.live_stacks l join stk s on s.code = l.code where s.name in ('v', 'v0', 'vl', 'vb')),
  'venue stacks store a 64-character hex digest');
select is(
  (select r -> 'venue' from (select pg_temp.get('v') r) s),
  '{"name": "E2E Live Stacks A", "slug": "e2e-ls-a", "logo_path": "a0000000-0000-0000-0000-0000000000a9/logo/11111111-cccc-cccc-cccc-cccccccccccc.webp"}'::jsonb,
  'get_live_stack returns the venue name, slug and logo_path for a venue stack');

-- running it again rotates the secret and keeps the code
insert into mark select 'hash_before', pg_temp.col('v', 'secret_hash');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
insert into stk
select 'v2', r ->> 'code', r ->> 'secret', r from (select public.create_venue_live_stack('e0000000-0000-0000-0000-000000000001') r) s;
reset role;
select is((select code from stk where name = 'v2'), (select code from stk where name = 'v'), 'a second call for the same session returns the same code');
select isnt((select secret from stk where name = 'v2'), (select secret from stk where name = 'v'), 'and a new secret');
select is((select count(*)::int from public.live_stacks where open_play_session_id = 'e0000000-0000-0000-0000-000000000001'), 1,
  'there is still one stack for the session');
select ok(
  (select secret_hash from public.live_stacks where code = (select code from stk where name = 'v')) <> (select v from mark where k = 'hash_before'),
  'only secret_hash changed: it is a different digest now');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select pg_temp.pub('v', 1, '{"v":1}', false, (select secret from stk where name = 'v')) $$), 'forbidden',
  'the old secret now gets forbidden');
select is(pg_temp.pub('v', 1, '{"v":1}', false, (select secret from stk where name = 'v2')) ->> 'version', '1', 'the new secret publishes');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.create_venue_live_stack('e0000000-0000-0000-0000-000000000001') $$), 'forbidden',
  'a player cannot rotate the secret of an existing stack');
reset role;

-- ---------------------------------------------------------------- what deleting a session or a venue does
delete from public.open_play_sessions where id = 'e0000000-0000-0000-0000-000000000003';
select is(
  (select concat_ws('|', (open_play_session_id is null)::text, venue_id) from public.live_stacks where code = (select code from stk where name = 'vl')),
  'true|a0000000-0000-0000-0000-0000000000a9', 'deleting a session keeps its stack and clears open_play_session_id');
delete from public.venues where id = 'd0000000-0000-0000-0000-0000000000d9';
select is((select count(*)::int from public.live_stacks where code = (select code from stk where name = 'd')), 0,
  'deleting a venue deletes its live stacks');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is(
  (select concat_ws('|', r ->> 'deletable', r -> 'blockers') from (select public.venue_deletion_preview('c0000000-0000-0000-0000-0000000000c9') r) s),
  'true|[]', 'a venue with only a live stack is deletable: the stack is not history');
select lives_ok($$ select public.delete_unused_venue('c0000000-0000-0000-0000-0000000000c9', 'e2e-ls-c') $$,
  'delete_unused_venue deletes a venue that only has a live stack');
select is(
  (select r -> 'blockers' from (select public.venue_deletion_preview('a0000000-0000-0000-0000-0000000000a9') r) s),
  '["open_play"]'::jsonb, 'a venue whose stack is tied to an open play session is blocked by the session only');
select is(pg_temp.hint_of($$ select public.delete_unused_venue('a0000000-0000-0000-0000-0000000000a9', 'e2e-ls-a') $$), 'venue_in_use',
  'delete_unused_venue refuses a venue with an open play session');
reset role;
select is((select count(*)::int from public.live_stacks where code = (select code from stk where name = 'c')), 0, 'the deleted venue''s stack went with it');
select is((select count(*)::int from public.live_stacks where code = (select code from stk where name = 'v')), 1, 'the refused deletion left the stack of venue A');

-- ---------------------------------------------------------------- purge
select results_eq(
  $$ select schedule, command, active from cron.job where jobname = 'purge-live-stacks' $$,
  $$ values ('0 * * * *'::text, 'select private.purge_live_stacks()'::text, true) $$,
  'the purge-live-stacks job runs hourly');
select is((select count(*)::int from cron.job where jobname = 'purge-live-stacks'), 1, 'there is exactly one purge-live-stacks job');
select ok(
  not has_function_privilege('anon', 'private.purge_live_stacks()', 'execute') and not has_function_privilege('authenticated', 'private.purge_live_stacks()', 'execute'),
  'anon and authenticated cannot run the purge');
select pg_temp.setexp('x', interval '0');
select pg_temp.setexp('k', interval '-2 days');
select lives_ok($$ select private.purge_live_stacks() $$, 'the purge runs');
select is((select count(*)::int from public.live_stacks where code in (select code from stk where name in ('x', 'k'))), 0,
  'it deletes stacks whose expires_at is now or earlier');
select is((select count(*)::int from public.live_stacks where code in (select code from stk where name in ('p', 'q', 'e', 'l', 'v', 'b'))), 6,
  'it keeps unexpired stacks, ended ones included, and venue stacks');

-- ---------------------------------------------------------------- the 300 cap (last: it fills the table)
insert into public.live_stacks (code, secret_hash, courts, title, expires_at)
select 'e2efiller' || lpad(i::text, 16, '0'), 'h', 1, 'filler', now() + interval '1 hour'
  from generate_series(1, 300 - (select count(*)::int from public.live_stacks where expires_at > now())) i;
select is((select count(*)::int from public.live_stacks where expires_at > now()), 300, 'the table holds 300 unexpired stacks');
set local role service_role;
select is(pg_temp.hint_of($$ select private.create_live_stack('over', 2, null, null) $$), 'busy', 'create_live_stack refuses the 301st unexpired stack with busy');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.create_venue_live_stack('e0000000-0000-0000-0000-000000000006') $$), 'busy',
  'create_venue_live_stack gives busy at the cap');
select is(pg_temp.hint_of($$ select public.create_venue_live_stack('e0000000-0000-0000-0000-000000000005') $$), 'session_ended',
  'session_ended comes before busy');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.create_venue_live_stack('e0000000-0000-0000-0000-000000000006') $$), 'forbidden',
  'forbidden comes before busy');
reset role;
update public.live_stacks set expires_at = now() - interval '1 second'
 where code = (select code from public.live_stacks where title = 'filler' order by code limit 1);
set local role service_role;
select lives_ok($$ select private.create_live_stack('fits', 2, null, null) $$, 'an expired stack does not count towards the cap');
select is(pg_temp.hint_of($$ select private.create_live_stack('over again', 2, null, null) $$), 'busy', 'and the cap holds again once it is full');
reset role;

select * from finish();
rollback;
