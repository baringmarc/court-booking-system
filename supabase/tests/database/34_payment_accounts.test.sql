-- T11.10: venue_payment_accounts (checks, the 10-account cap, append order, reorder_payment_accounts) and the
-- payment-qr bucket and its storage policies. Anyone reads accounts; only admins write them or upload QR codes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';
delete from public.venue_payment_accounts; -- local edits can't break the counts below

create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true)
$$;
create function pg_temp.as_player() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true)
$$;
create function pg_temp.order_of() returns text language sql as $$
  select string_agg(label, ',' order by position) from public.venue_payment_accounts
$$;

-- ---------------------------------------------------------------------------
-- Shape and privileges
-- ---------------------------------------------------------------------------
select has_table('public', 'venue_payment_accounts', 'venue_payment_accounts exists');
select ok((select relrowsecurity from pg_class where oid = 'public.venue_payment_accounts'::regclass), 'RLS is on');
select ok(not has_table_privilege('anon', 'public.venue_payment_accounts', 'insert'), 'anon has no insert grant');
select ok(not has_column_privilege('authenticated', 'public.venue_payment_accounts', 'position', 'update'),
  'clients cannot update position directly');
select ok(not has_column_privilege('authenticated', 'public.venue_payment_accounts', 'position', 'insert'),
  'clients cannot insert a position');
select ok(has_column_privilege('authenticated', 'public.venue_payment_accounts', 'qr_path', 'update'), 'qr_path is updatable by grant');
select ok(not has_function_privilege('anon', 'public.reorder_payment_accounts(uuid[])', 'execute'), 'anon cannot execute the reorder');
select ok(has_function_privilege('authenticated', 'public.reorder_payment_accounts(uuid[])', 'execute'), 'authenticated can execute the reorder');
select ok((select prosecdef from pg_proc where oid = 'public.reorder_payment_accounts(uuid[])'::regprocedure), 'the reorder is security definer');
select ok(not has_function_privilege('authenticated', 'private.venue_payment_accounts_append()', 'execute'), 'the append trigger function is not callable');

-- ---------------------------------------------------------------------------
-- Admin: insert, checks, append order, the cap
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_admin();
select lives_ok(
  $$ insert into public.venue_payment_accounts (label, account_name, account_number, qr_path)
     values ('GCash', 'Claudex Courts', '0917 000 0000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png') $$,
  'an admin adds an account with a QR code');
select lives_ok($$ insert into public.venue_payment_accounts (label) values ('Maya') $$, 'name, number and QR are optional');
select lives_ok($$ insert into public.venue_payment_accounts (label, account_number) values ('BPI', '1234-5678-90') $$, 'a third account');
select is(pg_temp.order_of(), 'GCash,Maya,BPI', 'new accounts go last');
select is((select string_agg(position::text, ',' order by position) from public.venue_payment_accounts), '0,1,2', 'positions start at 0');
select is((select account_name from public.venue_payment_accounts where label = 'Maya'), '', 'account_name defaults to empty');
select is((select qr_path from public.venue_payment_accounts where label = 'Maya'), null, 'qr_path defaults to none');
select throws_ok($$ insert into public.venue_payment_accounts (label, position) values ('X', 0) $$, '42501', null,
  'an admin cannot pick a position either');
select throws_ok($$ update public.venue_payment_accounts set position = 9 $$, '42501', null, 'or change one directly');

select throws_ok($$ insert into public.venue_payment_accounts (label) values ('') $$, '23514', null, 'a label is required');
select throws_ok($$ insert into public.venue_payment_accounts (label) values (' GCash') $$, '23514', null, 'labels are trimmed');
select throws_ok($$ insert into public.venue_payment_accounts (label) values (repeat('a', 41)) $$, '23514', null, 'labels are at most 40');
select lives_ok($$ update public.venue_payment_accounts set label = repeat('a', 40) where label = 'BPI' $$, '40 characters is fine');
update public.venue_payment_accounts set label = 'BPI' where label = repeat('a', 40);
select throws_ok($$ update public.venue_payment_accounts set account_name = repeat('a', 81) $$, '23514', null, 'account names are at most 80');
select throws_ok($$ update public.venue_payment_accounts set account_name = 'Ana ' $$, '23514', null, 'account names are trimmed');
select throws_ok($$ update public.venue_payment_accounts set account_number = repeat('1', 61) $$, '23514', null, 'account numbers are at most 60');
select throws_ok($$ update public.venue_payment_accounts set account_number = ' 0917' $$, '23514', null, 'account numbers are trimmed');
select throws_ok($$ update public.venue_payment_accounts set qr_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg' where label = 'Maya' $$,
  '23514', null, 'a QR code must be PNG');
select throws_ok($$ update public.venue_payment_accounts set qr_path = 'banner/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png' where label = 'Maya' $$,
  '23514', null, 'a QR path has no folder');
select throws_ok($$ update public.venue_payment_accounts set qr_path = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.png' where label = 'Maya' $$,
  '23514', null, 'a QR path is a lowercase uuid');

select lives_ok(
  $$ insert into public.venue_payment_accounts (label) select 'Bank ' || g from generate_series(4, 10) g $$,
  'up to 10 accounts');
select throws_matching(
  $$ insert into public.venue_payment_accounts (label) values ('Eleventh') $$,
  'at most 10 payment accounts', 'an 11th account is refused');
select is((select count(*)::int from public.venue_payment_accounts), 10, 'still 10');
delete from public.venue_payment_accounts where label like 'Bank %';

-- ---------------------------------------------------------------------------
-- reorder_payment_accounts
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.reorder_payment_accounts(array(select id from public.venue_payment_accounts order by
       array_position(array['BPI', 'GCash', 'Maya'], label))) $$,
  'an admin saves a whole new order');
select is(pg_temp.order_of(), 'BPI,GCash,Maya', 'the order is saved');
select is((select string_agg(position::text, ',' order by position) from public.venue_payment_accounts), '0,1,2', 'renumbered 0..n-1');
select throws_matching(
  $$ select public.reorder_payment_accounts(array(select id from public.venue_payment_accounts where label <> 'Maya')) $$,
  'out of date', 'a list missing an account is refused');
select throws_matching(
  $$ select public.reorder_payment_accounts(array(select id from public.venue_payment_accounts) || (select id from public.venue_payment_accounts where label = 'BPI')) $$,
  'out of date', 'a list with a duplicate is refused');
select throws_matching(
  $$ select public.reorder_payment_accounts(array(select id from public.venue_payment_accounts) || gen_random_uuid()) $$,
  'out of date', 'a list with an unknown id is refused');
select throws_matching($$ select public.reorder_payment_accounts(null) $$, 'Choose the accounts', 'a null list is refused');
select lives_ok($$ insert into public.venue_payment_accounts (label) values ('InstaPay') $$, 'an account added after a reorder');
select is(pg_temp.order_of(), 'BPI,GCash,Maya,InstaPay', 'still goes last');

-- ---------------------------------------------------------------------------
-- Player and anon: read, never write
-- ---------------------------------------------------------------------------
select pg_temp.as_player();
select is((select count(*)::int from public.venue_payment_accounts), 4, 'a player reads every account');
select throws_ok($$ insert into public.venue_payment_accounts (label) values ('Mine') $$, '42501', null, 'a player cannot add an account');
update public.venue_payment_accounts set label = 'Hacked';
delete from public.venue_payment_accounts;
select is(pg_temp.order_of(), 'BPI,GCash,Maya,InstaPay', 'a player''s update and delete are filtered by RLS');
select throws_matching(
  $$ select public.reorder_payment_accounts(array(select id from public.venue_payment_accounts)) $$,
  'Only staff', 'a player cannot reorder');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from public.venue_payment_accounts), 4, 'anon reads every account');
select throws_ok($$ insert into public.venue_payment_accounts (label) values ('Anon') $$, '42501', null, 'anon cannot add an account');
select throws_ok($$ update public.venue_payment_accounts set label = 'Anon' $$, '42501', null, 'anon cannot update accounts');
select throws_ok($$ delete from public.venue_payment_accounts $$, '42501', null, 'anon cannot delete accounts');
reset role;

-- ---------------------------------------------------------------------------
-- The payment-qr bucket and its storage policies
-- ---------------------------------------------------------------------------
-- Storage blocks SQL deletes, so the delete rule is checked through its definition (as 17_venue_media does).
select ok(
  (select qual like '%payment-qr%' and qual like '%is_admin()%' from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname = 'Admins delete payment QR codes'),
  'only admins can delete QR codes, and only in this bucket');
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'payment-qr' $$,
  $$ values (true, 1048576::bigint, array['image/png']) $$,
  'payment-qr is public, 1 MB, PNG only');
select is(
  (select string_agg(policyname || ' ' || cmd || ' ' || array_to_string(roles, ','), '; ' order by policyname)::text
   from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like '%payment QR codes'),
  'Admins delete payment QR codes DELETE authenticated; Admins read payment QR codes SELECT authenticated; '
  || 'Admins upload payment QR codes INSERT authenticated',
  'exactly three payment-qr policies, all for authenticated (no update, no anon)');

set local role authenticated;
select pg_temp.as_admin();
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png') $$,
  'an admin uploads a QR code at a fresh <uuid>.png');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'qr/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png') $$,
  '42501', null, 'not in a folder');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.webp') $$,
  '42501', null, 'not under another extension');
select is((select count(*)::int from storage.objects where bucket_id = 'payment-qr'), 1, 'an admin can list the QR codes (remove() needs it)');

select pg_temp.as_player();
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('payment-qr', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd.png') $$,
  '42501', null, 'a player cannot upload a QR code');
select is((select count(*)::int from storage.objects where bucket_id = 'payment-qr'), 0, 'a player cannot list the QR codes');

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'payment-qr'), 0, 'anon cannot list the QR codes (public URLs need no policy)');
reset role;

select * from finish();
rollback;
