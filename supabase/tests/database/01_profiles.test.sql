-- Milestone 1: profiles, signup trigger, role protection. Admin rights come from venue_members since T12.11.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local', '{"full_name": "Pat Player"}'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local',  '{"name": "Ada Admin"}'),
  ('33333333-3333-3333-3333-333333333333', 'sneaky@test.local', '{"full_name": "Sam Sneaky", "role": "admin"}');
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';

select is(
  (select full_name from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'Pat Player', 'signup trigger creates a profile from full_name'
);
select is(
  (select full_name from public.profiles where id = '22222222-2222-2222-2222-222222222222'),
  'Ada Admin', 'signup trigger falls back to name (Google)'
);
select is(
  (select count(*)::int from public.venue_members where user_id = '33333333-3333-3333-3333-333333333333')
    + (select count(*)::int from public.platform_admins where user_id = '33333333-3333-3333-3333-333333333333'),
  0, 'signup ignores a role in user metadata: new accounts are always players'
);

-- As the player
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select is((select count(*)::int from public.profiles), 1, 'player sees only their own profile');
select ok(not private.is_venue_admin((select id from public.venues where slug = 'claudex-courts')), 'player is not admin');
select throws_ok(
  $$ insert into public.venue_members (venue_id, user_id, role) select id, '11111111-1111-1111-1111-111111111111', 'owner' from public.venues where slug = 'claudex-courts' $$,
  '42501', null, 'player cannot make themselves an admin'
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
select ok(private.is_venue_admin((select id from public.venues where slug = 'claudex-courts')), 'admin is admin');
select is((select count(*)::int from public.profiles where id::text like any (array['1111%', '2222%', '3333%'])), 1,
  'venue admin sees only their own profile until a player books at their venue (T12.4)');

-- As anon
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');

select * from finish();
rollback;
