-- Marketing site tables (docs/PLATFORM.md §4–5): leads and reviews. RLS for anon, player and admin, and the
-- CHECK constraints that back up _shared/siteForms.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Users: a player and an admin (profiles are created by the auth trigger).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'site-player@example.com'),
  ('00000000-0000-0000-0000-0000000005a2', 'site-admin@example.com');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000005a2';

-- What the Edge Functions insert (as the service role / table owner).
insert into public.leads (id, first_name, last_name, email, phone, venue_name, location, courts, consented_at)
values ('00000000-0000-0000-0000-0000000005b1', 'Ana', 'Reyes', 'ana@example.com', '09171234567',
        'Sample Pickle Park', 'Pasig', 3, now());

delete from public.reviews;
insert into public.reviews (id, name, quote, role, rating, approved, consented_at) values
  ('00000000-0000-0000-0000-0000000005c1', 'Ben', 'Booking took me one minute.', 'player', 5, true, now()),
  ('00000000-0000-0000-0000-0000000005c2', 'Cara', 'Waiting for approval here.', 'owner', 4, false, now());

-- Constraints (as the owner).
select is((select status from public.leads where id = '00000000-0000-0000-0000-0000000005b1'), 'new',
  'a new lead starts as new');
select throws_ok(
  $$update public.leads set status = 'maybe' where id = '00000000-0000-0000-0000-0000000005b1'$$,
  '23514', null, 'lead status is one of new, talking, won, lost'
);
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'a@example.com', '09171234567', 'Venue', 'Pasig', 51, now())$$,
  '23514', null, 'courts is 1 to 50'
);
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'Upper@Example.com', '09171234567', 'Venue', 'Pasig', 2, now())$$,
  '23514', null, 'emails are stored lowercase'
);
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'a@example.com', '0281234567', 'Venue', 'Pasig', 2, now())$$,
  '23514', null, 'phone is a normalized PH mobile number'
);
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values ('X', 'Too short', 'player', 5, now())$$,
  '23514', null, 'a review quote has at least 10 characters'
);

-- Anon: approved reviews only, no leads, no writes.
set local role anon;
select is((select count(*)::int from public.reviews), 1, 'anon sees approved reviews only');
select throws_ok($$select count(*) from public.leads$$, '42501', null, 'anon cannot read leads');
select throws_ok(
  $$insert into public.reviews (name, quote, role, rating, consented_at) values ('X', 'Ten chars at least', 'player', 5, now())$$,
  '42501', null, 'anon cannot insert reviews directly'
);

-- Player: no leads, approved reviews only, can't approve.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}';
select is((select count(*)::int from public.leads), 0, 'a player sees no leads');
select is((select count(*)::int from public.reviews), 1, 'a player sees approved reviews only');
update public.reviews set approved = true where id = '00000000-0000-0000-0000-0000000005c2';
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'a@example.com', '09171234567', 'Venue', 'Pasig', 2, now())$$,
  '42501', null, 'a player cannot insert leads'
);

-- Admin: reads everything, tracks leads, approves reviews; can't touch other columns.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000005a2","role":"authenticated"}';
select is((select count(*)::int from public.reviews where not approved), 1,
  'the player''s update approved nothing (and the admin sees unapproved reviews)');
select is((select count(*)::int from public.leads), 1, 'an admin sees leads');
select lives_ok(
  $$update public.leads set status = 'talking', notes = 'Called on Monday' where id = '00000000-0000-0000-0000-0000000005b1'$$,
  'an admin can update a lead''s status and notes'
);
select throws_ok(
  $$update public.leads set email = 'other@example.com' where id = '00000000-0000-0000-0000-0000000005b1'$$,
  '42501', null, 'an admin cannot change a lead''s contact details'
);
update public.reviews set approved = true where id = '00000000-0000-0000-0000-0000000005c2';
reset role;
select is((select count(*)::int from public.reviews where approved), 2, 'an admin can approve a review');

select * from finish();
rollback;
