-- T14.4: public.create_venue(p_slug, p_name, p_timezone) returns uuid. Platform admins only; creates a draft
-- venue with settings and default operating hours, and nothing else. Failures raise P0001 with a hint.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- Returns 'SQLSTATE|hint' of the error a statement raises, or 'ok' if it succeeds.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare s text; h text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
  return s || '|' || coalesce(h, '');
end $$;
grant execute on function pg_temp.err(text) to anon, authenticated;

create temp table res (id uuid);
grant all on res to anon, authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000056a1', 'e2e-cv-player@example.com'),
  ('00000000-0000-0000-0000-0000000056a2', 'e2e-cv-platform@example.com'),
  ('00000000-0000-0000-0000-0000000056a3', 'e2e-cv-owner@example.com');
insert into public.venues (id, slug, status) values ('a0000000-0000-0000-0000-0000000056aa', 'e2e-cv-existing', 'active');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000056aa', '00000000-0000-0000-0000-0000000056a3', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000056a2');

select has_function('public', 'create_venue', array['text', 'text', 'text'], 'create_venue(text, text, text) exists');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok(
  $$select public.create_venue('e2e-cv-anon', 'E2E Anon', 'Asia/Manila')$$,
  '42501', null, 'anon has no execute on create_venue');

-- ---------------------------------------------------------------- player and venue owner
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000056a1","role":"authenticated"}';
select is(pg_temp.err($$select public.create_venue('e2e-cv-player', 'E2E Player', 'Asia/Manila')$$),
  'P0001|not_platform_admin', 'a player is refused with not_platform_admin');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000056a3","role":"authenticated"}';
select is(pg_temp.err($$select public.create_venue('e2e-cv-owner', 'E2E Owner', 'Asia/Manila')$$),
  'P0001|not_platform_admin', 'a venue owner is refused with not_platform_admin');

-- ---------------------------------------------------------------- platform admin: validation
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000056a2","role":"authenticated"}';
select is(pg_temp.err($$select public.create_venue('Bad_Slug', 'E2E Venue', 'Asia/Manila')$$),
  'P0001|slug_invalid', 'uppercase and underscore slug is slug_invalid');
select is(pg_temp.err($$select public.create_venue('ab', 'E2E Venue', 'Asia/Manila')$$),
  'P0001|slug_invalid', 'a 2-character slug is slug_invalid');
select is(pg_temp.err($$select public.create_venue(repeat('a', 41), 'E2E Venue', 'Asia/Manila')$$),
  'P0001|slug_invalid', 'a 41-character slug is slug_invalid');
select is(pg_temp.err($$select public.create_venue('has space', 'E2E Venue', 'Asia/Manila')$$),
  'P0001|slug_invalid', 'a slug with a space is slug_invalid');
select is(pg_temp.err($$select public.create_venue(repeat('a', 40), 'E2E Venue', 'Asia/Manila')$$),
  'ok', 'a 40-character slug is valid');
select is(pg_temp.err($$select public.create_venue('abc', 'E2E Venue', 'Asia/Manila')$$),
  'ok', 'a 3-character slug is valid');
select is(
  (select count(*)::int from unnest(array['www','app','api','admin','mail','demo','plotline','support','status','staging','help','blog']) r
    where pg_temp.err(format('select public.create_venue(%L, %L, %L)', r, 'E2E Venue', 'Asia/Manila')) = 'P0001|slug_reserved'),
  12, 'all 12 reserved slugs are slug_reserved');
select is(pg_temp.err($$select public.create_venue('e2e-cv-name1', 'x', 'Asia/Manila')$$),
  'P0001|name_invalid', 'a 1-character name is name_invalid');
select is(pg_temp.err($$select public.create_venue('e2e-cv-name2', '   ', 'Asia/Manila')$$),
  'P0001|name_invalid', 'a whitespace-only name is name_invalid');
select is(pg_temp.err($$select public.create_venue('e2e-cv-name3', ' x ', 'Asia/Manila')$$),
  'P0001|name_invalid', 'a name that is under 2 characters after trimming is name_invalid');
select is(pg_temp.err(format('select public.create_venue(%L, %L, %L)', 'e2e-cv-name4', repeat('n', 81), 'Asia/Manila')),
  'P0001|name_invalid', 'an 81-character name is name_invalid');
select is(pg_temp.err($$select public.create_venue('e2e-cv-tz', 'E2E Venue', 'Mars/Olympus')$$),
  'P0001|timezone_invalid', 'an unknown timezone is timezone_invalid');
select is(pg_temp.err($$select public.create_venue(null, 'E2E Venue', 'Asia/Manila')$$),
  'P0001|slug_invalid', 'a null slug is slug_invalid');
select is(
  (select count(*)::int from public.venues where slug in ('e2e-cv-name1', 'e2e-cv-name2', 'e2e-cv-name3', 'e2e-cv-name4', 'e2e-cv-tz', 'e2e-cv-player', 'e2e-cv-owner')),
  0, 'failed calls create no venue');

-- ---------------------------------------------------------------- platform admin: success
select lives_ok(
  $$insert into res select public.create_venue('e2e-cv-new', '  E2E New Venue  ', 'Asia/Manila')$$,
  'a platform admin can create a venue');
select is((select count(*)::int from public.venues where id = (select id from res) and slug = 'e2e-cv-new'), 1,
  'it returns the new venue id, visible to the platform admin');
select is((select status from public.venues where id = (select id from res)), 'draft', 'the new venue is a draft');
select is((select count(*)::int from public.venue_settings where venue_id = (select id from res)), 1,
  'it creates one venue_settings row');
select is((select name from public.venue_settings where venue_id = (select id from res)), 'E2E New Venue',
  'the settings name is trimmed');
select is((select timezone from public.venue_settings where venue_id = (select id from res)), 'Asia/Manila',
  'the settings timezone is the one given');
select is((select count(distinct day_of_week)::int from public.operating_hours where venue_id = (select id from res)), 7,
  'it creates operating hours for days 0 to 6');
select is((select count(*)::int from public.operating_hours
            where venue_id = (select id from res) and open_time = '06:00' and close_time = '22:00' and not is_closed), 7,
  'every day is open 06:00 to 22:00');
select is((select count(*)::int from public.courts where venue_id = (select id from res)), 0, 'it creates no courts');
select is((select count(*)::int from public.venue_members where venue_id = (select id from res)), 0, 'it creates no venue members');
select is(pg_temp.err($$select public.create_venue('e2e-cv-new', 'E2E Again', 'Asia/Manila')$$),
  'P0001|slug_taken', 'a duplicate slug is slug_taken');

-- ---------------------------------------------------------------- draft venue is hidden from others
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000056a1","role":"authenticated"}';
select is((select count(*)::int from public.venues where slug = 'e2e-cv-new'), 0, 'a player cannot see the draft venue');
reset role;
set local role anon;
select is((select count(*)::int from public.venues where slug = 'e2e-cv-new'), 0, 'anon cannot see the draft venue');

select * from finish();
rollback;
