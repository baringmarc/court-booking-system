-- T11.8: venue_settings.maps_url. The column and its link check, and RLS: anyone reads it, only admins change it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';

-- ---------------------------------------------------------------------------
-- The column
-- ---------------------------------------------------------------------------
select has_column('public', 'venue_settings', 'maps_url', 'venue_settings has maps_url');
select col_not_null('public', 'venue_settings', 'maps_url', 'maps_url is required');
select col_default_is('public', 'venue_settings', 'maps_url', '', 'maps_url defaults to empty');
select hasnt_column('public', 'venue_settings', 'maps_query', 'maps_query is dropped (T11.15)');
select hasnt_function('private', 'maps_search_url', array['text'], 'maps_search_url is dropped');
select hasnt_function('private', 'url_encode', array['text'], 'url_encode is dropped');
select is(
  (select count(*)::int from pg_constraint where conname = 'venue_settings_maps_url_link' and conrelid = 'public.venue_settings'::regclass),
  1, 'the maps_url link check constraint stays'
);

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
