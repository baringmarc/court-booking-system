-- T17.5: payment readiness requires an account number and nonblank instructions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create function pg_temp.item(p_venue uuid, p_key text) returns text language sql stable as $$
  select i ->> 'done'
  from jsonb_array_elements(public.venue_setup_status(p_venue) -> 'items') i
  where i ->> 'key' = p_key
$$;

create function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare s text; h text; d text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint, d = pg_exception_detail;
  return s || '|' || coalesce(h, '') || '|' || coalesce(d, '');
end $$;
grant execute on function pg_temp.item(uuid, text) to authenticated;
grant execute on function pg_temp.err(text) to authenticated;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a175', 'e2e-t175-owner@example.com'),
  ('00000000-0000-0000-0000-00000000a176', 'e2e-t175-other@example.com');
insert into public.venues (id, slug, status) values
  ('a0000000-0000-0000-0000-00000000a175', 'e2e-t175-one', 'draft'),
  ('a0000000-0000-0000-0000-00000000a176', 'e2e-t175-two', 'draft'),
  ('a0000000-0000-0000-0000-00000000a177', 'e2e-t175-active', 'active');
insert into public.venue_settings (venue_id, name, payment_instructions) values
  ('a0000000-0000-0000-0000-00000000a175', 'E2E T175 One', ''),
  ('a0000000-0000-0000-0000-00000000a176', 'E2E T175 Two', ''),
  ('a0000000-0000-0000-0000-00000000a177', 'E2E T175 Active', '');
insert into public.venue_members (venue_id, user_id, role) values
  ('a0000000-0000-0000-0000-00000000a175', '00000000-0000-0000-0000-00000000a175', 'owner');
insert into public.platform_admins (user_id) values ('00000000-0000-0000-0000-00000000a176');
update public.venue_settings set payment_instructions = '   '
where venue_id = 'a0000000-0000-0000-0000-00000000a175';
update public.venue_settings set payment_instructions = E'\nWire to account 123\n'
where venue_id = 'a0000000-0000-0000-0000-00000000a176';
update public.venue_settings set payment_instructions = 'Pay by transfer'
where venue_id = 'a0000000-0000-0000-0000-00000000a177';
insert into public.venue_payment_accounts (venue_id, label, account_name, account_number) values
  ('a0000000-0000-0000-0000-00000000a175', 'Bank', 'E2E', '123'),
  ('a0000000-0000-0000-0000-00000000a176', 'Bank', 'E2E', '123');
insert into public.courts (venue_id, name, sport, default_hourly_rate, is_active) values
  ('a0000000-0000-0000-0000-00000000a175', 'E2E T175 Court', 'badminton', 100, true),
  ('a0000000-0000-0000-0000-00000000a176', 'E2E T175 Court 2', 'badminton', 100, true);
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v, d, time '06:00', time '22:00'
from unnest(array['a0000000-0000-0000-0000-00000000a175', 'a0000000-0000-0000-0000-00000000a176']::uuid[]) v,
     generate_series(0, 6) d;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a175","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-00000000a175', 'payment_instructions'), 'false',
  'whitespace-only payment instructions leave payment incomplete');
select is(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-00000000a175')$$),
  'P0001|setup_incomplete|payment_instructions', 'publish requires trimmed nonblank instructions');
reset role;
select throws_ok($$update public.venue_payment_accounts set account_number = '   '
  where venue_id = 'a0000000-0000-0000-0000-00000000a175'$$, '23514', null,
  'the account-number constraint rejects whitespace-only numbers');
set local role authenticated;
select is((select status from public.venues where id = 'a0000000-0000-0000-0000-00000000a175'),
  'draft', 'incomplete venue remains a draft');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a176","role":"authenticated"}';
select is(pg_temp.item('a0000000-0000-0000-0000-00000000a176', 'payment_instructions'), 'true',
  'nonblank trimmed instructions and account number satisfy payment');
select is((public.venue_setup_status('a0000000-0000-0000-0000-00000000a176') ->> 'ready'), 'true',
  'complete requirements make the venue ready');
select lives_ok($$select public.publish_venue('a0000000-0000-0000-0000-00000000a176')$$,
  'authorized platform admin can publish a ready venue');
reset role;
select is((select status from public.venues where id = 'a0000000-0000-0000-0000-00000000a176'),
  'active', 'successful publication activates the venue');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000a175","role":"authenticated"}';
select is(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-00000000a176')$$),
  'P0001|not_venue_admin|', 'venue admin cannot publish another venue');
select is(pg_temp.err($$select public.publish_venue('a0000000-0000-0000-0000-00000000a177')$$),
  'P0001|not_venue_admin|', 'venue admin cannot shut down an active venue');
reset role;
select is((select status from public.venues where id = 'a0000000-0000-0000-0000-00000000a177'),
  'active', 'refused publish leaves active venue unchanged');

select * from finish();
rollback;
