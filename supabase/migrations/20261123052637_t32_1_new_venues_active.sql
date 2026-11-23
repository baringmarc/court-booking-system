-- T32.1: new venues start on schedule v2 (TASKS T32.1; SPEC §10 2026-11-23).
-- Every hosted venue was activated on 2026-11-23; from here on a new venue's first row is active, so the owner's
-- Weekly Hours & Rates edits reach players without a manual activation. Existing rows keep their flag.
-- create_venue still inserts the default operating_hours (as the definer, so operating_hours_v2_guard lets it through)
-- and operating_hours_expand_insert mirrors them into venue_open_periods.

alter table public.venue_schedule_state alter column schedule_v2_active set default true;

create or replace function private.initialize_venue_schedule_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.venue_schedule_state (venue_id, schedule_v2_active) values (new.id, true)
    on conflict (venue_id) do nothing;
  return new;
end $$;
revoke all on function private.initialize_venue_schedule_state() from public, anon, authenticated;

comment on table public.venue_schedule_state is 'Schedule v2 revision and server-controlled activation; new venues start active (T32.1).';
