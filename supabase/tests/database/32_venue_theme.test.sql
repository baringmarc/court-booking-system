-- T11.6: venue_settings.theme. The default, the preset check, and RLS: anyone reads it, only admins change it.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local');
update public.profiles set role = 'admin' where id = '22222222-2222-2222-2222-222222222222';
insert into public.venue_members (venue_id, user_id, role) select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';

-- ---------------------------------------------------------------------------
-- The column, its default and the check
-- ---------------------------------------------------------------------------
select has_column('public', 'venue_settings', 'theme', 'venue_settings has theme');
select col_not_null('public', 'venue_settings', 'theme', 'theme is required');
select col_default_is('public', 'venue_settings', 'theme', 'plotline', 'theme defaults to plotline');
select is((select theme from public.venue_settings), 'plotline', 'the existing venue starts on plotline');
select throws_ok(
  $$ update public.venue_settings set theme = 'neon' $$,
  '23514', null, 'an unknown preset key is refused'
);
select throws_ok(
  $$ update public.venue_settings set theme = 'Plotline' $$,
  '23514', null, 'keys are exact (no other case)'
);

-- ---------------------------------------------------------------------------
-- Anon reads, never writes
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select is((select theme from public.venue_settings), 'plotline', 'anon can read the theme');
select throws_ok($$ update public.venue_settings set theme = 'ocean' $$, '42501', null, 'anon cannot update venue_settings');

-- ---------------------------------------------------------------------------
-- A player reads; an update is filtered out by RLS
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select is((select theme from public.venue_settings), 'plotline', 'a player can read the theme');
select lives_ok($$ update public.venue_settings set theme = 'ocean' $$, 'a player''s update is filtered by RLS');
select is((select theme from public.venue_settings), 'plotline', 'the theme is unchanged by the player');

-- ---------------------------------------------------------------------------
-- An admin can set every preset
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);
select lives_ok(
  $$ do $d$
     declare k text;
     begin
       foreach k in array array['court-green', 'ocean', 'plum', 'sunset', 'plotline'] loop
         update public.venue_settings set theme = k;
         if (select theme from public.venue_settings) <> k then raise exception 'not saved: %', k; end if;
       end loop;
     end $d$ $$,
  'an admin can set each of the five presets'
);
update public.venue_settings set theme = 'plum';
select is((select theme from public.venue_settings), 'plum', 'the admin''s choice is stored');

select * from finish();
rollback;
