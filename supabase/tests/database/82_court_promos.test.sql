-- T19.1: court promo rates. public.court_promos + public.court_promo_courts (RLS, constraints, venue-consistent FKs),
-- public.save_court_promo / public.delete_court_promo, private.slot_price honoring an active promo (date range, weekday, local
-- start hour, court; overnight slots follow their operating day), get_availability.promo_label, and create_booking totals.
-- 2030-01-05 is a Saturday in Asia/Manila (UTC+8); booking-path cases use dates relative to today (inside the booking window).
begin;
create extension if not exists pgtap with schema extensions;
select plan(144);

create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
create function pg_temp.try(p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
exception when others then
  null;
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
create function pg_temp.as_other_admin() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true)
$$;
create function pg_temp.main_id() returns uuid language sql as $$ select id from public.venues where slug = 'claudex-courts' $$;
create function pg_temp.at(p_day date, p_time time) returns timestamptz language sql as $$
  select (p_day + p_time) at time zone 'Asia/Manila'
$$;
-- Thin wrapper so the cases below stay readable; plpgsql so it is only resolved when called.
create function pg_temp.sv(p_id uuid, p_label text, p_from date, p_to date, p_courts uuid[], p_days int[], p_sh int, p_eh int,
  p_price numeric, p_active boolean default true) returns uuid language plpgsql as $$
begin
  return public.save_court_promo(p_id, p_label, p_from, p_to, p_courts, p_days::smallint[], p_sh::smallint, p_eh::smallint, p_price, p_active);
end $$;
create function pg_temp.av_price(p_date date, p_court uuid, p_ts timestamptz) returns numeric language plpgsql as $$
begin
  return (select a.price from public.get_availability(p_date, p_court) a where a.slot_start = p_ts);
end $$;
create function pg_temp.av_label(p_date date, p_court uuid, p_ts timestamptz) returns text language plpgsql as $$
begin
  return (select a.promo_label from public.get_availability(p_date, p_court) a where a.slot_start = p_ts);
end $$;
-- A direct (postgres) insert of a main-venue promo, to probe the table constraints one at a time.
create function pg_temp.raw(p_label text, p_from date, p_to date, p_days int[], p_sh int, p_eh int, p_price numeric) returns void language plpgsql as $$
begin
  insert into public.court_promos (id, venue_id, label, starts_on, ends_on, days_of_week, start_hour, end_hour, price, is_active)
  values (gen_random_uuid(), (select id from public.venues where slug = 'claudex-courts'), p_label, p_from, p_to,
          p_days::smallint[], p_sh::smallint, p_eh::smallint, p_price, true);
end $$;
grant execute on function pg_temp.sqlstate_of(text), pg_temp.hint_of(text), pg_temp.try(text), pg_temp.as_anon(), pg_temp.as_player(),
  pg_temp.as_admin(), pg_temp.as_other_admin(), pg_temp.main_id(), pg_temp.at(date, time),
  pg_temp.sv(uuid, text, date, date, uuid[], int[], int, int, numeric, boolean),
  pg_temp.av_price(date, uuid, timestamptz), pg_temp.av_label(date, uuid, timestamptz)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fixtures. Court ids: A c..191, B c..193 (both main venue, A has court_rates), O c..194 (overnight), E c..195, F c..196,
-- c..192 belongs to the other venue, c..197 to a suspended venue.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'pat@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'other-admin@test.local');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-000000000191', 'e2e-promo-other', 'active'),
  ('a0000000-0000-0000-0000-000000000192', 'e2e-promo-susp', 'suspended');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-000000000191', 'E2E Promo Other', 'Asia/Manila'),
  ('a0000000-0000-0000-0000-000000000192', 'E2E Promo Suspended', 'Asia/Manila');
insert into public.venue_members (venue_id, user_id, role)
  select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000191', '44444444-4444-4444-4444-444444444444', 'owner');
insert into public.courts (venue_id, id, name, sport, default_hourly_rate) values
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000191', 'Promo Court A', 'tennis', 500),
  ('a0000000-0000-0000-0000-000000000191', 'c0000000-0000-0000-0000-000000000192', 'Promo Other Court', 'tennis', 500),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000193', 'Promo Court B', 'tennis', 500),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000194', 'Promo Night Court', 'tennis', 300),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000195', 'Promo Court E', 'tennis', 300),
  (private.default_venue_id(), 'c0000000-0000-0000-0000-000000000196', 'Promo Court F', 'tennis', 300),
  ('a0000000-0000-0000-0000-000000000192', 'c0000000-0000-0000-0000-000000000197', 'Promo Suspended Court', 'tennis', 300);

update public.venue_settings set booking_window_days = 30 where venue_id = private.default_venue_id();
update public.operating_hours set open_time = '06:00', close_time = '22:00', is_closed = false;
update public.operating_hours set close_time = '05:00' where day_of_week = 5; -- Friday runs overnight to 05:00 Saturday

-- d: three days out (dow_d its weekday, dow_n the next); f: a Friday inside the window.
create temp table fx as
select t + 3 as d, extract(dow from t + 3)::int as dow_d, ((extract(dow from t + 3)::int + 1) % 7) as dow_n,
       t + 2 + ((5 - extract(dow from t + 2)::int + 7) % 7) as f
from (select private.local_today(private.default_venue_id()) as t) x;
grant select on fx to anon, authenticated;
create temp table pr (label text primary key, id uuid);
grant select, insert on pr to authenticated;
grant select on pr to anon;

-- Court A has weekday rates at 10:00 and 12:00 on d's weekday (400): the promo must beat these, and they apply outside it.
insert into public.court_rates (court_id, day_of_week, start_hour, price)
select 'c0000000-0000-0000-0000-000000000191'::uuid, dow_d, h, 400 from fx, (values (10), (12)) v(h);

-- A promo in a suspended venue, inserted directly (fixed id).
insert into public.court_promos (id, venue_id, label, starts_on, ends_on, days_of_week, start_hour, end_hour, price, is_active)
values ('e0000000-0000-0000-0000-000000000197', 'a0000000-0000-0000-0000-000000000192', 'Suspended promo', '2030-01-05', '2030-01-05', '{6}', 8, 10, 100, true);
insert into public.court_promo_courts (promo_id, court_id, venue_id)
values ('e0000000-0000-0000-0000-000000000197', 'c0000000-0000-0000-0000-000000000197', 'a0000000-0000-0000-0000-000000000192');

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
select has_table('public', 'court_promos', 'public.court_promos exists');
select has_table('public', 'court_promo_courts', 'public.court_promo_courts exists');
select col_type_is('public', 'court_promos', 'label', 'text', 'label is text');
select col_type_is('public', 'court_promos', 'starts_on', 'date', 'starts_on is date');
select col_type_is('public', 'court_promos', 'ends_on', 'date', 'ends_on is date');
select col_type_is('public', 'court_promos', 'days_of_week', 'smallint[]', 'days_of_week is smallint[]');
select col_type_is('public', 'court_promos', 'start_hour', 'smallint', 'start_hour is smallint');
select col_type_is('public', 'court_promos', 'end_hour', 'smallint', 'end_hour is smallint');
select col_type_is('public', 'court_promos', 'price', 'numeric', 'price is numeric');
select col_type_is('public', 'court_promos', 'is_active', 'boolean', 'is_active is boolean');
select is((select relrowsecurity from pg_class where oid = 'public.court_promos'::regclass), true, 'RLS is enabled on court_promos');
select is((select relrowsecurity from pg_class where oid = 'public.court_promo_courts'::regclass), true, 'RLS is enabled on court_promo_courts');

select has_function('public', 'save_court_promo', array['uuid', 'text', 'date', 'date', 'uuid[]', 'smallint[]', 'smallint', 'smallint', 'numeric', 'boolean'],
  'save_court_promo(uuid, text, date, date, uuid[], smallint[], smallint, smallint, numeric, boolean) exists');
select function_returns('public', 'save_court_promo', array['uuid', 'text', 'date', 'date', 'uuid[]', 'smallint[]', 'smallint', 'smallint', 'numeric', 'boolean'],
  'uuid', 'save_court_promo returns uuid');
select has_function('public', 'delete_court_promo', array['uuid'], 'delete_court_promo(uuid) exists');
select function_returns('public', 'delete_court_promo', array['uuid'], 'void', 'delete_court_promo returns void');
select is((select p.prosecdef from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_court_promo'), true, 'save_court_promo is security definer');
select is((select p.prosecdef from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'delete_court_promo'), true, 'delete_court_promo is security definer');
select is((select has_function_privilege('anon', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_court_promo'), false, 'anon cannot execute save_court_promo');
select is((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'save_court_promo'), true, 'authenticated can execute save_court_promo');
select is((select has_function_privilege('anon', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'delete_court_promo'), false, 'anon cannot execute delete_court_promo');
select is((select has_function_privilege('authenticated', p.oid, 'execute') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'delete_court_promo'), true, 'authenticated can execute delete_court_promo');

-- ---------------------------------------------------------------------------
-- Constraints (direct inserts as the table owner)
-- ---------------------------------------------------------------------------
select throws_ok($$ select pg_temp.raw('', '2030-01-05', '2030-01-05', array[6], 8, 10, 100) $$, '23514', null, 'an empty label violates a check');
select throws_ok($$ select pg_temp.raw(repeat('x', 61), '2030-01-05', '2030-01-05', array[6], 8, 10, 100) $$, '23514', null, 'a 61-character label violates a check');
select throws_ok($$ select pg_temp.raw('Bad dates', '2030-01-06', '2030-01-05', array[6], 8, 10, 100) $$, '23514', null, 'ends_on before starts_on violates a check');
select throws_ok($$ select pg_temp.raw('No days', '2030-01-05', '2030-01-05', array[]::int[], 8, 10, 100) $$, '23514', null, 'an empty days_of_week violates a check');
select throws_ok($$ select pg_temp.raw('Day 7', '2030-01-05', '2030-01-05', array[7], 8, 10, 100) $$, '23514', null, 'a weekday outside 0-6 violates a check');
select throws_ok($$ select pg_temp.raw('Hour 25', '2030-01-05', '2030-01-05', array[6], 8, 25, 100) $$, '23514', null, 'end_hour above 24 violates a check');
select throws_ok($$ select pg_temp.raw('Empty window', '2030-01-05', '2030-01-05', array[6], 10, 10, 100) $$, '23514', null, 'end_hour equal to start_hour violates a check');
select throws_ok($$ select pg_temp.raw('Free', '2030-01-05', '2030-01-05', array[6], 8, 10, 0) $$, '23514', null, 'a zero price violates a check');
select lives_ok($$ select pg_temp.raw(repeat('x', 60), '2030-01-05', '2030-01-05', array[0, 6], 0, 24, 0.01) $$,
  'a 60-character label, hours 0 to 24, weekdays 0 and 6 and a 0.01 price are valid');
delete from public.court_promos where price = 0.01;

insert into public.court_promos (id, venue_id, label, starts_on, ends_on, days_of_week, start_hour, end_hour, price, is_active)
values ('e0000000-0000-0000-0000-0000000001ff', private.default_venue_id(), 'FK probe', '2030-01-05', '2030-01-05', '{6}', 8, 10, 100, true);
select throws_ok($$ insert into public.court_promo_courts (promo_id, court_id, venue_id)
  values ('e0000000-0000-0000-0000-0000000001ff', 'c0000000-0000-0000-0000-000000000192', private.default_venue_id()) $$,
  '23503', null, 'a promo cannot link another venue''s court (court not in the promo''s venue)');
select throws_ok($$ insert into public.court_promo_courts (promo_id, court_id, venue_id)
  values ('e0000000-0000-0000-0000-0000000001ff', 'c0000000-0000-0000-0000-000000000191', 'a0000000-0000-0000-0000-000000000191') $$,
  '23503', null, 'a link row cannot carry a venue different from its promo''s');
select lives_ok($$ insert into public.court_promo_courts (promo_id, court_id, venue_id)
  values ('e0000000-0000-0000-0000-0000000001ff', 'c0000000-0000-0000-0000-000000000191', private.default_venue_id()) $$,
  'a same-venue link is accepted');
delete from public.court_promos where id = 'e0000000-0000-0000-0000-0000000001ff';
select is((select count(*)::int from public.court_promo_courts where promo_id = 'e0000000-0000-0000-0000-0000000001ff'), 0,
  'deleting a promo removes its court links');

-- ---------------------------------------------------------------------------
-- Venue admins write through the RPCs (both venues)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_admin();
select lives_ok($$ insert into pr select 'p1', pg_temp.sv(null, 'Happy hour', (select d from fx), (select d + 7 from fx),
  array['c0000000-0000-0000-0000-000000000191'::uuid], array[(select dow_d from fx)], 10, 12, 200) $$,
  'the venue admin creates a promo through save_court_promo (null id inserts)');
select lives_ok($$ insert into pr select 'p2', pg_temp.sv(null, 'Night owl', (select f from fx), (select f from fx),
  array['c0000000-0000-0000-0000-000000000194'::uuid], array[5], 0, 3, 150) $$, 'the admin creates a Friday 00:00-03:00 promo');
select lives_ok($$ insert into pr select 'p2b', pg_temp.sv(null, 'Wrong day', (select f + 1 from fx), (select f + 1 from fx),
  array['c0000000-0000-0000-0000-000000000194'::uuid], array[6], 0, 3, 77) $$, 'the admin creates a Saturday 00:00-03:00 promo');
select pg_temp.as_other_admin();
select lives_ok($$ insert into pr select 'ov', pg_temp.sv(null, 'Other venue promo', (select d from fx), (select d from fx),
  array['c0000000-0000-0000-0000-000000000192'::uuid], array[(select dow_d from fx)], 8, 9, 50) $$,
  'another venue''s admin creates a promo on its own court');
reset role;
select results_eq(
  $$ select venue_id, label, starts_on, ends_on, days_of_week::text, start_hour::int, end_hour::int, price::numeric, is_active
     from public.court_promos where id = (select id from pr where label = 'p1') $$,
  $$ select pg_temp.main_id(), 'Happy hour', (select d from fx), (select d + 7 from fx), '{' || dow_d || '}', 10, 12, 200::numeric, true from fx $$,
  'the saved promo has the given values and the courts'' venue');
select results_eq(
  $$ select court_id, venue_id from public.court_promo_courts where promo_id = (select id from pr where label = 'p1') $$,
  $$ values ('c0000000-0000-0000-0000-000000000191'::uuid, pg_temp.main_id()) $$,
  'its court link carries the venue');

-- ---------------------------------------------------------------------------
-- RLS: reads
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_anon();
select is((select count(*)::int from public.court_promos where id = (select id from pr where label = 'p1')), 1, 'anon reads an active venue''s promo');
select is((select count(*)::int from public.court_promo_courts where promo_id = (select id from pr where label = 'p1')), 1, 'anon reads an active venue''s promo-court link');
select is((select count(*)::int from public.court_promos where id = 'e0000000-0000-0000-0000-000000000197'), 0, 'anon does not read a suspended venue''s promo');
select is((select count(*)::int from public.court_promo_courts where promo_id = 'e0000000-0000-0000-0000-000000000197'), 0, 'anon does not read a suspended venue''s link');
select is(pg_temp.sqlstate_of($$ insert into public.court_promos (id, venue_id, label, starts_on, ends_on, days_of_week, start_hour, end_hour, price, is_active)
  values (gen_random_uuid(), pg_temp.main_id(), 'Sneaky', '2030-01-05', '2030-01-05', '{6}', 8, 9, 1, true) $$), '42501', 'anon cannot insert a promo');
select pg_temp.try($$ update public.court_promos set price = 1 $$);
select pg_temp.try($$ delete from public.court_promos $$);
select pg_temp.try($$ delete from public.court_promo_courts $$);
reset role;

set local role authenticated;
select pg_temp.as_player();
select is((select count(*)::int from public.court_promos where id = (select id from pr where label = 'p1')), 1, 'a player reads an active venue''s promo');
select is((select count(*)::int from public.court_promos where id = 'e0000000-0000-0000-0000-000000000197'), 0, 'a player does not read a suspended venue''s promo');
select is(pg_temp.sqlstate_of($$ insert into public.court_promos (id, venue_id, label, starts_on, ends_on, days_of_week, start_hour, end_hour, price, is_active)
  values (gen_random_uuid(), pg_temp.main_id(), 'Sneaky', '2030-01-05', '2030-01-05', '{6}', 8, 9, 1, true) $$), '42501', 'a player cannot insert a promo');
select is(pg_temp.sqlstate_of($$ insert into public.court_promo_courts (promo_id, court_id, venue_id)
  values ((select id from pr where label = 'p1'), 'c0000000-0000-0000-0000-000000000193', pg_temp.main_id()) $$), '42501', 'a player cannot link a court to a promo');
select pg_temp.try($$ update public.court_promos set price = 1, label = 'Hacked', is_active = false $$);
select pg_temp.try($$ delete from public.court_promos $$);
select pg_temp.try($$ delete from public.court_promo_courts $$);

select pg_temp.as_other_admin();
select is((select count(*)::int from public.court_promos where id = 'e0000000-0000-0000-0000-000000000197'), 0, 'another venue''s admin does not read a suspended venue''s promo');
select is(pg_temp.sqlstate_of($$ insert into public.court_promos (id, venue_id, label, starts_on, ends_on, days_of_week, start_hour, end_hour, price, is_active)
  values (gen_random_uuid(), pg_temp.main_id(), 'Sneaky', '2030-01-05', '2030-01-05', '{6}', 8, 9, 1, true) $$), '42501', 'another venue''s admin cannot insert a promo into this venue');
select pg_temp.try($$ update public.court_promos set price = 1, label = 'Hacked', is_active = false where venue_id = pg_temp.main_id() $$);
select pg_temp.try($$ delete from public.court_promos where venue_id = pg_temp.main_id() $$);
select pg_temp.try($$ delete from public.court_promo_courts where venue_id = pg_temp.main_id() $$);
reset role;
select is((select count(*)::int from public.court_promos where id = (select id from pr where label = 'p1') and label = 'Happy hour' and price = 200 and is_active),
  1, 'refused anon, player and foreign-admin writes left the promo untouched');
select is((select count(*)::int from public.court_promo_courts where promo_id = (select id from pr where label = 'p1')), 1,
  'and left its court link in place');
select is((select count(*)::int from public.court_promos where label in ('Sneaky', 'Hacked')), 0, 'no sneaky row was created');

-- ---------------------------------------------------------------------------
-- RPC authorization and validation
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_player();
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Nope', (select d from fx), (select d from fx),
  array['c0000000-0000-0000-0000-000000000191'::uuid], array[1], 8, 9, 10) $$), 'forbidden', 'a player is refused with forbidden');
select is(pg_temp.hint_of($$ select public.delete_court_promo((select id from pr where label = 'p1')) $$), 'forbidden', 'a player cannot delete a promo (forbidden)');
select pg_temp.as_other_admin();
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Nope', (select d from fx), (select d from fx),
  array['c0000000-0000-0000-0000-000000000191'::uuid], array[1], 8, 9, 10) $$), 'court_not_found', 'another venue''s admin saving on this venue''s court is court_not_found');
select throws_ok($$ select public.delete_court_promo((select id from pr where label = 'p1')) $$, 'P0001', null,
  'another venue''s admin cannot delete this venue''s promo');
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.sqlstate_of($$ select pg_temp.sv(null, 'Nope', '2030-01-05', '2030-01-05',
  array['c0000000-0000-0000-0000-000000000191'::uuid], array[1], 8, 9, 10) $$), '42501', 'anon cannot call save_court_promo');
select is(pg_temp.sqlstate_of($$ select public.delete_court_promo(gen_random_uuid()) $$), '42501', 'anon cannot call delete_court_promo');
reset role;
select is((select count(*)::int from public.court_promos where id = (select id from pr where label = 'p1')), 1, 'the refused deletes left the promo in place');

set local role authenticated;
select pg_temp.as_admin();
select is(pg_temp.hint_of($$ select pg_temp.sv(null, '', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[(select dow_n from fx)], 14, 15, 100) $$), 'invalid_input', 'an empty label is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, repeat('x', 61), (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[(select dow_n from fx)], 14, 15, 100) $$), 'invalid_input', 'a 61-character label is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Backwards', (select d + 2 from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[(select dow_n from fx)], 14, 15, 100) $$), 'invalid_input', 'ends before starts is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'No days', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[]::int[], 14, 15, 100) $$), 'invalid_input', 'no days is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Day 7', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[7], 14, 15, 100) $$), 'invalid_input', 'a day outside 0-6 is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Empty window', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[(select dow_n from fx)], 15, 15, 100) $$), 'invalid_input', 'end_hour equal to start_hour is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Hour 25', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[(select dow_n from fx)], 14, 25, 100) $$), 'invalid_input', 'end_hour above 24 is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Negative hour', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[(select dow_n from fx)], -1, 15, 100) $$), 'invalid_input', 'a negative start_hour is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Free', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[(select dow_n from fx)], 14, 15, 0) $$), 'invalid_input', 'a zero price is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Negative', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[(select dow_n from fx)], 14, 15, -5) $$), 'invalid_input', 'a negative price is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'No courts', (select d from fx), (select d + 1 from fx),
  array[]::uuid[], array[(select dow_n from fx)], 14, 15, 100) $$), 'invalid_input', 'no courts is invalid_input');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Ghost court', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-0000000001ff'::uuid], array[(select dow_n from fx)], 14, 15, 100) $$), 'court_not_found', 'a court that does not exist is court_not_found');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Foreign court', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000192'::uuid], array[(select dow_n from fx)], 14, 15, 100) $$), 'court_not_found', 'another venue''s court is court_not_found');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Mixed courts', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid, 'c0000000-0000-0000-0000-000000000192'::uuid], array[(select dow_n from fx)], 14, 15, 100) $$),
  'court_not_found', 'one foreign court among own courts is court_not_found');
select throws_ok($$ select pg_temp.sv(null, '', (select d from fx), (select d + 1 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[(select dow_n from fx)], 14, 15, 100) $$, 'P0001', null, 'validation errors are P0001');
reset role;
select is((select count(*)::int from public.court_promos where label in ('', 'Backwards', 'No days', 'Day 7', 'Empty window', 'Hour 25', 'Negative hour', 'Free', 'Negative', 'No courts', 'Ghost court', 'Foreign court', 'Mixed courts', 'Nope')
  or length(label) = 61), 0, 'no refused call created a promo');

-- ---------------------------------------------------------------------------
-- Pricing: private.slot_price / range_price (A: default 500, rates 400 at 10:00 and 12:00 on d's weekday; promo 10-12 for 200)
-- ---------------------------------------------------------------------------
select is(private.slot_price('c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '10:00')), 200::numeric, 'slot_price: a promo hour beats the court rate');
select is(private.slot_price('c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '11:00')), 200::numeric, 'slot_price: the last promo hour (11:00) is covered');
select is(private.slot_price('c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '12:00')), 400::numeric, 'slot_price: end_hour is exclusive (12:00 uses the court rate)');
select is(private.slot_price('c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '09:00')), 500::numeric, 'slot_price: one hour before the window is the default rate');
select is(private.slot_price('c0000000-0000-0000-0000-000000000191', pg_temp.at((select d + 1 from fx), '10:00')), 500::numeric, 'slot_price: the next day (other weekday) is unaffected');
select is(private.slot_price('c0000000-0000-0000-0000-000000000191', pg_temp.at((select d + 7 from fx), '10:00')), 200::numeric, 'slot_price: ends_on is inclusive');
select is(private.slot_price('c0000000-0000-0000-0000-000000000191', pg_temp.at((select d + 14 from fx), '10:00')), 400::numeric, 'slot_price: after ends_on the court rate applies again');
select is(private.slot_price('c0000000-0000-0000-0000-000000000191', pg_temp.at((select d - 7 from fx), '10:00')), 400::numeric, 'slot_price: before starts_on the court rate applies');
select is(private.slot_price('c0000000-0000-0000-0000-000000000193', pg_temp.at((select d from fx), '10:00')), 500::numeric, 'slot_price: another court of the venue is unaffected');
select is(private.range_price('c0000000-0000-0000-0000-000000000191', tstzrange(pg_temp.at((select d from fx), '11:00'), pg_temp.at((select d from fx), '14:00'))),
  1100::numeric, 'range_price sums promo (200), rate (400) and default (500)');
select is(private.slot_price('c0000000-0000-0000-0000-000000000191', '2030-01-05 07:00+08'), 500::numeric, 'with no promo on that date prices are unchanged (2030-01-05 07:00)');

-- Overnight: the 01:00 slot after Friday's opening is Friday's, so Friday's promo applies and Saturday's does not.
select is(private.slot_price('c0000000-0000-0000-0000-000000000194', pg_temp.at((select f + 1 from fx), '01:00')), 150::numeric,
  'overnight: 01:00 after a Friday opening takes the Friday promo, not the Saturday one');
select is(private.slot_price('c0000000-0000-0000-0000-000000000194', pg_temp.at((select f + 1 from fx), '04:00')), 300::numeric,
  'overnight: 04:00 is outside the 0-3 window (default rate)');
select is(private.slot_price('c0000000-0000-0000-0000-000000000194', pg_temp.at((select f from fx), '06:00')), 300::numeric,
  'overnight: Friday 06:00 is outside the 0-3 window');

-- ---------------------------------------------------------------------------
-- get_availability: price and promo_label
-- ---------------------------------------------------------------------------
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.av_price((select d from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '10:00')), 200::numeric, 'availability: promo price inside the window');
select is(pg_temp.av_label((select d from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '10:00')), 'Happy hour', 'availability: promo_label is the promo''s label');
select is(pg_temp.av_price((select d from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '11:00')), 200::numeric, 'availability: last promo hour');
select is(pg_temp.av_price((select d from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '12:00')), 400::numeric, 'availability: end hour uses the court rate');
select ok(pg_temp.av_label((select d from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '12:00')) is null, 'availability: no label outside the window');
select is(pg_temp.av_price((select d from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '09:00')), 500::numeric, 'availability: one hour before is the default rate');
select ok(pg_temp.av_label((select d from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d from fx), '09:00')) is null, 'availability: no label an hour before');
select is(pg_temp.av_price((select d + 1 from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d + 1 from fx), '10:00')), 500::numeric, 'availability: the next day is unaffected');
select is(pg_temp.av_price((select d + 7 from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d + 7 from fx), '10:00')), 200::numeric, 'availability: the last day of the range is promo-priced');
select is(pg_temp.av_price((select d + 14 from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d + 14 from fx), '10:00')), 400::numeric, 'availability: after ends_on the court rate applies');
select ok(pg_temp.av_label((select d + 14 from fx), 'c0000000-0000-0000-0000-000000000191', pg_temp.at((select d + 14 from fx), '10:00')) is null, 'availability: no label after ends_on');
select is(pg_temp.av_price((select d from fx), 'c0000000-0000-0000-0000-000000000193', pg_temp.at((select d from fx), '10:00')), 500::numeric, 'availability: another court is unaffected');
select is((select count(*)::int from public.get_availability((select d from fx), 'c0000000-0000-0000-0000-000000000193') where promo_label is not null), 0,
  'availability: an unpromoted court has no labels');
select is(pg_temp.av_price((select f from fx), 'c0000000-0000-0000-0000-000000000194', pg_temp.at((select f + 1 from fx), '01:00')), 150::numeric, 'availability: the overnight slot is priced from its operating day''s promo');
select is(pg_temp.av_label((select f from fx), 'c0000000-0000-0000-0000-000000000194', pg_temp.at((select f + 1 from fx), '01:00')), 'Night owl', 'availability: the overnight slot carries the Friday promo label');
reset role;

-- ---------------------------------------------------------------------------
-- create_booking totals; existing bookings keep their total
-- ---------------------------------------------------------------------------
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000191',
  pg_temp.at((select d from fx), '11:00'), 2, 'Promo Pat', 'pat-promo@example.com', '09171234567') $$), null,
  'a guest books A across the end of the promo window');
select is((select total_amount from public.bookings where guest_name = 'Promo Pat'), 600::numeric, 'the total is 200 (promo 11:00) + 400 (rate 12:00)');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000193',
  pg_temp.at((select d from fx), '10:00'), 1, 'Before Bea', 'bea-promo@example.com', '09171234567') $$), null, 'a guest books B before it has a promo');
select is((select total_amount from public.bookings where guest_name = 'Before Bea'), 500::numeric, 'B''s booking is at the default rate');

set local role authenticated;
select pg_temp.as_admin();
select lives_ok($$ insert into pr select 'p3', pg_temp.sv(null, 'Morning', (select d from fx), (select d from fx),
  array['c0000000-0000-0000-0000-000000000193'::uuid], array[(select dow_d from fx)], 9, 13, 100) $$, 'the admin adds a promo on B for the day of the existing booking');
reset role;
select is((select total_amount from public.bookings where guest_name = 'Before Bea'), 500::numeric, 'an existing booking keeps its total_amount after a promo is added');
select is((select total_amount from public.bookings where guest_name = 'Promo Pat'), 600::numeric, 'and so does the other existing booking');
select is(pg_temp.hint_of($$ select * from public.create_booking('c0000000-0000-0000-0000-000000000193',
  pg_temp.at((select d from fx), '11:00'), 2, 'After Abe', 'abe-promo@example.com', '09171234567') $$), null, 'a guest books B inside the new promo');
select is((select total_amount from public.bookings where guest_name = 'After Abe'), 200::numeric, 'create_booking totals the promo price (2 x 100)');
set local role anon;
select pg_temp.as_anon();
select is(pg_temp.av_price((select d from fx), 'c0000000-0000-0000-0000-000000000193', pg_temp.at((select d from fx), '09:00')), 100::numeric, 'availability shows the new promo price');
select is(pg_temp.av_label((select d from fx), 'c0000000-0000-0000-0000-000000000193', pg_temp.at((select d from fx), '09:00')), 'Morning', 'and its label');
select is(pg_temp.av_price((select d from fx), 'c0000000-0000-0000-0000-000000000193', pg_temp.at((select d from fx), '13:00')), 500::numeric, 'but not at its exclusive end hour');
reset role;

-- ---------------------------------------------------------------------------
-- Overlaps (court F: q1 = d weekday, 10-12, d..d+7, 200)
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_admin();
select lives_ok($$ insert into pr select 'q1', pg_temp.sv(null, 'F happy', (select d from fx), (select d + 7 from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 10, 12, 200) $$, 'q1 is created on F');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Clash', (select d + 7 from fx), (select d + 14 from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 11, 13, 100) $$), 'promo_overlap',
  'sharing one day (d+7), the weekday and hour 11 is promo_overlap');
select is(pg_temp.hint_of($$ select pg_temp.sv(null, 'Clash two', (select d from fx), (select d from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid, 'c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 10, 11, 100) $$), 'promo_overlap',
  'overlap on any one of several courts is promo_overlap');
select throws_ok($$ select pg_temp.sv(null, 'Clash three', (select d from fx), (select d from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 10, 11, 100) $$, 'P0001', null, 'promo_overlap is P0001');
select lives_ok($$ insert into pr select 'q2', pg_temp.sv(null, 'F adjacent hours', (select d from fx), (select d + 7 from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 12, 14, 120) $$, 'an adjacent hour window (12-14) does not overlap (end is exclusive)');
select lives_ok($$ insert into pr select 'q3', pg_temp.sv(null, 'F other day', (select d from fx), (select d + 7 from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_n from fx)], 10, 12, 130) $$, 'the same hours on another weekday do not overlap');
select lives_ok($$ insert into pr select 'q4', pg_temp.sv(null, 'F later dates', (select d + 8 from fx), (select d + 14 from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 10, 12, 140) $$, 'the same hours and weekday on later dates do not overlap');
select lives_ok($$ insert into pr select 'q5', pg_temp.sv(null, 'E same slots', (select d from fx), (select d + 7 from fx),
  array['c0000000-0000-0000-0000-000000000195'::uuid], array[(select dow_d from fx)], 10, 12, 150) $$, 'the same slots on another court do not overlap');
select lives_ok($$ select pg_temp.sv((select id from pr where label = 'q1'), 'F happy', (select d from fx), (select d + 7 from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 10, 12, 250) $$, 'editing a promo does not overlap itself');
reset role;
select is(private.slot_price('c0000000-0000-0000-0000-000000000196', pg_temp.at((select d from fx), '10:00')), 250::numeric, 'the edit changed the price');
set local role authenticated;
select pg_temp.as_admin();
select lives_ok($$ select pg_temp.sv((select id from pr where label = 'q1'), 'F happy', (select d from fx), (select d + 7 from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 9, 12, 250) $$, 'widening a promo over its own old window is fine');
select is(pg_temp.hint_of($$ select pg_temp.sv((select id from pr where label = 'q1'), 'F happy', (select d from fx), (select d + 7 from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 9, 13, 250) $$), 'promo_overlap',
  'widening into another promo (q2, 12-14) is promo_overlap');
select lives_ok($$ select pg_temp.sv((select id from pr where label = 'q1'), 'F happy', (select d from fx), (select d + 7 from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 9, 12, 250, false) $$, 'the admin deactivates q1');
reset role;
select is(private.slot_price('c0000000-0000-0000-0000-000000000196', pg_temp.at((select d from fx), '10:00')), 300::numeric, 'an inactive promo is ignored by slot_price (F default)');
set local role authenticated;
select pg_temp.as_admin();
select lives_ok($$ insert into pr select 'q6', pg_temp.sv(null, 'F replacement', (select d from fx), (select d from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 10, 12, 120) $$, 'an inactive promo does not count toward overlap');
select is(pg_temp.hint_of($$ select pg_temp.sv((select id from pr where label = 'q1'), 'F happy', (select d from fx), (select d + 7 from fx),
  array['c0000000-0000-0000-0000-000000000196'::uuid], array[(select dow_d from fx)], 9, 12, 250, true) $$), 'promo_overlap',
  'reactivating a promo that now overlaps an active one is promo_overlap');
reset role;
select is(private.slot_price('c0000000-0000-0000-0000-000000000196', pg_temp.at((select d from fx), '10:00')), 120::numeric, 'the active replacement is used');

-- ---------------------------------------------------------------------------
-- delete_court_promo
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_admin();
select lives_ok($$ select public.delete_court_promo((select id from pr where label = 'q5')) $$, 'the venue admin deletes a promo');
select throws_ok($$ select public.delete_court_promo(gen_random_uuid()) $$, 'P0001', null, 'deleting an unknown promo is refused');
select throws_ok($$ select public.delete_court_promo((select id from pr where label = 'ov')) $$, 'P0001', null, 'a venue admin cannot delete another venue''s promo');
reset role;
select is((select count(*)::int from public.court_promos where id = (select id from pr where label = 'q5')), 0, 'the deleted promo is gone');
select is((select count(*)::int from public.court_promo_courts where promo_id = (select id from pr where label = 'q5')), 0, 'and its court links');
select is((select count(*)::int from public.court_promos where id = (select id from pr where label = 'ov')), 1, 'the other venue''s promo is intact');
select is(private.slot_price('c0000000-0000-0000-0000-000000000195', pg_temp.at((select d from fx), '10:00')), 300::numeric, 'after the delete the court is back to its default rate');
select is((select count(*)::int from public.court_promos where id = 'e0000000-0000-0000-0000-000000000197'), 1, 'the suspended venue''s promo was never touched');

select * from finish();
rollback;
