-- T11.5a: drag-to-reorder saves a whole new order at once. Courts (within a sport) and info sections only had
-- move-by-one RPCs (move_court, move_info_section); these set the full order, like reorder_court_photos.
-- Expand only: the move_* functions stay until the contract migration (T11.15).

-- ---------------------------------------------------------------------------
-- 1. reorder_courts: the sport's courts in this order (archived ones included, as the admin list shows them).
-- ---------------------------------------------------------------------------
create function public.reorder_courts(p_sport public.sport, p_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can reorder courts.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_sport is null or p_ids is null then
    raise exception 'Choose a sport and its courts.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Lock the sport's courts (the order move_court takes) so two admins reordering at once can't interleave.
  perform 1 from public.courts c where c.sport = p_sport order by c.id for update;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(c.id order by c.id) from public.courts c where c.sport = p_sport)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The court list is out of date. Reload the page and try again.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.courts c
  set sort_order = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where c.id = o.id and c.sort_order is distinct from o.ord - 1;
end;
$$;
revoke all on function public.reorder_courts(public.sport, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_courts(public.sport, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. reorder_info_sections: every info section in this order.
-- ---------------------------------------------------------------------------
create function public.reorder_info_sections(p_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'Only staff can reorder info sections.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if p_ids is null then
    raise exception 'Choose the sections.' using errcode = 'P0001', hint = 'invalid_input';
  end if;

  perform 1 from public.venue_info_sections s order by s.id for update;
  if cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or (select array_agg(s.id order by s.id) from public.venue_info_sections s)
        is distinct from (select array_agg(x order by x) from unnest(p_ids) x) then
    raise exception 'The section list is out of date. Reload the page and try again.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  update public.venue_info_sections s
  set sort_order = o.ord - 1
  from unnest(p_ids) with ordinality as o(id, ord)
  where s.id = o.id and s.sort_order is distinct from o.ord - 1;
end;
$$;
revoke all on function public.reorder_info_sections(uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_info_sections(uuid[]) to authenticated;
