-- T15.4: public.reviews. Inserted by the service role only (site-review); everyone reads approved reviews;
-- platform admins read all and change `approved` (nothing else). CHECK constraints back up siteForms.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

create function pg_temp.nrows(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.nrows(text) to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000065a1', 'e2e-review-player@example.com'),
  ('00000000-0000-0000-0000-0000000065a2', 'e2e-review-platform@example.com'),
  ('00000000-0000-0000-0000-0000000065a3', 'e2e-review-staff@example.com');
insert into public.venues (id, slug, status) values ('a0000000-0000-0000-0000-0000000065aa', 'e2e-reviews-a', 'active');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000065aa', '00000000-0000-0000-0000-0000000065a3', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000065a2');

-- What the Edge Function inserts (as the owner / service role): approved is left to its default.
insert into public.reviews (id, name, quote, role, rating, consented_at)
values ('00000000-0000-0000-0000-0000000065b2', 'Ben', 'Booking took me one minute.', 'player', 5, now());
insert into public.reviews (id, name, venue, quote, role, rating, approved, consented_at)
values ('00000000-0000-0000-0000-0000000065b1', 'Ana', 'Sample Pickle Park', 'Our members book on their own now.', 'owner', 4, true, now());

-- ---------------------------------------------------------------- table, defaults, constraints (as owner)
select has_table('public', 'reviews', 'public.reviews exists');
select ok((select relrowsecurity from pg_class where oid = 'public.reviews'::regclass), 'RLS is enabled on reviews');
select is((select approved from public.reviews where id = '00000000-0000-0000-0000-0000000065b2'), false, 'a new review starts unapproved');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values ('', 'A fine long quote here', 'player', 5, now())$$,
  '23514', null, 'name must not be empty');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values (repeat('x', 61), 'A fine long quote here', 'player', 5, now())$$,
  '23514', null, 'name is at most 60 characters');
select throws_ok(
  $$insert into public.reviews (name, venue, quote, role, rating, consented_at) values ('A', repeat('x', 81), 'A fine long quote here', 'player', 5, now())$$,
  '23514', null, 'venue is at most 80 characters');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values ('A', '123456789', 'player', 5, now())$$,
  '23514', null, 'quote is at least 10 characters');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values ('A', repeat('x', 401), 'player', 5, now())$$,
  '23514', null, 'quote is at most 400 characters');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values ('A', 'A fine long quote here', 'coach', 5, now())$$,
  '23514', null, 'role is player or owner');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values ('A', 'A fine long quote here', 'player', 0, now())$$,
  '23514', null, 'rating is at least 1');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values ('A', 'A fine long quote here', 'player', 6, now())$$,
  '23514', null, 'rating is at most 5');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating) values ('A', 'A fine long quote here', 'player', 5)$$,
  '23502', null, 'consented_at is required');

-- ---------------------------------------------------------------- anon
set local role anon;
select is((select count(*)::int from public.reviews where id in ('00000000-0000-0000-0000-0000000065b1', '00000000-0000-0000-0000-0000000065b2')),
  1, 'anon sees approved reviews only');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values ('A', 'A fine long quote here', 'player', 5, now())$$,
  '42501', null, 'anon cannot insert reviews');
select throws_ok($$update public.reviews set approved = true$$, '42501', null, 'anon cannot update reviews');

-- ---------------------------------------------------------------- player and venue owner
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000065a1","role":"authenticated"}';
select is((select count(*)::int from public.reviews where id in ('00000000-0000-0000-0000-0000000065b1', '00000000-0000-0000-0000-0000000065b2')),
  1, 'a player sees approved reviews only');
select is(pg_temp.nrows($$update public.reviews set approved = true$$), 0, 'a player approves no review');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values ('A', 'A fine long quote here', 'player', 5, now())$$,
  '42501', null, 'a player cannot insert reviews');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000065a3","role":"authenticated"}';
select is((select count(*)::int from public.reviews where id in ('00000000-0000-0000-0000-0000000065b1', '00000000-0000-0000-0000-0000000065b2')),
  1, 'a venue owner sees approved reviews only');
select is(pg_temp.nrows($$update public.reviews set approved = true$$), 0, 'a venue owner approves no review');

-- ---------------------------------------------------------------- platform admin
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000065a2","role":"authenticated"}';
select is((select count(*)::int from public.reviews where id in ('00000000-0000-0000-0000-0000000065b1', '00000000-0000-0000-0000-0000000065b2')),
  2, 'a platform admin sees approved and hidden reviews');
select lives_ok(
  $$update public.reviews set approved = true where id = '00000000-0000-0000-0000-0000000065b2'$$,
  'a platform admin can approve a review');
select is((select approved from public.reviews where id = '00000000-0000-0000-0000-0000000065b2'), true, 'the review is now approved');
select lives_ok(
  $$update public.reviews set approved = false where id = '00000000-0000-0000-0000-0000000065b1'$$,
  'a platform admin can hide a review');
select throws_ok(
  $$update public.reviews set quote = 'Edited by the admin.....' where id = '00000000-0000-0000-0000-0000000065b1'$$,
  '42501', null, 'a platform admin cannot edit the quote');
select throws_ok(
  $$delete from public.reviews where id = '00000000-0000-0000-0000-0000000065b1'$$,
  '42501', null, 'a platform admin cannot delete reviews from the client');

select * from finish();
rollback;
