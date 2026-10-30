-- T12.3 (expand): every venue-owned table gets venue_id.
-- Direct tables default to Claudex Courts, so today's inserts keep working; child tables take the venue from
-- their parent court or booking in a BEFORE INSERT trigger. Composite foreign keys make cross-venue rows
-- impossible. The defaults and venue_settings.id go in T12.11 (contract). Rollback: drop the composite FKs and
-- venue_id columns, restore the single-column keys listed below.

create function private.default_venue_id()
returns uuid
language sql
stable
set search_path = ''
as $$ select id from public.venues where slug = 'claudex-courts' $$;

revoke execute on function private.default_venue_id() from public, anon, authenticated;
grant execute on function private.default_venue_id() to authenticated, anon;

-- 1. Direct tables: venue_id NOT NULL with a default, backfilled to Claudex Courts.
do $$
declare t text;
begin
  foreach t in array array['courts', 'blackouts', 'open_play_sessions', 'venue_amenities', 'venue_info_sections',
                           'venue_payment_accounts', 'venue_social_links', 'operating_hours', 'venue_settings']
  loop
    -- A stable default backfills existing rows without an UPDATE (operating_hours has a deferred trigger).
    execute format(
      'alter table public.%I add column venue_id uuid not null default private.default_venue_id() references public.venues (id)', t);
  end loop;
end $$;

-- 2. Child tables: venue_id backfilled from the parent, NOT NULL, filled by a trigger.
do $$
declare t text;
begin
  foreach t in array array['bookings', 'court_rates', 'court_photos', 'open_play_courts', 'payments',
                           'paymongo_checkouts', 'email_outbox', 'booking_changes', 'guest_link_tokens']
  loop
    execute format('alter table public.%I add column venue_id uuid references public.venues (id)', t);
  end loop;
end $$;

update public.bookings b set venue_id = c.venue_id from public.courts c where c.id = b.court_id;
update public.court_rates x set venue_id = c.venue_id from public.courts c where c.id = x.court_id;
update public.court_photos x set venue_id = c.venue_id from public.courts c where c.id = x.court_id;
update public.open_play_courts x set venue_id = c.venue_id from public.courts c where c.id = x.court_id;
update public.payments x set venue_id = b.venue_id from public.bookings b where b.id = x.booking_id;
update public.paymongo_checkouts x set venue_id = b.venue_id from public.bookings b where b.id = x.booking_id;
update public.email_outbox x set venue_id = b.venue_id from public.bookings b where b.id = x.booking_id;
update public.booking_changes x set venue_id = b.venue_id from public.bookings b where b.id = x.booking_id;
update public.guest_link_tokens x set venue_id = b.venue_id from public.bookings b where b.id = x.booking_id;

alter table public.bookings alter column venue_id set not null;
alter table public.court_rates alter column venue_id set not null;
alter table public.court_photos alter column venue_id set not null;
alter table public.open_play_courts alter column venue_id set not null;
alter table public.payments alter column venue_id set not null;
alter table public.paymongo_checkouts alter column venue_id set not null;
alter table public.email_outbox alter column venue_id set not null;
alter table public.booking_changes alter column venue_id set not null;
alter table public.guest_link_tokens alter column venue_id set not null;

create function private.venue_from_court()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.venue_id := coalesce(new.venue_id, (select c.venue_id from public.courts c where c.id = new.court_id));
  return new;
end;
$$;

create function private.venue_from_booking()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.venue_id := coalesce(new.venue_id, (select b.venue_id from public.bookings b where b.id = new.booking_id));
  return new;
end;
$$;

-- Names sort before the other BEFORE INSERT triggers' (a_), so they see venue_id already set.
create trigger a_venue_from_court before insert on public.bookings for each row execute function private.venue_from_court();
create trigger a_venue_from_court before insert on public.court_rates for each row execute function private.venue_from_court();
create trigger a_venue_from_court before insert on public.court_photos for each row execute function private.venue_from_court();
create trigger a_venue_from_court before insert on public.open_play_courts for each row execute function private.venue_from_court();
create trigger a_venue_from_booking before insert on public.payments for each row execute function private.venue_from_booking();
create trigger a_venue_from_booking before insert on public.paymongo_checkouts for each row execute function private.venue_from_booking();
create trigger a_venue_from_booking before insert on public.email_outbox for each row execute function private.venue_from_booking();
create trigger a_venue_from_booking before insert on public.booking_changes for each row execute function private.venue_from_booking();
create trigger a_venue_from_booking before insert on public.guest_link_tokens for each row execute function private.venue_from_booking();

-- 3. Parents: (venue_id, id) is what the composite foreign keys point at.
alter table public.courts add constraint courts_venue_id_id_key unique (venue_id, id);
alter table public.bookings add constraint bookings_venue_id_id_key unique (venue_id, id);
alter table public.payments add constraint payments_venue_id_id_key unique (venue_id, id);
alter table public.open_play_sessions add constraint open_play_sessions_venue_id_id_key unique (venue_id, id);
alter table public.venue_payment_accounts add constraint venue_payment_accounts_venue_id_id_key unique (venue_id, id);
alter table public.booking_changes add constraint booking_changes_venue_id_id_key unique (venue_id, id);

-- 4. Composite foreign keys replace the single-column ones, with the same delete behaviour.
alter table public.court_rates drop constraint court_rates_court_id_fkey,
  add constraint court_rates_court_fkey foreign key (venue_id, court_id) references public.courts (venue_id, id) on delete cascade;
alter table public.blackouts drop constraint blackouts_court_id_fkey,
  add constraint blackouts_court_fkey foreign key (venue_id, court_id) references public.courts (venue_id, id) on delete cascade;
alter table public.court_photos drop constraint court_photos_court_id_fkey,
  add constraint court_photos_court_fkey foreign key (venue_id, court_id) references public.courts (venue_id, id) on delete cascade;
alter table public.open_play_courts drop constraint open_play_courts_court_id_fkey,
  drop constraint open_play_courts_session_id_fkey,
  add constraint open_play_courts_court_fkey foreign key (venue_id, court_id) references public.courts (venue_id, id) on delete cascade,
  add constraint open_play_courts_session_fkey foreign key (venue_id, session_id) references public.open_play_sessions (venue_id, id) on delete cascade;
alter table public.bookings drop constraint bookings_court_id_fkey,
  drop constraint bookings_parent_booking_id_fkey,
  add constraint bookings_court_fkey foreign key (venue_id, court_id) references public.courts (venue_id, id) on delete restrict,
  add constraint bookings_parent_fkey foreign key (venue_id, parent_booking_id) references public.bookings (venue_id, id) on delete restrict;
alter table public.payments drop constraint payments_booking_id_fkey,
  drop constraint payments_payment_account_id_fkey,
  add constraint payments_booking_fkey foreign key (venue_id, booking_id) references public.bookings (venue_id, id) on delete cascade,
  add constraint payments_payment_account_fkey foreign key (venue_id, payment_account_id)
    references public.venue_payment_accounts (venue_id, id) on delete set null (payment_account_id);
alter table public.paymongo_checkouts drop constraint paymongo_checkouts_booking_id_fkey,
  add constraint paymongo_checkouts_booking_fkey foreign key (venue_id, booking_id) references public.bookings (venue_id, id) on delete cascade;
alter table public.email_outbox drop constraint email_outbox_booking_id_fkey,
  drop constraint email_outbox_change_id_fkey,
  drop constraint email_outbox_payment_id_fkey,
  add constraint email_outbox_booking_fkey foreign key (venue_id, booking_id) references public.bookings (venue_id, id) on delete cascade,
  add constraint email_outbox_change_fkey foreign key (venue_id, change_id) references public.booking_changes (venue_id, id) on delete cascade,
  add constraint email_outbox_payment_fkey foreign key (venue_id, payment_id) references public.payments (venue_id, id) on delete cascade;
alter table public.booking_changes drop constraint booking_changes_booking_id_fkey,
  drop constraint booking_changes_continuation_id_fkey,
  drop constraint booking_changes_new_court_id_fkey,
  drop constraint booking_changes_old_court_id_fkey,
  add constraint booking_changes_booking_fkey foreign key (venue_id, booking_id) references public.bookings (venue_id, id) on delete cascade,
  add constraint booking_changes_continuation_fkey foreign key (venue_id, continuation_id)
    references public.bookings (venue_id, id) on delete set null (continuation_id),
  add constraint booking_changes_new_court_fkey foreign key (venue_id, new_court_id) references public.courts (venue_id, id) on delete restrict,
  add constraint booking_changes_old_court_fkey foreign key (venue_id, old_court_id) references public.courts (venue_id, id) on delete restrict;
alter table public.guest_link_tokens drop constraint guest_link_tokens_booking_id_fkey,
  add constraint guest_link_tokens_booking_fkey foreign key (venue_id, booking_id) references public.bookings (venue_id, id) on delete cascade;

-- Foreign keys need an index on the referencing side to stay cheap (delete of a parent, RLS by venue).
create index courts_venue_idx on public.courts (venue_id);
create index bookings_venue_idx on public.bookings (venue_id);
create index payments_venue_booking_idx on public.payments (venue_id, booking_id);
create index court_photos_venue_court_idx on public.court_photos (venue_id, court_id);
create index court_rates_venue_court_idx on public.court_rates (venue_id, court_id);
create index blackouts_venue_court_idx on public.blackouts (venue_id, court_id);
create index open_play_courts_venue_session_idx on public.open_play_courts (venue_id, session_id);
create index email_outbox_venue_booking_idx on public.email_outbox (venue_id, booking_id);
create index booking_changes_venue_booking_idx on public.booking_changes (venue_id, booking_id);

-- 5. Rekey the venue-wide tables and make their uniques per venue.
alter table public.courts drop constraint courts_name_key, add constraint courts_venue_id_name_key unique (venue_id, name);

alter table public.venue_amenities drop constraint venue_amenities_builtin_key_key,
  add constraint venue_amenities_venue_id_builtin_key_key unique (venue_id, builtin_key);
drop index public.venue_amenities_custom_name_key;
create unique index venue_amenities_custom_name_key on public.venue_amenities (venue_id, lower(btrim(custom_name)));

alter table public.operating_hours drop constraint operating_hours_pkey, add primary key (venue_id, day_of_week);
alter table public.venue_social_links drop constraint venue_social_links_pkey, add primary key (venue_id, platform);

-- venue_settings is keyed by venue_id. The deployed frontend still filters `.eq('id', true)`, so `id` stays as a
-- constant generated column until T12.11.
alter table public.venue_settings drop constraint venue_settings_pkey,
  drop constraint venue_settings_id_check,
  drop column id;
alter table public.venue_settings add primary key (venue_id),
  add column id boolean generated always as (true) stored;

-- 6. Triggers that looked at the whole table now look at one venue.
create or replace function private.check_operating_hours()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_names constant text[] := array['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  r record;
begin
  perform pg_advisory_xact_lock(hashtext('public.operating_hours no overlap'));

  -- Hours past each day's midnight: a day ends at close (+24 when it closes the next day); the next day,
  -- in the same frame, opens at 24 + its open. They overlap when the end is later than that.
  for r in
    select d.day_of_week as dow, n.day_of_week as next_dow
    from public.operating_hours d
    join public.operating_hours n on n.venue_id = d.venue_id and n.day_of_week = (d.day_of_week + 1) % 7
    where not d.is_closed and not n.is_closed
      and extract(epoch from d.close_time) / 3600 + case when d.close_time <= d.open_time then 24 else 0 end
          > 24 + extract(epoch from n.open_time) / 3600
  loop
    raise exception '% runs past % opening time. Close earlier, or open % later.',
      v_names[r.dow + 1], v_names[r.next_dow + 1] || '''s', v_names[r.next_dow + 1]
      using errcode = 'P0001', hint = 'hours_overlap';
  end loop;
  return null;
end;
$$;

create or replace function private.venue_info_sections_append()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.sort_order := coalesce(
    (select max(s.sort_order) + 1 from public.venue_info_sections s where s.venue_id = new.venue_id), 0);
  return new;
end;
$$;

create or replace function private.venue_payment_accounts_append()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('public.venue_payment_accounts'));
  if (select count(*) from public.venue_payment_accounts a where a.venue_id = new.venue_id) >= 10 then
    raise exception 'A venue can list at most 10 payment accounts.' using errcode = 'P0001', hint = 'too_many';
  end if;
  new.position := coalesce(
    (select max(a.position) + 1 from public.venue_payment_accounts a where a.venue_id = new.venue_id), 0);
  return new;
end;
$$;
