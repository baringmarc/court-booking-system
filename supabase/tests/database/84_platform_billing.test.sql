-- T26.3: platform_payment_accounts (checks, 5-account cap, append order, reorder_platform_payment_accounts), the
-- platform-billing bucket and its storage policies, invoice_sends (read-only log) and the additive last_emailed_at /
-- email_count keys on the platform admin's invoice RPCs (never on the venue's statement_invoices_page).
begin;
create extension if not exists pgtap with schema extensions;
select plan(107);

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare s text; h text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return s || '|' || coalesce(h, '');
end $$;
-- row count of a count(*) query, or the sqlstate when the role may not even read the table
create function pg_temp.seen(p_sql text) returns text language plpgsql as $$
declare n bigint;
begin
  execute p_sql into n;
  return n::text;
exception when others then
  return sqlstate;
end $$;
create function pg_temp.order_of() returns text language plpgsql as $$
begin
  return (select string_agg(label, ',' order by position) from public.platform_payment_accounts);
end $$;
-- the invoice with this id out of a json array
create function pg_temp.inv(p jsonb, p_id text) returns jsonb language sql as $$
  select e from jsonb_array_elements(p) e where e ->> 'invoice_id' = p_id
$$;
create function pg_temp.em(e jsonb) returns text language sql as $$
  select (e ? 'last_emailed_at')::text || '|' || jsonb_typeof(e -> 'last_emailed_at') || '|' || jsonb_typeof(e -> 'email_count') || '|' || (e ->> 'email_count')
$$;
-- rows affected by a data-modifying statement
create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.affected(text) to anon, authenticated;
grant execute on function pg_temp.err(text), pg_temp.seen(text), pg_temp.order_of(), pg_temp.inv(jsonb, text), pg_temp.em(jsonb) to anon, authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000084a1', 'e2e-pb-player@example.com'),
  ('00000000-0000-0000-0000-0000000084a2', 'e2e-pb-platform@example.com'),
  ('00000000-0000-0000-0000-0000000084a3', 'e2e-pb-owner@example.com');
insert into public.venues (id, slug, status) values ('a0000000-0000-0000-0000-0000000084a1', 'e2e-pb-alpha', 'active');
insert into public.venue_settings (venue_id, name, timezone) values ('a0000000-0000-0000-0000-0000000084a1', 'E2E PB Alpha', 'Asia/Manila');
insert into public.venue_members (venue_id, user_id, role) values ('a0000000-0000-0000-0000-0000000084a1', '00000000-0000-0000-0000-0000000084a3', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000084a2');
insert into public.invoices (id, venue_id, billing_month, status, sent_at) values
  ('d0000000-0000-0000-0000-0000000084e1', 'a0000000-0000-0000-0000-0000000084a1', '2030-02-01', 'draft', null),
  ('d0000000-0000-0000-0000-0000000084e2', 'a0000000-0000-0000-0000-0000000084a1', '2030-01-01', 'sent', now() - interval '1 day');
delete from public.platform_payment_accounts; -- local edits can't break the counts below

-- ---------------------------------------------------------------- shape and privileges
select has_table('public', 'platform_payment_accounts', 'platform_payment_accounts exists');
select ok((select relrowsecurity from pg_class where oid = 'public.platform_payment_accounts'::regclass), 'RLS is on for platform_payment_accounts');
select has_table('public', 'invoice_sends', 'invoice_sends exists');
select ok((select relrowsecurity from pg_class where oid = 'public.invoice_sends'::regclass), 'RLS is on for invoice_sends');
select ok(not has_table_privilege('anon', 'public.platform_payment_accounts', 'insert'), 'anon has no insert grant on accounts');
select ok(not has_column_privilege('authenticated', 'public.platform_payment_accounts', 'position', 'insert'), 'clients cannot insert a position');
select ok(not has_column_privilege('authenticated', 'public.platform_payment_accounts', 'position', 'update'), 'clients cannot update position directly');
select ok(has_column_privilege('authenticated', 'public.platform_payment_accounts', 'qr_path', 'update'), 'qr_path is updatable by grant');
select ok(not has_function_privilege('anon', 'public.reorder_platform_payment_accounts(uuid[])', 'execute'), 'anon cannot execute the reorder');
select ok(has_function_privilege('authenticated', 'public.reorder_platform_payment_accounts(uuid[])', 'execute'), 'authenticated can execute the reorder');
select ok((select prosecdef from pg_proc where oid = 'public.reorder_platform_payment_accounts(uuid[])'::regprocedure), 'the reorder is security definer');
select ok(not has_table_privilege('authenticated', 'public.invoice_sends', 'insert'), 'authenticated has no insert grant on invoice_sends');
select ok(not has_table_privilege('authenticated', 'public.invoice_sends', 'update'), 'authenticated has no update grant on invoice_sends');
select ok(not has_table_privilege('authenticated', 'public.invoice_sends', 'delete'), 'authenticated has no delete grant on invoice_sends');
select ok(not has_table_privilege('anon', 'public.invoice_sends', 'insert'), 'anon has no insert grant on invoice_sends');
select ok(not has_table_privilege('anon', 'public.invoice_sends', 'update'), 'anon has no update grant on invoice_sends');
select ok(not has_table_privilege('anon', 'public.invoice_sends', 'delete'), 'anon has no delete grant on invoice_sends');

-- ---------------------------------------------------------------- invoice_sends constraints (as the service role) and seed
select lives_ok($$ insert into public.invoice_sends (id, invoice_id, sent_by, recipients, kind, provider_id, created_at) values
  ('50000000-0000-0000-0000-0000000084c1', 'd0000000-0000-0000-0000-0000000084e2', '00000000-0000-0000-0000-0000000084a2', array['owner@example.com'], 'send', null, '2030-01-01 10:00+00'),
  ('50000000-0000-0000-0000-0000000084c2', 'd0000000-0000-0000-0000-0000000084e2', '00000000-0000-0000-0000-0000000084a2', array['owner@example.com', 'ops@example.com'], 'resend', 'prov-1', '2030-01-02 11:00+00') $$,
  'the service role records sends (send and resend, provider id optional)');
select throws_ok($$ insert into public.invoice_sends (invoice_id, sent_by, recipients, kind) values ('d0000000-0000-0000-0000-0000000084e2', '00000000-0000-0000-0000-0000000084a2', '{}', 'send') $$, '23514', null, 'a send needs at least one recipient');
select throws_ok($$ insert into public.invoice_sends (invoice_id, sent_by, recipients, kind) values ('d0000000-0000-0000-0000-0000000084e2', '00000000-0000-0000-0000-0000000084a2', array['a@example.com'], 'bogus') $$, '23514', null, 'kind is send or resend');
select throws_ok($$ insert into public.invoice_sends (invoice_id, sent_by, recipients, kind) values ('d0000000-0000-0000-0000-0000000084ff', '00000000-0000-0000-0000-0000000084a2', array['a@example.com'], 'send') $$, '23503', null, 'a send belongs to a real invoice');
select throws_ok($$ insert into public.invoice_sends (invoice_id, sent_by, recipients, kind) values ('d0000000-0000-0000-0000-0000000084e2', '00000000-0000-0000-0000-0000000084ff', array['a@example.com'], 'send') $$, '23503', null, 'a send is by a real user');
select throws_ok($$ insert into public.invoice_sends (invoice_id, sent_by, recipients, kind) values ('d0000000-0000-0000-0000-0000000084e2', null, array['a@example.com'], 'send') $$, '23502', null, 'sent_by is required');

-- ---------------------------------------------------------------- platform admin: accounts
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000084a2","role":"authenticated"}';
select lives_ok($$ insert into public.platform_payment_accounts (label, account_name, account_number, qr_path)
  values ('GCash', 'Plotline', '0917 000 0000', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png') $$, 'a platform admin adds an account with a QR code');
select lives_ok($$ insert into public.platform_payment_accounts (label) values ('Maya') $$, 'name, number and QR are optional');
select lives_ok($$ insert into public.platform_payment_accounts (label, account_number) values ('BPI', '1234-5678-90') $$, 'a third account');
select is(pg_temp.order_of(), 'GCash,Maya,BPI', 'new accounts go last');
select is((select count(distinct position)::int from public.platform_payment_accounts), 3, 'every account has its own position');
select is((select account_name || '|' || account_number from public.platform_payment_accounts where label = 'Maya'), '|', 'account_name and account_number default to empty');
select is((select qr_path from public.platform_payment_accounts where label = 'Maya'), null, 'qr_path defaults to none');
select throws_ok($$ insert into public.platform_payment_accounts (label, position) values ('X', 0) $$, '42501', null, 'an admin cannot pick a position');
select throws_ok($$ update public.platform_payment_accounts set position = 9 $$, '42501', null, 'or change one directly');
select throws_ok($$ insert into public.platform_payment_accounts (label) values ('') $$, '23514', null, 'a label is required');
select throws_ok($$ insert into public.platform_payment_accounts (label) values (' GCash') $$, '23514', null, 'labels are trimmed');
select throws_ok($$ insert into public.platform_payment_accounts (label) values (repeat('a', 41)) $$, '23514', null, 'labels are at most 40');
select lives_ok($$ update public.platform_payment_accounts set label = repeat('a', 40) where label = 'BPI' $$, '40 characters is fine');
update public.platform_payment_accounts set label = 'BPI' where label = repeat('a', 40);
select throws_ok($$ update public.platform_payment_accounts set account_name = repeat('a', 81) $$, '23514', null, 'account names are at most 80');
select throws_ok($$ update public.platform_payment_accounts set account_name = 'Ana ' $$, '23514', null, 'account names are trimmed');
select throws_ok($$ update public.platform_payment_accounts set account_number = repeat('1', 61) $$, '23514', null, 'account numbers are at most 60');
select throws_ok($$ update public.platform_payment_accounts set account_number = ' 0917' $$, '23514', null, 'account numbers are trimmed');
select lives_ok($$ update public.platform_payment_accounts set qr_path = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg' where label = 'Maya' $$, 'a QR code may be a JPG');
select throws_ok($$ update public.platform_payment_accounts set qr_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp' where label = 'Maya' $$, '23514', null, 'a QR code must be PNG or JPG');
select throws_ok($$ update public.platform_payment_accounts set qr_path = 'banner/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png' where label = 'Maya' $$, '23514', null, 'a QR path has no folder');
select throws_ok($$ update public.platform_payment_accounts set qr_path = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA.png' where label = 'Maya' $$, '23514', null, 'a QR path is a lowercase uuid');

select lives_ok($$ insert into public.platform_payment_accounts (label) select 'Bank ' || g from generate_series(4, 5) g $$, 'up to 5 accounts');
select is(pg_temp.err($$ insert into public.platform_payment_accounts (label) values ('Sixth') $$), 'P0001|too_many', 'a 6th account is refused with too_many');
select is((select count(*)::int from public.platform_payment_accounts), 5, 'still 5');

-- reorder
select lives_ok($$ select public.reorder_platform_payment_accounts(array(select id from public.platform_payment_accounts order by
  array_position(array['Bank 5', 'BPI', 'Maya', 'GCash', 'Bank 4'], label))) $$, 'a platform admin saves a whole new order');
select is(pg_temp.order_of(), 'Bank 5,BPI,Maya,GCash,Bank 4', 'the order is saved');
select is(pg_temp.err($$ select public.reorder_platform_payment_accounts(array(select id from public.platform_payment_accounts where label <> 'Maya')) $$), 'P0001|invalid_input', 'a list missing an account is invalid_input');
select is(pg_temp.err($$ select public.reorder_platform_payment_accounts(array(select id from public.platform_payment_accounts) || (select id from public.platform_payment_accounts where label = 'BPI')) $$), 'P0001|invalid_input', 'a list with a duplicate is invalid_input');
select is(pg_temp.err($$ select public.reorder_platform_payment_accounts(array(select id from public.platform_payment_accounts) || gen_random_uuid()) $$), 'P0001|invalid_input', 'a list with an unknown id is invalid_input');
select is(pg_temp.err($$ select public.reorder_platform_payment_accounts(null) $$), 'P0001|invalid_input', 'a null list is invalid_input');
select is(pg_temp.order_of(), 'Bank 5,BPI,Maya,GCash,Bank 4', 'refused reorders change nothing');

-- update and delete by a platform admin
select lives_ok($$ update public.platform_payment_accounts set label = 'GCash 2' where label = 'GCash' $$, 'a platform admin edits an account');
select is((select count(*)::int from public.platform_payment_accounts where label = 'GCash 2'), 1, 'the edit is saved');
select lives_ok($$ delete from public.platform_payment_accounts where label = 'Bank 4' $$, 'a platform admin deletes an account');
select is((select count(*)::int from public.platform_payment_accounts), 4, 'the delete removed one row');
select lives_ok($$ insert into public.platform_payment_accounts (label) values ('InstaPay') $$, 'an account added after a delete');
select is(pg_temp.order_of(), 'Bank 5,BPI,Maya,GCash 2,InstaPay', 'still goes last');

-- ---------------------------------------------------------------- everyone else: no read, no write
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000084a1","role":"authenticated"}';
select is(pg_temp.seen('select count(*) from public.platform_payment_accounts'), '0', 'a player sees no accounts');
select throws_ok($$ insert into public.platform_payment_accounts (label) values ('Mine') $$, '42501', null, 'a player cannot add an account');
select is(pg_temp.affected($$ update public.platform_payment_accounts set label = 'Hacked' $$), 0, 'a player''s update touches no row');
select is(pg_temp.affected($$ delete from public.platform_payment_accounts $$), 0, 'a player''s delete touches no row');
select is(pg_temp.err($$ select public.reorder_platform_payment_accounts(array(select id from public.platform_payment_accounts)) $$), 'P0001|forbidden', 'a player cannot reorder');
select is(pg_temp.seen('select count(*) from public.invoice_sends'), '0', 'a player sees no invoice sends');
select throws_ok($$ insert into public.invoice_sends (invoice_id, sent_by, recipients, kind) values ('d0000000-0000-0000-0000-0000000084e2', '00000000-0000-0000-0000-0000000084a1', array['a@example.com'], 'send') $$, '42501', null, 'a player cannot insert an invoice send');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000084a3","role":"authenticated"}';
select is(pg_temp.seen('select count(*) from public.platform_payment_accounts'), '0', 'a venue owner sees no platform accounts');
select throws_ok($$ insert into public.platform_payment_accounts (label) values ('Mine') $$, '42501', null, 'a venue owner cannot add an account');
select is(pg_temp.affected($$ update public.platform_payment_accounts set label = 'Hacked' $$), 0, 'a venue owner''s update touches no row');
select is(pg_temp.affected($$ delete from public.platform_payment_accounts $$), 0, 'a venue owner''s delete touches no row');
select is(pg_temp.err($$ select public.reorder_platform_payment_accounts(array(select id from public.platform_payment_accounts)) $$), 'P0001|forbidden', 'a venue owner cannot reorder');
select is(pg_temp.seen('select count(*) from public.invoice_sends'), '0', 'a venue owner sees no invoice sends');
select throws_ok($$ insert into public.invoice_sends (invoice_id, sent_by, recipients, kind) values ('d0000000-0000-0000-0000-0000000084e2', '00000000-0000-0000-0000-0000000084a3', array['a@example.com'], 'send') $$, '42501', null, 'a venue owner cannot insert an invoice send');

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select ok(pg_temp.seen('select count(*) from public.platform_payment_accounts') in ('0', '42501'), 'anon sees no accounts');
select throws_ok($$ insert into public.platform_payment_accounts (label) values ('Anon') $$, '42501', null, 'anon cannot add an account');
select throws_ok($$ select public.reorder_platform_payment_accounts(array[gen_random_uuid()]) $$, '42501', null, 'anon cannot execute the reorder');
select ok(pg_temp.seen('select count(*) from public.invoice_sends') in ('0', '42501'), 'anon sees no invoice sends');
select throws_ok($$ insert into public.invoice_sends (invoice_id, sent_by, recipients, kind) values ('d0000000-0000-0000-0000-0000000084e2', '00000000-0000-0000-0000-0000000084a1', array['a@example.com'], 'send') $$, '42501', null, 'anon cannot insert an invoice send');

-- ---------------------------------------------------------------- invoice_sends: platform admin reads, nobody writes
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000084a2","role":"authenticated"}';
select is((select count(*)::int from public.invoice_sends where invoice_id = 'd0000000-0000-0000-0000-0000000084e2'), 2, 'a platform admin reads the invoice sends');
select throws_ok($$ insert into public.invoice_sends (invoice_id, sent_by, recipients, kind) values ('d0000000-0000-0000-0000-0000000084e2', '00000000-0000-0000-0000-0000000084a2', array['a@example.com'], 'send') $$, '42501', null, 'not even a platform admin inserts an invoice send directly');
select throws_ok($$ update public.invoice_sends set kind = 'send' $$, '42501', null, 'nor updates one');
select throws_ok($$ delete from public.invoice_sends $$, '42501', null, 'nor deletes one');

-- ---------------------------------------------------------------- invoice RPCs: last_emailed_at and email_count
select is(pg_temp.em(pg_temp.inv(public.invoices_overview(), 'd0000000-0000-0000-0000-0000000084e1')), 'true|null|number|0', 'invoices_overview: no sends gives null and 0');
select is(pg_temp.em(pg_temp.inv(public.invoices_overview(), 'd0000000-0000-0000-0000-0000000084e2')), 'true|string|number|2', 'invoices_overview: two sends give a count of 2');
select ok((pg_temp.inv(public.invoices_overview(), 'd0000000-0000-0000-0000-0000000084e2') ->> 'last_emailed_at')::timestamptz = timestamptz '2030-01-02 11:00+00', 'invoices_overview: last_emailed_at is the newest send');
select is(pg_temp.em(pg_temp.inv(public.invoices_page('e2e-pb-alpha') -> 'rows', 'd0000000-0000-0000-0000-0000000084e1')), 'true|null|number|0', 'invoices_page: no sends gives null and 0');
select is(pg_temp.em(pg_temp.inv(public.invoices_page('e2e-pb-alpha') -> 'rows', 'd0000000-0000-0000-0000-0000000084e2')), 'true|string|number|2', 'invoices_page: two sends give a count of 2');
select ok((pg_temp.inv(public.invoices_page('e2e-pb-alpha') -> 'rows', 'd0000000-0000-0000-0000-0000000084e2') ->> 'last_emailed_at')::timestamptz = timestamptz '2030-01-02 11:00+00', 'invoices_page: last_emailed_at is the newest send');
select is(pg_temp.em(public.invoice_detail('d0000000-0000-0000-0000-0000000084e1')), 'true|null|number|0', 'invoice_detail: no sends gives null and 0');
select is(pg_temp.em(public.invoice_detail('d0000000-0000-0000-0000-0000000084e2')), 'true|string|number|2', 'invoice_detail: two sends give a count of 2');
select ok((public.invoice_detail('d0000000-0000-0000-0000-0000000084e2') ->> 'last_emailed_at')::timestamptz = timestamptz '2030-01-02 11:00+00', 'invoice_detail: last_emailed_at is the newest send');
select is(pg_temp.em(public.invoice_detail_page('d0000000-0000-0000-0000-0000000084e1')), 'true|null|number|0', 'invoice_detail_page: no sends gives null and 0');
select is(pg_temp.em(public.invoice_detail_page('d0000000-0000-0000-0000-0000000084e2')), 'true|string|number|2', 'invoice_detail_page: two sends give a count of 2');
select ok((public.invoice_detail_page('d0000000-0000-0000-0000-0000000084e2') ->> 'last_emailed_at')::timestamptz = timestamptz '2030-01-02 11:00+00', 'invoice_detail_page: last_emailed_at is the newest send');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.invoice_detail('d0000000-0000-0000-0000-0000000084e2')) k where k in ('invoice_id', 'status', 'total', 'fee_count', 'lines')),
  'fee_count,invoice_id,lines,status,total', 'invoice_detail keeps its existing keys');
select is(pg_temp.inv(public.invoices_overview(), 'd0000000-0000-0000-0000-0000000084e2') ->> 'status', 'sent', 'invoices_overview keeps status');
select ok(pg_temp.inv(public.invoices_page('e2e-pb-alpha') -> 'rows', 'd0000000-0000-0000-0000-0000000084e2') ?& array['invoice_id', 'status', 'total', 'fee_count'], 'invoices_page rows keep their existing keys');
select ok(public.invoice_detail_page('d0000000-0000-0000-0000-0000000084e2') ?& array['invoice_id', 'status', 'total', 'fee_count', 'lines', 'line_total'], 'invoice_detail_page keeps its existing keys');

-- the venue's own statement never shows them
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000084a3","role":"authenticated"}';
select is((public.statement_invoices_page('a0000000-0000-0000-0000-0000000084a1') ->> 'total')::int, 2, 'the venue owner sees both invoices');
select is((select count(*)::int from jsonb_array_elements(public.statement_invoices_page('a0000000-0000-0000-0000-0000000084a1') -> 'rows') e where e ? 'last_emailed_at' or e ? 'email_count'), 0,
  'statement_invoices_page rows do not carry last_emailed_at or email_count');
select is((select string_agg(k, ',' order by k) from jsonb_object_keys(public.statement_invoices_page('a0000000-0000-0000-0000-0000000084a1') -> 'rows' -> 0) k),
  'adjustment_total,billing_month,due_at,fee_total,invoice_id,overdue,paid_at,paid_method,paid_reference,sent_at,status,total', 'statement_invoices_page keeps exactly its documented keys');

-- ---------------------------------------------------------------- the platform-billing bucket and its storage policies
reset role;
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'platform-billing' $$,
  $$ values (false, 1048576::bigint, array['image/png', 'image/jpeg']) $$,
  'platform-billing is private, 1 MB, PNG and JPEG only');
select ok((select qual like '%platform-billing%' and qual like '%is_platform_admin%' from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname = 'Platform admins read billing QR'), 'only platform admins read billing QR codes, in this bucket');
select ok((select with_check like '%platform-billing%' and with_check like '%is_platform_admin%' from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname = 'Platform admins upload billing QR'), 'only platform admins upload billing QR codes, in this bucket');
select ok((select qual like '%platform-billing%' and qual like '%is_platform_admin%' from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname = 'Platform admins delete billing QR'), 'only platform admins delete billing QR codes, in this bucket');
select is(
  (select string_agg(policyname || ' ' || cmd, '; ' order by policyname)::text
   from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'Platform admins % billing QR'),
  'Platform admins delete billing QR DELETE; Platform admins read billing QR SELECT; Platform admins upload billing QR INSERT',
  'exactly three billing QR policies: read, upload, delete (no update)');

select * from finish();
rollback;
