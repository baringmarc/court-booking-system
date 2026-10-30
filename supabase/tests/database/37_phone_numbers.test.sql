-- T11.17: Philippine mobile numbers. private.normalize_ph_mobile, the bookings/profiles triggers, the
-- NOT VALID checks, create_booking without a guest phone, and the walk-in path.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role": "anon"}', true)
$$;
create function pg_temp.as_player() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true)
$$;
create function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true)
$$;
grant execute on function pg_temp.as_anon() to anon, authenticated, service_role;
grant execute on function pg_temp.as_player() to anon, authenticated, service_role;
grant execute on function pg_temp.as_admin() to anon, authenticated, service_role;

update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.venue_members (venue_id, user_id, role)
select id, '22222222-2222-2222-2222-222222222222', 'staff' from public.venues where slug = 'claudex-courts';
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000037a1', 'Phone Court', 'tennis', 300);

create temp table fx as
select (private.local_today() + 4 + time '07:00') at time zone 'Asia/Manila' as t07;
grant select on fx to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The function: shape and access
-- ---------------------------------------------------------------------------
select has_function('private', 'normalize_ph_mobile', array['text'], 'private.normalize_ph_mobile(text) exists');
select is((select provolatile::text from pg_proc where oid = 'private.normalize_ph_mobile(text)'::regprocedure), 'i',
  'normalize_ph_mobile is immutable');
select ok(not has_function_privilege('anon', 'private.normalize_ph_mobile(text)', 'execute'), 'anon cannot execute normalize_ph_mobile');
select ok(not has_function_privilege('authenticated', 'private.normalize_ph_mobile(text)', 'execute'), 'authenticated cannot execute normalize_ph_mobile');

-- ---------------------------------------------------------------------------
-- Accepted formats
-- ---------------------------------------------------------------------------
select is(private.normalize_ph_mobile(null), null, 'null stays null');
select is(private.normalize_ph_mobile(''), null, 'empty becomes null');
select is(private.normalize_ph_mobile('   '), null, 'blank becomes null');
select is(private.normalize_ph_mobile('09171234567'), '09171234567', '11 digits starting 09 stay as they are');
select is(private.normalize_ph_mobile('0917 123 4567'), '09171234567', 'spaces are dropped');
select is(private.normalize_ph_mobile('0917.123.4567'), '09171234567', 'dots are dropped');
select is(private.normalize_ph_mobile('0917-123-4567'), '09171234567', 'dashes are dropped');
select is(private.normalize_ph_mobile('(0917) 123-4567'), '09171234567', 'brackets are dropped');
select is(private.normalize_ph_mobile('+63 917 123 4567'), '09171234567', '+63 becomes 0');
select is(private.normalize_ph_mobile('+639171234567'), '09171234567', '+63 without spaces becomes 0');
select is(private.normalize_ph_mobile('63 917 123 4567'), '09171234567', '63 becomes 0');
select is(private.normalize_ph_mobile('639171234567'), '09171234567', '63 without spaces becomes 0');
select is(private.normalize_ph_mobile('917 123 4567'), '09171234567', 'a bare 10-digit 9... number gets a leading 0');
select is(private.normalize_ph_mobile('9171234567'), '09171234567', 'a bare 10-digit number without spaces gets a leading 0');
select is(private.normalize_ph_mobile('  0917 123 4567  '), '09171234567', 'surrounding whitespace is ignored');

-- ---------------------------------------------------------------------------
-- Refused
-- ---------------------------------------------------------------------------
select is(pg_temp.hint_of($$ select private.normalize_ph_mobile('028123456') $$), 'invalid_phone', 'a landline is refused');
select is(pg_temp.hint_of($$ select private.normalize_ph_mobile('0917123456') $$), 'invalid_phone', 'too short (10 digits with 0) is refused');
select is(pg_temp.hint_of($$ select private.normalize_ph_mobile('091712345678') $$), 'invalid_phone', 'too long is refused');
select is(pg_temp.hint_of($$ select private.normalize_ph_mobile('0917abc4567') $$), 'invalid_phone', 'letters are refused');
select is(pg_temp.hint_of($$ select private.normalize_ph_mobile('+1 917 123 4567') $$), 'invalid_phone', 'a non-Philippine country code is refused');
select is(pg_temp.hint_of($$ select private.normalize_ph_mobile('+63 817 123 4567') $$), 'invalid_phone', '+63 not followed by 9 is refused');
select is(pg_temp.hint_of($$ select private.normalize_ph_mobile('8171234567') $$), 'invalid_phone', 'a bare 10-digit number not starting with 9 is refused');
select throws_ok($$ select private.normalize_ph_mobile('12345') $$, 'P0001',
  'Enter an 11-digit mobile number, like 09171234567.', 'the refusal has the exact message and SQLSTATE P0001');

-- ---------------------------------------------------------------------------
-- Constraints exist; they validate when nothing invalid remained
-- ---------------------------------------------------------------------------
select has_trigger('public', 'bookings', 'bookings_normalize_phone', 'bookings has the normalize trigger');
select has_trigger('public', 'profiles', 'profiles_normalize_phone', 'profiles has the normalize trigger');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_guest_phone_format') is not null, true,
  'bookings_guest_phone_format exists');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_phone_format') is not null, true,
  'profiles_phone_format exists');
select is(
  (select count(*)::int from public.bookings where guest_phone is not null and guest_phone !~ '^09[0-9]{9}$'), 0,
  'after the backfill no existing booking has a malformed guest_phone');
select is(
  (select count(*)::int from public.profiles where phone is not null and phone !~ '^09[0-9]{9}$'), 0,
  'after the backfill no existing profile has a malformed phone');

-- ---------------------------------------------------------------------------
-- create_booking: guest without a phone, with formats, with a bad phone
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_anon();
select lives_ok(
  $$ select * from public.create_booking('c0000000-0000-0000-0000-0000000037a1', (select t07 from fx), 1, 'Gina Guest', 'gina@example.com') $$,
  'a guest can book without a phone');
select lives_ok(
  $$ select * from public.create_booking('c0000000-0000-0000-0000-0000000037a1', (select t07 + interval '1 hour' from fx), 1, 'Gus Guest', 'gus@example.com', '+63 917 123 4567') $$,
  'a guest can book with a +63 phone');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000037a1', (select t07 + interval '2 hours' from fx), 1, 'Bad Phone', 'bad@example.com', '028123456') $$),
  'invalid_phone', 'a guest with an invalid phone is refused with invalid_phone');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000037a1', (select t07 + interval '2 hours' from fx), 1, '', 'x@example.com') $$),
  'invalid_guest', 'a guest still needs a name');
select throws_ok(
  $$ select * from public.create_booking('c0000000-0000-0000-0000-0000000037a1', (select t07 + interval '2 hours' from fx), 1, 'No Email', '') $$,
  'P0001', 'Please enter your name and email.', 'a missing email gives the new message without "phone"');
reset role;

select is((select guest_phone from public.bookings where guest_email = 'gina@example.com'), null, 'the phone-less booking stores a null phone');
select is((select guest_phone from public.bookings where guest_email = 'gus@example.com'), '09171234567', 'the +63 phone is stored as 09171234567');
select is((select count(*)::int from public.bookings where guest_email = 'bad@example.com'), 0, 'the refused booking left no row');

-- signed-in player: profile phone used when none is passed
update public.profiles set phone = '0918 000 1111' where id = '11111111-1111-1111-1111-111111111111';
select is((select phone from public.profiles where id = '11111111-1111-1111-1111-111111111111'), '09180001111',
  'a profile phone is normalized on write');
set local role authenticated;
select pg_temp.as_player();
select is(pg_temp.hint_of($$ update public.profiles set phone = '12345' where id = '11111111-1111-1111-1111-111111111111' $$),
  'invalid_phone', 'a player cannot save an invalid profile phone');
update public.profiles set phone = '+63 919 222 3333' where id = '11111111-1111-1111-1111-111111111111';
reset role;
select is((select phone from public.profiles where id = '11111111-1111-1111-1111-111111111111'), '09192223333',
  'a player updating their own phone gets it normalized');

-- ---------------------------------------------------------------------------
-- Walk-ins and direct writes
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_admin();
select lives_ok(
  $$ select * from public.create_walk_in('c0000000-0000-0000-0000-0000000037a1', (select t07 + interval '3 hours' from fx), 1, 'Walker One', '917 555 0000') $$,
  'a walk-in with a bare 10-digit phone is accepted');
select lives_ok(
  $$ select * from public.create_walk_in('c0000000-0000-0000-0000-0000000037a1', (select t07 + interval '4 hours' from fx), 1, 'Walker Two') $$,
  'a walk-in without a phone is accepted');
select is(pg_temp.hint_of($$ select * from public.create_walk_in('c0000000-0000-0000-0000-0000000037a1', (select t07 + interval '5 hours' from fx), 1, 'Walker Bad', 'abc') $$),
  'invalid_phone', 'a walk-in with an invalid phone is refused');
reset role;
select is((select guest_phone from public.bookings where guest_name = 'Walker One'), '09175550000', 'the walk-in phone is stored normalized');

select is(pg_temp.hint_of($$ update public.bookings set guest_phone = '123' where guest_name = 'Walker One' $$),
  'invalid_phone', 'updating a booking to an invalid phone is refused by the trigger');
update public.bookings set guest_phone = '0917-555-1234' where guest_name = 'Walker One';
select is((select guest_phone from public.bookings where guest_name = 'Walker One'), '09175551234', 'updating a booking phone normalizes it');

select * from finish();
rollback;
