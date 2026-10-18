-- Milestone 1: profiles, signup trigger, role protection, is_admin().
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local', '{"full_name": "Pat Player"}'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local',  '{"name": "Ada Admin"}'),
  ('33333333-3333-3333-3333-333333333333', 'sneaky@test.local', '{"full_name": "Sam Sneaky", "role": "admin"}');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

select is(
  (select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Pat Player', 'signup trigger creates a profile from full_name'
);
select is(
  (select full_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Ada Admin', 'signup trigger falls back to name (Google)'
);
select is(
  (select role from public.profiles where id = '33333333-3333-3333-3333-333333333333'),
  'player'::public.user_role, 'signup ignores a role in user metadata: new accounts are always players'
);

-- As the player
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select is((select count(*)::int from public.profiles), 1, 'player sees only their own profile');
select ok(not private.is_admin(), 'player is not admin');
select throws_ok(
  $$ update public.profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'player cannot change their own role'
);
select lives_ok(
  $$ update public.profiles set full_name = 'Hacked' where id = '22222222-2222-2222-2222-222222222222' $$,
  'updating another profile is silently filtered by RLS'
);

-- As the admin
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is(
  (select full_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Ada Admin', 'the player''s update did not change the other profile'
);
select ok(private.is_admin(), 'admin is admin');
select cmp_ok((select count(*)::int from public.profiles), '>=', 2, 'admin sees all profiles');

-- As anon
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');

select * from finish();
rollback;
