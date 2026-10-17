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
- **Status:** Decided (SPEC §10, 2026-10-17)
- **Question:** What's the exact DDL for the overlap rule? Where should `btree_gist` live on Supabase, and does that affect the operator class? Which SQLSTATE does a violation raise?
- **Findings:**
  - `btree_gist` 1.7 is available but not installed. Created it with `create extension if not exists btree_gist with schema extensions;`. With `search_path = ''`, `exclude using gist (court_id with =, during with &&) where (status in ('pending_payment','payment_submitted','confirmed'))` still finds the default uuid gist opclass. The index definition is `USING gist (court_id, during) WHERE (status = ANY (ARRAY[...]))`. *(Local experiment, 2026-10-17.)*
  - Default `[)` ranges: adjacent bookings (10–12 and 12–13) don't conflict. A booking on another court, or a `cancelled` row, overlapping the same time is allowed. An overlapping active booking fails with **SQLSTATE `23P01`** (`exclusion_violation`) and `CONSTRAINT NAME` set to the constraint. *(Local experiment.)*
  - The violation's `DETAIL` contains the conflicting key: the court UUID and both ranges. It has no personal data, but it isn't a friendly message either.
  - Exclusion constraints and partial predicates: [Postgres docs, CREATE TABLE … EXCLUDE](https://www.postgresql.org/docs/current/sql-createtable.html#SQL-CREATETABLE-EXCLUDE). btree_gist: [Postgres docs](https://www.postgresql.org/docs/current/btree-gist.html).
- **Gotchas:**
  - **A `pending_payment` row whose `expires_at` has passed still blocks the slot until its status changes.** The predicate can't use `now()` because it must be immutable. Tested locally: the insert fails with `23P01` until the stale row is set to `expired`, then succeeds. Lazy expiry in `get_availability` alone would show a slot as free that `create_booking` then rejects.
  - Add `check (not isempty(during) and lower_inc(during) and not upper_inc(during))` so every range is a proper `[)` range.
- **Recommendation:**
  - Install `btree_gist` in `extensions`.
  - Name the constraint `bookings_no_overlap` and filter it to active statuses.
  - In `create_booking`, set overlapping stale holds on the same court to `expired` (`status = 'pending_payment' and expires_at <= now() and during && new_range`) before inserting.
  - Catch `23P01` and re-raise it as a readable `slot_unavailable` error.

### Slot math in the venue timezone
- **Status:** Decided (SPEC §10, 2026-10-17)
- **Question:** How do we build a day's slots in SQL from `operating_hours` and a venue-local date? How do we get day of week and hour for pricing in the venue timezone? How do we check slot alignment and that a booking stays within one day? What happens with a `close_time` of `24:00`?
- **Findings:** *(Local experiments, session TimeZone = `UTC`, which is the Supabase default.)*
  - Wall clock to instant: `(date '2026-10-17' + time '06:00') at time zone 'Asia/Manila'` gives `2026-10-16 22:00+00`.
  - `close_time = '24:00'` works: `date + time '24:00'` is the next midnight, which gives `2026-10-17 16:00+00`.
  - Day of week and hour must be computed in the venue zone. A 07:00 Manila slot on Saturday 2026-10-17 is `2026-10-16 23:00+00`. `extract(dow from s at time zone 'Asia/Manila')` gives 6 (Saturday) and `hour` gives 7. Without the conversion, `extract(dow from s)` gives **5** (Friday), which would apply weekday prices to weekend slots.
  - Alignment: `date_trunc('hour', ts at time zone tz) = ts at time zone tz` must hold for both bounds. A 10:30–11:30 range fails.
  - Same day: `(lower at time zone tz)::date = ((upper - interval '1 microsecond') at time zone tz)::date`. This correctly rejects 21:00 to 01:00 the next day and accepts a booking that ends exactly at midnight.
  - Slot rows: `generate_series(open_ts, close_ts - interval '1 hour', interval '1 hour')` over `timestamptz`.
- **Gotchas:**
  - Never rely on the session `TimeZone`. Always write `at time zone <venue tz>`, reading the zone from `venue_settings.timezone` rather than hardcoding it.
  - `extract()` returns `numeric`. Cast it to `smallint` before comparing with `court_rates.day_of_week` and `start_hour`.
  - Asia/Manila has no DST. With a DST zone, a one-hour `generate_series` step would still be right in UTC but could skip or repeat wall-clock hours. Out of scope for v1.
- **Recommendation:** Add three `private` SQL helpers, all `stable`, all reading the timezone from `venue_settings`, and use them in every RPC and test:
  - `private.venue_tz()`
  - `private.local_day_bounds(date) returns tstzrange`: the venue-local day from midnight to midnight, `[d 00:00, d+1 00:00)`. Operating hours are applied separately from `operating_hours`.
  - `private.local_dow_hour(timestamptz) returns (dow smallint, hour smallint)`

### Reference code generation
- **Status:** Decided (SPEC §10, 2026-10-17)
- **Question:** How do we generate `CB-XXXXXX` codes with an unambiguous alphabet, a unique constraint and a retry on collision? What's the collision probability?
- **Findings:**
  - Alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` has 32 characters, without 0, O, 1 or I. Taking `get_byte(extensions.gen_random_bytes(6), i) % 32` is unbiased because 256 is a multiple of 32. A sample generated locally: `CB-WEKQ82`.
  - The space is 32^6 ≈ 1.07 × 10^9. With N existing bookings, the chance that a new code collides is N / 1.07e9. That's about 1e-5 at 10k bookings and 1e-4 at 100k.
  - `pgcrypto` is already installed in `extensions` (`gen_random_bytes`). *(Local check.)*
- **Gotchas:**
  - Don't use `random()`. It isn't cryptographically secure, and codes appear in URLs.
  - The reference code alone must never grant access, because the guest token is the secret. Collisions only matter for uniqueness.
- **Recommendation:**
  - Use `private.new_reference_code()` with the alphabet above and `unique (reference_code)`.
  - In `create_booking`, insert inside a loop with up to 5 attempts. Catch `unique_violation` only when the constraint is `bookings_reference_code_key`, checked with `get stacked diagnostics … constraint_name`. Re-raise any other error.

### Guest access tokens
- **Status:** Decided (SPEC §10, 2026-10-17)
- **Question:** How should the token be generated and hashed? Do we need a constant-time comparison? How do we return it exactly once?
- **Findings:**
  - Token: `rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=')` produces 43 characters, URL-safe, with 256 bits of entropy. *(Local check.)*
  - Hash: the core `sha256(bytea)` function (Postgres 11+) needs no extension. Store `sha256(convert_to(token, 'UTF8'))` as `bytea`. [Postgres docs: binary string functions](https://www.postgresql.org/docs/current/functions-binarystring.html).
  - A fast hash is enough here. Slow, salted KDFs (bcrypt, `crypt()`) exist to protect low-entropy passwords against brute force, and a 256-bit random token can't be brute-forced. [OWASP Password Storage cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) scopes KDFs to passwords.
  - Lookup: `where reference_code = $1 and guest_token_hash = sha256(convert_to($2, 'UTF8'))`. The query compares hashes of the attacker's input, not the secret itself, so timing reveals nothing useful and no constant-time comparison is needed.
  - `supabase.rpc()` sends arguments in the POST body, which keeps the token out of the RPC's URL. The `/booking/:ref?token=` page URL does carry it. Browsers default to `Referrer-Policy: strict-origin-when-cross-origin`, which strips the path and query from cross-origin `Referer` headers ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Referrer-Policy)).
- **Gotchas:**
  - The token must never be written to a table, a `raise notice` or a log line. Return it only from `create_booking`.
  - A wrong token and an unknown reference code must give the same response (SPEC T3.6).
- **Recommendation:**
  - Add `guest_token_hash bytea`, set only for guest bookings.
  - Add `<meta name="referrer" content="no-referrer">` to `index.html` as defense in depth. That's a T3.10 UI concern.
  - Keep `?token=` as SPEC specifies.

### RPC conventions (security definer, errors, grants)
- **Status:** Decided (SPEC §10, 2026-10-17)
- **Question:** Which RPCs need `security definer`? How do we raise errors the client can show? Which grants are needed?
- **Findings:**
  - **On Supabase, a new function in `public` is executable by `anon`, `authenticated` and `service_role` by default (default privileges).** `revoke execute … from public` leaves `anon` and `authenticated` with `execute = t`. Only `revoke … from anon, authenticated` removes it. *(Local experiment on `public.zz_probe()`, 2026-10-17.)* The supabase skill warns about the same thing: "SECURITY DEFINER functions in public are callable by all roles".
  - Existing M1 functions: `private.is_admin()` is executable by both roles on purpose. `private.set_updated_at()` is also executable by both, but harmlessly, because Postgres refuses to call a trigger function directly.
  - PostgREST error mapping ([errors reference](https://github.com/PostgREST/postgrest-docs/blob/main/docs/references/errors.rst)): `RAISE EXCEPTION` gives `P0001` and HTTP **400**, with `code`, `message`, `details` and `hint` in the body. `23505` gives 409. `42501` gives 401 for anon and 403 for authenticated. `PTxyz` sets HTTP status `xyz`. `23P01` isn't listed, so it falls into the generic 400.
  - Writes to `bookings` must bypass RLS because nobody has insert or update grants, so `create_booking`, `cancel_booking` and `review_payment` need `security definer`. `get_availability` also needs it, because it reads busy ranges from `bookings` while anon can't select from `bookings`, and it must return no personal data.
- **Gotchas:**
  - `security definer` skips RLS completely. Every check (caller identity via `auth.uid()`, admin via `private.is_admin()`, ownership, token) has to be written into the function body.
  - Set `search_path = ''` and schema-qualify every name, including `extensions.gen_random_bytes`.
  - Never take `user_id` or a price from arguments.
- **Recommendation:**
  - Public RPCs are `security definer`, `set search_path = ''`, followed by `revoke all on function … from public, anon, authenticated;` and then an explicit `grant execute … to <roles>`.
  - Business errors use `raise exception '<human message>' using errcode = 'P0001', hint = '<stable_code>'`. Codes: `slot_unavailable`, `outside_hours`, `not_aligned`, `multi_day`, `blackout`, `outside_window`, `slot_started`, `court_inactive`, `invalid_guest`, `invalid_input` (null start, `slots < 1`, unknown court), `not_found`. The client maps `error.hint` to UI copy and falls back to `error.message`.
  - pgTAP checks each code with `throws_ok(sql, 'P0001', '<message>')`.

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
- **Status:** Decided (SPEC §10, 2026-10-17)
- **Question:** At the default `read committed` isolation, is the exclusion constraint enough on its own to guarantee one winner? Do we need advisory locks?
- **Findings:** *(Local experiment with two psql sessions, 2026-10-17.)*
  - Session A inserts 10:00–12:00 and holds the transaction open for 3 seconds. Session B, starting 1 second later, inserts 11:00–13:00 on the same court. B **blocks** until A commits (A committed at `…27.3620`, B errored at `…27.3627`) and then fails with `23P01`. One row remains.
  - When A rolls back instead, B's blocked insert **succeeds**. One row remains.
  - This matches the documented behavior: an exclusion constraint check waits for conflicting uncommitted rows ([Postgres docs, Index Uniqueness Checks](https://www.postgresql.org/docs/current/index-unique-checks.html)).
- **Gotchas:**
  - The checks before the insert (operating hours, blackouts, court active) read without locks, so an admin who adds a blackout at the same moment could slip past. At this venue's scale that's acceptable, and admins can cancel.
  - Racing a stale hold: two requests can both expire the same stale row. Both `UPDATE`s are idempotent, and the exclusion constraint still picks one winner for the insert.
- **Recommendation:** No advisory locks. Rely on `bookings_no_overlap` and map `23P01` to `slot_unavailable`. pgTAP runs in a single rolled-back transaction, so a real two-session race isn't practical there (dblink exists, but its commits would escape the rollback). Test the mapping by inserting a conflicting row first. The two-session race result above is the evidence for the concurrency guarantee.

---

## Milestone 4: Payments

### Proof upload for guests (Edge Function design)
- **Status:** Decided (SPEC §10, 2026-10-17). The open point was verified locally in T4.5, see the last finding.
- **Question:** Guests have no JWT, so storage RLS can't authorize their uploads. How do guests and players upload a proof safely?
- **Findings:**
  - Edge Functions now use `withSupabase` from `npm:@supabase/server@1`, with `auth` modes `'user' | 'publishable' | 'secret' | 'none'`. An array tries each mode in order, and `ctx.authMode` says which one matched. `ctx.supabase` is scoped to the caller's JWT and `ctx.supabaseAdmin` bypasses RLS. Environment: `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` (JSON), with a single `SUPABASE_SECRET_KEY` fallback locally. `verify_jwt` defaults to true and can be turned off per function in `config.toml`. Source: [Functions auth](https://supabase.com/docs/guides/functions/auth.md).
  - Limits: 256 MB memory, 2 s CPU time, 150 s wall clock on the free plan ([limits](https://supabase.com/docs/guides/functions/limits.md)). Standard storage uploads are meant for files up to 6 MB ([standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads.md)), and our cap is 5 MB.
  - The service (secret) key bypasses storage RLS ([access control](https://supabase.com/docs/guides/storage/security/access-control.md)).
  - Deno isn't installed locally, so there's no `deno test`. `supabase start` (edge-runtime v1.77.4) serves functions at `/functions/v1/<name>`.
  - **Verified locally (T4.5, 2026-10-17), with a smoke-test script using `supabase-js` `functions.invoke`:** `export default { fetch: withSupabase({ auth: ['user', 'publishable'] }, …) }` together with `verify_jwt = false` accepts a publishable-key guest (`ctx.authMode = 'publishable'`) and a signed-in player (`'user'`, user id taken from the claims), and the wrapper answers CORS itself. The fallback isn't needed.
    - Results: guest wrong token 404 `not_found`; HTML disguised as PNG 415; valid proof 201; second proof 409 `invalid_state`; a player with only a session (no token) 201; an anonymous caller targeting a player's booking 404.
    - Storage: a player can `list` their own proof and `createSignedUrl` with only the SELECT policy, so signed URLs need SELECT. A direct upload to the bucket is refused by RLS.
- **Gotchas:**
  - The docs only show `['user', 'secret']`. **Resolved in T4.5:** `['user', 'publishable']` with `verify_jwt = false` works (see the "Verified locally" finding above). The fallback, `auth: 'none'` with manual `getClaims`, wasn't needed.
  - `req.formData()` buffers the whole body, so the function rejects a `Content-Length` over about 5.5 MB before parsing it.
  - The browser's file type can't be trusted. Check magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WEBP `RIFF....WEBP`, PDF `%PDF`), and set `allowed_mime_types` and `file_size_limit` on the bucket as a second layer.
  - PostgREST doesn't expose `private`, so the function's RPCs must live in `public` with execute granted **only to `service_role`**.
- **Recommendation:**
  - One Edge Function, `submit-payment-proof`, takes `multipart/form-data` (ref, token?, method, amount, reference number, file) and proxies the upload, so there's a single round trip and the file is checked on the server.
  - Its steps:
    1. `public.proof_target(ref, token, user_id)` (service_role only) authorizes the caller and checks the booking is `pending_payment` and not expired. It returns the `booking_id`.
    2. The function uploads to `{booking_id}/{uuid}.{ext}` with the admin client.
    3. `public.record_payment_proof(...)` (service_role only) re-checks the state, inserts the payment and sets `payment_submitted` in one transaction.
    4. If step 3 fails, the function deletes the uploaded object.
  - Testing:
    - All authorization and state rules live in SQL, tested with pgTAP.
    - File sniffing and form validation live in `supabase/functions/_shared/*.ts`, plain TypeScript with no Deno APIs, tested with Vitest (add the folder to the Vitest `include`).
    - The handler gets a smoke test with `supabase functions serve`.

### Storage bucket and read access
- **Status:** Decided (SPEC §10, 2026-10-17)
- **Question:** What bucket configuration and `storage.objects` policies do proofs need? How do admins preview proofs, and who else can read them?
- **Findings:** *(Local check.)* `storage.buckets` has `public`, `file_size_limit` and `allowed_mime_types` columns. `storage.foldername(name)` exists. RLS is on for `storage.objects`. Upload needs an INSERT policy, and upsert needs INSERT, SELECT and UPDATE ([access control](https://supabase.com/docs/guides/storage/security/access-control.md)).
- **Gotchas:** The docs don't say which policy creating a signed URL needs. **Verified in T4.5:** SELECT alone is enough (a player created a signed URL for their own proof against local Storage).
- **Recommendation:**
  - Create a private bucket `payment-proofs` in a migration: `public = false`, 5 MB limit, MIME types `image/jpeg, image/png, image/webp, application/pdf`.
  - Policies: SELECT only, for admins and for the booking owner, matching the first folder of the path, `(storage.foldername(name))[1]`, to a booking whose `user_id = auth.uid()`, compared as text so a malformed path can't raise a uuid cast error. No client INSERT, UPDATE or DELETE, because only the Edge Function writes.
  - Admins preview with `createSignedUrl` (60 s).
  - **Guests see proof metadata only** (submitted time, method, amount, review status and note), not the file. Their token can't authorize storage reads. Record this in SPEC §10.

### Expiry job (pg_cron)
- **Status:** Decided (2026-10-17)
- **Question:** How do we schedule the sweep from `pending_payment` to `expired` from a migration?
- **Findings:** *(Local experiment.)* `pg_cron` is in `shared_preload_libraries` and `create extension if not exists pg_cron with schema pg_catalog;` works, which matches the [cron install guide](https://supabase.com/docs/guides/cron/install.md). Calling `cron.schedule('zz-probe', …)` twice returned the same job id (1) and updated the schedule and command, so scheduling by name is an upsert and safe to re-run.
- **Gotchas:** Disabling the extension deletes every job ([guide](https://supabase.com/docs/guides/cron/install.md)). The job runs as the scheduling role (`postgres`), so the sweep function must not depend on `auth.uid()`.
- **Recommendation:** Add `private.expire_holds()`, which sets `status = 'expired'` where `pending_payment and expires_at <= now()` (the same rule as everywhere else) and returns the count. Schedule `cron.schedule('expire-holds', '* * * * *', 'select private.expire_holds()')`. pgTAP tests the function, and asserts that the job exists.

### Review and walk-in rules (SQL design notes)
- **Status:** Decided (2026-10-17). These come from SPEC §4 and §5.8, with no external research.
- **`review_payment(booking_id, approve, note)`** (admin only, `security definer`): it acts on the booking's single `pending` payment, and requires the booking to be `payment_submitted`.
  - Approve: the payment becomes `approved` and the booking `confirmed`.
  - Reject: requires `note`. The payment becomes `rejected` with the note, and `rejection_count + 1`. If the new count is below `max_rejections`, the booking goes back to `pending_payment` with `expires_at = now() + payment_hold_minutes`; otherwise it becomes `rejected`, which frees the slot.
  - Errors use the same `P0001` and hint convention (`not_found`, `invalid_state`, `note_required`, `forbidden`).
- **`create_walk_in(court_id, start, slots, name, phone?, method, amount, reference?)`** (admin only): the same checks as `create_booking`, except there's no booking window and the start may be **the slot currently in progress** (`start <= now() < start + 1h`). It inserts a `confirmed` booking with `source = 'walk_in'`, `created_by = auth.uid()` and an `approved` payment with `recorded_by = auth.uid()`. Move the shared validation into `private.validate_booking_slot(...)` so the two RPCs can't drift apart.
- **`payments`:** add `unique (booking_id) where review_status = 'approved'` (SPEC §6) and a partial unique index allowing only one `pending` payment per booking.
