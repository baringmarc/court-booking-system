-- T20.2: the theme check allows exactly seven preset keys (plotline, court-green, ocean, plum, sunset, slate, midnight).
-- Same constraint name, no data change, default stays plotline. RLS is unchanged: admins write, everyone else cannot.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'player@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'admin@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'other-admin@test.local');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-000000000201', 'e2e-theme-other', 'active');
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-000000000201', 'E2E Theme Other', 'Asia/Manila');
insert into public.venue_members (venue_id, user_id, role)
  select id, '22222222-2222-2222-2222-222222222222', 'owner' from public.venues where slug = 'claudex-courts';
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-000000000201', '44444444-4444-4444-4444-444444444444', 'owner');

-- ---------------------------------------------------------------------------
-- The constraint: same name, exactly seven keys; default and existing data untouched
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_constraint
    where conrelid = 'public.venue_settings'::regclass and conname = 'venue_settings_theme_preset' and contype = 'c'),
  1, 'the check is still named venue_settings_theme_preset'
);
select is(
  (select count(*)::int from unnest(array['plotline', 'court-green', 'ocean', 'plum', 'sunset', 'slate', 'midnight']) k
    where (select pg_get_constraintdef(oid) from pg_constraint
            where conrelid = 'public.venue_settings'::regclass and conname = 'venue_settings_theme_preset')
          like '%''' || k || '''%'),
  7, 'the check definition names all seven keys'
);
select is(
  (select count(*)::int from regexp_matches(
     (select pg_get_constraintdef(oid) from pg_constraint
       where conrelid = 'public.venue_settings'::regclass and conname = 'venue_settings_theme_preset'),
     '''[^'']+''', 'g')),
  7, 'the check definition lists exactly seven literals'
);
select col_default_is('public', 'venue_settings', 'theme', 'plotline', 'theme still defaults to plotline');
select is((select theme from public.venue_settings where venue_id = private.default_venue_id()), 'plotline',
  'the existing venue still has plotline (no data change)');
select is((select theme from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-000000000201'), 'plotline',
  'a new venue row defaults to plotline');

-- ---------------------------------------------------------------------------
-- Unknown keys and the wrong case are refused
-- ---------------------------------------------------------------------------
select throws_ok($$ update public.venue_settings set theme = 'neon' $$, '23514', null, 'an unknown preset key is refused');
select throws_ok($$ update public.venue_settings set theme = 'Slate' $$, '23514', null, 'keys are exact (Slate with a capital is refused)');

-- ---------------------------------------------------------------------------
-- Anon never writes
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
select throws_ok($$ update public.venue_settings set theme = 'slate' $$, '42501', null, 'anon cannot update the theme');

-- ---------------------------------------------------------------------------
-- A player's update is filtered out by RLS
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', true);
select lives_ok($$ update public.venue_settings set theme = 'slate' $$, 'a player''s update is filtered by RLS');
reset role;
select is((select theme from public.venue_settings where venue_id = private.default_venue_id()), 'plotline',
  'the theme is unchanged by the player');

-- ---------------------------------------------------------------------------
-- Another venue's admin cannot change this venue's theme
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', true);
select lives_ok(
  $$ update public.venue_settings set theme = 'midnight' where venue_id = private.default_venue_id() $$,
  'another venue''s admin update on this venue is filtered by RLS'
);
reset role;
select is((select theme from public.venue_settings where venue_id = private.default_venue_id()), 'plotline',
  'this venue''s theme is unchanged by the other venue''s admin');

-- ---------------------------------------------------------------------------
-- The venue's own admin can save each of the seven keys
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', true);

select lives_ok($$ update public.venue_settings set theme = 'plotline' where venue_id = private.default_venue_id() $$, 'admin saves plotline');
select is((select theme from public.venue_settings where venue_id = private.default_venue_id()), 'plotline', 'plotline is stored');
select lives_ok($$ update public.venue_settings set theme = 'court-green' where venue_id = private.default_venue_id() $$, 'admin saves court-green');
select is((select theme from public.venue_settings where venue_id = private.default_venue_id()), 'court-green', 'court-green is stored');
select lives_ok($$ update public.venue_settings set theme = 'ocean' where venue_id = private.default_venue_id() $$, 'admin saves ocean');
select is((select theme from public.venue_settings where venue_id = private.default_venue_id()), 'ocean', 'ocean is stored');
select lives_ok($$ update public.venue_settings set theme = 'plum' where venue_id = private.default_venue_id() $$, 'admin saves plum');
select is((select theme from public.venue_settings where venue_id = private.default_venue_id()), 'plum', 'plum is stored');
select lives_ok($$ update public.venue_settings set theme = 'sunset' where venue_id = private.default_venue_id() $$, 'admin saves sunset');
select is((select theme from public.venue_settings where venue_id = private.default_venue_id()), 'sunset', 'sunset is stored');
select lives_ok($$ update public.venue_settings set theme = 'slate' where venue_id = private.default_venue_id() $$, 'admin saves slate');
select is((select theme from public.venue_settings where venue_id = private.default_venue_id()), 'slate', 'slate is stored');
select lives_ok($$ update public.venue_settings set theme = 'midnight' where venue_id = private.default_venue_id() $$, 'admin saves midnight');
select is((select theme from public.venue_settings where venue_id = private.default_venue_id()), 'midnight', 'midnight is stored');

select * from finish();
rollback;
