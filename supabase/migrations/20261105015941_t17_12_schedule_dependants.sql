create or replace function private.save_open_play(p_venue uuid, p_id uuid, p_court_ids uuid[], p_start timestamp with time zone, p_end timestamp with time zone, p_title text, p_details text, p_links jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_tz      text := private.venue_tz(p_venue);
  v_title   text := btrim(p_title);
  v_details text := coalesce(btrim(p_details), '');
  v_links   jsonb := coalesce(p_links, '[]'::jsonb);
  v_courts  uuid[];
  v_court   uuid;
  v_during  tstzrange;
  v_day     date;
  v_clash   text;
  v_id      uuid := p_id;
  v_unchanged boolean := false;
begin
  if v_title is null or char_length(v_title) not between 1 and 80 then
    raise exception 'Give the session a title (up to 80 characters).' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if char_length(v_details) > 2000 then
    raise exception 'Keep the details under 2000 characters.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if not private.valid_open_play_links(v_links) then
    raise exception 'Each link needs a label (up to 40 characters) and an https:// address, and there can be at most 3.'
      using errcode = 'P0001', hint = 'invalid_links';
  end if;

  select array_agg(distinct x order by x) into v_courts from unnest(p_court_ids) x where x is not null;
  if v_courts is null then
    raise exception 'Choose at least one court.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if exists (select 1 from public.courts c where c.id = any (v_courts) and c.venue_id <> p_venue) then
    raise exception 'Choose courts of this venue.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if exists (
    select 1 from unnest(v_courts) x
    where not exists (select 1 from public.courts c where c.id = x and c.is_active)
  ) then
    raise exception 'Choose active courts only.' using errcode = 'P0001', hint = 'court_inactive';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Choose a start time and a later end time.' using errcode = 'P0001', hint = 'invalid_input';
  end if;
  if date_trunc('hour', p_start at time zone v_tz) <> p_start at time zone v_tz
     or date_trunc('hour', p_end at time zone v_tz) <> p_end at time zone v_tz then
    raise exception 'Sessions start and end on the hour.' using errcode = 'P0001', hint = 'not_aligned';
  end if;
  if p_start <= now() then
    raise exception 'That time has already started. Please pick a later time.' using errcode = 'P0001', hint = 'slot_started';
  end if;
  v_during := tstzrange(p_start, p_end);
  -- Serialize against schedule edits before reading each court's effective periods.
  foreach v_court in array v_courts loop
    perform private.lock_court_slots(v_court);
  end loop;
  select exists (
    select 1 from public.open_play_sessions s
    where s.id = p_id and s.venue_id = p_venue and s.starts_at = p_start and s.ends_at = p_end
      and v_courts = (select array_agg(oc.court_id order by oc.court_id) from public.open_play_courts oc where oc.session_id = s.id)
  ) into v_unchanged;
  foreach v_court in array v_courts loop
    exit when v_unchanged;
    v_day := private.operating_day_of(p_venue, v_court, p_start);
    if v_day is null or not exists (
      select 1 from private.effective_open_periods(p_venue, v_court, v_day) ep
      where ep @> v_during
    ) then
      raise exception 'A session must fit within one day''s opening hours.' using errcode = 'P0001', hint = 'outside_hours';
    end if;
  end loop;

  -- Active bookings, by the same rule as get_availability (a lapsed hold doesn't count; its revival re-checks).
  select string_agg(distinct c.name, ', ' order by c.name) into v_clash
  from public.bookings b
  join public.courts c on c.id = b.court_id
  where b.court_id = any (v_courts)
    and b.during && v_during
    and b.status in ('pending_payment', 'payment_submitted', 'confirmed')
    and not (b.status = 'pending_payment' and b.expires_at <= now());
  if v_clash is not null then
    raise exception 'There are bookings on % at that time. Cancel or move them first.', v_clash
      using errcode = 'P0001', hint = 'slot_unavailable';
  end if;

  if v_id is null then
    insert into public.open_play_sessions (venue_id, title, details, links, starts_at, ends_at)
    values (p_venue, v_title, v_details, v_links, p_start, p_end)
    returning id into v_id;
  else
    update public.open_play_sessions
    set title = v_title, details = v_details, links = v_links, starts_at = p_start, ends_at = p_end, updated_at = now()
    where id = v_id;
    delete from public.open_play_courts where session_id = v_id;
  end if;

  begin
    insert into public.open_play_courts (session_id, court_id, during)
    select v_id, x, v_during from unnest(v_courts) x;
  exception when exclusion_violation then
    raise exception 'Another open play session already uses one of those courts at that time.'
      using errcode = 'P0001', hint = 'session_overlap';
  end;

  return v_id;
end;
$function$;


create or replace function public.get_earnings(p_from date, p_to date, p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue      uuid;
  v_tz         text;
  v_days       integer;
  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_result     jsonb;
begin
  v_venue := private.admin_venue(p_venue_id);
  v_tz := private.venue_tz(v_venue);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from >= 366 then
    raise exception 'Choose a start and end date, up to 366 days apart.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  v_days := p_to - p_from + 1;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;
  v_prev_start := (p_from - v_days)::timestamp at time zone v_tz;

  with
  -- Approved payments in this period and the one just before it.
  paid as (
    select p.method, p.paid_with, p.amount, p.reviewed_at, (p.reviewed_at at time zone v_tz)::date as day
    from public.payments p
    where p.venue_id = v_venue and p.review_status = 'approved' and p.reviewed_at >= v_prev_start and p.reviewed_at < v_end
  ),
  cur as (select * from paid where reviewed_at >= v_start),
  prev as (select * from paid where reviewed_at < v_start),
  -- Plotline fees (T11.12): a booking's fee counts once, when its first payment was approved, unless the venue
  -- cancelled it (SAAS-PLAN §5). Player cancellations keep their fee.
  fee_bookings as (
    select b.booking_fee, min(p.reviewed_at) as paid_at
    from public.bookings b
    join public.payments p on p.booking_id = b.id and p.review_status = 'approved'
    where b.venue_id = v_venue and b.booking_fee > 0 and not b.cancelled_by_venue
    group by b.id, b.booking_fee
  ),
  dates as (
    select d::date as day from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as d
  ),
  courts as (
    select c.id, c.name, c.sport, c.sort_order,
           array_position((select vs.sport_order from public.venue_settings vs where vs.venue_id = v_venue), c.sport) as sport_pos
    from public.courts c
    where c.is_active and c.venue_id = v_venue
  ),
  -- One row per active court and open operating day, with that day's hours in each category.
  hours as (
    select
      c.id as court_id,
      od.day,
      extract(epoch from upper(od.r) - lower(od.r)) / 3600 as open_h,
      coalesce((
        select sum(extract(epoch from upper(x) - lower(x))) / 3600
        from unnest((
          select range_agg(tstzrange(bo.starts_at, bo.ends_at) * od.r)
          from public.blackouts bo
          where bo.venue_id = v_venue and (bo.court_id is null or bo.court_id = c.id) and tstzrange(bo.starts_at, bo.ends_at) && od.r
        )) as x
      ), 0) as blackout_h,
      coalesce((
        select sum(extract(epoch from upper(b.during * od.r) - lower(b.during * od.r))) / 3600
        from public.bookings b
        where b.court_id = c.id and b.status = 'confirmed' and b.during && od.r
      ), 0) as sold_h,
      coalesce((
        select sum(extract(epoch from upper(oc.during * od.r) - lower(oc.during * od.r))) / 3600
        from public.open_play_courts oc
        where oc.court_id = c.id and oc.during && od.r
      ), 0) as open_play_h
    from courts c
    cross join dates dt
    cross join lateral (select dt.day, ep as r from private.effective_open_periods(v_venue, c.id, dt.day) ep) od
  ),
  per_court as (
    select c.id, c.name, c.sport, c.sort_order, c.sport_pos,
           coalesce(sum(h.open_h), 0) as open_h,
           coalesce(sum(h.blackout_h), 0) as blackout_h,
           coalesce(sum(h.sold_h), 0) as sold_h,
           coalesce(sum(h.open_play_h), 0) as open_play_h
    from courts c
    left join hours h on h.court_id = c.id
    group by c.id, c.name, c.sport, c.sort_order, c.sport_pos
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'timezone', v_tz,
    'collected', (
      select jsonb_build_object(
        'total', coalesce(sum(m.amount), 0),
        'count', coalesce(sum(m.n), 0),
        'by_method', coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'paid_with', m.paid_with, 'amount', m.amount, 'count', m.n) order by m.method, m.paid_with), '[]'::jsonb))
      from (select method, paid_with, sum(amount) as amount, count(*) as n from cur group by method, paid_with) m
    ),
    'previous', (
      select jsonb_build_object(
        'from', p_from - v_days,
        'to', p_from - 1,
        'total', coalesce(sum(m.amount), 0),
        'count', coalesce(sum(m.n), 0),
        'by_method', coalesce(jsonb_agg(jsonb_build_object('method', m.method, 'paid_with', m.paid_with, 'amount', m.amount, 'count', m.n) order by m.method, m.paid_with), '[]'::jsonb))
      from (select method, paid_with, sum(amount) as amount, count(*) as n from prev group by method, paid_with) m
    ),
    'refunds_due', (
      select jsonb_build_object('count', count(*), 'total', coalesce(sum(p.amount), 0))
      from public.payments p
      where p.venue_id = v_venue and p.method = 'paymongo' and p.review_status = 'rejected' and p.reviewed_at >= v_start and p.reviewed_at < v_end
    ),
    'daily', (
      select jsonb_agg(jsonb_build_object(
        'date', dt.day,
        'collected', coalesce((select sum(cur.amount) from cur where cur.day = dt.day), 0),
        'sold_hours', round(coalesce((select sum(h.sold_h) from hours h where h.day = dt.day), 0), 2)
      ) order by dt.day)
      from dates dt
    ),
    'courts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'court_id', pc.id, 'name', pc.name, 'sport', pc.sport,
        'open_hours', round(pc.open_h, 2), 'blackout_hours', round(pc.blackout_h, 2),
        'sold_hours', round(pc.sold_h, 2), 'open_play_hours', round(pc.open_play_h, 2)
      ) order by pc.sport_pos, pc.sort_order, pc.name), '[]'::jsonb)
      from per_court pc
    ),
    'sports', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'sport', s.sport,
        'open_hours', round(s.open_h, 2), 'blackout_hours', round(s.blackout_h, 2),
        'sold_hours', round(s.sold_h, 2), 'open_play_hours', round(s.open_play_h, 2)
      ) order by s.sport_pos), '[]'::jsonb)
      from (
        select pc.sport, min(pc.sport_pos) as sport_pos, sum(pc.open_h) as open_h, sum(pc.blackout_h) as blackout_h,
               sum(pc.sold_h) as sold_h, sum(pc.open_play_h) as open_play_h
        from per_court pc
        group by pc.sport
      ) s
    ),
    'split', (
      select jsonb_build_object(
        'total_revenue', s.cur_revenue,
        'plotline_fees', s.cur_fees,
        'owner_earnings', s.cur_revenue - s.cur_fees,
        'previous', jsonb_build_object(
          'total_revenue', s.prev_revenue,
          'plotline_fees', s.prev_fees,
          'owner_earnings', s.prev_revenue - s.prev_fees))
      from (
        select
          (select coalesce(sum(cur.amount), 0) from cur) as cur_revenue,
          (select coalesce(sum(f.booking_fee), 0) from fee_bookings f where f.paid_at >= v_start and f.paid_at < v_end) as cur_fees,
          (select coalesce(sum(prev.amount), 0) from prev) as prev_revenue,
          (select coalesce(sum(f.booking_fee), 0) from fee_bookings f where f.paid_at >= v_prev_start and f.paid_at < v_start) as prev_fees
      ) s
    ),
    'coming_up', (
      select jsonb_build_object('count', count(*), 'value', coalesce(sum(b.total_amount), 0))
      from public.bookings b
      where b.venue_id = v_venue and b.status = 'confirmed' and lower(b.during) > now()
    )
  )
  into v_result;

  return v_result;
end;
$function$;

create or replace function public.venue_setup_status(p_venue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_courts boolean;
  v_rates boolean;
  v_hours boolean;
  v_payment_account boolean;
  v_payment_instructions boolean;
  v_photos boolean;
  v_items jsonb;
begin
  if not (select private.is_venue_admin(p_venue_id)) then
    raise exception 'Only this venue''s admins can read its setup.' using errcode = 'P0001', hint = 'not_venue_admin';
  end if;

  select exists (select 1 from public.courts where venue_id = p_venue_id and is_active) into v_courts;
  select v_courts and not exists (
    select 1 from public.courts where venue_id = p_venue_id and is_active and default_hourly_rate <= 0
  ) into v_rates;
  select case when coalesce((select schedule_v2_active from public.venue_schedule_state where venue_id = p_venue_id), false)
    then exists (select 1 from public.courts c cross join generate_series(0, 6) d
      cross join lateral private.effective_open_periods(p_venue_id, c.id, current_date + d) ep
      where c.venue_id = p_venue_id and c.is_active)
    else exists (select 1 from public.operating_hours where venue_id = p_venue_id and not is_closed) end into v_hours;
  select exists (
    select 1 from public.venue_payment_accounts where venue_id = p_venue_id and btrim(account_number) <> ''
  ) into v_payment_account;
  select exists (
    select 1 from public.venue_settings where venue_id = p_venue_id and btrim(payment_instructions) <> ''
  ) into v_payment_instructions;
  select exists (select 1 from public.court_photos where venue_id = p_venue_id) into v_photos;

  v_items := jsonb_build_array(
    jsonb_build_object('key', 'courts', 'label', 'Add at least one active court', 'required', true, 'done', v_courts),
    jsonb_build_object('key', 'rates', 'label', 'Set a rate above zero on every active court', 'required', true, 'done', v_rates),
    jsonb_build_object('key', 'hours', 'label', 'Open on at least one day', 'required', true, 'done', v_hours),
    jsonb_build_object('key', 'payment', 'label', 'Add a payment account with an account number', 'required', true, 'done', v_payment_account),
    jsonb_build_object('key', 'payment_instructions', 'label', 'Add payment instructions', 'required', true, 'done', v_payment_instructions),
    jsonb_build_object('key', 'photos', 'label', 'Add court photos', 'required', false, 'done', v_photos)
  );

  return jsonb_build_object(
    'items', v_items,
    'ready', v_courts and v_rates and v_hours and v_payment_account and v_payment_instructions
  );
end;
$$;

