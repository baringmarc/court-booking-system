-- T14.5: public.user_id_by_email(p_email text) returns uuid. SECURITY DEFINER lookup in auth.users by trimmed,
-- lowercased email; null when unknown or null. Executable by service_role only (the invite-venue-owner function).
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000057a1', 'e2e-invitee@example.com'),
  ('00000000-0000-0000-0000-0000000057a2', 'E2E-Mixed.Case@Example.com');

select has_function('public', 'user_id_by_email', array['text'], 'user_id_by_email(text) exists');
select ok((select prosecdef from pg_proc where oid = to_regprocedure('public.user_id_by_email(text)')),
  'user_id_by_email is security definer');
select ok(not has_function_privilege('anon', 'public.user_id_by_email(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.user_id_by_email(text)', 'execute'),
  'neither anon nor authenticated hold execute (revoked from public)');

-- ---------------------------------------------------------------- service_role
set local role service_role;
select is(public.user_id_by_email('e2e-invitee@example.com'), '00000000-0000-0000-0000-0000000057a1'::uuid,
  'service_role gets the id for an exact email');
select is(public.user_id_by_email('  E2E-INVITEE@Example.com  '), '00000000-0000-0000-0000-0000000057a1'::uuid,
  'lookup ignores case and surrounding whitespace');
select is(public.user_id_by_email('e2e-mixed.case@example.com'), '00000000-0000-0000-0000-0000000057a2'::uuid,
  'an account stored with mixed case is still found by the lowercased email');
select is(public.user_id_by_email('e2e-nobody@example.com'), null::uuid, 'unknown email gives null');
select is(public.user_id_by_email(null), null::uuid, 'null input gives null');

-- ---------------------------------------------------------------- clients
set local role anon;
select throws_ok($$select public.user_id_by_email('e2e-invitee@example.com')$$, '42501', null, 'anon cannot call it');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000057a1","role":"authenticated"}', true);
select throws_ok($$select public.user_id_by_email('e2e-invitee@example.com')$$, '42501', null, 'authenticated cannot call it');

reset role;
select * from finish();
rollback;
