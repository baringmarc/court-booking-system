-- T14.13 / T17.7: venue_settings.city and retained showcase_opt_in plus the public.public_venues view
-- (slug, name, city, logo_url). Active, platform-approved venues appear; the legacy selection is preserved and guarded.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000064a1', 'e2e-vsh-alpha@example.com'),
  ('00000000-0000-0000-0000-0000000064a2', 'e2e-vsh-bravo@example.com'),
  ('00000000-0000-0000-0000-0000000064a3', 'e2e-vsh-player@example.com');

-- alpha: banner + photos. bravo: photos only (sort_order decides). charlie: neither. delta: two photos tied on sort_order.
-- foxtrot/golf/hotel: draft, suspended, closed (all opted in). echo: active but never opted in (defaults).
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000064a1', 'e2e-vsh-alpha', 'active'),
  ('a0000000-0000-0000-0000-0000000064a2', 'e2e-vsh-bravo', 'active'),
  ('a0000000-0000-0000-0000-0000000064a3', 'e2e-vsh-charlie', 'active'),
  ('a0000000-0000-0000-0000-0000000064a4', 'e2e-vsh-delta', 'active'),
  ('a0000000-0000-0000-0000-0000000064a5', 'e2e-vsh-echo', 'active'),
  ('a0000000-0000-0000-0000-0000000064a6', 'e2e-vsh-foxtrot', 'draft'),
  ('a0000000-0000-0000-0000-0000000064a7', 'e2e-vsh-golf', 'suspended'),
  ('a0000000-0000-0000-0000-0000000064a8', 'e2e-vsh-hotel', 'closed');
update public.venues set showcase_approved = true where id in (
  'a0000000-0000-0000-0000-0000000064a1', 'a0000000-0000-0000-0000-0000000064a2',
  'a0000000-0000-0000-0000-0000000064a3', 'a0000000-0000-0000-0000-0000000064a4'
);
insert into public.venue_settings (venue_id, name, timezone, city, showcase_opt_in, banner_path, banner_alt) values
  ('a0000000-0000-0000-0000-0000000064a1', 'E2E VSH Alpha', 'Asia/Manila', 'Cebu', true, 'a0000000-0000-0000-0000-0000000064a1/banner/aaaaaaaa-0000-0000-0000-0000000064a1.webp', 'Alpha banner'),
  ('a0000000-0000-0000-0000-0000000064a2', 'E2E VSH Bravo', 'Asia/Manila', 'Davao', true, null, null),
  ('a0000000-0000-0000-0000-0000000064a3', 'E2E VSH Charlie', 'Asia/Manila', '', true, null, null),
  ('a0000000-0000-0000-0000-0000000064a4', 'E2E VSH Delta', 'Asia/Manila', 'Baguio', true, null, null),
  ('a0000000-0000-0000-0000-0000000064a6', 'E2E VSH Foxtrot', 'Asia/Manila', 'Manila', true, null, null),
  ('a0000000-0000-0000-0000-0000000064a7', 'E2E VSH Golf', 'Asia/Manila', 'Manila', true, null, null),
  ('a0000000-0000-0000-0000-0000000064a8', 'E2E VSH Hotel', 'Asia/Manila', 'Manila', true, null, null);
insert into public.venue_settings (venue_id, name, timezone) values
  ('a0000000-0000-0000-0000-0000000064a5', 'E2E VSH Echo', 'Asia/Manila');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000064a1', '00000000-0000-0000-0000-0000000064a1', 'owner'),
  ('a0000000-0000-0000-0000-0000000064a2', '00000000-0000-0000-0000-0000000064a2', 'owner');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000064a1', 'a0000000-0000-0000-0000-0000000064a1', 'E2E VSH A', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000064a2', 'a0000000-0000-0000-0000-0000000064a2', 'E2E VSH B', 'tennis', 100, true),
  ('c0000000-0000-0000-0000-0000000064a4', 'a0000000-0000-0000-0000-0000000064a4', 'E2E VSH D', 'tennis', 100, true);
insert into public.court_photos (court_id, venue_id, path, sort_order, created_at) values
  ('c0000000-0000-0000-0000-0000000064a1', 'a0000000-0000-0000-0000-0000000064a1', 'a0000000-0000-0000-0000-0000000064a1/courts/c0000000-0000-0000-0000-0000000064a1/bbbbbbbb-0000-0000-0000-0000000064a1.webp', 0, now()),
  ('c0000000-0000-0000-0000-0000000064a2', 'a0000000-0000-0000-0000-0000000064a2', 'a0000000-0000-0000-0000-0000000064a2/courts/c0000000-0000-0000-0000-0000000064a2/aaaaaaaa-0000-0000-0000-0000000064b1.webp', 5, now() - interval '3 days'),
  ('c0000000-0000-0000-0000-0000000064a2', 'a0000000-0000-0000-0000-0000000064a2', 'a0000000-0000-0000-0000-0000000064a2/courts/c0000000-0000-0000-0000-0000000064a2/bbbbbbbb-0000-0000-0000-0000000064b2.webp', 1, now() - interval '1 day'),
  ('c0000000-0000-0000-0000-0000000064a4', 'a0000000-0000-0000-0000-0000000064a4', 'a0000000-0000-0000-0000-0000000064a4/courts/c0000000-0000-0000-0000-0000000064a4/aaaaaaaa-0000-0000-0000-0000000064d1.webp', 0, now() - interval '1 day'),
  ('c0000000-0000-0000-0000-0000000064a4', 'a0000000-0000-0000-0000-0000000064a4', 'a0000000-0000-0000-0000-0000000064a4/courts/c0000000-0000-0000-0000-0000000064a4/bbbbbbbb-0000-0000-0000-0000000064d2.webp', 0, now() - interval '2 days');

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare s text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate;
  return s;
end $$;
grant execute on function pg_temp.err(text) to anon, authenticated;

-- ---------------------------------------------------------------- schema
select has_view('public', 'public_venues', 'public.public_venues exists');
select columns_are('public', 'public_venues', array['slug', 'name', 'city', 'logo_url'], 'the view exposes exactly slug, name, city, logo_url');
select has_column('public', 'venue_settings', 'city', 'venue_settings.city exists');
select has_column('public', 'venue_settings', 'showcase_opt_in', 'venue_settings.showcase_opt_in exists');
select is((select city from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-0000000064a5'), '', 'city defaults to the empty string');
select is((select showcase_opt_in from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-0000000064a5'), false, 'showcase_opt_in defaults to false');
select throws_ok($$update public.venue_settings set city = repeat('x', 81) where venue_id = 'a0000000-0000-0000-0000-0000000064a5'$$,
  '23514', null, 'a city longer than 80 characters is refused');
select lives_ok($$update public.venue_settings set city = repeat('x', 80) where venue_id = 'a0000000-0000-0000-0000-0000000064a5'$$, 'a city of exactly 80 characters is accepted');
select lives_ok($$update public.venue_settings set city = '' where venue_id = 'a0000000-0000-0000-0000-0000000064a5'$$, 'reset echo city');

-- ---------------------------------------------------------------- privileges
select ok(has_table_privilege('anon', 'public.public_venues', 'select'), 'anon can select the view');
select ok(has_table_privilege('authenticated', 'public.public_venues', 'select'), 'authenticated can select the view');
select ok(not has_table_privilege('anon', 'public.public_venues', 'insert')
      and not has_table_privilege('anon', 'public.public_venues', 'update')
      and not has_table_privilege('anon', 'public.public_venues', 'delete'), 'anon cannot write the view');
select ok(not has_table_privilege('authenticated', 'public.public_venues', 'insert')
      and not has_table_privilege('authenticated', 'public.public_venues', 'update')
      and not has_table_privilege('authenticated', 'public.public_venues', 'delete'), 'authenticated cannot write the view');

-- ---------------------------------------------------------------- anon reads
set local role anon;
select results_eq(
  $$ select slug from public.public_venues where slug like 'e2e-vsh-%' order by slug $$,
  $$ values ('e2e-vsh-alpha'::text), ('e2e-vsh-bravo'), ('e2e-vsh-charlie'), ('e2e-vsh-delta') $$,
  'anon sees only active approved venues (draft, suspended, closed and unapproved are hidden)');
select results_eq(
  $$ select slug, name, city from public.public_venues where slug like 'e2e-vsh-%' order by slug $$,
  $$ values ('e2e-vsh-alpha'::text, 'E2E VSH Alpha'::text, 'Cebu'::text), ('e2e-vsh-bravo', 'E2E VSH Bravo', 'Davao'),
            ('e2e-vsh-charlie', 'E2E VSH Charlie', ''), ('e2e-vsh-delta', 'E2E VSH Delta', 'Baguio') $$,
  'name is the venue_settings name and city is the venue city');
select is((select logo_url from public.public_venues where slug = 'e2e-vsh-alpha'),
  'a0000000-0000-0000-0000-0000000064a1/banner/aaaaaaaa-0000-0000-0000-0000000064a1.webp', 'logo_url is the banner when there is one (even if a court has photos)');
select is((select logo_url from public.public_venues where slug = 'e2e-vsh-bravo'),
  'a0000000-0000-0000-0000-0000000064a2/courts/c0000000-0000-0000-0000-0000000064a2/bbbbbbbb-0000-0000-0000-0000000064b2.webp', 'without a banner logo_url is the first court photo by sort_order');
select is((select logo_url from public.public_venues where slug = 'e2e-vsh-delta'),
  'a0000000-0000-0000-0000-0000000064a4/courts/c0000000-0000-0000-0000-0000000064a4/bbbbbbbb-0000-0000-0000-0000000064d2.webp', 'ties on sort_order break by the earliest created_at');
select is((select logo_url from public.public_venues where slug = 'e2e-vsh-charlie'), null, 'with no banner and no photo logo_url is null');
select ok(pg_temp.err($$insert into public.public_venues (slug, name, city, logo_url) values ('e2e-vsh-x', 'x', '', null)$$) in ('42501', '55000'), 'anon cannot insert into the view');
select ok(pg_temp.err($$update public.public_venues set city = 'Hacked'$$) in ('42501', '55000'), 'anon cannot update the view');
select ok(pg_temp.err($$delete from public.public_venues$$) in ('42501', '55000'), 'anon cannot delete from the view');
select is(pg_temp.err($$update public.venue_settings set showcase_opt_in = true where venue_id = 'a0000000-0000-0000-0000-0000000064a5'$$), '42501', 'anon cannot update venue_settings');
reset role;

-- ---------------------------------------------------------------- authenticated reads
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000064a3","role":"authenticated"}';
select is((select count(*)::int from public.public_venues where slug like 'e2e-vsh-%'), 4, 'a signed-in player sees the same four showcase venues');

-- A player with no membership changes nothing.
update public.venue_settings set city = 'Hacked', showcase_opt_in = true where venue_id = 'a0000000-0000-0000-0000-0000000064a5';
reset role;
select is((select city || '/' || showcase_opt_in::text from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-0000000064a5'), '/false',
  'a non-member cannot change a venue''s city or opt-in');

-- ---------------------------------------------------------------- venue admins
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000064a1","role":"authenticated"}';
select lives_ok($$update public.venue_settings set city = 'Cebu City' where venue_id = 'a0000000-0000-0000-0000-0000000064a1'$$, 'the venue admin can set the city');
select throws_ok($$update public.venue_settings set showcase_opt_in = false where venue_id = 'a0000000-0000-0000-0000-0000000064a1'$$,
  '42501', null, 'the venue admin cannot change the preserved legacy selection');
-- Another venue's settings: alpha's admin cannot touch echo or bravo.
update public.venue_settings set city = 'Hacked', showcase_opt_in = true where venue_id in ('a0000000-0000-0000-0000-0000000064a5', 'a0000000-0000-0000-0000-0000000064a2');
reset role;
select is((select city from public.venue_settings where venue_id = 'a0000000-0000-0000-0000-0000000064a1'), 'Cebu City', 'the admin''s city change was saved');
select is((select string_agg(venue_id::text || ':' || city || ':' || showcase_opt_in::text, ',' order by venue_id)
           from public.venue_settings where venue_id in ('a0000000-0000-0000-0000-0000000064a2', 'a0000000-0000-0000-0000-0000000064a5')),
  'a0000000-0000-0000-0000-0000000064a2:Davao:true,a0000000-0000-0000-0000-0000000064a5::false',
  'another venue''s admin cannot change a different venue''s city or opt-in');

-- The view follows platform approval and venue status, not the preserved legacy flag.
update public.venues set showcase_approved = false where id = 'a0000000-0000-0000-0000-0000000064a1';
select is((select count(*)::int from public.public_venues where slug = 'e2e-vsh-alpha'), 0, 'removing platform approval removes the venue from the view');
update public.venues set showcase_approved = true where id = 'a0000000-0000-0000-0000-0000000064a1';
select is((select city from public.public_venues where slug = 'e2e-vsh-alpha'), 'Cebu City', 'reapproving lists the venue with its current city');
update public.venues set status = 'suspended' where id = 'a0000000-0000-0000-0000-0000000064a1';
select is((select count(*)::int from public.public_venues where slug = 'e2e-vsh-alpha'), 0, 'suspending an approved venue removes it from the view');
update public.venues set status = 'active' where id = 'a0000000-0000-0000-0000-0000000064a1';
delete from public.court_photos where venue_id = 'a0000000-0000-0000-0000-0000000064a2';
select is((select logo_url from public.public_venues where slug = 'e2e-vsh-bravo'), null, 'deleting the last photo leaves logo_url null');
select is((select count(*)::int from public.public_venues where slug = 'e2e-vsh-bravo'), 1, 'and the venue is still listed');

select * from finish();
rollback;
