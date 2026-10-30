-- T12.3: venue_id on every venue-owned table (expand).
-- Backfill into claudex-courts, column defaults on direct tables, BEFORE INSERT fill on child tables,
-- composite FKs (venue_id, parent_id) so children can't cross venues, rekeys so a second venue can coexist.
begin;
create extension if not exists pgtap with schema extensions;
select plan(74);

-- helpers (run as postgres)
create function pg_temp.venue_tables() returns text[] language sql as $$
  select array['courts','blackouts','open_play_sessions','venue_amenities','venue_info_sections',
    'venue_payment_accounts','venue_social_links','operating_hours','venue_settings','bookings','payments',
    'court_rates','court_photos','open_play_courts','paymongo_checkouts','email_outbox','booking_changes',
    'guest_link_tokens'] $$;

-- how many of the 18 tables have a venue_id column that is NOT NULL
create function pg_temp.not_null_tables() returns int language sql as $$
  select count(*)::int from pg_attribute a
  where a.attrelid = any (select ('public.' || t)::regclass from unnest(pg_temp.venue_tables()) t)
    and a.attname = 'venue_id' and a.attnotnull and not a.attisdropped $$;

-- how many of the 18 tables have a foreign key from venue_id to venues(id)
create function pg_temp.venue_fk_tables() returns int language sql as $$
  select count(distinct c.conrelid)::int from pg_constraint c
  where c.contype = 'f' and c.confrelid = 'public.venues'::regclass
    and c.conrelid = any (select ('public.' || t)::regclass from unnest(pg_temp.venue_tables()) t)
    and (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['venue_id'] $$;

create function pg_temp.null_rows() returns bigint language plpgsql as $$
declare t text; n bigint; total bigint := 0;
begin
  foreach t in array pg_temp.venue_tables() loop
    execute format('select count(*) from public.%I where venue_id is null', t) into n;
    total := total + n;
  end loop;
  return total;
end $$;

create function pg_temp.foreign_rows() returns bigint language plpgsql as $$
declare t text; n bigint; total bigint := 0;
begin
  foreach t in array pg_temp.venue_tables() loop
    execute format('select count(*) from public.%I where venue_id is distinct from private.default_venue_id()', t) into n;
    total := total + n;
  end loop;
  return total;
end $$;

-- how many of the 9 direct tables default venue_id to private.default_venue_id()
create function pg_temp.default_tables() returns int language sql as $$
  select count(*)::int from pg_attrdef d
  join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
  where a.attname = 'venue_id'
    and d.adrelid = any (select ('public.' || t)::regclass from unnest(array['courts','blackouts','open_play_sessions',
      'venue_amenities','venue_info_sections','venue_payment_accounts','venue_social_links','operating_hours','venue_settings']) t)
    and pg_get_expr(d.adbin, d.adrelid) like '%default_venue_id%' $$;

-- primary key columns in key order
create function pg_temp.pk_cols(p_table regclass) returns text language sql as $$
  select string_agg(a.attname, ',' order by k.ord)
  from pg_index i
  cross join lateral unnest(i.indkey::int2[]) with ordinality as k(attnum, ord)
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where i.indrelid = p_table and i.indisprimary $$;

-- number of the 6 parents with a unique index/constraint on exactly (venue_id, id)
create function pg_temp.parent_uniques() returns int language sql as $$
  select count(*)::int from unnest(array['courts','bookings','payments','open_play_sessions','venue_payment_accounts','booking_changes']) t
  where exists (
    select 1 from pg_index i
    where i.indrelid = ('public.' || t)::regclass and i.indisunique and i.indpred is null
      and (select string_agg(a.attname, ',' order by k.ord)
           from unnest(i.indkey::int2[]) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum) = 'venue_id,id') $$;

-- seed backfill (nothing inserted yet)
select is(private.default_venue_id(), (select id from public.venues where slug = 'claudex-courts'), 'default_venue_id: returns the claudex-courts venue');
select is(pg_temp.not_null_tables(), 18, 'schema: venue_id is NOT NULL on all 18 venue-owned tables');
select is(pg_temp.venue_fk_tables(), 18, 'schema: venue_id references venues(id) on all 18 tables');
select is(pg_temp.null_rows(), 0::bigint, 'backfill: no row has a NULL venue_id');
select is(pg_temp.foreign_rows(), 0::bigint, 'backfill: every existing row belongs to claudex-courts');
select cmp_ok((select count(*) from public.courts), '>', 0::bigint, 'backfill: seed courts exist (so the checks above are not vacuous)');
select cmp_ok((select count(*) from public.operating_hours), '=', 7::bigint, 'backfill: operating_hours keeps its 7 rows');
select is((select count(*) from public.venue_settings), 1::bigint, 'backfill: venue_settings keeps its single row');
select is(pg_temp.default_tables(), 9, 'default: the 9 direct tables default venue_id to private.default_venue_id()');

-- rekeys
select is(pg_temp.pk_cols('public.venue_settings'), 'venue_id', 'rekey: venue_settings primary key is (venue_id)');
select is(pg_temp.pk_cols('public.operating_hours'), 'venue_id,day_of_week', 'rekey: operating_hours primary key is (venue_id, day_of_week)');
select is(pg_temp.pk_cols('public.venue_social_links'), 'venue_id,platform', 'rekey: venue_social_links primary key is (venue_id, platform)');
select is(pg_temp.parent_uniques(), 6, 'schema: 6 parents have unique (venue_id, id)');

-- fixtures
insert into public.venues (id, slug, status) values ('b0000000-0000-0000-0000-00000000000b', 'e2e-venue-b', 'active');

-- default venue on direct tables when venue_id is omitted
insert into public.courts (id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000000a1', 'E2E Shared Name', 'tennis', 500);
select is((select venue_id from public.courts where id = 'c0000000-0000-0000-0000-0000000000a1'), private.default_venue_id(), 'default: court inserted without venue_id lands in claudex-courts');
insert into public.blackouts (id, court_id, starts_at, ends_at) values
  ('d0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000a1', now() + interval '10 days', now() + interval '10 days 1 hour');
select is((select venue_id from public.blackouts where id = 'd0000000-0000-0000-0000-0000000000a1'), private.default_venue_id(), 'default: blackout lands in claudex-courts');
insert into public.open_play_sessions (id, title, starts_at, ends_at) values
  ('e0000000-0000-0000-0000-0000000000a1', 'E2E Open Play', now() + interval '11 days', now() + interval '11 days 2 hours');
select is((select venue_id from public.open_play_sessions where id = 'e0000000-0000-0000-0000-0000000000a1'), private.default_venue_id(), 'default: open play session lands in claudex-courts');
insert into public.venue_amenities (id, builtin_key) values ('f0000000-0000-0000-0000-0000000000a1', 'parking');
select is((select venue_id from public.venue_amenities where id = 'f0000000-0000-0000-0000-0000000000a1'), private.default_venue_id(), 'default: amenity lands in claudex-courts');
insert into public.venue_info_sections (id, title) values ('f1000000-0000-0000-0000-0000000000a1', 'E2E Info');
select is((select venue_id from public.venue_info_sections where id = 'f1000000-0000-0000-0000-0000000000a1'), private.default_venue_id(), 'default: info section lands in claudex-courts');
insert into public.venue_payment_accounts (id, label) values ('f2000000-0000-0000-0000-0000000000a1', 'E2E Account A');
select is((select venue_id from public.venue_payment_accounts where id = 'f2000000-0000-0000-0000-0000000000a1'), private.default_venue_id(), 'default: payment account lands in claudex-courts');

-- venue B fixtures (explicit venue_id on the direct tables)
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  ('c0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E Court B1', 'tennis', 600),
  ('c0000000-0000-0000-0000-0000000000b2', 'b0000000-0000-0000-0000-00000000000b', 'E2E Court B2', 'tennis', 600);
insert into public.open_play_sessions (id, venue_id, title, starts_at, ends_at) values
  ('e0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E Open Play B', now() + interval '12 days', now() + interval '12 days 2 hours');
insert into public.venue_payment_accounts (id, venue_id, label) values
  ('f2000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'E2E Account B');
insert into public.bookings (id, venue_id, reference_code, court_id, guest_name, during, total_amount, status) values
  ('b1000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'CB-BBBBB2', 'c0000000-0000-0000-0000-0000000000b1', 'E2E Guest B',
   tstzrange(now() + interval '13 days', now() + interval '13 days 1 hour'), 600, 'confirmed');

-- child tables fill venue_id from the parent when it is omitted
insert into public.bookings (id, reference_code, court_id, guest_name, during, total_amount, status) values
  ('b1000000-0000-0000-0000-0000000000b2', 'CB-BBBBB3', 'c0000000-0000-0000-0000-0000000000b1', 'E2E Guest B2',
   tstzrange(now() + interval '14 days', now() + interval '14 days 1 hour'), 600, 'confirmed');
select is((select venue_id from public.bookings where id = 'b1000000-0000-0000-0000-0000000000b2'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'child fill: booking takes its court''s venue (not the default)');
insert into public.payments (id, booking_id, method, amount) values
  ('a1000000-0000-0000-0000-0000000000b1', 'b1000000-0000-0000-0000-0000000000b1', 'cash', 600);
select is((select venue_id from public.payments where id = 'a1000000-0000-0000-0000-0000000000b1'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'child fill: payment takes its booking''s venue');
insert into public.court_rates (court_id, day_of_week, start_hour, price) values ('c0000000-0000-0000-0000-0000000000b2', 1, 8, 700);
select is((select venue_id from public.court_rates where court_id = 'c0000000-0000-0000-0000-0000000000b2'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'child fill: court rate takes its court''s venue');
insert into public.court_photos (id, court_id, path, sort_order) values
  ('a2000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-0000000000b2', 'courts/c0000000-0000-0000-0000-0000000000b2/a2000000-0000-0000-0000-0000000000b2.png', 0);
select is((select venue_id from public.court_photos where id = 'a2000000-0000-0000-0000-0000000000b2'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'child fill: court photo takes its court''s venue');
insert into public.open_play_courts (session_id, court_id, during) values
  ('e0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b2', tstzrange(now() + interval '12 days', now() + interval '12 days 2 hours'));
select is((select venue_id from public.open_play_courts where session_id = 'e0000000-0000-0000-0000-0000000000b1'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'child fill: open play court takes its court''s venue');
insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos) values
  ('b1000000-0000-0000-0000-0000000000b1', 'cs_e2evenueid', 'https://example.com/cs', 60000);
select is((select venue_id from public.paymongo_checkouts where checkout_id = 'cs_e2evenueid'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'child fill: paymongo checkout takes its booking''s venue');
insert into public.email_outbox (id, booking_id, kind, to_email, for_guest, data) values
  ('a3000000-0000-0000-0000-0000000000b1', 'b1000000-0000-0000-0000-0000000000b1', 'booking_created', 'e2e-b@example.com', true, '{}');
select is((select venue_id from public.email_outbox where id = 'a3000000-0000-0000-0000-0000000000b1'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'child fill: email outbox row takes its booking''s venue');
insert into public.booking_changes (id, booking_id, old_court_id, old_during, new_court_id, new_during, reason) values
  ('a4000000-0000-0000-0000-0000000000b1', 'b1000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1',
   tstzrange(now() + interval '13 days', now() + interval '13 days 1 hour'), 'c0000000-0000-0000-0000-0000000000b1',
   tstzrange(now() + interval '15 days', now() + interval '15 days 1 hour'), 'e2e');
select is((select venue_id from public.booking_changes where id = 'a4000000-0000-0000-0000-0000000000b1'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'child fill: booking change takes its booking''s venue');
insert into public.guest_link_tokens (booking_id, token_hash) values ('b1000000-0000-0000-0000-0000000000b1', '\x00112233'::bytea);
select is((select venue_id from public.guest_link_tokens where booking_id = 'b1000000-0000-0000-0000-0000000000b1'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'child fill: guest link token takes its booking''s venue');
insert into public.blackouts (id, venue_id, court_id, starts_at, ends_at) values
  ('d0000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b2', now() + interval '20 days', now() + interval '20 days 1 hour');
select is((select venue_id from public.blackouts where id = 'd0000000-0000-0000-0000-0000000000b1'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'child: blackout in venue B on a venue B court is accepted');

-- matching explicit venue_id on a child is accepted
select lives_ok($$insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000b2', 2, 8, 700)$$,
  'composite FK: explicit venue_id that matches the court is accepted');

-- cross-venue child inserts are rejected (claudex venue_id against a venue B parent), one per composite FK
select throws_ok($$insert into public.bookings (venue_id, reference_code, court_id, guest_name, during, total_amount, status) values (private.default_venue_id(), 'CB-BBBBB4', 'c0000000-0000-0000-0000-0000000000b1', 'E2E X', tstzrange(now() + interval '30 days', now() + interval '30 days 1 hour'), 1, 'confirmed')$$,
  '23503', null, 'cross-venue: booking in claudex on a venue B court is rejected');
select throws_ok($$insert into public.payments (venue_id, booking_id, method, amount) values (private.default_venue_id(), 'b1000000-0000-0000-0000-0000000000b2', 'cash', 1)$$,
  '23503', null, 'cross-venue: payment in claudex on a venue B booking is rejected');
select throws_ok($$insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000b2', 3, 8, 1)$$,
  '23503', null, 'cross-venue: court rate in claudex on a venue B court is rejected');
select throws_ok($$insert into public.court_photos (venue_id, court_id, path, sort_order) values (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000b2', 'courts/c0000000-0000-0000-0000-0000000000b2/a2000000-0000-0000-0000-0000000000c3.png', 1)$$,
  '23503', null, 'cross-venue: court photo in claudex on a venue B court is rejected');
select throws_ok($$insert into public.blackouts (venue_id, court_id, starts_at, ends_at) values (private.default_venue_id(), 'c0000000-0000-0000-0000-0000000000b2', now() + interval '40 days', now() + interval '40 days 1 hour')$$,
  '23503', null, 'cross-venue: blackout in claudex on a venue B court is rejected');
select throws_ok($$insert into public.open_play_courts (venue_id, session_id, court_id, during) values (private.default_venue_id(), 'e0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000b1', tstzrange(now() + interval '11 days', now() + interval '11 days 2 hours'))$$,
  '23503', null, 'cross-venue: open play court in claudex with a venue B court is rejected');
select throws_ok($$insert into public.open_play_courts (venue_id, session_id, court_id, during) values ('b0000000-0000-0000-0000-00000000000b', 'e0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000b1', tstzrange(now() + interval '11 days', now() + interval '11 days 2 hours'))$$,
  '23503', null, 'cross-venue: open play court in venue B with a claudex session is rejected');
select throws_ok($$insert into public.paymongo_checkouts (venue_id, booking_id, checkout_id, checkout_url, amount_centavos) values (private.default_venue_id(), 'b1000000-0000-0000-0000-0000000000b2', 'cs_e2ex', 'https://example.com/x', 100)$$,
  '23503', null, 'cross-venue: paymongo checkout in claudex on a venue B booking is rejected');
select throws_ok($$insert into public.email_outbox (venue_id, booking_id, kind, to_email, for_guest, data) values (private.default_venue_id(), 'b1000000-0000-0000-0000-0000000000b1', 'payment_confirmed', 'e2e-x@example.com', true, '{}')$$,
  '23503', null, 'cross-venue: email outbox row in claudex on a venue B booking is rejected');
select throws_ok($$insert into public.booking_changes (venue_id, booking_id, old_court_id, old_during, new_court_id, new_during, reason) values (private.default_venue_id(), 'b1000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000b1', tstzrange(now() + interval '13 days', now() + interval '13 days 1 hour'), 'c0000000-0000-0000-0000-0000000000b2', tstzrange(now() + interval '16 days', now() + interval '16 days 1 hour'), 'e2e')$$,
  '23503', null, 'cross-venue: booking change in claudex on a venue B booking is rejected');
select throws_ok($$insert into public.guest_link_tokens (venue_id, booking_id, token_hash) values (private.default_venue_id(), 'b1000000-0000-0000-0000-0000000000b1', '\x99'::bytea)$$,
  '23503', null, 'cross-venue: guest link token in claudex on a venue B booking is rejected');
select throws_ok($$insert into public.payments (booking_id, method, amount, payment_account_id, paid_with) values ('b1000000-0000-0000-0000-0000000000b2', 'account', 1, 'f2000000-0000-0000-0000-0000000000a1', 'E2E Account A')$$,
  '23503', null, 'cross-venue: venue B payment pointing at a claudex payment account is rejected');
select lives_ok($$insert into public.payments (booking_id, method, amount, payment_account_id, paid_with) values ('b1000000-0000-0000-0000-0000000000b2', 'account', 1, 'f2000000-0000-0000-0000-0000000000b1', 'E2E Account B')$$,
  'composite FK: venue B payment pointing at a venue B payment account is accepted');
select throws_ok($$insert into public.court_rates (venue_id, court_id, day_of_week, start_hour, price) values ('b0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000a1', 4, 8, 1)$$,
  '23503', null, 'cross-venue: venue B court rate on a claudex court is rejected');
select throws_ok($$insert into public.bookings (venue_id, reference_code, court_id, guest_name, during, total_amount, status) values ('b0000000-0000-0000-0000-00000000000b', 'CB-BBBBB5', 'c0000000-0000-0000-0000-0000000000a1', 'E2E Y', tstzrange(now() + interval '31 days', now() + interval '31 days 1 hour'), 1, 'confirmed')$$,
  '23503', null, 'cross-venue: venue B booking on a claudex court is rejected');
select throws_ok($$update public.court_rates set venue_id = private.default_venue_id() where court_id = 'c0000000-0000-0000-0000-0000000000b2' and day_of_week = 1$$,
  '23503', null, 'cross-venue: moving an existing court rate to another venue is rejected');

-- a second venue coexists with the first
insert into public.venue_settings (venue_id, name) values ('b0000000-0000-0000-0000-00000000000b', 'E2E Venue B');
select is((select count(*) from public.venue_settings), 2::bigint, 'second venue: venue_settings can hold a row per venue');
select is((select slot_minutes from public.venue_settings where venue_id = 'b0000000-0000-0000-0000-00000000000b'), 60::smallint, 'second venue: venue_settings row gets the column defaults');
select throws_ok($$insert into public.venue_settings (venue_id, name) values ('b0000000-0000-0000-0000-00000000000b', 'E2E dup')$$,
  '23505', null, 'second venue: a venue still has only one venue_settings row');
select lives_ok($$insert into public.operating_hours (venue_id, day_of_week, open_time, close_time) values ('b0000000-0000-0000-0000-00000000000b', 0, '08:00', '20:00'), ('b0000000-0000-0000-0000-00000000000b', 1, '08:00', '20:00')$$,
  'second venue: operating_hours can hold the same weekdays as claudex');
select throws_ok($$insert into public.operating_hours (venue_id, day_of_week, open_time, close_time) values ('b0000000-0000-0000-0000-00000000000b', 0, '09:00', '19:00')$$,
  '23505', null, 'second venue: a venue has one operating_hours row per weekday');
select is((select count(*) from public.operating_hours where venue_id = private.default_venue_id()), 7::bigint, 'second venue: claudex operating_hours is untouched');
select lives_ok($$insert into public.courts (venue_id, name, sport, default_hourly_rate) values ('b0000000-0000-0000-0000-00000000000b', 'E2E Shared Name', 'tennis', 500)$$,
  'second venue: can reuse a court name another venue uses');
select throws_ok($$insert into public.courts (name, sport, default_hourly_rate) values ('E2E Shared Name', 'tennis', 500)$$,
  '23505', null, 'second venue: court name is still unique within a venue');
select lives_ok($$insert into public.venue_amenities (venue_id, builtin_key) values ('b0000000-0000-0000-0000-00000000000b', 'parking')$$,
  'second venue: can reuse a built-in amenity another venue has');
select throws_ok($$insert into public.venue_amenities (builtin_key) values ('parking')$$,
  '23505', null, 'second venue: built-in amenity is still unique within a venue');
select lives_ok($$insert into public.venue_social_links (venue_id, platform, url) values ('b0000000-0000-0000-0000-00000000000b', 'facebook', 'https://facebook.com/e2e-b'), (private.default_venue_id(), 'facebook', 'https://facebook.com/e2e-a')$$,
  'second venue: each venue can have its own link for the same platform');
select throws_ok($$insert into public.venue_social_links (venue_id, platform, url) values ('b0000000-0000-0000-0000-00000000000b', 'facebook', 'https://facebook.com/e2e-dup')$$,
  '23505', null, 'second venue: a venue has one link per platform');
select is((select count(*) from public.venue_social_links where platform = 'facebook'), 2::bigint, 'second venue: two facebook links exist, one per venue');

-- cascade and delete behavior is preserved
select is((select count(*) from public.court_rates where court_id = 'c0000000-0000-0000-0000-0000000000b2'), 2::bigint, 'cascade setup: court B2 has 2 rates');
select throws_ok($$delete from public.courts where id = 'c0000000-0000-0000-0000-0000000000b1'$$, '23503', null, 'restrict: a court with bookings still cannot be deleted');
delete from public.courts where id = 'c0000000-0000-0000-0000-0000000000b2';
select is((select count(*) from public.court_rates where court_id = 'c0000000-0000-0000-0000-0000000000b2'), 0::bigint, 'cascade: deleting a court deletes its rates');
select is((select count(*) from public.court_photos where court_id = 'c0000000-0000-0000-0000-0000000000b2'), 0::bigint, 'cascade: deleting a court deletes its photos');
select is((select count(*) from public.blackouts where id = 'd0000000-0000-0000-0000-0000000000b1'), 0::bigint, 'cascade: deleting a court deletes its blackouts');
select is((select count(*) from public.open_play_courts where session_id = 'e0000000-0000-0000-0000-0000000000b1'), 0::bigint, 'cascade: deleting a court deletes its open play courts');
delete from public.venue_payment_accounts where id = 'f2000000-0000-0000-0000-0000000000b1';
select is((select payment_account_id from public.payments where amount = 1 and booking_id = 'b1000000-0000-0000-0000-0000000000b2'), null, 'set null: deleting a payment account clears payments.payment_account_id');
select is((select venue_id from public.payments where amount = 1 and booking_id = 'b1000000-0000-0000-0000-0000000000b2'), 'b0000000-0000-0000-0000-00000000000b'::uuid, 'set null: the payment keeps its venue_id');
delete from public.bookings where id = 'b1000000-0000-0000-0000-0000000000b1';
select is((select count(*) from public.payments where booking_id = 'b1000000-0000-0000-0000-0000000000b1'), 0::bigint, 'cascade: deleting a booking deletes its payments');
select is((select count(*) from public.paymongo_checkouts where checkout_id = 'cs_e2evenueid'), 0::bigint, 'cascade: deleting a booking deletes its paymongo checkout');
select is((select count(*) from public.email_outbox where id = 'a3000000-0000-0000-0000-0000000000b1'), 0::bigint, 'cascade: deleting a booking deletes its email outbox rows');
select is((select count(*) from public.guest_link_tokens where booking_id = 'b1000000-0000-0000-0000-0000000000b1'), 0::bigint, 'cascade: deleting a booking deletes its guest link tokens');
select is((select count(*) from public.booking_changes where id = 'a4000000-0000-0000-0000-0000000000b1'), 0::bigint, 'cascade: deleting a booking deletes its booking changes');
select throws_ok($$delete from public.venues where id = 'b0000000-0000-0000-0000-00000000000b'$$, '23503', null, 'restrict: a venue that still owns rows cannot be deleted');
select is(pg_temp.null_rows(), 0::bigint, 'end: still no NULL venue_id on any table after all the inserts');

select * from finish();
rollback;
