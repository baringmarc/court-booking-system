-- T29.4: live stacks (SPEC §6, §10 2026-11-18/19; PLATFORM.md §4 "Live stacks"; RESEARCH "Milestone 29").
--   * public.live_stacks: RLS on and NO table grants to anon or authenticated. Every read and write goes through the
--     security definer RPCs below, so stacks can't be listed or enumerated; only a known code reads. An explicit
--     deny-all policy keeps the repo rule (a policy on every table), as for guest_link_tokens.
--   * The publish secret is returned once and stored only as a sha256 hex hash.
--   * publish_live_stack broadcasts {version, snapshot, ended} as event 'snapshot' on the PUBLIC channel
--     live-stack:<code> with realtime.send(..., false), inside the publishing transaction; a failed send never fails
--     the publish (the snapshot is stored and viewers' 15 s polling still sees it).
--   * Hourly pg_cron job purge-live-stacks deletes stacks 24 hours after their last change.
--   * A venue's stack cascades with the venue; it is not history. A venue stack always belongs to an open play
--     session, which already blocks delete_unused_venue, so venue_deletion_preview / delete_unused_venue are unchanged.

create table public.live_stacks (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[A-Za-z0-9_-]{22,}$'),
  secret_hash          text not null,  -- sha256 hex of the secret (private.live_stack_secret_hash)
  venue_id             uuid references public.venues (id) on delete cascade,
  open_play_session_id uuid references public.open_play_sessions (id) on delete set null,
  title                text check (title is null or char_length(title) <= 60),
  courts               integer not null check (courts between 1 and 12),
  snapshot             jsonb,
  version              integer not null default 0,
  publish_count        integer not null default 0,
  ended_at             timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  expires_at           timestamptz not null default (now() + interval '24 hours')
);

create index live_stacks_expires_at_idx on public.live_stacks (expires_at);
create index live_stacks_venue_id_idx on public.live_stacks (venue_id);
create index live_stacks_session_idx on public.live_stacks (open_play_session_id);

alter table public.live_stacks enable row level security;
revoke all on table public.live_stacks from public, anon, authenticated;
create policy "No client access to live stacks"
  on public.live_stacks for all
  to anon, authenticated
  using (false) with check (false);

-- ---------------------------------------------------------------- helpers
create function private.live_stack_token(p_bytes integer)
returns text
language sql
volatile
set search_path = ''
as $$
  select rtrim(translate(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/', '-_'), '=');
$$;
revoke all on function private.live_stack_token(integer) from public, anon, authenticated;

create function private.live_stack_secret_hash(p_secret text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex');
$$;
revoke all on function private.live_stack_secret_hash(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- create (service role / venue RPC)
create function private.create_live_stack(p_title text, p_courts integer, p_venue_id uuid, p_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_title  text := nullif(btrim(coalesce(p_title, '')), '');
  v_code   text;
  v_secret text;
begin
  if p_courts is null or p_courts not between 1 and 12 or char_length(coalesce(v_title, '')) > 60 then
    raise exception 'A live stack needs 1 to 12 courts and a title of up to 60 characters.'
      using errcode = 'P0001', hint = 'invalid_input';
  end if;

  -- Serialize creations so the cap can't be overshot by concurrent callers.
  perform pg_advisory_xact_lock(hashtext('public.live_stacks:cap'));
  if (select count(*) from public.live_stacks where expires_at > now()) >= 300 then
    raise exception 'Too many live stacks right now. Try again later.' using errcode = 'P0001', hint = 'busy';
  end if;

  v_code := private.live_stack_token(16);    -- 128 bits, 22 URL-safe characters
  v_secret := private.live_stack_token(32);  -- 256 bits
  insert into public.live_stacks (code, secret_hash, venue_id, open_play_session_id, title, courts)
  values (v_code, private.live_stack_secret_hash(v_secret), p_venue_id, p_session_id, v_title, p_courts);

  return jsonb_build_object('code', v_code, 'secret', v_secret);
end;
$$;
revoke all on function private.create_live_stack(text, integer, uuid, uuid) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.create_live_stack(text, integer, uuid, uuid) to service_role;

create function public.create_venue_live_stack(p_open_play_session_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_session public.open_play_sessions%rowtype;
  v_courts  integer;
  v_stack   public.live_stacks%rowtype;
  v_secret  text;
begin
  select * into v_session from public.open_play_sessions where id = p_open_play_session_id for update;
  if not found then
    -- Someone who administers no venue learns nothing about which session ids exist.
    if not private.is_platform_admin()
       and not exists (select 1 from public.venue_members where user_id = (select auth.uid())) then
      raise exception 'Only venue staff can run a live stack.' using errcode = 'P0001', hint = 'forbidden';
    end if;
    raise exception 'That open play session doesn''t exist.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if not private.is_venue_admin(v_session.venue_id) then
    raise exception 'Only venue staff can run a live stack.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if v_session.ends_at <= now() then
    raise exception 'That open play session has ended.' using errcode = 'P0001', hint = 'session_ended';
  end if;

  -- Same session again: keep the code, rotate the secret (the newest device takes over).
  select * into v_stack
    from public.live_stacks
   where open_play_session_id = v_session.id and expires_at > now() and ended_at is null
   order by created_at desc
   limit 1
   for update;
  if found then
    v_secret := private.live_stack_token(32);
    update public.live_stacks set secret_hash = private.live_stack_secret_hash(v_secret) where id = v_stack.id;
    return jsonb_build_object('code', v_stack.code, 'secret', v_secret);
  end if;

  select least(12, greatest(1, count(*)))::integer into v_courts
    from public.open_play_courts where session_id = v_session.id;

  return private.create_live_stack(left(btrim(v_session.title), 60), v_courts, v_session.venue_id, v_session.id);
end;
$$;
revoke all on function public.create_venue_live_stack(uuid) from public, anon, authenticated;
grant execute on function public.create_venue_live_stack(uuid) to authenticated;

-- ---------------------------------------------------------------- read
create function public.get_live_stack(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
           'title', s.title,
           'courts', s.courts,
           'snapshot', s.snapshot,
           'version', s.version,
           'ended', s.ended_at is not null,
           'expires_at', s.expires_at,
           'venue', case when v.id is null then null
                         else jsonb_build_object('name', vs.name, 'slug', v.slug, 'logo_path', vs.logo_path) end)
    into v_result
    from public.live_stacks s
    left join public.venues v on v.id = s.venue_id
    left join public.venue_settings vs on vs.venue_id = s.venue_id
   where s.code = p_code and s.expires_at > now();
  if v_result is null then
    raise exception 'This stack has ended.' using errcode = 'P0001', hint = 'not_found';
  end if;
  return v_result;
end;
$$;
revoke all on function public.get_live_stack(text) from public, anon, authenticated;
grant execute on function public.get_live_stack(text) to anon, authenticated;

-- ---------------------------------------------------------------- publish
create function public.publish_live_stack(
  p_code text, p_secret text, p_version integer, p_snapshot jsonb, p_end boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_stack public.live_stacks%rowtype;
  v_now   timestamptz := clock_timestamp();
  v_v     jsonb;
  v_ended boolean := coalesce(p_end, false);
begin
  select * into v_stack from public.live_stacks where code = p_code and expires_at > now() for update;
  if not found then
    raise exception 'This stack has ended.' using errcode = 'P0001', hint = 'not_found';
  end if;
  if v_stack.secret_hash <> private.live_stack_secret_hash(p_secret) then
    raise exception 'This device can''t update the stack.' using errcode = 'P0001', hint = 'forbidden';
  end if;
  if v_stack.ended_at is not null then
    raise exception 'This stack has ended.' using errcode = 'P0001', hint = 'ended';
  end if;
  if p_version is null or p_version <= v_stack.version then
    raise exception 'A newer update is already live.' using errcode = 'P0001', hint = 'stale_version';
  end if;
  -- The first publish is never too fast; later ones need 1 s since the last (the organizer's client uses 2 s).
  if v_stack.publish_count > 0 and v_now < v_stack.updated_at + interval '1 second' then
    raise exception 'Updates are too frequent.' using errcode = 'P0001', hint = 'too_fast';
  end if;
  if octet_length(coalesce(p_snapshot::text, '')) > 65536 then
    raise exception 'The stack is too large to share.' using errcode = 'P0001', hint = 'too_large';
  end if;
  v_v := case when jsonb_typeof(p_snapshot) = 'object' then p_snapshot -> 'v' end;
  if v_v is null or jsonb_typeof(v_v) <> 'number' or (v_v #>> '{}')::numeric <> trunc((v_v #>> '{}')::numeric) then
    raise exception 'The stack update is not valid.' using errcode = 'P0001', hint = 'invalid_snapshot';
  end if;
  if v_stack.publish_count >= 5000 then
    raise exception 'This stack has reached its update limit.' using errcode = 'P0001', hint = 'limit_reached';
  end if;

  update public.live_stacks
     set snapshot = p_snapshot,
         version = p_version,
         publish_count = publish_count + 1,
         updated_at = v_now,
         expires_at = v_now + interval '24 hours',
         ended_at = case when v_ended then v_now end
   where id = v_stack.id;

  begin
    perform realtime.send(
      jsonb_build_object('version', p_version, 'snapshot', p_snapshot, 'ended', v_ended),
      'snapshot',
      'live-stack:' || v_stack.code,
      false
    );
  exception when others then
    null;  -- e.g. no realtime.messages partition for today: the stored snapshot still serves polling viewers
  end;

  return jsonb_build_object('version', p_version, 'expires_at', v_now + interval '24 hours');
end;
$$;
revoke all on function public.publish_live_stack(text, text, integer, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.publish_live_stack(text, text, integer, jsonb, boolean) to anon, authenticated;

-- ---------------------------------------------------------------- purge
create function private.purge_live_stacks()
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.live_stacks where expires_at <= now();
$$;
revoke all on function private.purge_live_stacks() from public, anon, authenticated;

select cron.schedule('purge-live-stacks', '0 * * * *', 'select private.purge_live_stacks()');
