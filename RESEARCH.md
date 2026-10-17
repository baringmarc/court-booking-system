# RESEARCH.md

Technical findings gathered **before** a milestone is built. [SPEC.md](SPEC.md) is the source of truth for behavior. Once a recommendation here is accepted, it moves into SPEC §10 (decisions log), and the entry here is marked `Decided`.

## How to write an entry

```md
### <Topic>
- **Status:** Open | Researched | Decided (SPEC §10, <date>)
- **Question:** what we need to know to build the task
- **Findings:** facts, each with a source (docs URL, the installed skill under .agents/skills, or an experiment run against the linked DB)
- **Gotchas:** traps to avoid
- **Recommendation:** what to do and why, in 1–3 lines
```

Rules:
- Check the installed skills (`.agents/skills/supabase`, `.agents/skills/supabase-postgres-best-practices`) first, then the official docs.
- When you claim that something "works in our setup", include the SQL or command you ran to check it.
- Keep entries short. Link to sources rather than copying them.

---

## Milestone 3: Booking

### Exclusion constraint for overlapping bookings
- **Status:** Open
- **Question:** What is the exact DDL for `EXCLUDE USING gist (court_id WITH =, during WITH &&) WHERE (status in active)`? Does `btree_gist` need to be in the `extensions` schema on Supabase, and how does that affect the operator class? What SQLSTATE does a violation raise (`23P01`)?
- **Findings:**
- **Gotchas:**
- **Recommendation:**

### Slot math in the venue timezone
- **Status:** Open
- **Question:** How do we build a day's slots in SQL from `operating_hours` plus a venue-local date? Use `(date + time) at time zone tz` and `generate_series` over timestamptz. How do we get day of week and hour for pricing in `Asia/Manila`? How do we check that a `tstzrange` lines up with slot boundaries and stays inside one venue day? What about a `close_time` of `24:00`?
- **Findings:**
- **Gotchas:**
- **Recommendation:**

### Reference code generation
- **Status:** Open
- **Question:** How do we generate `CB-XXXXXX` codes (unambiguous alphabet, no 0/O/1/I) with a unique constraint and a retry when two codes collide? What's the collision probability at our scale?
- **Findings:**
- **Gotchas:**
- **Recommendation:**

### Guest access tokens
- **Status:** Open
- **Question:** Should the token come from `gen_random_bytes` (pgcrypto) or `gen_random_uuid`? Hash it with sha256 via `extensions.digest`, or with `pgcrypto crypt`? Do we need a constant-time comparison? How do we return the token once without logging it?
- **Findings:**
- **Gotchas:**
- **Recommendation:**

### RPC conventions (security definer, errors, grants)
- **Status:** Open
- **Question:** Which RPCs need `security definer`, given that writes bypass RLS on purpose? How do we raise errors the client can show (custom SQLSTATE or error codes in `hint`/`detail`) and map them in `api.ts`? What grants do `anon` and `authenticated` need, and how do we revoke `public` execute by default?
- **Findings:**
- **Gotchas:**
- **Recommendation:**

### Testing database logic
- **Status:** Decided (2026-10-17, harness setup H1b)
- **Question:** How do we verify the RPCs and constraints repeatably, as part of `npm run verify`?
- **Findings:**
  - `supabase db start` runs only Postgres 17 locally and applies migrations and `seed.sql`. `supabase test db` runs `supabase/tests/**/*.sql` through the `pg_prove` container. Both checked on 2026-10-17: 3 files, 26 tests, roughly 1 second after the containers are warm.
  - You can act as a user inside a test with `set local role authenticated|anon` plus `select set_config('request.jwt.claims', '{"sub": "<uuid>", "role": "authenticated"}', true)`. `auth.uid()` and RLS then behave as they do for that user.
  - Test users can be created with `insert into auth.users (id, email, raw_user_meta_data)`. The profile trigger fires as it does in production.
- **Gotchas:**
  - Docker Desktop adds its CLI to PATH only in `~/.zprofile` and uses a per-user socket (`~/.docker/run/docker.sock`). Non-login shells and hooks need `scripts/with-docker.sh`.
  - The local database doesn't pick up a new migration until `supabase migration up --local` is run (`scripts/test-db.sh` does this).
  - `is_empty()` can't wrap `UPDATE … RETURNING`. Use `lives_ok` and then check the row afterwards.
  - When RLS filters an update, nothing is updated and no error is raised. A `with check` failure on insert raises `42501`.
- **Recommendation:** Use pgTAP against the local database for every migration. Never run tests against the linked project.

### Concurrency of `create_booking`
- **Status:** Open
- **Question:** Is the exclusion constraint enough on its own to guarantee one winner under concurrent inserts at the default `read committed` isolation? Do we need advisory locks? How do we reproduce a race to test it?
- **Findings:**
- **Gotchas:**
- **Recommendation:**
