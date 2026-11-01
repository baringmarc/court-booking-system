-- T14.7: public.venue_setup_status(p_venue_id) and public.publish_venue(p_venue_id). Venue admins of that venue and platform
-- admins only; everyone else gets P0001 hint not_venue_admin. publish_venue moves draft -> active once the required
-- setup items exist (courts, rates, hours, payment); photos are optional.
begin;
create extension if not exists pgtap with schema extensions;
select plan(50);

-- Returns 'SQLSTATE|hint|detail' of the error a statement raises, or 'ok' if it succeeds.
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare s text; h text; d text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint, d = pg_exception_detail;
  return s || '|' || coalesce(h, '') || '|' || coalesce(d, '');
end $$;
grant execute on function pg_temp.err(text) to anon, authenticated;

-- One field of one item of the setup status, e.g. pg_temp.item(venue, 'courts', 'done').
create function pg_temp.item(p_venue uuid, p_key text, p_field text) returns text language plpgsql as $$
begin
  return (select i ->> p_field from jsonb_array_elements(public.venue_setup_status(p_venue) -> 'items') i where i ->> 'key' = p_key);
end $$;
grant execute on function pg_temp.item(uuid, text, text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000058a1', 'e2e-pv-player@example.com'),
  ('00000000-0000-0000-0000-0000000058a2', 'e2e-pv-platform@example.com'),
  ('00000000-0000-0000-0000-0000000058a3', 'e2e-pv-owner@example.com'),
  ('00000000-0000-0000-0000-0000000058a4', 'e2e-pv-other@example.com');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-0000000058a1', 'e2e-pv-one', 'draft'),
  ('a0000000-0000-0000-0000-0000000058a2', 'e2e-pv-two', 'draft'),
  ('a0000000-0000-0000-0000-0000000058a3', 'e2e-pv-suspended', 'suspended'),
  ('a0000000-0000-0000-0000-0000000058a4', 'e2e-pv-closed', 'closed'),
  ('a0000000-0000-0000-0000-0000000058a5', 'e2e-pv-active', 'active'),
  ('a0000000-0000-0000-0000-0000000058a6', 'e2e-pv-six', 'draft');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-0000000058a1', '00000000-0000-0000-0000-0000000058a3', 'owner'),
  ('a0000000-0000-0000-0000-0000000058a2', '00000000-0000-0000-0000-0000000058a4', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-0000000058a2');
-- Every venue starts with default hours, like create_venue does. Venue two also has a court with a photo, to prove venue one does not count it.
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v, d, time '06:00', time '22:00'
from unnest(array['a0000000-0000-0000-0000-0000000058a1', 'a0000000-0000-0000-0000-0000000058a2', 'a0000000-0000-0000-0000-0000000058a6']::uuid[]) v, generate_series(0, 6) d;
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000058a2', 'a0000000-0000-0000-0000-0000000058a2', 'E2E PV Court Two', 'badminton', 200, true);
insert into public.court_photos (venue_id, court_id, path, sort_order) values
  ('a0000000-0000-0000-0000-0000000058a2', 'c0000000-0000-0000-0000-0000000058a2',
   'a0000000-0000-0000-0000-0000000058a2/courts/c0000000-0000-0000-0000-0000000058a2/d0000000-0000-0000-0000-0000000058a2.png', 0);
-- Venues three, four and five are complete apart from their status; six is complete and still a draft.
insert into public.courts (venue_id, name, sport, default_hourly_rate, is_active)
select v, 'E2E PV Court ' || v, 'tennis', 150, true
from unnest(array['a0000000-0000-0000-0000-0000000058a3', 'a0000000-0000-0000-0000-0000000058a4', 'a0000000-0000-0000-0000-0000000058a6']::uuid[]) v;
insert into public.venue_payment_accounts (venue_id, label, account_name, account_number)
select v, 'GCash', 'E2E', '0917 000 0000'
from unnest(array['a0000000-0000-0000-0000-0000000058a3', 'a0000000-0000-0000-0000-0000000058a4', 'a0000000-0000-0000-0000-0000000058a6']::uuid[]) v;
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v, d, time '06:00', time '22:00'
from unnest(array['a0000000-0000-0000-0000-0000000058a3', 'a0000000-0000-0000-0000-0000000058a4']::uuid[]) v, generate_series(0, 6) d;

select has_function('public', 'venue_setup_status', array['uuid'], 'venue_setup_status(uuid) exists');
select has_function('public', 'publish_venue', array['uuid'], 'publish_venue(uuid) exists');

-- ---------------------------------------------------------------- anon
set local role anon;
select throws_ok($$select public.venue_setup_status('a0000000-0000-0000-0000-0000000058a1')$$, '42501', null,
  'anon has no execute on venue_setup_status');
select throws_ok($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a1')$$, '42501', null,
  'anon has no execute on publish_venue');

-- ---------------------------------------------------------------- player and another venue's admin
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a1","role":"authenticated"}';
select is(pg_temp.err($$select public.venue_setup_status('a0000000-0000-0000-0000-0000000058a1')$$),
  'P0001|not_venue_admin|', 'a player is refused the setup status with not_venue_admin');
select is(substr(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a6')$$), 1, 22),
  'P0001|not_venue_admin|', 'a player is refused publish_venue with not_venue_admin');
select is(pg_temp.err($$select public.venue_setup_status('a0000000-0000-0000-0000-0000000058ff')$$),
  'P0001|not_venue_admin|', 'a player asking about an unknown venue gets not_venue_admin');
select is(substr(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058ff')$$), 1, 22),
  'P0001|not_venue_admin|', 'a player publishing an unknown venue gets not_venue_admin');

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a4","role":"authenticated"}';
select is(pg_temp.err($$select public.venue_setup_status('a0000000-0000-0000-0000-0000000058a1')$$),
  'P0001|not_venue_admin|', 'the admin of another venue is refused the setup status');
select is(substr(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a6')$$), 1, 22),
  'P0001|not_venue_admin|', 'the admin of another venue cannot publish this venue');
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a2', 'courts', 'done'), 'true',
  'a venue admin can read their own venue''s status');

-- ---------------------------------------------------------------- a fresh venue: only the default hours exist
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(public.venue_setup_status('a0000000-0000-0000-0000-0000000058a1') ->> 'ready', 'false', 'a fresh venue is not ready');
select is(
  (select array_agg(i ->> 'key' order by o) from jsonb_array_elements(public.venue_setup_status('a0000000-0000-0000-0000-0000000058a1') -> 'items') with ordinality t(i, o)),
  array['courts', 'rates', 'hours', 'payment', 'photos'], 'the items are courts, rates, hours, payment, photos in that order');
select is(
  (select count(*)::int from jsonb_array_elements(public.venue_setup_status('a0000000-0000-0000-0000-0000000058a1') -> 'items') i
    where jsonb_typeof(i -> 'label') = 'string' and length(i ->> 'label') > 0
      and jsonb_typeof(i -> 'required') = 'boolean' and jsonb_typeof(i -> 'done') = 'boolean'),
  5, 'every item has a non-empty label and boolean required and done');
select is(
  (select array_agg(i ->> 'key' order by o) from jsonb_array_elements(public.venue_setup_status('a0000000-0000-0000-0000-0000000058a1') -> 'items') with ordinality t(i, o) where (i ->> 'required')::boolean),
  array['courts', 'rates', 'hours', 'payment'], 'courts, rates, hours and payment are required');
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'photos', 'required'), 'false', 'photos are optional');
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'courts', 'done'), 'false', 'no courts: courts is not done');
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'rates', 'done'), 'false', 'no courts: rates is not done');
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'hours', 'done'), 'true', 'the default hours count as done');
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'payment', 'done'), 'false', 'no payment account: payment is not done');
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'photos', 'done'), 'false',
  'photos is not done, and another venue''s photo does not count');

-- publish refuses, naming what is missing
select is(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a1')$$),
  'P0001|setup_incomplete|courts,rates,payment', 'publishing a fresh venue is setup_incomplete and the detail lists courts,rates,payment');
select is((select status from public.venues where id = 'a0000000-0000-0000-0000-0000000058a1'), 'draft', 'a refused publish leaves the venue a draft');

-- ---------------------------------------------------------------- the items, one at a time (built as the service role)
reset role;
insert into public.courts (id, venue_id, name, sport, default_hourly_rate, is_active) values
  ('c0000000-0000-0000-0000-0000000058a1', 'a0000000-0000-0000-0000-0000000058a1', 'E2E PV Free Court', 'badminton', 0, true),
  ('c0000000-0000-0000-0000-0000000058b1', 'a0000000-0000-0000-0000-0000000058a1', 'E2E PV Old Court', 'badminton', 100, false);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'courts', 'done'), 'true', 'an active court makes courts done');
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'rates', 'done'), 'false', 'an active court with a 0 rate leaves rates not done (an inactive court with a rate does not help)');
reset role;
update public.courts set default_hourly_rate = 120 where id = 'c0000000-0000-0000-0000-0000000058a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'rates', 'done'), 'true', 'every active court priced above 0 makes rates done');
reset role;
update public.courts set default_hourly_rate = 0 where id = 'c0000000-0000-0000-0000-0000000058b1';
insert into public.courts (venue_id, name, sport, default_hourly_rate, is_active) values
  ('a0000000-0000-0000-0000-0000000058a1', 'E2E PV Second Free', 'tennis', 0, true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'rates', 'done'), 'false', 'one active court with a 0 rate is enough to leave rates not done');
reset role;
update public.courts set default_hourly_rate = 90 where venue_id = 'a0000000-0000-0000-0000-0000000058a1' and name = 'E2E PV Second Free';
-- an inactive court with a 0 rate does not hold rates back
update public.courts set is_active = false where id = 'c0000000-0000-0000-0000-0000000058b1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'rates', 'done'), 'true', 'inactive courts are ignored by rates');

-- hours: closed every day is not hours
reset role;
update public.operating_hours set is_closed = true where venue_id = 'a0000000-0000-0000-0000-0000000058a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'hours', 'done'), 'false', 'closed every day: hours is not done');
reset role;
update public.operating_hours set is_closed = false where venue_id = 'a0000000-0000-0000-0000-0000000058a1' and day_of_week = 3;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'hours', 'done'), 'true', 'open on one day is enough for hours');
reset role;
delete from public.operating_hours where venue_id = 'a0000000-0000-0000-0000-0000000058a1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'hours', 'done'), 'false', 'no hours rows: hours is not done');
reset role;
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select 'a0000000-0000-0000-0000-0000000058a1', d, time '06:00', time '22:00' from generate_series(0, 6) d;

-- payment: an account with no number is not payment
insert into public.venue_payment_accounts (venue_id, label, account_name, account_number) values
  ('a0000000-0000-0000-0000-0000000058a1', 'Cash only', '', '');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'payment', 'done'), 'false', 'an account with an empty number leaves payment not done');
select is(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a1')$$),
  'P0001|setup_incomplete|payment', 'with only payment missing the detail is just payment');
reset role;
insert into public.venue_payment_accounts (venue_id, label, account_name, account_number) values
  ('a0000000-0000-0000-0000-0000000058a1', 'GCash', 'E2E', '0917 000 0000');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a1', 'payment', 'done'), 'true', 'an account with a number makes payment done');
select is(public.venue_setup_status('a0000000-0000-0000-0000-0000000058a1') ->> 'ready', 'true',
  'ready is true with every required item done, with no photos');

-- the other venue admin and the player still cannot publish it; nothing changed
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a4","role":"authenticated"}';
select is(substr(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a1')$$), 1, 22),
  'P0001|not_venue_admin|', 'the admin of another venue cannot publish a ready venue');
-- read as the service role: RLS hides a draft venue from another venue's admin, which would make this NULL
reset role;
select is((select status from public.venues where id = 'a0000000-0000-0000-0000-0000000058a1'), 'draft', 'and it is still a draft');
set local role authenticated;

-- ---------------------------------------------------------------- success
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select lives_ok($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a1')$$, 'the venue owner can publish a ready venue');
reset role;
select is((select status from public.venues where id = 'a0000000-0000-0000-0000-0000000058a1'), 'active', 'publishing sets the status to active');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a3","role":"authenticated"}';
select is(substr(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a1')$$), 1, 16),
  'P0001|not_draft|', 'publishing an active venue again is not_draft');
select is(substr(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a5')$$), 1, 22),
  'P0001|not_venue_admin|', 'an owner cannot publish a venue they do not run (even an active one)');

-- platform admin
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000058a2","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-0000000058a2', 'courts', 'done'), 'true', 'a platform admin can read any venue''s status');
select is(substr(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058ff')$$), 1, 22),
  'P0001|venue_not_found|', 'a platform admin publishing an unknown venue gets venue_not_found');
select is(substr(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a3')$$), 1, 16),
  'P0001|not_draft|', 'a suspended venue is not_draft');
select is(substr(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a4')$$), 1, 16),
  'P0001|not_draft|', 'a closed venue is not_draft');
select is(substr(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a5')$$), 1, 16),
  'P0001|not_draft|', 'an active venue that is missing setup is still not_draft (status is checked before setup)');
select is(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a2')$$),
  'P0001|setup_incomplete|payment', 'a platform admin is held to the same setup rules (venue two lacks payment)');
select lives_ok($$select public.publish_venue('a0000000-0000-0000-0000-0000000058a6')$$, 'a platform admin can publish a ready venue');
reset role;
select is((select status from public.venues where id = 'a0000000-0000-0000-0000-0000000058a6'), 'active', 'and it is active');
select is((select string_agg(status, ',' order by slug) from public.venues where slug in ('e2e-pv-suspended', 'e2e-pv-closed', 'e2e-pv-two')),
  'closed,suspended,draft', 'refused publishes changed no other venue');

select * from finish();
rollback;
