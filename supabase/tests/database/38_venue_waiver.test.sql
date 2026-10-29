-- T11.19: venue waiver. venue_settings.waiver_text (default, length check, RLS), the bookings snapshot
-- (waiver_accepted_at + waiver_text, the pair check), create_booking's p_waiver_accepted rule, walk-ins and
-- moved continuations storing nothing, get_guest_booking and the email payload.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
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
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000038a1', 'Waiver Court 1', 'tennis', 300),
  ('c0000000-0000-0000-0000-0000000038a2', 'Waiver Court 2', 'tennis', 300),
  ('c0000000-0000-0000-0000-0000000038a3', 'Waiver Court 3', 'tennis', 300);

create temp table fx as
select (private.local_today() + 4 + time '07:00') at time zone 'Asia/Manila' as t07,
       date_trunc('hour', now()) as h;
grant select on fx to anon, authenticated, service_role;
create temp table b (label text primary key, id uuid, ref text, token text);
grant select, insert on b to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- venue_settings.waiver_text: column, default, rollout value, length check
-- ---------------------------------------------------------------------------
select has_column('public', 'venue_settings', 'waiver_text', 'venue_settings has waiver_text');
select col_type_is('public', 'venue_settings', 'waiver_text', 'text', 'waiver_text is text');
select col_not_null('public', 'venue_settings', 'waiver_text', 'waiver_text is required');
select is(
  (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d
     where d.adrelid = 'public.venue_settings'::regclass
       and d.adnum = (select attnum from pg_attribute where attrelid = 'public.venue_settings'::regclass and attname = 'waiver_text')),
  quote_literal('By booking and playing at the venue, you accept that sports carry a risk of injury. You play at your own risk and are responsible for your own belongings. Players under 18 need a parent or guardian''s consent.') || '::text',
  'the column default is the SPEC default waiver text');
select is((select waiver_text from public.venue_settings), '', 'the existing venue starts with no waiver (rollout)');
select is((select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.venue_settings'::regclass and conname = 'venue_settings_waiver_text_length') like '%2000%', true,
  'venue_settings_waiver_text_length exists and limits to 2000');
select is(pg_temp.sqlstate_of($$ update public.venue_settings set waiver_text = repeat('x', 2001) $$), '23514', 'a waiver over 2000 characters is refused');
select lives_ok($$ update public.venue_settings set waiver_text = repeat('x', 2000) $$, 'a waiver of exactly 2000 characters is allowed');
update public.venue_settings set waiver_text = '';

-- RLS: anon and players read, only admins write
set local role anon;
select pg_temp.as_anon();
select is((select waiver_text from public.venue_settings), '', 'anon can read the waiver');
select throws_ok($$ update public.venue_settings set waiver_text = 'anon wrote this' $$, '42501', null, 'anon cannot update the waiver');
set local role authenticated;
select pg_temp.as_player();
select is((select waiver_text from public.venue_settings), '', 'a player can read the waiver');
select lives_ok($$ update public.venue_settings set waiver_text = 'player wrote this' $$, 'a player''s update is filtered by RLS');
select is((select waiver_text from public.venue_settings), '', 'the waiver is unchanged by the player');
select pg_temp.as_admin();
select lives_ok($$ update public.venue_settings set waiver_text = 'Play at your own risk.' $$, 'an admin can set the waiver');
reset role;
select is((select waiver_text from public.venue_settings), 'Play at your own risk.', 'the admin''s waiver is stored');

-- ---------------------------------------------------------------------------
-- bookings columns and the pair check
-- ---------------------------------------------------------------------------
select col_type_is('public', 'bookings', 'waiver_accepted_at', 'timestamp with time zone', 'bookings.waiver_accepted_at is timestamptz');
select col_is_null('public', 'bookings', 'waiver_accepted_at', 'waiver_accepted_at is nullable');
select col_type_is('public', 'bookings', 'waiver_text', 'text', 'bookings.waiver_text is text');
select col_is_null('public', 'bookings', 'waiver_text', 'bookings.waiver_text is nullable');
select is(pg_temp.sqlstate_of($$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, source, waiver_accepted_at)
  values ('CB-WVPAKR', 'c0000000-0000-0000-0000-0000000038a1', 'X', tstzrange(now() + interval '60 days', now() + interval '60 days 1 hour'), 0, 'walk_in', now()) $$),
  '23514', 'bookings_waiver_pair: a timestamp without text is refused');
select is(pg_temp.sqlstate_of($$ insert into public.bookings (reference_code, court_id, guest_name, during, total_amount, source, waiver_text)
  values ('CB-WVPAKR', 'c0000000-0000-0000-0000-0000000038a1', 'X', tstzrange(now() + interval '60 days', now() + interval '60 days 1 hour'), 0, 'walk_in', 'text only') $$),
  '23514', 'bookings_waiver_pair: text without a timestamp is refused');

-- ---------------------------------------------------------------------------
-- create_booking: one function, new signature, grants
-- ---------------------------------------------------------------------------
select is((select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_booking'), 1, 'exactly one create_booking exists');
select has_function('public', 'create_booking', array['uuid', 'timestamp with time zone', 'integer', 'text', 'text', 'text', 'boolean'], 'create_booking takes p_waiver_accepted as the 7th argument');
select ok(has_function_privilege('anon', 'public.create_booking(uuid, timestamptz, integer, text, text, text, boolean)', 'execute')
      and has_function_privilege('authenticated', 'public.create_booking(uuid, timestamptz, integer, text, text, text, boolean)', 'execute'),
  'anon and authenticated can execute create_booking');

-- ---------------------------------------------------------------------------
-- create_booking with a venue waiver
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000038a1', (select t07 from fx), 1, 'No Accept', 'noaccept@example.com', null, false) $$),
  'waiver_required', 'a guest who has not accepted is refused with waiver_required');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000038a1', (select t07 from fx), 1, 'Old Client', 'old@example.com') $$),
  'waiver_required', 'the old 6-argument call (no acceptance) is refused too');
select throws_ok($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000038a1', (select t07 from fx), 1, 'No Accept', 'noaccept@example.com', null, false) $$,
  'P0001', 'Please read and accept the waiver to book.', 'the refusal has the exact message and SQLSTATE P0001');
insert into b select 'guest', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-0000000038a1', fx.t07, 1, 'Wanda Waiver', 'wanda@example.com', '0917 333 3333', true) r;
set local role authenticated;
select pg_temp.as_player();
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000038a2', (select t07 from fx), 1) $$),
  'waiver_required', 'a signed-in player must accept too');
insert into b select 'player', r.id, r.reference_code, null
from fx, public.create_booking('c0000000-0000-0000-0000-0000000038a2', fx.t07, 1, p_waiver_accepted => true) r;
reset role;
select is((select count(*)::int from public.bookings where guest_email in ('noaccept@example.com', 'old@example.com')), 0, 'refused bookings left no row');

select results_eq(
  $$ select bk.waiver_text, bk.waiver_accepted_at between now() - interval '1 minute' and now() + interval '1 minute'
     from public.bookings bk join b on b.id = bk.id where b.label = 'guest' $$,
  $$ values ('Play at your own risk.', true) $$,
  'an accepted guest booking stores the waiver text and the time');
select results_eq(
  $$ select bk.waiver_text, bk.waiver_accepted_at is not null from public.bookings bk join b on b.id = bk.id where b.label = 'player' $$,
  $$ values ('Play at your own risk.', true) $$,
  'an accepted player booking stores the waiver too');

-- Editing the waiver later leaves existing bookings alone
update public.venue_settings set waiver_text = 'A brand new waiver.';
select is((select bk.waiver_text from public.bookings bk join b on b.id = bk.id where b.label = 'guest'), 'Play at your own risk.',
  'editing the venue waiver does not change an existing booking''s copy');

-- get_guest_booking
set local role anon;
select pg_temp.as_anon();
select results_eq(
  $$ select g.waiver_text, g.waiver_accepted_at is not null from b, public.get_guest_booking(b.ref, b.token) g where b.label = 'guest' $$,
  $$ values ('Play at your own risk.', true) $$,
  'get_guest_booking returns the stored waiver text and acceptance time');
reset role;
-- The email payload
select results_eq(
  $$ select x.d ->> 'waiver_text', (x.d ->> 'waiver_accepted_at') is not null, x.d ? 'waiver_accepted_at'
     from (select private.booking_email_data(bk) as d from public.bookings bk join b on b.id = bk.id where b.label = 'guest') x $$,
  $$ values ('Play at your own risk.', true, true) $$,
  'booking_email_data carries waiver_text and waiver_accepted_at');

-- ---------------------------------------------------------------------------
-- A blank venue waiver: nothing required, nothing stored
-- ---------------------------------------------------------------------------
update public.venue_settings set waiver_text = '';
set local role anon;
select pg_temp.as_anon();
insert into b select 'blank', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-0000000038a3', fx.t07, 1, 'Blank Guest', 'blank@example.com') r;
insert into b select 'blank_accepted', r.id, r.reference_code, r.guest_token
from fx, public.create_booking('c0000000-0000-0000-0000-0000000038a3', fx.t07 + interval '1 hour', 1, 'Blank Yes', 'blankyes@example.com', null, true) r;
reset role;
select results_eq(
  $$ select bk.waiver_text, bk.waiver_accepted_at from public.bookings bk join b on b.id = bk.id where b.label in ('blank', 'blank_accepted') $$,
  $$ values (null::text, null::timestamptz), (null::text, null::timestamptz) $$,
  'with a blank waiver the booking stores nulls whether or not acceptance was sent');

update public.venue_settings set waiver_text = '   ';
set local role anon;
select pg_temp.as_anon();
select lives_ok($$ select * from public.create_booking('c0000000-0000-0000-0000-0000000038a3', (select t07 + interval '2 hours' from fx), 1, 'Spaces', 'spaces@example.com') $$,
  'a whitespace-only waiver counts as blank: no acceptance needed');
reset role;
select results_eq(
  $$ select waiver_text, waiver_accepted_at from public.bookings where guest_email = 'spaces@example.com' $$,
  $$ values (null::text, null::timestamptz) $$,
  'a whitespace-only waiver is not stored');

-- ---------------------------------------------------------------------------
-- Walk-ins and moved continuations store nothing
-- ---------------------------------------------------------------------------
update public.venue_settings set waiver_text = 'Walk-in era waiver.';
set local role authenticated;
select pg_temp.as_admin();
insert into b select 'walkin', r.id, r.reference_code, null
from fx, public.create_walk_in('c0000000-0000-0000-0000-0000000038a1', fx.t07 + interval '1 day', 1, 'Walk Wally') r;
reset role;
select results_eq(
  $$ select bk.waiver_text, bk.waiver_accepted_at from public.bookings bk join b on b.id = bk.id where b.label = 'walkin' $$,
  $$ values (null::text, null::timestamptz) $$,
  'a walk-in stores no waiver even when the venue has one');

-- A booking in progress with a waiver, split by reschedule_booking: the continuation gets nulls.
insert into public.bookings (reference_code, court_id, guest_name, guest_email, during, total_amount, status, source,
                             guest_token_hash, waiver_accepted_at, waiver_text)
values ('CB-WVLKEE', 'c0000000-0000-0000-0000-0000000038a3', 'Live Lou', 'live@example.com',
        tstzrange((select h from fx) - interval '1 hour', (select h from fx) + interval '2 hours'), 900, 'confirmed', 'online',
        sha256(convert_to('tok-live', 'UTF8')), now() - interval '2 hours', 'Walk-in era waiver.');
insert into public.payments (booking_id, method, amount, review_status, reviewed_at)
select id, 'cash', 900, 'approved', now() from public.bookings where reference_code = 'CB-WVLKEE';
set local role authenticated;
select pg_temp.as_admin();
insert into b (label, id)
select 'cont', x.continuation_id
from public.reschedule_booking((select id from public.bookings where reference_code = 'CB-WVLKEE'),
  (select h from fx), 'c0000000-0000-0000-0000-0000000038a2', (select t07 + interval '5 days' from fx), 'Lights failed') x;
reset role;
select results_eq(
  $$ select bk.source::text, bk.waiver_text, bk.waiver_accepted_at from public.bookings bk join b on b.id = bk.id where b.label = 'cont' $$,
  $$ values ('moved', null::text, null::timestamptz) $$,
  'a moved continuation stores no waiver');
select results_eq(
  $$ select waiver_text, waiver_accepted_at is not null from public.bookings where reference_code = 'CB-WVLKEE' $$,
  $$ values ('Walk-in era waiver.', true) $$,
  'the original booking keeps its waiver after the split');
select is((select (private.booking_email_data(bk) ->> 'waiver_text') is null and (private.booking_email_data(bk) ? 'waiver_text')
           from public.bookings bk join b on b.id = bk.id where b.label = 'walkin'),
  true, 'booking_email_data has the waiver keys with null values for a walk-in');

select * from finish();
rollback;
