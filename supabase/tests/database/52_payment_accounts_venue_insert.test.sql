-- T12.10: a venue admin inserts a payment account naming their own venue_id; another venue's id is refused by RLS,
-- and venue_id stays out of the UPDATE grant.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'staff-a@test.local'),
  ('b2222222-2222-2222-2222-222222222222', 'player@test.local');
insert into public.venues (id, slug, status) values ('b0000000-0000-0000-0000-00000000000b', 'e2e-pay-venue-b', 'active');
insert into public.venue_members (venue_id, user_id, role)
  select id, 'a1111111-1111-1111-1111-111111111111', 'staff' from public.venues where slug = 'claudex-courts';

select ok(has_column_privilege('authenticated', 'public.venue_payment_accounts', 'venue_id', 'insert'),
  'authenticated may insert venue_id');
select ok(not has_column_privilege('authenticated', 'public.venue_payment_accounts', 'venue_id', 'update'),
  'authenticated may not update venue_id (an account never moves venue)');
select ok(not has_column_privilege('anon', 'public.venue_payment_accounts', 'venue_id', 'insert'), 'anon may not insert venue_id');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "a1111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);

select lives_ok(
  $$ insert into public.venue_payment_accounts (venue_id, label, account_name, account_number)
     select id, 'E2E Own', 'Ada', '0917' from public.venues where slug = 'claudex-courts' $$,
  'staff insert an account naming their own venue');
select throws_ok(
  $$ insert into public.venue_payment_accounts (venue_id, label, account_name, account_number)
     values ('b0000000-0000-0000-0000-00000000000b', 'E2E Other', 'Ada', '0917') $$,
  '42501', null, 'staff cannot insert an account into another venue');

select set_config('request.jwt.claims', '{"sub": "b2222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select throws_ok(
  $$ insert into public.venue_payment_accounts (venue_id, label, account_name, account_number)
     select id, 'E2E Player', 'Pat', '0917' from public.venues where slug = 'claudex-courts' $$,
  '42501', null, 'a player cannot insert an account');

select * from finish();
rollback;
