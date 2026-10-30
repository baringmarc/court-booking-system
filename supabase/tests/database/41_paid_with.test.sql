-- T11.27: "Paid with". payment_method gains 'account'; payments get payment_account_id (set null on delete) and
-- paid_with (the account's label at payment time, a snapshot). record_payment_proof takes an optional account id
-- (service role only); get_guest_booking and get_earnings expose / group by paid_with.
begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
grant execute on function pg_temp.hint_of(text) to anon, authenticated, service_role;

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'other@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-000000000041', 'Paid With Court', 'tennis', 500);
delete from public.venue_payment_accounts;
create temp table acc as
  with i as (insert into public.venue_payment_accounts (label, account_name) values ('Main GCash', 'Claudex') returning id)
  select id from i;
insert into public.venue_payment_accounts (label) values ('Other Maya');
grant select on acc to anon, authenticated, service_role;

create temp table fx as select (private.local_today() + 3 + time '10:00') at time zone 'Asia/Manila' as t10;
create temp table b (label text primary key, id uuid, ref text, token text);
grant select on fx to anon, authenticated, service_role;
grant select, insert on b to anon, authenticated, service_role;

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
insert into b select 'acct', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000041', fx.t10, 1, 'Ann', 'ann@example.com', '0917 111 1111') r;
insert into b select 'old', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000041', fx.t10 + interval '2 hours', 1, 'Olga', 'olga@example.com', '0917 222 2222') r;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
insert into b select 'player', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000041', fx.t10 + interval '4 hours', 1) r;
reset role;

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------
select ok('account' = any (enum_range(null::public.payment_method)::text[]), 'payment_method has the value account');
select has_column('public', 'payments', 'payment_account_id', 'payments.payment_account_id exists');
select has_column('public', 'payments', 'paid_with', 'payments.paid_with exists');
select col_type_is('public', 'payments', 'paid_with', 'text', 'paid_with is text');
select ok(not has_function_privilege('anon', 'public.record_payment_proof(uuid, text, public.payment_method, numeric, text, uuid)', 'execute'),
  'anon cannot call record_payment_proof');
select ok(not has_function_privilege('authenticated', 'public.record_payment_proof(uuid, text, public.payment_method, numeric, text, uuid)', 'execute'),
  'authenticated cannot call record_payment_proof');
select ok(has_function_privilege('service_role', 'public.record_payment_proof(uuid, text, public.payment_method, numeric, text, uuid)', 'execute'),
  'service_role can call record_payment_proof');
select ok(not has_table_privilege('anon', 'public.payments', 'select'), 'anon still has no table access to payments');
select ok(not has_table_privilege('authenticated', 'public.payments', 'insert')
  and not has_table_privilege('authenticated', 'public.payments', 'update'), 'players and admins still cannot write payments directly');

-- Table constraints (as the table owner)
select throws_ok(
  $$ insert into public.payments (booking_id, method, amount) select id, 'account', 100 from b where label = 'acct' $$,
  '23514', null, 'an account payment must carry paid_with');
select throws_ok(
  $$ insert into public.payments (booking_id, method, amount, paid_with) select id, 'account', 100, repeat('a', 41) from b where label = 'acct' $$,
  '23514', null, 'paid_with is at most 40 characters');
select lives_ok(
  $$ insert into public.payments (booking_id, method, amount, paid_with) select id, 'gcash', 100, null from b where label = 'acct' $$,
  'a non-account payment needs no paid_with');
delete from public.payments where booking_id = (select id from b where label = 'acct');

-- ---------------------------------------------------------------------------
-- record_payment_proof: input checks
-- ---------------------------------------------------------------------------
set local role service_role;
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'old'), (select id::text || '/p.png' from b where label = 'old'), 'gcash', 500, null, '99999999-9999-9999-9999-999999999999') $$),
  'invalid_input', 'an account id that does not exist is invalid_input');
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'old'), (select id::text || '/p.png' from b where label = 'old'), 'account', 500) $$),
  'invalid_input', 'method account without an account id is invalid_input');
select is(pg_temp.hint_of($$ select * from public.record_payment_proof((select id from b where label = 'old'), (select id::text || '/p.png' from b where label = 'old'), 'cash', 500) $$),
  'invalid_input', 'cash is still refused without an account id');
select is((select count(*)::int from public.payments where booking_id = (select id from b where label = 'old')), 0,
  'the refused calls left no payment behind');

-- ---------------------------------------------------------------------------
-- record_payment_proof: with an account
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select * from public.record_payment_proof((select id from b where label = 'acct'), (select id::text || '/a.png' from b where label = 'acct'), 'gcash', 500, ' 987 ', (select id from acc)) $$,
  'a proof naming an account is recorded (p_method is ignored)');
select results_eq(
  $$ select p.method::text, p.payment_account_id, p.paid_with, p.reference_number, p.review_status::text, bk.status::text
     from public.payments p join public.bookings bk on bk.id = p.booking_id join b on b.id = bk.id where b.label = 'acct' $$,
  $$ select 'account', (select id from acc), 'Main GCash', '987', 'pending', 'payment_submitted' $$,
  'the payment stores method account, the account id and its label');

-- The old path still works
select lives_ok(
  $$ select * from public.record_payment_proof((select id from b where label = 'old'), (select id::text || '/o.png' from b where label = 'old'), 'maya', 500) $$,
  'the old method-only call still works');
select results_eq(
  $$ select p.method::text, p.payment_account_id, p.paid_with from public.payments p join b on b.id = p.booking_id where b.label = 'old' $$,
  $$ values ('maya', null::uuid, null::text) $$,
  'an old-path payment has no account and no paid_with');
reset role;

-- ---------------------------------------------------------------------------
-- Snapshot: rename, then delete the account
-- ---------------------------------------------------------------------------
update public.venue_payment_accounts set label = 'Renamed GCash' where id = (select id from acc);
select is((select paid_with from public.payments p join b on b.id = p.booking_id where b.label = 'acct'), 'Main GCash',
  'renaming the account does not change what the payment says');
select is((select payment_account_id from public.payments p join b on b.id = p.booking_id where b.label = 'acct'), (select id from acc),
  'the link still points at the account after a rename');

-- Guests see paid_with, never the file path
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select g.payments -> 0 ->> 'paid_with' from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'acct'), 'Main GCash',
  'get_guest_booking shows paid_with');
select ok((select g.payments -> 0 ? 'paid_with' from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'old'),
  'the paid_with key is present for a non-account payment');
select is((select g.payments -> 0 -> 'paid_with' from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'old'), 'null'::jsonb,
  'and it is null');
select ok((select not (g.payments -> 0 ? 'storage_path') from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'acct'),
  'guests still never receive file paths');
select ok((select not (g.payments -> 0 ? 'payment_account_id') from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'acct'),
  'nor the account id');
reset role;

-- RLS: the owner and admins read it, another player does not
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', true);
select is((select count(*)::int from public.payments), 0, 'another player sees none of these payments');
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select is((select paid_with from public.payments p join b on b.id = p.booking_id where b.label = 'acct'), 'Main GCash', 'an admin reads paid_with');
select throws_ok($$ update public.payments set paid_with = 'x' $$, '42501', null, 'an admin cannot edit paid_with directly');
reset role;

-- A player-owned booking: record with the other account, then the owner reads it
set local role service_role;
select lives_ok(
  $$ select * from public.record_payment_proof((select id from b where label = 'player'), (select id::text || '/p.png' from b where label = 'player'), 'bank_transfer', 500, null, (select id from public.venue_payment_accounts where label = 'Other Maya')) $$,
  'a player booking takes an account payment');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is((select paid_with from public.payments p join b on b.id = p.booking_id where b.label = 'player'), 'Other Maya',
  'the owning player reads their own paid_with');
reset role;

delete from public.venue_payment_accounts where id = (select id from acc);
select is((select payment_account_id from public.payments p join b on b.id = p.booking_id where b.label = 'acct'), null,
  'deleting the account nulls payment_account_id');
select is((select paid_with from public.payments p join b on b.id = p.booking_id where b.label = 'acct'), 'Main GCash',
  'but paid_with stays');
select is((select method::text from public.payments p join b on b.id = p.booking_id where b.label = 'acct'), 'account',
  'and the method stays account');

-- ---------------------------------------------------------------------------
-- get_earnings groups account payments by label
-- ---------------------------------------------------------------------------
-- A far-past Monday week (2019-03-04..10) with its previous week, clear of any other data.
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status, cancelled_at)
select ('b0000000-0000-0000-0000-0000000041' || lpad(n::text, 2, '0'))::uuid, 'CB-PWQ' || chr(65 + n) || 'X' || (n + 1),
       'c0000000-0000-0000-0000-000000000041', 'Payer ' || n,
       tstzrange(('2019-02-01'::date + n + time '03:00') at time zone 'Asia/Manila', ('2019-02-01'::date + n + time '04:00') at time zone 'Asia/Manila'),
       100, 'cancelled', now()
from generate_series(1, 7) n;

insert into public.payments (booking_id, method, amount, paid_with, review_status, reviewed_at)
select ('b0000000-0000-0000-0000-0000000041' || lpad(v.n::text, 2, '0'))::uuid, v.m::public.payment_method, v.amt, v.pw, 'approved',
       (v.d + time '12:00') at time zone 'Asia/Manila'
from (values
  (1, 'account', 100, 'GCash Main', date '2019-03-04'),
  (2, 'account', 200, 'GCash Main', date '2019-03-05'),
  (3, 'account',  50, 'Maya Biz',   date '2019-03-06'),
  (4, 'cash',     25, null,         date '2019-03-07'),
  (5, 'gcash',    10, null,         date '2019-03-08'),
  (6, 'account',  70, 'GCash Main', date '2019-02-27'),
  (7, 'account',  30, 'Maya Biz',   date '2019-02-26')
) as v(n, m, amt, pw, d);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
create temp table e as select public.get_earnings(date '2019-03-04', date '2019-03-10') as j;
grant select on e to authenticated;
select is((select (j -> 'collected' -> 'total')::numeric from e), 385::numeric, 'earnings: collected total is unchanged by the new columns');
select is(
  (select jsonb_agg(m order by m ->> 'method', m ->> 'paid_with') from e, jsonb_array_elements(e.j -> 'collected' -> 'by_method') m),
  '[{"count": 2, "amount": 300, "method": "account", "paid_with": "GCash Main"},
    {"count": 1, "amount": 50,  "method": "account", "paid_with": "Maya Biz"},
    {"count": 1, "amount": 25,  "method": "cash",    "paid_with": null},
    {"count": 1, "amount": 10,  "method": "gcash",   "paid_with": null}]'::jsonb,
  'collected.by_method groups account payments by label; other methods carry paid_with null');
select is(
  (select jsonb_agg(m order by m ->> 'paid_with') from e, jsonb_array_elements(e.j -> 'previous' -> 'by_method') m),
  '[{"count": 1, "amount": 70, "method": "account", "paid_with": "GCash Main"},
    {"count": 1, "amount": 30, "method": "account", "paid_with": "Maya Biz"}]'::jsonb,
  'previous.by_method is grouped by label too');
reset role;

select * from finish();
rollback;
