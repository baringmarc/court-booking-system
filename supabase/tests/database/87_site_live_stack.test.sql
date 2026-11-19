-- T29.5: public.create_site_live_stack(p_title text, p_courts integer) returns jsonb, the RPC the stack-live Edge Function
-- calls with the service role. It wraps private.create_live_stack(p_title, p_courts, null, null): service_role only, a stack
-- with no venue and no session, only the secret's hash stored, the same invalid_input and busy hints (86_live_stacks).
begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

create temp table stk (name text primary key, code text, secret text, raw jsonb);
grant all on stk to anon, authenticated, service_role;

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
create function pg_temp.pub(p_name text, p_ver int, p_snap jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  select public.publish_live_stack((select code from stk where name = p_name), (select secret from stk where name = p_name), p_ver, p_snap, false) into r;
  return r;
end $$;
create function pg_temp.get(p_name text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  select public.get_live_stack((select code from stk where name = p_name)) into r;
  return r;
end $$;
grant execute on function pg_temp.hint_of(text), pg_temp.pub(text, int, jsonb), pg_temp.get(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------- who may call it
select ok(
  not has_function_privilege('anon', 'public.create_site_live_stack(text, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_site_live_stack(text, integer)', 'execute')
  and has_function_privilege('service_role', 'public.create_site_live_stack(text, integer)', 'execute'),
  'create_site_live_stack is executable by service_role only');
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.create_site_live_stack('E2E site stack', 2) $$, '42501', null, 'anon cannot call create_site_live_stack');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok($$ select public.create_site_live_stack('E2E site stack', 2) $$, '42501', null, 'a signed-in user cannot call create_site_live_stack');
reset role;

-- ---------------------------------------------------------------- what the service role gets
set local role service_role;
insert into stk
select n, r ->> 'code', r ->> 'secret', r
  from (select 'a' n, public.create_site_live_stack('E2E site stack', 2) r
        union all select 'nul', public.create_site_live_stack(null, 3)
        union all select 'trim', public.create_site_live_stack('   E2E Trim   ', 4)
        union all select 'blank', public.create_site_live_stack('   ', 5)) s;
reset role;

select is((select array_agg(k order by k) from stk, jsonb_object_keys(raw) k where name = 'a'), array['code', 'secret'], 'it returns exactly code and secret');
select is(
  (select concat_ws('|', title, courts, (venue_id is null)::text, (open_play_session_id is null)::text, version, publish_count, (snapshot is null)::text, (ended_at is null)::text)
     from public.live_stacks where code = (select code from stk where name = 'a')),
  'E2E site stack|2|true|true|0|0|true|true',
  'the stack has its title and courts, no venue and no session, version 0, no snapshot, not ended');
select is((select count(*)::int from public.live_stacks l, stk s where l.secret_hash = s.secret or strpos(l::text, s.secret) > 0), 0,
  'the table stores only a hash: no column of any row holds a returned secret');
select ok(
  (select secret_hash ~ '^[0-9a-f]{64}$' from public.live_stacks where code = (select code from stk where name = 'a')),
  'secret_hash is a 64-character hex digest');

-- the returned secret publishes, the code reads
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.pub('a', 1, '{"v":1,"players":["Ann"]}') ->> 'version', '1', 'the returned secret publishes through publish_live_stack');
select is(pg_temp.get('a') -> 'snapshot', '{"v":1,"players":["Ann"]}'::jsonb, 'get_live_stack reads the published snapshot by the returned code');
select is(pg_temp.get('a') -> 'venue', 'null'::jsonb, 'the stack has a JSON null venue');
reset role;

-- title handling
select ok((select title is null from public.live_stacks where code = (select code from stk where name = 'nul')), 'a null title is stored as null');
select is((select title from public.live_stacks where code = (select code from stk where name = 'trim')), 'E2E Trim', 'a title is trimmed');
select ok((select title is null from public.live_stacks where code = (select code from stk where name = 'blank')), 'a blank title is stored as null');

-- ---------------------------------------------------------------- invalid_input
set local role service_role;
select is(pg_temp.hint_of($$ select public.create_site_live_stack('t', 0) $$), 'invalid_input', 'courts 0 is invalid_input');
select is(pg_temp.hint_of($$ select public.create_site_live_stack('t', 13) $$), 'invalid_input', 'courts 13 is invalid_input');
select is(pg_temp.hint_of($$ select public.create_site_live_stack('t', null) $$), 'invalid_input', 'null courts is invalid_input');
select is(pg_temp.hint_of($$ select public.create_site_live_stack(repeat('t', 61), 2) $$), 'invalid_input', 'a title of 61 characters is invalid_input');
select lives_ok($$ select public.create_site_live_stack('  ' || repeat('t', 60) || '  ', 2) $$, 'a title of 60 characters after trimming is accepted');
select lives_ok($$ select public.create_site_live_stack('one', 1) $$, 'courts 1 is accepted');
select lives_ok($$ select public.create_site_live_stack('twelve', 12) $$, 'courts 12 is accepted');
reset role;

-- ---------------------------------------------------------------- busy at 300 (last: it fills the table)
insert into public.live_stacks (code, secret_hash, courts, title, expires_at)
select 'e2esitefiller' || lpad(i::text, 12, '0'), 'h', 1, 'filler', now() + interval '1 hour'
  from generate_series(1, 300 - (select count(*)::int from public.live_stacks where expires_at > now())) i;
set local role service_role;
select is(pg_temp.hint_of($$ select public.create_site_live_stack('over', 2) $$), 'busy', 'the 301st unexpired stack is refused with busy');
reset role;

select * from finish();
rollback;
