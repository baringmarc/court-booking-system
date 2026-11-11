-- T19.1: promo rates (SPEC §5.4, §6, §10 2026-11-10). Expand only: no data changes, and with no promos every price is as before.
-- A promo is one fixed hourly price for its courts, on venue-timezone operating dates starts_on..ends_on, on its weekdays,
-- for slots whose local start hour is in [start_hour, end_hour). It wins over court_rates and the court's default rate.

-- 1. Tables ------------------------------------------------------------------------------------------------------------------
create table public.court_promos (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references public.venues (id) on delete cascade,
  label        text not null check (char_length(btrim(label)) between 1 and 60 and char_length(label) <= 60),
  starts_on    date not null,
  ends_on      date not null,
  days_of_week smallint[] not null check (cardinality(days_of_week) > 0 and days_of_week <@ array[0,1,2,3,4,5,6]::smallint[]),
  start_hour   smallint not null check (start_hour between 0 and 23),
  end_hour     smallint not null check (end_hour between 1 and 24),
  price        numeric not null check (price > 0 and price < 100000000 and price = round(price, 2)),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint court_promos_dates_check check (ends_on >= starts_on),
  constraint court_promos_hours_check check (end_hour > start_hour),
  constraint court_promos_venue_id_id_key unique (venue_id, id)
);
create index court_promos_venue_idx on public.court_promos (venue_id, starts_on, ends_on);

-- Venue consistency comes from composite FKs (as in open_play_courts): the court and the promo must both be this venue's.
create table public.court_promo_courts (
  promo_id uuid not null,
  court_id uuid not null,
  venue_id uuid not null,
  primary key (promo_id, court_id),
  constraint court_promo_courts_promo_fkey foreign key (venue_id, promo_id) references public.court_promos (venue_id, id) on delete cascade,
  constraint court_promo_courts_court_fkey foreign key (venue_id, court_id) references public.courts (venue_id, id) on delete cascade
);
create index court_promo_courts_court_idx on public.court_promo_courts (court_id);
create index court_promo_courts_venue_promo_idx on public.court_promo_courts (venue_id, promo_id);

-- 2. RLS: anyone reads the promos of venues they can see (same rule as court_rates). There are no write grants or policies:
-- admins write only through save_court_promo / delete_court_promo, which enforce the overlap rule.
alter table public.court_promos enable row level security;
alter table public.court_promo_courts enable row level security;
revoke all on public.court_promos, public.court_promo_courts from public, anon, authenticated;
grant select on public.court_promos, public.court_promo_courts to anon, authenticated;
grant all on public.court_promos, public.court_promo_courts to service_role;

create policy "Anyone can read promos of visible venues" on public.court_promos for select to anon, authenticated
  using (venue_id in (select id from public.venues));
create policy "Anyone can read promo courts of visible venues" on public.court_promo_courts for select to anon, authenticated
  using (venue_id in (select id from public.venues));

-- 3. Pricing -----------------------------------------------------------------------------------------------------------------
-- The active promo for a court's 1-hour slot. p_dow is the slot's operating weekday (callers already resolve overnight
-- slots to the day they opened on), so the operating date is the local date or the day before, whichever has that weekday.
create function private.slot_promo(p_court_id uuid, p_slot_start timestamptz, p_dow smallint)
returns table(label text, price numeric) language sql stable set search_path = '' as $$
  with l as (
    select c.venue_id, (p_slot_start at time zone private.venue_tz(c.venue_id)) as local_ts
    from public.courts c where c.id = p_court_id
  ), d as (
    select l.venue_id, extract(hour from l.local_ts)::smallint as hour,
           case when extract(dow from l.local_ts::date)::smallint = p_dow then l.local_ts::date
                else l.local_ts::date - 1 end as op_date
    from l
  )
  select p.label, p.price
  from d
  join public.court_promo_courts pc on pc.court_id = p_court_id and pc.venue_id = d.venue_id
  join public.court_promos p on p.id = pc.promo_id and p.venue_id = d.venue_id
  where p.is_active and d.op_date between p.starts_on and p.ends_on
    and p_dow = any (p.days_of_week) and d.hour >= p.start_hour and d.hour < p.end_hour
  order by p.created_at, p.id
  limit 1
$$;
revoke all on function private.slot_promo(uuid, timestamptz, smallint) from public, anon, authenticated;

create or replace function private.slot_price(p_court_id uuid, p_slot_start timestamptz, p_dow smallint)
returns numeric language sql stable set search_path = ''
as $$
  select coalesce((select sp.price from private.slot_promo(c.id, p_slot_start, p_dow) sp), r.price, c.default_hourly_rate)
  from public.courts c
  cross join private.local_dow_hour(c.venue_id, p_slot_start) l
  left join public.court_rates r
    on r.court_id = c.id and r.day_of_week = p_dow and r.start_hour = l.hour
  where c.id = p_court_id;
$$;
revoke all on function private.slot_price(uuid, timestamptz, smallint) from public, anon, authenticated;

-- 4. get_availability gains promo_label (nullable, last column). The return type changes, so drop and recreate.
drop function public.get_availability(date, uuid, text);
create function public.get_availability(p_date date, p_court_id uuid default null::uuid,
  p_venue_slug text default null::text)
returns table(court_id uuid, slot_start timestamptz, slot_end timestamptz, price numeric, status text,
              booker_first_name text, open_play_session_id uuid, block_key text, promo_label text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_venue uuid;
begin
  if p_court_id is not null then
    select c.venue_id into v_venue from public.courts c where c.id = p_court_id;
    if v_venue is null then return; end if;
    perform private.assert_venue_active(v_venue);
  else
    v_venue := private.resolve_public_venue(p_venue_slug);
  end if;

  return query
  with court_periods as (
    select c.id as court_id, c.sport, c.sort_order, c.name, r.period
    from public.courts c
    cross join lateral private.effective_open_periods(v_venue, c.id, p_date) r(period)
    where c.is_active and c.venue_id = v_venue and (p_court_id is null or c.id = p_court_id)
      and private.in_booking_window(v_venue, c.id, p_date)
  ), slots as (
    select cp.court_id, cp.sport, cp.sort_order, cp.name, s as slot_start,
           tstzrange(s, s + interval '1 hour') as slot
    from court_periods cp,
         generate_series(lower(cp.period), upper(cp.period) - interval '1 hour', interval '1 hour') as s
  ), cells as (
    select sl.*, bk.id as booking_id, bk.guest_name, bl.id as blackout_id, op.session_id,
      case
        when upper(sl.slot) <= now() then 'past'
        when bk.guest_name is not null then 'booked'
        when bl.id is not null then 'blackout'
        when op.session_id is not null then 'open_play'
        when sl.slot_start <= now() then 'past'
        else 'free'
      end as status
    from slots sl
    left join lateral (
      select b.id, b.guest_name from public.bookings b
      where b.court_id = sl.court_id and b.during && sl.slot and b.status in ('pending_payment','payment_submitted','confirmed')
        and not (b.status = 'pending_payment' and b.expires_at <= now()) limit 1
    ) bk on true
    left join lateral (
      select bo.id from public.blackouts bo
      where bo.venue_id = v_venue and (bo.court_id is null or bo.court_id = sl.court_id)
        and tstzrange(bo.starts_at, bo.ends_at) && sl.slot order by bo.id limit 1
    ) bl on true
    left join lateral (
      select oc.session_id from public.open_play_courts oc
      where oc.court_id = sl.court_id and oc.during && sl.slot limit 1
    ) op on true
  )
  select x.court_id, x.slot_start, upper(x.slot),
    private.slot_price(x.court_id, x.slot_start, extract(dow from p_date)::smallint),
    x.status,
    case when x.status = 'booked' then nullif(left(split_part(btrim(x.guest_name), ' ', 1), 20), '') end,
    case when x.status = 'open_play' then x.session_id end,
    case x.status
      when 'booked' then left(encode(sha256(convert_to('booking:' || x.booking_id::text, 'UTF8')), 'hex'), 16)
      when 'open_play' then x.session_id::text
      when 'blackout' then 'blackout:' || x.blackout_id::text
    end,
    (select sp.label from private.slot_promo(x.court_id, x.slot_start, extract(dow from p_date)::smallint) sp)
  from cells x
  order by array_position((select vs.sport_order from public.venue_settings vs where vs.venue_id = v_venue), x.sport),
           x.sort_order, x.name, x.slot_start;
end;
$$;
revoke all on function public.get_availability(date, uuid, text) from public;
grant execute on function public.get_availability(date, uuid, text) to anon, authenticated, service_role;

-- 5. Admin RPCs --------------------------------------------------------------------------------------------------------------
-- Save (p_id null inserts). The venue is the courts' own. A court that doesn't exist, isn't a venue the caller administers,
-- or is in a different venue from the other courts is court_not_found. A non-staff caller is forbidden.
create function public.save_court_promo(p_id uuid, p_label text, p_starts_on date, p_ends_on date, p_court_ids uuid[],
  p_days smallint[], p_start_hour smallint, p_end_hour smallint, p_price numeric, p_is_active boolean)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare
  v_label  text := btrim(p_label);
  v_courts uuid[];
  v_days   smallint[];
  v_venues uuid[];
  v_venue  uuid;
  v_found  int;
  v_id     uuid := p_id;
  v_clash  text;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can manage promos.' using errcode = 'P0001', hint = 'forbidden';
  end if;

  select array_agg(distinct x order by x) into v_courts from unnest(p_court_ids) x where x is not null;
  select array_agg(distinct x order by x) into v_days from unnest(p_days) x where x is not null;
  if v_label is null or char_length(v_label) not between 1 and 60
     or p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on
     or v_days is null or not (v_days <@ array[0,1,2,3,4,5,6]::smallint[])
     or p_start_hour is null or p_end_hour is null or p_start_hour < 0 or p_end_hour > 24 or p_end_hour <= p_start_hour
     or p_price is null or p_price <= 0 or p_price >= 100000000 or p_price <> round(p_price, 2)
     or v_courts is null then
    raise exception 'Check the promo: a label (up to 60 characters), dates in order, at least one day and court, an hour window and a price above zero.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Lock the courts so two concurrent saves can't both pass the overlap check.
  select array_agg(distinct c.venue_id), count(*) into v_venues, v_found
  from (select c.venue_id from public.courts c where c.id = any (v_courts) order by c.id for update) c;
  if v_found <> cardinality(v_courts) or cardinality(v_venues) <> 1 or not private.is_venue_admin(v_venues[1]) then
    raise exception 'That court doesn''t exist.' using errcode = 'P0001', hint = 'court_not_found';
  end if;
  v_venue := v_venues[1];

  if v_id is not null then
    perform 1 from public.court_promos p where p.id = v_id and p.venue_id = v_venue for update;
    if not found then
      raise exception 'That promo doesn''t exist.' using errcode = 'P0001', hint = 'not_found';
    end if;
  end if;

  if coalesce(p_is_active, true) then
    select o.label into v_clash
    from public.court_promos o
    join public.court_promo_courts oc on oc.promo_id = o.id
    where o.venue_id = v_venue and o.is_active and (v_id is null or o.id <> v_id)
      and oc.court_id = any (v_courts)
      and o.start_hour < p_end_hour and p_start_hour < o.end_hour
      and o.starts_on <= p_ends_on and p_starts_on <= o.ends_on
      and exists (
        select 1 from generate_series(greatest(o.starts_on, p_starts_on),
                                      least(o.ends_on, p_ends_on, greatest(o.starts_on, p_starts_on) + 6), interval '1 day') g
        where extract(dow from g)::smallint = any (v_days) and extract(dow from g)::smallint = any (o.days_of_week)
      )
    order by o.label limit 1;
    if v_clash is not null then
      raise exception 'This promo overlaps "%" on the same court, day and hour.', v_clash
        using errcode = 'P0001', hint = 'promo_overlap';
    end if;
  end if;

  if v_id is null then
    insert into public.court_promos (venue_id, label, starts_on, ends_on, days_of_week, start_hour, end_hour, price, is_active)
    values (v_venue, v_label, p_starts_on, p_ends_on, v_days, p_start_hour, p_end_hour, p_price, coalesce(p_is_active, true))
    returning id into v_id;
  else
    update public.court_promos set label = v_label, starts_on = p_starts_on, ends_on = p_ends_on, days_of_week = v_days,
      start_hour = p_start_hour, end_hour = p_end_hour, price = p_price, is_active = coalesce(p_is_active, true)
    where id = v_id;
    delete from public.court_promo_courts where promo_id = v_id and not (court_id = any (v_courts));
  end if;
  insert into public.court_promo_courts (promo_id, court_id, venue_id)
  select v_id, c, v_venue from unnest(v_courts) c
  on conflict (promo_id, court_id) do nothing;
  return v_id;
end;
$$;
revoke all on function public.save_court_promo(uuid, text, date, date, uuid[], smallint[], smallint, smallint, numeric, boolean)
  from public, anon;
grant execute on function public.save_court_promo(uuid, text, date, date, uuid[], smallint[], smallint, smallint, numeric, boolean)
  to authenticated;

create function public.delete_court_promo(p_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_venue uuid;
begin
  if auth.uid() is null or not private.is_any_venue_admin() then
    raise exception 'Only staff can manage promos.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  select p.venue_id into v_venue from public.court_promos p where p.id = p_id;
  if v_venue is null or not private.is_venue_admin(v_venue) then
    raise exception 'That promo doesn''t exist.' using errcode = 'P0001', hint = 'not_found';
  end if;
  delete from public.court_promos where id = p_id;
end;
$$;
revoke all on function public.delete_court_promo(uuid) from public, anon;
grant execute on function public.delete_court_promo(uuid) to authenticated;
