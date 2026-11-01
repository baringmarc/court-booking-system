-- T14.2: public.leads. Inserted by the service role only (site-contact); platform admins read them and
-- change status and notes; venue staff, players and anon get nothing. CHECK constraints back up siteForms.ts.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

create function pg_temp.nrows(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function pg_temp.nrows(text) to anon, authenticated, service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000055a1', 'e2e-lead-player@example.com'),
  ('00000000-0000-0000-0000-0000000055a2', 'e2e-lead-platform@example.com'),
  ('00000000-0000-0000-0000-0000000055a3', 'e2e-lead-staff@example.com');
insert into public.venues (id, slug, status) values ('a0000000-0000-0000-0000-0000000055aa', 'e2e-leads-a', 'active');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000055aa', '00000000-0000-0000-0000-0000000055a3', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000055a2');

-- What the Edge Function inserts (as the owner / service role).
insert into public.leads (id, first_name, last_name, email, phone, venue_name, location, courts, consented_at)
values ('00000000-0000-0000-0000-0000000055b1', 'Ana', 'Reyes', 'ana@example.com', '09171234567',
        'Sample Pickle Park', 'Pasig', 3, now());

-- ---------------------------------------------------------------- table, constraints (as owner)
select has_table('public', 'leads', 'public.leads exists');
select ok((select relrowsecurity from pg_class where oid = 'public.leads'::regclass), 'RLS is enabled on leads');
select is((select status from public.leads where id = '00000000-0000-0000-0000-0000000055b1'), 'new', 'a new lead starts as new');
select throws_ok(
  $$update public.leads set status = 'maybe' where id = '00000000-0000-0000-0000-0000000055b1'$$,
  '23514', null, 'lead status is one of new, talking, won, lost');
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'a@example.com', '09171234567', 'Venue', 'Pasig', 51, now())$$,
  '23514', null, 'courts is at most 50');
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'a@example.com', '09171234567', 'Venue', 'Pasig', 0, now())$$,
  '23514', null, 'courts is at least 1');
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'Upper@Example.com', '09171234567', 'Venue', 'Pasig', 2, now())$$,
  '23514', null, 'emails are stored lowercase');
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'a@example.com', '0281234567', 'Venue', 'Pasig', 2, now())$$,
  '23514', null, 'phone is a normalized PH mobile number');
select lives_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'b@example.com', '+639171234567', 'Venue', 'Pasig', 2, now())$$,
  'a +63 mobile number is accepted');
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'a@example.com', '09171234567', 'V', 'Pasig', 2, now())$$,
  '23514', null, 'venue_name has at least 2 characters');
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, message, consented_at)
    values ('A', 'B', 'a@example.com', '09171234567', 'Venue', 'Pasig', 2, repeat('x', 1001), now())$$,
  '23514', null, 'message is at most 1000 characters');
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts)
    values ('A', 'B', 'a@example.com', '09171234567', 'Venue', 'Pasig', 2)$$,
  '23502', null, 'consented_at is required');
select throws_ok(
  $$update public.leads set notes = repeat('x', 2001) where id = '00000000-0000-0000-0000-0000000055b1'$$,
  '23514', null, 'notes are at most 2000 characters');

-- updated_at trigger
update public.leads set created_at = now() - interval '1 day', updated_at = now() - interval '1 day'
 where id = '00000000-0000-0000-0000-0000000055b1';
update public.leads set notes = 'touch' where id = '00000000-0000-0000-0000-0000000055b1';
select ok((select updated_at > now() - interval '1 hour' from public.leads where id = '00000000-0000-0000-0000-0000000055b1'),
  'updating a lead bumps updated_at');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select count(*) from public.leads$$, '42501', null, 'anon cannot read leads');
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'a@example.com', '09171234567', 'Venue', 'Pasig', 2, now())$$,
  '42501', null, 'anon cannot insert leads');

-- ---------------------------------------------------------------- player and venue owner
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000055a1","role":"authenticated"}';
select is((select count(*)::int from public.leads), 0, 'a player sees no leads');
select is(pg_temp.nrows($$update public.leads set status = 'won'$$), 0, 'a player updates no lead');
select throws_ok(
  $$insert into public.leads (first_name, last_name, email, phone, venue_name, location, courts, consented_at)
    values ('A', 'B', 'a@example.com', '09171234567', 'Venue', 'Pasig', 2, now())$$,
  '42501', null, 'a player cannot insert leads');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000055a3","role":"authenticated"}';
select is((select count(*)::int from public.leads), 0, 'a venue owner sees no leads');
select is(pg_temp.nrows($$update public.leads set status = 'won'$$), 0, 'a venue owner updates no lead');

-- ---------------------------------------------------------------- platform admin
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000055a2","role":"authenticated"}';
select ok((select count(*)::int from public.leads) >= 1, 'a platform admin sees leads');
select lives_ok(
  $$update public.leads set status = 'talking', notes = 'Called on Monday' where id = '00000000-0000-0000-0000-0000000055b1'$$,
  'a platform admin can update status and notes');
select throws_ok(
  $$update public.leads set email = 'other@example.com' where id = '00000000-0000-0000-0000-0000000055b1'$$,
  '42501', null, 'a platform admin cannot change contact details');
select throws_ok(
  $$delete from public.leads where id = '00000000-0000-0000-0000-0000000055b1'$$,
  '42501', null, 'a platform admin cannot delete leads from the client');

select * from finish();
rollback;
