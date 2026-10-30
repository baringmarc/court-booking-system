-- T12.2: venues, venue_members, platform_admins, private.is_venue_admin(uuid), private.is_platform_admin().
-- Clients can read per RLS but never write. Existing private.is_admin() / profiles.role keep working.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

-- helpers (run as the calling role)
create function pg_temp.visible(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;
grant execute on function pg_temp.visible(text) to anon, authenticated;

-- true when the write fails with a privilege/RLS error or touches zero rows
create function pg_temp.write_blocked(p_sql text) returns boolean language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n = 0;
exception when insufficient_privilege then
  return true;
end $$;
grant execute on function pg_temp.write_blocked(text) to anon, authenticated;

-- how many of the reserved slugs are rejected
create function pg_temp.reserved_rejected() returns int language plpgsql as $$
declare s text; n int := 0;
begin
  foreach s in array array['www','app','api','admin','mail','demo','plotline','support','status','staging'] loop
    begin
      insert into public.venues (slug) values (s);
    exception when check_violation then
      n := n + 1;
    end;
  end loop;
  return n;
end $$;

-- status a freshly inserted venue gets
create function pg_temp.default_status() returns text language plpgsql as $$
declare st text;
begin
  insert into public.venues (slug) values ('e2e-default') returning status into st;
  return st;
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'staff-a@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'owner-a@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'platform@test.local'),
  ('55555555-5555-5555-5555-555555555555', 'owner-b@test.local'),
  ('66666666-6666-6666-6666-666666666666', 'legacy-admin@test.local');
update public.profiles set role = 'admin' where id = '66666666-6666-6666-6666-666666666666';

insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-00000000000a', 'e2e-venue-a', 'active'),
  ('b0000000-0000-0000-0000-00000000000b', 'e2e-venue-b', 'draft'),
  ('c0000000-0000-0000-0000-00000000000c', 'e2e-venue-c', 'suspended');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'staff'),
  ('a0000000-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333', 'owner'),
  ('b0000000-0000-0000-0000-00000000000b', '55555555-5555-5555-5555-555555555555', 'owner');
insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');

-- seed
select is((select status from public.venues where slug = 'claudex-courts'), 'active', 'seed: claudex-courts venue exists and is active');

-- constraints (as postgres)
select throws_ok($$insert into public.venues (slug) values ('Upper-Case')$$, '23514', null, 'constraint: slug must be lowercase');
select throws_ok($$insert into public.venues (slug) values ('ab')$$, '23514', null, 'constraint: slug shorter than 3 chars rejected');
select throws_ok($$insert into public.venues (slug) values (repeat('a', 41))$$, '23514', null, 'constraint: slug longer than 40 chars rejected');
select throws_ok($$insert into public.venues (slug) values ('under_score')$$, '23514', null, 'constraint: slug allows only a-z, 0-9 and hyphen');
select is(pg_temp.reserved_rejected(), 10, 'constraint: all 10 reserved slugs are rejected');
select throws_ok($$insert into public.venues (slug) values ('e2e-venue-a')$$, '23505', null, 'constraint: slug is unique');
select throws_ok($$insert into public.venues (slug, status) values ('e2e-bad-status', 'open')$$, '23514', null, 'constraint: status must be draft/active/suspended/closed');
select is(pg_temp.default_status(), 'draft', 'default: new venue status is draft');
select throws_ok($$insert into public.venue_members (venue_id, user_id, role) values ('c0000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'manager')$$, '23514', null, 'constraint: member role must be owner or staff');
select throws_ok($$insert into public.venue_members (venue_id, user_id, role) values ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'owner')$$, '23505', null, 'constraint: one membership row per (venue, user)');
insert into public.venues (id, slug) values ('d0000000-0000-0000-0000-00000000000d', 'e2e-cascade');
insert into public.venue_members values ('d0000000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'staff');
delete from public.venues where id = 'd0000000-0000-0000-0000-00000000000d';
select is((select count(*) from public.venue_members where venue_id = 'd0000000-0000-0000-0000-00000000000d'), 0::bigint, 'fk: deleting a venue cascades to its members');
select lives_ok($$insert into public.venues (slug) values ('abc-123')$$, 'constraint: valid slug accepted');

-- helpers (evaluated as postgres; identity comes from the jwt claims)
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(private.is_venue_admin('a0000000-0000-0000-0000-00000000000a'), false, 'is_venue_admin: anon is false');
select is(private.is_platform_admin(), false, 'is_platform_admin: anon is false');
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(private.is_venue_admin('a0000000-0000-0000-0000-00000000000a'), false, 'is_venue_admin: player is false');
select is(private.is_platform_admin(), false, 'is_platform_admin: player is false');
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(private.is_venue_admin('a0000000-0000-0000-0000-00000000000a'), true, 'is_venue_admin: staff of venue A is true for A');
select is(private.is_venue_admin('b0000000-0000-0000-0000-00000000000b'), false, 'is_venue_admin: staff of A is false for venue B');
select is(private.is_platform_admin(), false, 'is_platform_admin: staff is false');
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is(private.is_venue_admin('a0000000-0000-0000-0000-00000000000a'), true, 'is_venue_admin: owner of A is true for A');
select is(private.is_platform_admin(), false, 'is_platform_admin: venue owner is false');
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(private.is_venue_admin('b0000000-0000-0000-0000-00000000000b'), true, 'is_venue_admin: platform admin is true for any venue');
select is(private.is_platform_admin(), true, 'is_platform_admin: platform admin is true');

-- RLS: venues
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.visible($$select count(*) from public.venues where slug like 'e2e-venue-%'$$), 1::bigint, 'rls venues: anon sees only the active test venue');
select is(pg_temp.visible($$select count(*) from public.venues where slug = 'claudex-courts'$$), 1::bigint, 'rls venues: anon sees the active seeded venue');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.venues where slug like 'e2e-venue-%'$$), 1::bigint, 'rls venues: player sees only active venues');
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.venues where slug like 'e2e-venue-%'$$), 1::bigint, 'rls venues: staff of A sees A only (B draft and C suspended hidden)');
select set_config('request.jwt.claims', '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.venues where slug like 'e2e-venue-%'$$), 2::bigint, 'rls venues: owner of draft B sees active A plus own B');
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.venues where slug like 'e2e-venue-%'$$), 3::bigint, 'rls venues: platform admin sees all statuses');

-- RLS: venue_members
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.visible($$select count(*) from public.venue_members$$), 0::bigint, 'rls members: anon sees nothing');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.venue_members$$), 0::bigint, 'rls members: player with no membership sees nothing');
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.venue_members$$), 1::bigint, 'rls members: staff sees only own row');
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.venue_members where venue_id = 'a0000000-0000-0000-0000-00000000000a'$$), 2::bigint, 'rls members: owner of A sees all rows of venue A');
select is(pg_temp.visible($$select count(*) from public.venue_members where venue_id = 'b0000000-0000-0000-0000-00000000000b'$$), 0::bigint, 'rls members: owner of A cannot see venue B rows');
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.venue_members where venue_id in ('a0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000b')$$), 3::bigint, 'rls members: platform admin sees all rows');

-- RLS: platform_admins
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.visible($$select count(*) from public.platform_admins$$), 0::bigint, 'rls platform_admins: anon sees nothing');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.platform_admins$$), 0::bigint, 'rls platform_admins: player sees nothing');
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.platform_admins$$), 0::bigint, 'rls platform_admins: venue owner sees nothing');
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select is(pg_temp.visible($$select count(*) from public.platform_admins where user_id = '44444444-4444-4444-4444-444444444444'$$), 1::bigint, 'rls platform_admins: platform admin reads own row');

-- client writes denied
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select ok(pg_temp.write_blocked($$insert into public.venues (slug) values ('e2e-anon-write')$$), 'writes: anon cannot insert a venue');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select ok(pg_temp.write_blocked($$insert into public.venues (slug) values ('e2e-owner-write')$$), 'writes: owner cannot insert a venue');
select ok(pg_temp.write_blocked($$update public.venues set status = 'closed' where id = 'a0000000-0000-0000-0000-00000000000a'$$), 'writes: owner cannot update a venue');
select ok(pg_temp.write_blocked($$delete from public.venues where id = 'a0000000-0000-0000-0000-00000000000a'$$), 'writes: owner cannot delete a venue');
select ok(pg_temp.write_blocked($$insert into public.venue_members values ('b0000000-0000-0000-0000-00000000000b', '33333333-3333-3333-3333-333333333333', 'owner')$$), 'writes: user cannot add a membership');
select ok(pg_temp.write_blocked($$update public.venue_members set role = 'owner' where user_id = '22222222-2222-2222-2222-222222222222'$$), 'writes: owner cannot change a member role');
select ok(pg_temp.write_blocked($$delete from public.venue_members where user_id = '22222222-2222-2222-2222-222222222222'$$), 'writes: owner cannot remove a member');
select ok(pg_temp.write_blocked($$insert into public.platform_admins values ('33333333-3333-3333-3333-333333333333')$$), 'writes: user cannot make themselves platform admin');
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select ok(pg_temp.write_blocked($$insert into public.venues (slug) values ('e2e-pa-write')$$), 'writes: platform admin cannot insert a venue through the client');
select ok(pg_temp.write_blocked($$update public.venues set status = 'closed' where id = 'a0000000-0000-0000-0000-00000000000a'$$), 'writes: platform admin cannot update a venue through the client');

-- data intact
reset role;
select is((select status from public.venues where id = 'a0000000-0000-0000-0000-00000000000a'), 'active', 'intact: venue A unchanged');
select is((select role from public.venue_members where user_id = '22222222-2222-2222-2222-222222222222'), 'staff', 'intact: staff role unchanged');
select is((select count(*) from public.platform_admins), 1::bigint, 'intact: still exactly one platform admin (test fixture)');

-- legacy admin keeps working
select set_config('request.jwt.claims', '{"sub": "66666666-6666-6666-6666-666666666666", "role": "authenticated"}', true);
select is(private.is_admin(), true, 'legacy: profiles.role=admin still passes private.is_admin()');
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(private.is_admin(), false, 'legacy: player still fails private.is_admin()');

select * from finish();
rollback;
