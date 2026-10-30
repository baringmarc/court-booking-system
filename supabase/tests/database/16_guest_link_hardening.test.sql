-- T5.5: guest links expire 30 days after the booking ends, and the guest view carries the cancellation.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;

insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000001', 'Link Court', 'tennis', 500);

-- Bookings that ended exactly at the 30-day line, one second inside it, and a cancelled one
-- (adjacent ranges so the first two don't overlap on the court).
insert into public.bookings (reference_code, court_id, guest_name, guest_email, during, total_amount, status, guest_token_hash,
                             cancelled_at, cancel_reason, cancelled_by_venue)
values
  ('CB-LNKEND', 'c0000000-0000-0000-0000-000000000001', 'Gina', 'gina@test.local',
   tstzrange(now() - interval '30 days' - interval '2 seconds', now() - interval '30 days'), 500, 'confirmed',
   sha256(convert_to('tok-end', 'UTF8')), null, null, false),
  ('CB-LNKLVE', 'c0000000-0000-0000-0000-000000000001', 'Gina', 'gina@test.local',
   tstzrange(now() - interval '30 days', now() - interval '30 days' + interval '1 second'), 500, 'confirmed',
   sha256(convert_to('tok-live', 'UTF8')), null, null, false),
  ('CB-LNKCAN', 'c0000000-0000-0000-0000-000000000001', 'Gina', 'gina@test.local',
   tstzrange(now() + interval '2 days', now() + interval '2 days 1 hour'), 500, 'cancelled',
   sha256(convert_to('tok-cancel', 'UTF8')), now(), 'Court maintenance', true);

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);

select is(pg_temp.hint_of($$ select * from public.get_guest_booking('CB-LNKEND', 'tok-end') $$), 'not_found',
  'a link 30 days after the booking ended no longer works');
select is(pg_temp.hint_of($$ select * from public.get_guest_booking('CB-LNKEND', 'wrong') $$), 'not_found',
  'an expired link and a wrong token give the same answer');
select is((select count(*)::int from public.get_guest_booking('CB-LNKLVE', 'tok-live')), 1,
  'one second before the 30-day line the link still works');

select results_eq(
  $$ select status::text, cancelled_at = now(), cancel_reason, cancelled_by_venue from public.get_guest_booking('cb-lnkcan', 'tok-cancel') $$,
  $$ values ('cancelled', true, 'Court maintenance', true) $$,
  'the guest view returns the cancellation and whether the venue cancelled'
);
select results_eq(
  $$ select cancelled_at, cancel_reason, cancelled_by_venue from public.get_guest_booking('CB-LNKLVE', 'tok-live') $$,
  $$ values (null::timestamptz, null::text, false) $$,
  'an active booking has no cancellation fields'
);
reset role;

-- Grants unchanged
select ok(has_function_privilege('anon', 'public.get_guest_booking(text, text)', 'execute'), 'anon can still call get_guest_booking');
select ok(has_function_privilege('authenticated', 'public.get_guest_booking(text, text)', 'execute'), 'authenticated can still call get_guest_booking');

select * from finish();
rollback;
