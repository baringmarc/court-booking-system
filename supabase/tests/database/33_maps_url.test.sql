-- T11.8: venue_settings.maps_url. The column and its link check, the url_encode and maps_search_url helpers behind the
-- backfill, and RLS: anyone reads it, only admins change it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
select has_column('public', 'venue_settings', 'maps_url', 'venue_settings has maps_url');
select col_not_null('public', 'venue_settings', 'maps_url', 'maps_url is required');
select col_default_is('public', 'venue_settings', 'maps_url', '', 'maps_url defaults to empty');
select has_column('public', 'venue_settings', 'maps_query', 'maps_query stays until the contract migration (T11.15)');
-- The migration's backfill statement, run again on a row with a blank map search and an address.
update public.venue_settings set maps_query = '  ', address = '12 Rizal Ave', maps_url = '';
update public.venue_settings
set maps_url = private.maps_search_url(coalesce(nullif(btrim(maps_query), ''), address))
where maps_url = '';
select is(
  (select maps_url from public.venue_settings),
  'https://www.google.com/maps/search/?api=1&query=12%20Rizal%20Ave',
  'the backfill falls back to the address when the map search is blank'
);
update public.venue_settings set maps_query = 'Claudex Courts', maps_url = 'https://maps.app.goo.gl/Kept';
update public.venue_settings
set maps_url = private.maps_search_url(coalesce(nullif(btrim(maps_query), ''), address))
where maps_url = '';
select is((select maps_url from public.venue_settings), 'https://maps.app.goo.gl/Kept', 'the backfill leaves a link that is already set');

-- ---------------------------------------------------------------------------
-- Accepted links
-- ---------------------------------------------------------------------------
select lives_ok($$ update public.venue_settings set maps_url = '' $$, 'empty is allowed (no link)');
select lives_ok($$ update public.venue_settings set maps_url = 'https://www.google.com/maps/place/Claudex+Courts/@14.5547,121.0244,17z' $$, 'a long www.google.com/maps/place link');
select lives_ok($$ update public.venue_settings set maps_url = 'https://www.google.com/maps?q=Claudex+Courts' $$, 'a www.google.com/maps?q= link');
select lives_ok($$ update public.venue_settings set maps_url = 'https://www.google.com/maps/search/?api=1&query=Claudex%20Courts' $$, 'a Maps search URL');
select lives_ok($$ update public.venue_settings set maps_url = 'https://maps.google.com/?q=Claudex' $$, 'a maps.google.com link');
select lives_ok($$ update public.venue_settings set maps_url = 'https://maps.app.goo.gl/AbC123xyz' $$, 'a maps.app.goo.gl share link');
select lives_ok($$ update public.venue_settings set maps_url = 'https://goo.gl/maps/AbC123xyz' $$, 'a legacy goo.gl/maps link');
select lives_ok(
  $$ update public.venue_settings set maps_url = 'https://maps.app.goo.gl/' || repeat('a', 1000 - char_length('https://maps.app.goo.gl/')) $$,
  'exactly 1000 characters is allowed'
);

-- ---------------------------------------------------------------------------
-- Refused links
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.venue_settings set maps_url = 'http://www.google.com/maps/place/X' $$, '23514', null, 'http is refused');
select throws_ok($$ update public.venue_settings set maps_url = 'https://www.example.com/maps' $$, '23514', null, 'another host is refused');
select throws_ok($$ update public.venue_settings set maps_url = 'https://www.google.com/search?q=courts' $$, '23514', null, 'google.com outside /maps is refused');
select throws_ok($$ update public.venue_settings set maps_url = 'https://www.google.com/mapsfoo' $$, '23514', null, 'a path that only starts with /maps is refused');
select throws_ok($$ update public.venue_settings set maps_url = 'https://maps.google.com.evil.test/x' $$, '23514', null, 'a lookalike host is refused');
select throws_ok($$ update public.venue_settings set maps_url = 'https://maps.app.goo.gl@evil.test/x' $$, '23514', null, 'userinfo tricks are refused');
select throws_ok($$ update public.venue_settings set maps_url = 'javascript:alert(1)' $$, '23514', null, 'javascript: is refused');
select throws_ok($$ update public.venue_settings set maps_url = 'https://www.google.com/maps/place/A B' $$, '23514', null, 'whitespace is refused');
select throws_ok($$ update public.venue_settings set maps_url = ' https://maps.app.goo.gl/x' $$, '23514', null, 'leading whitespace is refused');
select throws_ok(
  $$ update public.venue_settings set maps_url = 'https://maps.app.goo.gl/' || repeat('a', 1001 - char_length('https://maps.app.goo.gl/')) $$,
  '23514', null, '1001 characters is refused'
);

-- ---------------------------------------------------------------------------
-- The helpers behind the backfill
-- ---------------------------------------------------------------------------
select is(private.url_encode('Az09-_.~'), 'Az09-_.~', 'unreserved characters stay as they are');
select is(private.url_encode('a b&c#d+e/f?'), 'a%20b%26c%23d%2Be%2Ff%3F', 'spaces, &, #, +, / and ? are percent-encoded');
select is(private.url_encode('Parañaque'), 'Para%C3%B1aque', 'non-ASCII letters are encoded as UTF-8 bytes');
select is(private.maps_search_url('  '), '', 'nothing to search gives no link');
select is(
  private.maps_search_url(' 12 Rizal Ave, Makati '),
  'https://www.google.com/maps/search/?api=1&query=12%20Rizal%20Ave%2C%20Makati',
  'a search link for an address (trimmed)'
);
select lives_ok(
  $$ update public.venue_settings set maps_url = private.maps_search_url(repeat('a&', 150)) $$,
  'a 300-character ASCII address still fits the check'
);
select is(char_length(private.maps_search_url(repeat('a&', 150))), 48 + 150 * 4, 'its encoded link is 648 characters');
select is(char_length(private.maps_search_url(repeat('&', 300))), 948, 'the worst 300-character ASCII address encodes to 948 characters');
select lives_ok(
  $$ update public.venue_settings set maps_url = private.maps_search_url(repeat('&', 300)) $$,
  'and still fits the check'
);
select is(private.maps_search_url(repeat('ñ', 200)), '', 'an address whose link would pass 1000 characters gives no link');
select is(
  (select private.maps_search_url(coalesce(nullif(btrim(q), ''), a)) from (values ('Claudex Courts', '12 Rizal Ave')) v(q, a)),
  'https://www.google.com/maps/search/?api=1&query=Claudex%20Courts',
  'the backfill prefers the map search over the address'
);

select ok(not has_function_privilege('anon', 'private.url_encode(text)', 'execute'), 'anon cannot execute url_encode');
select ok(not has_function_privilege('authenticated', 'private.url_encode(text)', 'execute'), 'authenticated cannot execute url_encode');
select ok(not has_function_privilege('anon', 'private.maps_search_url(text)', 'execute'), 'anon cannot execute maps_search_url');
select ok(not has_function_privilege('authenticated', 'private.maps_search_url(text)', 'execute'), 'authenticated cannot execute maps_search_url');

-- ---------------------------------------------------------------------------
-- RLS: anon and players read, never write; admins write
-- ---------------------------------------------------------------------------
update public.venue_settings set maps_url = 'https://maps.app.goo.gl/Seed';

set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select maps_url from public.venue_settings), 'https://maps.app.goo.gl/Seed', 'anon can read maps_url');
select throws_ok($$ update public.venue_settings set maps_url = '' $$, '42501', null, 'anon cannot update venue_settings');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
update public.venue_settings set maps_url = 'https://maps.app.goo.gl/Player';
select is((select maps_url from public.venue_settings), 'https://maps.app.goo.gl/Seed', 'a player''s update is filtered by RLS');

select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
update public.venue_settings set maps_url = 'https://maps.app.goo.gl/Admin';
select is((select maps_url from public.venue_settings), 'https://maps.app.goo.gl/Admin', 'an admin can set the link');
select throws_ok($$ update public.venue_settings set maps_url = 'https://evil.test/' $$, '23514', null, 'the check applies to admins too');

select * from finish();
rollback;
