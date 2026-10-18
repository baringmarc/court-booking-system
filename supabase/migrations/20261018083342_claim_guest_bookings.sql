-- Milestone 5: attach a player's earlier guest bookings to their account (SPEC §5.7,
-- RESEARCH "Claiming guest bookings" and "DB plan for T5.3–T5.5", item 2).
-- Only the caller's confirmed email from auth.users is trusted, never client input. "Confirm email"
-- must be on (it is, locally and on the hosted project): with it off, Supabase confirms every email.
-- Only bookings made as a guest (guest_token_hash set) with no user_id are claimed, so a booking that
-- already belongs to an account, a walk-in, or a deleted player's old booking is never moved.

create index bookings_unclaimed_email_idx on public.bookings (guest_email)
  where user_id is null and guest_token_hash is not null;

create function public.claim_guest_bookings()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_count integer;
begin
  if v_uid is null then
    raise exception 'Log in to claim your bookings.' using errcode = 'P0001', hint = 'forbidden';
  end if;

  select lower(trim(u.email)) into v_email
  from auth.users u
  where u.id = v_uid and u.email_confirmed_at is not null;
  if v_email is null or v_email = '' then
    return 0;
  end if;

  update public.bookings b
  set user_id = v_uid
  where b.user_id is null
    and b.guest_token_hash is not null
    and b.source = 'online'
    and b.guest_email = v_email;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_guest_bookings() from public, anon, authenticated;
grant execute on function public.claim_guest_bookings() to authenticated;
