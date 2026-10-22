-- T9.11g: venue info. RLS (anon, player, admin) on the location columns, social links, info sections and
-- amenities; the URL, host and length checks; section ordering; the starter sections.
begin;
create extension if not exists pgtap with schema extensions;
select plan(51);

create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare h text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(nullif(h, ''), 'sqlstate ' || sqlstate);
end $$;
grant execute on function pg_temp.hint_of(text) to anon, authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

-- The migration's starter sections, then a known state for the rest (local edits are rolled back with the rest).
select is(
  (select count(*)::int from public.venue_info_sections
   where title in ('Waiver', 'Reminders and policies', 'Cancellation and refund policy', 'House rules')),
  4, 'the migration adds the four starter sections'
);
delete from public.venue_info_sections;
insert into public.venue_info_sections (title) values ('Waiver'), ('Reminders and policies'), ('Cancellation and refund policy'), ('House rules');
delete from public.venue_social_links;
delete from public.venue_amenities;
update public.venue_settings set address = '', maps_query = '';

-- ---------------------------------------------------------------------------
-- Anon: reads, never writes
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select results_eq(
  $$ select title from public.venue_info_sections order by sort_order $$,
  $$ values ('Waiver'), ('Reminders and policies'), ('Cancellation and refund policy'), ('House rules') $$,
  'sections are readable by anyone, in order'
);
select is((select count(*)::int from public.venue_social_links), 0, 'anon can read social links (none yet)');
select is((select count(*)::int from public.venue_amenities), 0, 'anon can read amenities (none yet)');
select is((select address from public.venue_settings), '', 'anon reads the address (empty by default)');
select throws_ok($$ insert into public.venue_info_sections (title) values ('Anon') $$, '42501', null,
  'anon cannot add sections');
select throws_ok($$ insert into public.venue_amenities (builtin_key) values ('wifi') $$, '42501', null,
  'anon cannot switch on amenities');
select throws_ok($$ insert into public.venue_social_links (platform, url) values ('website', 'https://evil.test') $$, '42501', null,
  'anon cannot add social links');
select throws_ok($$ select public.move_info_section((select id from public.venue_info_sections limit 1), 1::smallint) $$, '42501', null,
  'anon cannot reorder sections');

-- ---------------------------------------------------------------------------
-- Player: reads, never writes
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is((select count(*)::int from public.venue_info_sections), 4, 'players read sections');
select throws_ok($$ insert into public.venue_info_sections (title) values ('Mine') $$, '42501', null,
  'players cannot add sections');
select throws_ok($$ insert into public.venue_social_links (platform, url) values ('website', 'https://evil.test') $$,
  '42501', null, 'players cannot add social links');
select throws_ok($$ insert into public.venue_amenities (builtin_key) values ('wifi') $$, '42501', null,
  'players cannot switch on amenities');
update public.venue_info_sections set title = 'Hacked';
delete from public.venue_info_sections;
update public.venue_settings set address = 'Hacked';
reset role;
insert into public.venue_social_links (platform, url) values ('website', 'https://claudex.example.ph');
insert into public.venue_amenities (builtin_key) values ('showers');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
update public.venue_social_links set url = 'https://evil.test';
delete from public.venue_social_links;
delete from public.venue_amenities;
select throws_ok($$ update public.venue_amenities set builtin_key = 'wifi' $$, '42501', null, 'players cannot edit amenities');
reset role;
select is((select count(*)::int from public.venue_info_sections where title <> 'Hacked'), 4, 'players cannot edit or delete sections');
select is((select address from public.venue_settings), '', 'players cannot edit the address');
select is((select url from public.venue_social_links where platform = 'website'), 'https://claudex.example.ph',
  'players cannot edit or delete social links');
select is((select count(*)::int from public.venue_amenities), 1, 'players cannot switch amenities off');
delete from public.venue_social_links;
delete from public.venue_amenities;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is(pg_temp.hint_of($$ select public.move_info_section((select id from public.venue_info_sections order by sort_order limit 1), 1::smallint) $$),
  'forbidden', 'players cannot reorder sections');

-- ---------------------------------------------------------------------------
-- Admin: location
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select lives_ok($$ update public.venue_settings set address = '123 Rizal Ave, Makati', maps_query = 'Claudex Courts Makati' $$,
  'admins set the address and map query');
select is((select maps_query from public.venue_settings), 'Claudex Courts Makati', 'the map query is stored');
select throws_ok($$ update public.venue_settings set address = repeat('a', 301) $$, '23514', null, 'the address is at most 300 characters');

-- ---------------------------------------------------------------------------
-- Admin: social links, https and the platform's own hosts
-- ---------------------------------------------------------------------------
select lives_ok($$ insert into public.venue_social_links (platform, url) values
  ('facebook', 'https://www.facebook.com/claudexcourts'),
  ('instagram', 'https://instagram.com/claudex.courts'),
  ('tiktok', 'https://www.tiktok.com/@claudexcourts'),
  ('youtube', 'https://youtu.be/abc123'),
  ('x', 'https://twitter.com/claudex'),
  ('messenger', 'https://m.me/claudexcourts'),
  ('website', 'https://claudex-courts.example.ph/about?x=1') $$,
  'admins add a link for each platform on its own hosts');
select lives_ok($$ update public.venue_social_links set url = 'https://x.com/claudex' where platform = 'x' $$,
  'admins change a link');
select throws_ok($$ update public.venue_social_links set url = 'https://instagram.com/claudex' where platform = 'facebook' $$,
  '23514', null, 'a platform refuses another platform''s host');
select throws_ok($$ update public.venue_social_links set url = 'https://facebook.com.evil.test/x' where platform = 'facebook' $$,
  '23514', null, 'a look-alike host is refused');
select throws_ok($$ update public.venue_social_links set url = 'https://evilfacebook.com/x' where platform = 'facebook' $$,
  '23514', null, 'a host that only ends in the platform''s name is refused');
select throws_ok($$ update public.venue_social_links set url = 'https://facebook.com@evil.test' where platform = 'facebook' $$,
  '23514', null, 'a URL with user info is refused');
select throws_ok($$ update public.venue_social_links set url = 'http://www.facebook.com/claudex' where platform = 'facebook' $$,
  '23514', null, 'http is refused');
select throws_ok($$ update public.venue_social_links set url = 'javascript:alert(1)' where platform = 'website' $$,
  '23514', null, 'a javascript: website is refused');
select throws_ok($$ update public.venue_social_links set url = 'https://claudex.example.ph/' || repeat('a', 500) where platform = 'website' $$,
  '23514', null, 'a link is at most 500 characters');
select lives_ok($$ delete from public.venue_social_links where platform = 'tiktok' $$, 'admins remove a link');

-- ---------------------------------------------------------------------------
-- Admin: info sections and their order
-- ---------------------------------------------------------------------------
select lives_ok($$ insert into public.venue_info_sections (title, body) values ('Parking', 'Free for players.') $$,
  'admins add a section');
select is((select sort_order from public.venue_info_sections where title = 'Parking'), 4, 'a new section goes last');
select throws_ok($$ insert into public.venue_info_sections (title) values ('  ') $$, '23514', null, 'a section needs a title');
select throws_ok($$ insert into public.venue_info_sections (title, body) values ('Long', repeat('a', 5001)) $$,
  '23514', null, 'a body is at most 5000 characters');
select lives_ok($$ select public.move_info_section((select id from public.venue_info_sections where title = 'Parking'), -1::smallint) $$,
  'admins move a section up');
select results_eq(
  $$ select title, sort_order from public.venue_info_sections order by sort_order $$,
  $$ values ('Waiver', 0), ('Reminders and policies', 1), ('Cancellation and refund policy', 2), ('Parking', 3), ('House rules', 4) $$,
  'moving swaps it with its neighbour and renumbers 0..n-1'
);
select lives_ok($$ select public.move_info_section((select id from public.venue_info_sections where title = 'Waiver'), -1::smallint) $$,
  'moving the first section up does nothing');
select is((select title from public.venue_info_sections where sort_order = 0), 'Waiver', 'the first stays first');
select is(pg_temp.hint_of($$ select public.move_info_section('00000000-0000-0000-0000-00000000dead', 1::smallint) $$),
  'not_found', 'moving a missing section is refused');
select lives_ok($$ delete from public.venue_info_sections where title = 'House rules' $$, 'admins delete a section');

-- ---------------------------------------------------------------------------
-- Admin: amenities
-- ---------------------------------------------------------------------------
select lives_ok($$ insert into public.venue_amenities (builtin_key) values ('wifi'), ('parking') $$, 'admins switch on built-in amenities');
select throws_ok($$ insert into public.venue_amenities (builtin_key) values ('wifi') $$, '23505', null, 'a built-in is on once');
select throws_ok($$ insert into public.venue_amenities (builtin_key) values ('helipad') $$, '23514', null, 'only known built-ins');
select lives_ok($$ insert into public.venue_amenities (custom_name) values ('Massage chairs') $$, 'admins add a custom amenity');
select throws_ok($$ insert into public.venue_amenities (custom_name) values (' massage CHAIRS ') $$, '23505', null,
  'custom names are unique, ignoring case and spaces');
select throws_ok($$ insert into public.venue_amenities (builtin_key, custom_name) values ('lockers', 'Lockers') $$, '23514', null,
  'an amenity is either built-in or custom, not both');
select throws_ok($$ update public.venue_amenities set custom_name = 'Renamed' where custom_name = 'Massage chairs' $$, '42501', null,
  'amenities are switched on and off, not edited');
select lives_ok($$ delete from public.venue_amenities where builtin_key = 'parking' $$, 'admins switch an amenity off');
select results_eq($$ select coalesce(builtin_key, custom_name) from public.venue_amenities order by created_at, builtin_key $$,
  $$ values ('wifi'), ('Massage chairs') $$, 'only the switched-off amenity is gone');

select * from finish();
rollback;
