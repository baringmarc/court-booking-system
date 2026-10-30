-- T11.29: fresh guest links. public.guest_link_tokens (booking_id, token_hash sha256, created_at; RLS on, no client access),
-- public.issue_guest_link(booking_id) -> text (service role only), private.guest_token_matches(booking_id, token).
-- An issued token works like the original for get_guest_booking, guest cancel_booking and proof_target (the upload lookup).
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

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
create function pg_temp.msg_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
grant execute on function pg_temp.msg_of(text) to anon, authenticated, service_role;

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111', 'player@test.local');
insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000042', 'Link Token Court', 'tennis', 500);

create temp table fx as select (private.local_today(private.default_venue_id()) + 3 + time '10:00') at time zone 'Asia/Manila' as t10;
create temp table b (label text primary key, id uuid, ref text, token text);
create temp table issued (label text, n int, token text);
grant select on fx to anon, authenticated, service_role;
grant select, insert on b to anon, authenticated, service_role;
grant select, insert on issued to anon, authenticated, service_role;

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
insert into b select 'view', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000042', fx.t10, 1, 'Ann', 'ann@example.com') r;
insert into b select 'cancel', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000042', fx.t10 + interval '2 hours', 1, 'Cy', 'cy@example.com') r;
insert into b select 'upload', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000042', fx.t10 + interval '4 hours', 1, 'Uma', 'uma@example.com') r;
insert into b select 'other', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000042', fx.t10 + interval '6 hours', 1, 'Otto', 'otto@example.com') r;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
insert into b select 'player', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-000000000042', fx.t10 + interval '8 hours', 1) r;
reset role;

-- A guest booking that ended 31 days ago (outside the 30-day link window), with an original token.
insert into public.bookings (id, reference_code, court_id, guest_name, guest_email, during, total_amount, status, guest_token_hash)
values ('b0000000-0000-0000-0000-000000000042', 'CB-TKNAAA', 'c0000000-0000-0000-0000-000000000042', 'Old', 'old@test.local',
        tstzrange(now() - interval '31 days' - interval '1 hour', now() - interval '31 days'), 500, 'confirmed',
        sha256(convert_to('tok-old', 'UTF8')));
insert into b values ('old', 'b0000000-0000-0000-0000-000000000042', 'CB-TKNAAA', 'tok-old');
-- A booking still inside the window, ended 29 days ago.
insert into public.bookings (id, reference_code, court_id, guest_name, guest_email, during, total_amount, status, guest_token_hash)
values ('b0000000-0000-0000-0000-000000000043', 'CB-TKNBBB', 'c0000000-0000-0000-0000-000000000042', 'Late', 'late@test.local',
        tstzrange(now() - interval '29 days' - interval '1 hour', now() - interval '29 days'), 500, 'confirmed',
        sha256(convert_to('tok-late', 'UTF8')));
insert into b values ('late', 'b0000000-0000-0000-0000-000000000043', 'CB-TKNBBB', 'tok-late');

-- ---------------------------------------------------------------------------
-- Shape and grants
-- ---------------------------------------------------------------------------
select has_table('public', 'guest_link_tokens', 'guest_link_tokens exists');
select has_column('public', 'guest_link_tokens', 'booking_id', 'guest_link_tokens.booking_id exists');
select col_type_is('public', 'guest_link_tokens', 'token_hash', 'bytea', 'token_hash is bytea');
select has_column('public', 'guest_link_tokens', 'created_at', 'guest_link_tokens.created_at exists');
select ok((select relrowsecurity from pg_class where oid = 'public.guest_link_tokens'::regclass), 'RLS is on for guest_link_tokens');
select ok(not has_table_privilege('anon', 'public.guest_link_tokens', 'select')
  and not has_table_privilege('authenticated', 'public.guest_link_tokens', 'select'), 'anon and authenticated cannot select guest_link_tokens');
select ok(not has_table_privilege('anon', 'public.guest_link_tokens', 'insert')
  and not has_table_privilege('authenticated', 'public.guest_link_tokens', 'insert')
  and not has_table_privilege('authenticated', 'public.guest_link_tokens', 'update')
  and not has_table_privilege('authenticated', 'public.guest_link_tokens', 'delete'), 'clients cannot write guest_link_tokens');
select ok(not has_function_privilege('anon', 'public.issue_guest_link(uuid)', 'execute'), 'anon cannot call issue_guest_link');
select ok(not has_function_privilege('authenticated', 'public.issue_guest_link(uuid)', 'execute'), 'authenticated cannot call issue_guest_link');
select ok(has_function_privilege('service_role', 'public.issue_guest_link(uuid)', 'execute'), 'service_role can call issue_guest_link');

-- Clients (even a signed-in player) can neither call it nor read the table
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ select public.issue_guest_link((select id from b where label = 'view')) $$, '42501', null, 'anon is refused issue_guest_link');
select throws_ok($$ select count(*) from public.guest_link_tokens $$, '42501', null, 'anon is refused reading guest_link_tokens');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select throws_ok($$ select public.issue_guest_link((select id from b where label = 'view')) $$, '42501', null, 'a signed-in player is refused issue_guest_link');
select throws_ok($$ select count(*) from public.guest_link_tokens $$, '42501', null, 'a signed-in player is refused reading guest_link_tokens');
reset role;

-- ---------------------------------------------------------------------------
-- Issuing (service role)
-- ---------------------------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
insert into issued select 'view', 1, public.issue_guest_link((select id from b where label = 'view'));
insert into issued select 'view', 2, public.issue_guest_link((select id from b where label = 'view'));
insert into issued select 'cancel', 1, public.issue_guest_link((select id from b where label = 'cancel'));
insert into issued select 'upload', 1, public.issue_guest_link((select id from b where label = 'upload'));
insert into issued select 'late', 1, public.issue_guest_link((select id from b where label = 'late'));
select is(pg_temp.hint_of($$ select public.issue_guest_link((select id from b where label = 'player')) $$), 'not_found',
  'a signed-in player''s booking (no guest link) gets the not-found error');
select is(pg_temp.hint_of($$ select public.issue_guest_link((select id from b where label = 'old')) $$), 'not_found',
  'a booking past its 30-day window gets the not-found error');
select is(pg_temp.hint_of($$ select public.issue_guest_link('00000000-0000-0000-0000-00000000dead') $$), 'not_found',
  'an unknown booking gets the not-found error');
reset role;

select ok((select bool_and(length(token) >= 43) from issued), 'an issued token carries at least 256 bits (43+ url-safe characters)');
select isnt((select token from issued where label = 'view' and n = 1), (select token from issued where label = 'view' and n = 2),
  'each call issues a different token');
select isnt((select token from issued where label = 'view' and n = 1), (select token from b where label = 'view'),
  'an issued token differs from the original');
select is((select count(*)::int from public.guest_link_tokens where booking_id = (select id from b where label = 'view')), 2,
  'two issues store two hashes');
select ok(exists (select 1 from public.guest_link_tokens t, issued i
  where i.label = 'cancel' and t.booking_id = (select id from b where label = 'cancel')
    and t.token_hash = sha256(convert_to(i.token, 'UTF8'))), 'the stored value is the sha256 of the token');
select ok(not exists (select 1 from public.guest_link_tokens t, issued i
  where t.token_hash in (convert_to(i.token, 'UTF8'), decode(md5(i.token), 'hex'))
     or encode(t.token_hash, 'escape') = i.token), 'no raw token is stored');
select is((select count(*)::int from public.guest_link_tokens), 5, 'only the issued tokens were stored (the originals stay on bookings)');

-- ---------------------------------------------------------------------------
-- The helper
-- ---------------------------------------------------------------------------
select ok((select private.guest_token_matches(b.id, b.token) from b where label = 'view'), 'helper: the original token matches');
select ok((select private.guest_token_matches(b.id, i.token) from b, issued i where b.label = 'view' and i.label = 'view' and i.n = 2), 'helper: an issued token matches');
select ok(not (select private.guest_token_matches(b.id, i.token) from b, issued i where b.label = 'other' and i.label = 'view' and i.n = 1),
  'helper: another booking''s issued token does not match');

-- ---------------------------------------------------------------------------
-- Open, cancel and upload with an issued token; the original keeps working
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select g.id from b, issued i, public.get_guest_booking(b.ref, i.token) g where b.label = 'view' and i.label = 'view' and i.n = 1),
  (select id from b where label = 'view'), 'an issued token opens the booking page data');
select is((select count(*)::int from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'view'), 1,
  'the original token still opens it');
select is((select g.id from b, issued i, public.get_guest_booking(b.ref, i.token) g where b.label = 'late' and i.label = 'late'),
  (select id from b where label = 'late'), 'an issued token works inside the 30-day window');
select is(pg_temp.hint_of($$ select * from public.get_guest_booking((select ref from b where label = 'view'), 'wrong') $$), 'not_found',
  'a wrong token is not found');
select is(pg_temp.hint_of($$ select * from public.get_guest_booking((select ref from b where label = 'other'), (select token from issued where label = 'view' and n = 1)) $$),
  'not_found', 'an issued token does not open another booking');

select is((select s::text from b, issued i, public.cancel_booking(p_reference_code => b.ref, p_token => i.token) s
  where b.label = 'cancel' and i.label = 'cancel'), 'cancelled', 'an issued token cancels the booking');
select is(pg_temp.hint_of($$ select public.cancel_booking(p_reference_code => (select ref from b where label = 'other'), p_token => (select token from issued where label = 'view' and n = 1)) $$),
  'not_found', 'an issued token cannot cancel another booking');
reset role;

-- Upload path: proof_target is the lookup behind submit-payment-proof and the PayMongo checkout (service role).
set local role service_role;
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
select is((select t.booking_id from b, issued i, public.proof_target(b.ref, i.token, null) t where b.label = 'upload' and i.label = 'upload'),
  (select id from b where label = 'upload'), 'an issued token passes the upload / checkout lookup (proof_target)');
select is((select t.booking_id from b, public.proof_target(b.ref, b.token, null) t where b.label = 'upload'),
  (select id from b where label = 'upload'), 'the original token still passes the upload / checkout lookup');
select is(pg_temp.hint_of($$ select * from public.proof_target((select ref from b where label = 'upload'), 'wrong', null) $$), 'not_found',
  'proof_target still refuses a wrong token');
select is((select count(*)::int from b, public.record_payment_proof(b.id, b.id::text || '/proof.png', 'gcash', 500, 'REF1') where b.label = 'upload'), 1,
  'the proof is recorded for a booking opened with an issued token');
reset role;

-- ---------------------------------------------------------------------------
-- Expiry unchanged: an issued token on a booking past its window gets the same answer as a wrong token
-- ---------------------------------------------------------------------------
insert into public.guest_link_tokens (booking_id, token_hash)
values ('b0000000-0000-0000-0000-000000000042', sha256(convert_to('issued-old', 'UTF8')));
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is(pg_temp.hint_of($$ select * from public.get_guest_booking('CB-TKNAAA', 'issued-old') $$), 'not_found',
  'an issued token on an expired booking is not found');
select is(pg_temp.hint_of($$ select * from public.get_guest_booking('CB-TKNAAA', 'wrong') $$), 'not_found',
  'a wrong token on the same booking gives the same not-found');
select is(
  (select m from (select pg_temp.msg_of($$ select * from public.get_guest_booking('CB-TKNAAA', 'issued-old') $$) m) x),
  (select m from (select pg_temp.msg_of($$ select * from public.get_guest_booking('CB-TKNAAA', 'wrong') $$) m) y),
  'expired and wrong-token responses carry the same message');
reset role;

-- ---------------------------------------------------------------------------
-- Deleting a booking deletes its tokens
-- ---------------------------------------------------------------------------
delete from public.bookings where id = (select id from b where label = 'view');
select is((select count(*)::int from public.guest_link_tokens where booking_id = (select id from b where label = 'view')), 0,
  'deleting a booking deletes its tokens');
select is((select count(*)::int from public.guest_link_tokens where booking_id = (select id from b where label = 'upload')), 1,
  'other bookings keep their tokens');

select * from finish();
rollback;
