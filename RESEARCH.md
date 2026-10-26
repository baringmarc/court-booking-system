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

---

## Milestone 5: Accounts

### Cancellation rules
- **Status:** Decided (SPEC §10, 2026-10-17)
- **Question:** Which bookings can be cancelled, and by whom? How does the cutoff interact with the venue timezone? What happens to payments when there are no refunds?
- **Findings:**
  - The cutoff is a duration, not a wall-clock time. "Up to `cancel_cutoff_hours` before the start" is `now() <= lower(during) - make_interval(hours => cancel_cutoff_hours)` on `timestamptz` values, which is independent of timezone. `Asia/Manila` has no DST, and even in a DST zone an absolute interval is the natural reading. The venue timezone matters only when the deadline is *displayed* (`src/lib/time.ts`). *(Postgres docs: [datetime operators](https://www.postgresql.org/docs/current/functions-datetime.html).)*
  - The bookings that hold a slot are the **effectively** active ones: `pending_payment` with `expires_at > now()`, `payment_submitted` and `confirmed` (SPEC §4, §10). A stale hold is already `expired` to the user, so cancelling it should fail like any other inactive booking.
  - Setting `status = 'cancelled'` frees the slot at once, because `bookings_no_overlap` only covers active statuses (03_bookings pgTAP already proves that a cancelled row doesn't block its range).
  - `review_payment` locks the booking with `select … for update` (`20261017034431_review_payment.sql:38`). If `cancel_booking` takes the same row lock, a cancel and a review racing on one booking are serialized, and the second one sees the new status.
  - Payments when there are no refunds (a SPEC non-goal):
    - The dashboard's proof queue and the "proofs waiting" count filter on `bookings.status = 'payment_submitted'` (`src/features/admin/api.ts:113`). A pending proof on a cancelled booking therefore drops out of the queue with no change to the payment row.
    - Today's takings count approved payments by `reviewed_at` (SPEC §10). An approved payment on a booking cancelled later stays counted, which is correct: the money was received, and any refund happens outside the app.
  - Walk-ins have no `user_id` and no token, so only an admin can cancel them, with no extra rule needed.
- **Gotchas:**
  - A wrong token, an unknown id and another player's booking must all raise the same `not_found`, as `get_guest_booking` does.
  - The guest path (ref + token) must never count as admin, even if the caller happens to be a signed-in admin. Only the session path checks `private.is_admin()`.
  - Admins can cancel "any time" (SPEC §4), but cancelling a booking that has already ended would rewrite history. Limit admins to bookings that haven't ended.
- **Recommendation:** see the DB plan below. Players and guests can cancel active bookings until the cutoff, admins until the booking ends, and admins must give a reason because the player sees it. Payment rows are never touched, and the admin view shows "cancelled after payment" so staff know to settle any refund outside the app.

### Claiming guest bookings (verified email)
- **Status:** Decided (SPEC §10, 2026-10-17)
- **Question:** What counts as a verified email, how do we read it safely, and when should the claim run?
- **Findings:**
  - Supabase Auth records verification in `auth.users.email_confirmed_at`.
    - For OAuth sign-ins, `createAccountFromExternalIdentity` calls `user.Confirm()` only `if decision.CandidateEmail.Verified || config.Mailer.Autoconfirm` ([supabase/auth `internal/api/external.go`](https://github.com/supabase/auth/blob/master/internal/api/external.go)). Google reports `email_verified`, so Google users are confirmed.
    - Supabase also refuses to auto-link identities to unverified emails ([identity linking docs](https://supabase.com/docs/guides/auth/auth-identity-linking)).
  - **The "Confirm email" setting decides whether `email_confirmed_at` means anything.** The docs say turning it off "implicitly confirms the user's email in the database" ([general configuration](https://supabase.com/docs/guides/auth/general-configuration)).
    - *Local experiment (2026-10-17):* our `supabase/config.toml` has `[auth.email] enable_confirmations = false`. A `POST /auth/v1/signup` for a brand-new address returned a session immediately with `email_confirmed_at` set and identity `email`. The test user was deleted afterwards.
    - So with confirmations off, anyone can sign up as `someone@gmail.com` and claim that person's guest bookings.
  - `create_booking` already stores `guest_email` lower-cased and trimmed (`20261017025456_create_booking.sql:112`), so matching is `guest_email = lower(auth.users.email)`. A partial index `on bookings (guest_email) where user_id is null` keeps the claim fast.
  - Where to trigger the claim:
    - A trigger on `auth.users` would only fire on auth events, and would miss a guest booking made later by a signed-out user who already has an account.
    - A client call is simpler and covers that case. SPEC §5.7 already chooses it: the client calls the RPC after sign-in and on app load with an existing session, and the RPC is idempotent.
    - The call must stay out of `onAuthStateChange`, because awaiting Supabase inside that callback can deadlock (`AuthProvider.tsx` comment). As built in T5.7, it's a React Query query keyed on the user id (`useClaimGuestBookings`, mounted once at the app root). That deduplicates the call and needs no effect.
- **Gotchas:**
  - Read the email only from `auth.users` inside the `security definer` function, never from the JWT or the arguments. The JWT's `email` claim can be stale after an email change.
  - Anyone can make a guest booking with a victim's email, and it then shows up in the victim's My bookings. That's a nuisance, not a data leak, because the attacker learns nothing. Accepted.
  - Claim only `user_id is null` rows. A booking already attached to an account is never moved.
  - A deleted player's bookings also have `user_id is null` and keep their email snapshot. Without another filter, a new account with that email would claim them. Requiring `guest_token_hash is not null` (set only for guest bookings) excludes them.
- **Recommendation:**
  - The RPC requires `email_confirmed_at is not null`.
  - **Confirmations must be on wherever claims matter.** Turn on `enable_confirmations` in `config.toml`, so local matches the hosted project and `supabase config push` can never weaken it. e2e then confirms sign-ups through the local mail catcher, or creates confirmed users with the admin API.
  - Check the linked project's dashboard setting (Authentication → Providers → Email → "Confirm email").

### Guest token flow hardening
- **Status:** Decided (SPEC §10, 2026-10-17)
- **Question:** What does "hardened" mean for `/booking/:ref?token=`: rate limits, where the token sits in the URL, how long it lives, and a lost-link path?
- **Findings:**
  - **Brute force isn't a realistic threat.** The token has 256 bits of entropy (M3 entry "Guest access tokens"). An unknown reference code and a wrong token return the same `not_found`, so guessing reference codes (32⁶ ≈ 1.07 × 10⁹) reveals nothing. Postgres can't see a reliable client IP to throttle on anyway (only PostgREST's forwarded headers, which are spoofable from the client side). Supabase documents rate limits for Auth endpoints only ([Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits)), not per RPC (not verified further). A throttle table would add writes to a `stable` read path for no security gain.
  - **The query string reaches servers; the fragment doesn't.** The fragment "is not sent to the server" ([MDN, URI fragment](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Fragment); RFC 3986 §3.5). With `?token=`, the token lands in the static host's access logs (Vercel in M8), analytics and any proxy. `<meta name="referrer" content="no-referrer">` is already in `index.html`, so `Referer` leaks are covered either way.
  - *Unverified, from memory of the supabase-js source (`GoTrueClient._isImplicitGrantCallback`):* it treats the URL fragment as an auth callback only when it holds `access_token` or `error_description`, so `#token=…` shouldn't collide. The T5.5 e2e proves it either way.
  - The link grants **cancel** as well as read (T5.3), so a leaked link is now worth more than before. Its lifetime should be bounded.
  - **Lost link:** only the token's hash is stored, so the original link can never be re-sent. The existing feature that already works as a recovery path is the auto-claim: sign up or log in with the booking's email (verified) and the booking appears in My bookings. "Email me a new link" (a fresh token, emailed) needs emails, so it belongs in M8.
- **Gotchas:**
  - Old `?token=` links (already shown to guests on the confirmation page) must keep working. Read both, and rewrite `?token=` to `#token=` with `history.replaceState`.
  - Claiming doesn't need to clear `guest_token_hash`. The owner reads through RLS anyway, and links the guest saved keep working until they expire.
- **Recommendation:**
  - Move the token to the fragment.
  - Guest links stop working 30 days after the booking ends, with the same `not_found` response.
  - Don't add a lookup throttle (documented here).
  - Show the "sign up with your booking email" recovery hint on the not-found page and in the save-link card.

### My bookings query
- **Status:** Decided (SPEC §10, 2026-10-17). No DB change needed.
- **Question:** How do we list a player's bookings, upcoming vs past, with the effective status?
- **Findings:**
  - Players read their own rows through RLS. **Admins' RLS returns every booking**, so the query must also filter `.eq('user_id', user.id)` explicitly, or an admin's My bookings would list the whole venue.
  - `bookings_user_id_idx` exists. A single player has few rows, so one ordered query with a cap is enough (`limit 200`).
  - `displayStatus()` in `src/features/booking/status.ts` already applies the expired-hold rule on the client, and also shows a `confirmed` booking that has ended as `completed`.
- **Recommendation:**
  - Select through RLS with the explicit `user_id` filter and `courts(name, sport)`.
  - A pure `splitMyBookings(rows, now)` (Vitest) built on `displayStatus()`: **Upcoming** is a booking that ends in the future and displays as `pending_payment`, `payment_submitted` or `confirmed`, soonest first. **Past** is everything else (`completed`, `expired`, `rejected`, `cancelled`), most recent first.

### DB plan for T5.3–T5.5
- **Status:** Approved by the user on 2026-10-17, including `db:push` for these three migrations. The user also chose: confirmations on locally, guest links valid until 30 days after the booking, and the hosted project already has "Confirm email" on.
All functions are `security definer`, `set search_path = ''`, and follow RPC conventions (M3): `revoke all … from public, anon, authenticated`, then explicit grants. Errors are `P0001` with a stable `hint`.

1. **Migration `cancel_booking`** (T5.3)
   - Add `bookings.cancelled_by uuid references profiles(id) on delete set null` (an audit field with index `bookings_cancelled_by_idx`) and `bookings.cancelled_by_venue boolean not null default false`. Both are set at cancel time: the guest path always stores `cancelled_by = null, cancelled_by_venue = false`. The session path stores `cancelled_by = auth.uid()` and `cancelled_by_venue = private.is_admin()`. The flag is stored, not derived, so a later role change can't rewrite history.
   - Add `public.cancel_booking(p_booking_id uuid default null, p_reference_code text default null, p_token text default null, p_reason text default null) returns public.booking_status`. Grant to `anon, authenticated`.
     - **Guest path** (`p_token` given): match ref + `sha256(token)`, the same way `get_guest_booking` does. It never counts as admin.
     - **Session path** (`p_booking_id`): admin, or `user_id = auth.uid()`. Anything else is `not_found`.
     - Lock the row `for update`. The effective status must be active, otherwise `not_cancellable`.
     - Player or guest: `now() <= lower(during) - cutoff`, otherwise `cutoff_passed`. Admin: `now() < upper(during)`, otherwise `booking_ended`, and a reason is required (`reason_required`).
     - Sets `status = 'cancelled'`, `cancelled_at = now()`, `cancel_reason`, `cancelled_by` and `cancelled_by_venue` as above. Payment rows aren't touched.
     - When both `p_token` and `p_booking_id` are given, the guest path wins. When neither is, it's `not_found`. An admin cancelling through the session path always needs a reason, even for their own player booking.
2. **Migration `claim_guest_bookings`** (T5.4)
   - Add `public.claim_guest_bookings() returns integer`. Grant to `authenticated` only, so anon gets `42501`.
   - Reads `lower(email)` from `auth.users where id = auth.uid() and email_confirmed_at is not null`. If there's none, it returns 0.
   - Then `update bookings set user_id = auth.uid() where user_id is null and source = 'online' and guest_token_hash is not null and guest_email = v_email`, and returns the row count. Requiring a guest token means only bookings made as a guest are claimable. A deleted player's old bookings (`user_id` set to null, email snapshot kept) aren't.
   - Add a partial index `bookings_unclaimed_email_idx on bookings (guest_email) where user_id is null and guest_token_hash is not null`.
   - `config.toml`: set `enable_confirmations = true`. This isn't a migration; it's applied by `supabase stop/start` locally.
3. **Migration `guest_link_hardening`** (T5.5)
   - Replace `get_guest_booking` (drop and create, because the return type grows):
     - adds `and upper(b.during) + interval '30 days' > now()` to the match (same `not_found` otherwise)
     - returns `cancelled_at`, `cancel_reason` and the stored `cancelled_by_venue`
   - Client:
     - token in `#token=`, with `?token=` rewritten for old links
     - `CheckoutPage` and the save-link card build fragment links
     - the recovery hint

---

## Milestone 6: Venue media

Local experiments in this section ran on 2026-10-18 against `supabase start` with a throwaway public bucket `zz-probe-media` (2 MB, JPG/PNG/WEBP). The admin-only INSERT/UPDATE/DELETE policies were added first and a SELECT policy later. The probe used `supabase-js` as an admin, a player and anon, then removed the bucket, policies and users.

### Public bucket vs signed URLs
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** Should court photos and the banner live in a public bucket, or a private one served through signed URLs?
- **Findings:**
  - Public buckets skip access control for reads only: "Access control is still enforced for other types of operations including uploading, deleting, moving, and copying." Anyone with the URL can fetch the file. Public buckets are also cached more effectively. Source: [bucket fundamentals](https://supabase.com/docs/guides/storage/buckets/fundamentals.md).
  - *(Local.)* An anonymous `GET /storage/v1/object/public/zz-probe-media/courts/x/a.png` returned 200 with `content-type: image/png`. `getPublicUrl()` is synchronous and builds the URL from the path, so the database stores only the path and the same row works locally and on the hosted project.
  - *(Local.)* An anonymous `list()` on the public bucket with no anon SELECT policy returned `[]`. Public URLs work without a SELECT policy, and file names can't be listed.
- **Gotchas:** A private bucket would mean signing a URL for every court card on every visit, and signed URLs change, which defeats caching. Nothing here is sensitive.
- **Recommendation:** Use a public bucket `venue-media`. Store object paths, not URLs, and build URLs with `getPublicUrl()`. Don't add an anon or player SELECT policy: public reads don't need one, and leaving it out keeps listing closed.

### Storage policies and bucket limits
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** Which `storage.objects` policies do admin uploads, replacements and deletes need? What MIME and size limits should the bucket have?
- **Findings:**
  - Upsert needs INSERT, SELECT and UPDATE (installed skill `.agents/skills/supabase/SKILL.md`, "Storage access control"). *(Local.)* An admin upsert with only INSERT/UPDATE/DELETE failed with 403 "new row violates row-level security policy". With an admin SELECT policy added, it worked.
  - *(Local.)* **`remove()` needs SELECT as well as DELETE.** Without a SELECT policy, an admin's `remove(['courts/x/b.png'])` returned `[]` with no error and the object stayed. With an admin SELECT policy, the same call deleted it. A player's `remove()` returned `[]` and deleted nothing.
  - Objects must be deleted through the Storage API, never with SQL, which leaves the file behind ([delete objects](https://supabase.com/docs/guides/storage/management/delete-objects.md)).
  - *(Local.)* The bucket limits work: `text/html` was rejected with 415 and a file over 2 MB with 413. A player and anon were both refused with 403 (RLS).
  - *(Local.)* **The MIME allow-list trusts the declared `contentType`.** HTML bytes uploaded as `image/png` were accepted and served back as `image/png`.
  - The existing test `09_payment_proofs_storage.test.sql` asserts there are no client INSERT/UPDATE/DELETE/ALL policies on `storage.objects` at all, and its comment says to narrow the check when another bucket needs client writes.
- **Gotchas:**
  - A missing SELECT policy fails silently: `remove()` reports success and leaves an orphan. Tests must check that the object is actually gone, not just that there was no error.
  - Every policy must be scoped by `bucket_id = 'venue-media'`. Otherwise it would also open `payment-proofs`.
- **Recommendation:**
  - Bucket: `public = true`, `file_size_limit = 2 MB` (applies to the downscaled file), `allowed_mime_types = image/jpeg, image/png, image/webp`.
  - Four policies `to authenticated`, one each for SELECT, INSERT, UPDATE and DELETE. Each requires `bucket_id = 'venue-media' and (select private.is_admin())`. INSERT and UPDATE also require the first folder to be `courts` or `banner`.
  - Because only admins can write and the client re-encodes every image (next entry), the declared-type gap isn't exploitable by players.
  - In T6.2, narrow the `09` assertion to policies that could apply to `payment-proofs`, and add an explicit test that an admin can't write to `payment-proofs`. That keeps the guarantee rather than weakening it.

### Image size: transformations vs client-side downscale
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** Can we resize with Supabase image transformations, or do we downscale in the browser?
- **Findings:**
  - "Image Resizing is currently enabled for Pro Plan and above," billed at $5 per 1,000 origin images over quota ([image transformations](https://supabase.com/docs/guides/storage/serving/image-transformations.md)). `config.toml` also says the transformation API is Pro-only, and `[storage.image_transformation]` is commented out.
  - *(Local.)* `GET /storage/v1/render/image/public/…?width=100` returned 404 "Route … not found", so transformations aren't available locally.
  - Canvas WebP encoding isn't universal. `toBlob()` silently returns a PNG when it can't encode the requested type, and WebKit closed its WebP-encode bug as WONTFIX ([WebKit 226950](https://bugs.webkit.org/show_bug.cgi?id=226950), [write-up](https://dev.to/dailytechid/canvastoblob-can-silently-hand-you-back-a-png-when-it-cant-encode-what-you-asked-for-4blo)).
  - Re-encoding through a canvas drops EXIF data, including the GPS location in phone photos. `createImageBitmap` also fails on bytes that aren't an image, so the downscale doubles as a content check.
- **Gotchas:**
  - Check `blob.type` after `toBlob('image/webp')` and fall back to JPEG. Never save a PNG under a `.webp` name.
  - jsdom has no canvas. Keep the canvas code in one small module that component tests mock, and unit-test the pure size maths.
- **Recommendation:**
  - Downscale in the browser in `src/features/admin/media.ts`:
    1. Accept JPG, PNG or WEBP input up to 15 MB.
    2. Decode with `createImageBitmap(file)`. A decode failure shows "That file isn't a readable image".
    3. Scale to fit within 1600 px wide for court photos, or 2200 px wide for the banner (2× the 1100 px container), never upscaling.
    4. Encode WebP at quality 0.82, falling back to JPEG at 0.85 when `blob.type` isn't WebP.
    5. Refuse the result if it's still over 2 MB.
  - This works on the free plan and locally, whatever the hosted plan is.

### Replacing and removing images
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** How do we replace or remove an image without serving stale copies or leaving orphaned files?
- **Findings:**
  - Changes to a public object can take "up to 60 seconds" to clear the CDN, and browsers keep their own copy. For changing assets, upload to a new path rather than overwriting ([Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn.md)).
  - *(Local.)* The default response header is `cache-control: max-age=3600`. Uploading with `cacheControl: '31536000'` served `max-age=31536000`.
  - Courts are only archived (`is_active`) and never deleted from the client, so a court photo can't be orphaned by deleting its court.
- **Gotchas:** The upload and the row update can't share a transaction. Order the steps so a failure leaves at most an unreferenced file and never a row pointing at a missing one.
- **Recommendation:**
  - Paths:
    - court photo: `courts/{court_id}/{uuid}.{webp|jpg}`
    - banner: `banner/{uuid}.{webp|jpg}`
  - Upload with `upsert: false` and `cacheControl: '31536000'`. The path never changes contents, so it's safe to cache for a year.
  - Replace:
    1. Upload the new file.
    2. Update the row with the new path (existing admin RLS).
    3. Remove the old object, best effort.
    4. If step 2 fails, remove the new file.
  - Remove: clear the column first, then remove the object.
  - Orphans come from a failed best-effort delete, or from an upload whose save never happened (tab closed or request lost after the upload). Accept them, and keep a read-only listing query here for manual cleanup through the Storage API:
    ```sql
    select o.name from storage.objects o
    where o.bucket_id = 'venue-media'
      and o.name not in (select photo_path from public.courts where photo_path is not null)
      and o.name is distinct from (select banner_path from public.venue_settings);
    ```
  - No scheduled job is needed.

### Banner and photo layout
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** What aspect ratios and loading attributes should the banner and court photos use to avoid layout shift, and what alt text?
- **Findings:**
  - CSS `aspect-ratio`, or `width`/`height` attributes on `<img>`, reserves the box before the image loads ([web.dev CLS](https://web.dev/articles/optimize-cls#images-without-dimensions)). `object-fit: cover` fills the box by cropping.
  - Native `loading="lazy"` suits below-the-fold images. The banner is above the fold, so it should load eagerly with `fetchpriority="high"` ([web.dev lazy loading](https://web.dev/articles/browser-level-image-lazy-loading)).
  - The home page already fetches `venue_settings` (`HomePage.tsx`). Per the confirmed outline, nothing renders until settings load, so the banner appears once, when settings resolve. That's one shift, at most once per visit, and settings are often already in the React Query cache.
- **Gotchas:** `object-fit: cover` crops differently on phones and desktop, so the admin preview should show both crops.
- **Recommendation:**
  - Banner, inside `.container` (max 1100 px wide):
    - `aspect-ratio: 2 / 1` below 640 px and `3 / 1` from 640 px, with `object-fit: cover; object-position: center`, rounded corners and `fetchpriority="high"`.
    - The admin form recommends a landscape image of at least 1600 × 600.
    - Alt text is required while a banner is set (trimmed, 1 to 200 characters) and describes the picture.
  - Court photos: `aspect-ratio: 16 / 9`, `object-fit: cover`, `loading="lazy"`, `decoding="async"`, explicit `width`/`height`, and alt "Photo of {court name}".
  - Courts without a photo, or whose photo fails to load, get a placeholder with a sport icon (`aria-hidden`), labelled "{Sport} court" (`role="img"`), never a broken `<img>`. The court name is shown next to it in the tile. *(As built in T6.5.)*

### DB and storage plan for T6.2
- **Status:** Approved by the user on 2026-10-18, including `db:push` for this migration.
One migration, `venue_media`:
1. **Columns**
   - `courts.photo_path text null`, `check (photo_path ~ ('^courts/' || id::text || '/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$'))`. The path must sit under its own court's folder.
   - `venue_settings.banner_path text null`, `check (banner_path ~ '^banner/[0-9a-f-]{36}\.(webp|jpg|jpeg|png)$')`.
   - `venue_settings.banner_alt text null`, with `check ((banner_path is null) = (banner_alt is null))` and `check (banner_alt is null or (banner_alt = btrim(banner_alt, E' \t\r\n') and char_length(banner_alt) between 1 and 200 and banner_alt ~ '\S'))`. The value is stored already trimmed (the client trims before saving), and an alt made only of whitespace is refused.
   - No new grants: `update` on `courts` and `venue_settings` is already granted table-wide to `authenticated`, and the existing admin-only RLS update policies decide who can use it. No RPC and no `security definer`.
2. **Bucket:** insert `venue-media` into `storage.buckets` (`public = true`, `2 MB`, `image/jpeg, image/png, image/webp`), using `on conflict do update` like `payment-proofs`.
3. **Policies on `storage.objects`**, all `to authenticated`:
   - "Admins read venue media" (SELECT): `bucket_id = 'venue-media' and (select private.is_admin())`. Needed for `remove()` and upsert, not for public reads.
   - "Admins upload venue media" (INSERT): the same condition, plus `(storage.foldername(name))[1] in ('courts', 'banner')`, in `with check`.
   - "Admins update venue media" (UPDATE): the same condition in `using`, and in `with check` together with the `courts`/`banner` folder rule, so a `move()` can't place an object elsewhere.
   - "Admins delete venue media" (DELETE): `using (bucket_id = 'venue-media' and (select private.is_admin()))`.
4. **Tests**
   - New `17_venue_media.test.sql`:
     - bucket config
     - anon and player can't insert, update or delete in `venue-media` (42501, or 0 rows)
     - admin can insert under `courts/` and `banner/`, and is refused elsewhere
     - admin sees objects (SELECT), and player and anon see none through RLS
     - the path CHECKs: wrong court folder, wrong prefix, bad extension
     - the `banner_alt` CHECKs: alt without path, path without alt, blank alt, a tab/newline-only alt, untrimmed alt, and more than 200 characters
     - the column updates go through admin RLS: a player's update changes 0 rows, an admin's update works
   - Update `09_payment_proofs_storage.test.sql`: the "no write policy" check excludes only the three venue-media write policies, matched by exact `policyname`, not by text-matching their definitions, so any other write policy still fails it. Add behavioral checks that admin, player and anon all get 42501 inserting into `payment-proofs`. Deletes are checked through policy definitions, because Storage blocks SQL deletes.
   - The `00_rls_coverage` check should still pass, since there are no new tables.
5. Then run `npm run test:db` locally, `npm run db:push` (linked project) and `npm run db:types`, and update SPEC §6.

---

## Milestone 7: Online payments (PayMongo, test mode)

Sources are the current PayMongo docs at docs.paymongo.com (the old developers.paymongo.com pages redirect there; the `.md` versions are listed in `https://docs.paymongo.com/llms.txt`). Fetched on 2026-10-18. There's no PayMongo key in this repo yet, so the API calls themselves are verified in T7.3 (stub) and T7.7 (real test key).

### Checkout Sessions vs Payment Intents, methods and amounts
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** Which PayMongo API do we use, which methods do we offer, and how are amounts expressed?
- **Findings:**
  - Hosted Checkout: our backend creates a Checkout Session and redirects the customer to `data.attributes.checkout_url`. The customer pays on PayMongo's page and returns to `success_url` or `cancel_url`. "**We recommend `/v2` for new integrations**" (`POST https://api.paymongo.com/v2/checkout_sessions`), which defers Payment Intent creation until the customer pays. Auth is HTTP Basic with the secret key as the username and no password. "Never call this endpoint from your frontend." Sources: [Hosted Checkout](https://docs.paymongo.com/docs/payment-channels-hosted-checkout.md), [quick start](https://docs.paymongo.com/docs/payment-channels-hosted-checkout-quick-start.md).
  - Attributes: `line_items[]` (`name`, `amount` **in centavos as an integer**, `currency` "PHP" only, `quantity`), `payment_method_types[]`, `success_url`, `cancel_url`, `reference_number`, `metadata` (string values; `PYM_` keys are reserved), `description`, `send_email_receipt`, `billing`. Allowed methods: `qrph, card, gcash, paymaya, grab_pay, shopee_pay, billease, dob, dob_ubp, brankas_*`, but only those enabled on the merchant account work ([create a checkout](https://docs.paymongo.com/reference/create-a-checkout)).
  - Payment Intents (self-hosted) means building the payment UI and handling each method's flow ourselves. Hosted Checkout covers e-wallets, cards and QR Ph with one redirect.
  - Test mode: a session created with an `sk_test_…` key is a test session, and webhook endpoints are scoped to test or live mode ([testing](https://docs.paymongo.com/docs/payment-channels-testing.md), [webhook key concepts](https://docs.paymongo.com/docs/developer-tools-webhooks-key-concepts.md)).
- **Gotchas:**
  - Floating-point money: convert `numeric` → centavos in SQL (`(total_amount * 100)::int`) or with integer maths, never `Math.round(x * 100)` on a float that came from a client.
  - A method that isn't enabled on the account makes session creation fail. Keep the list in one constant and confirm it with the real test key in T7.7.
- **Recommendation:**
  - Hosted Checkout, `/v2/checkout_sessions`, one line item "Court booking {ref}" for the booking's stored `total_amount` in centavos.
  - Methods: `gcash`, `paymaya`, `card`, `qrph`.
  - `reference_number = reference_code`, `metadata.booking_id = <uuid>`, `send_email_receipt = true` (PayMongo's receipt; our own emails stay in M8).
  - The function refuses any secret key that doesn't start with `sk_test_`, so live mode can't be switched on by accident (SPEC: test mode only).

### Webhooks: events, signature, retries, idempotency
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** Which events do we handle, how do we verify them, and how do we survive retries?
- **Findings:**
  - Event: `checkout_session.payment.paid` "is sent when a customer completes payment on a Checkout Session… The payload contains the full Checkout Session, including the latest Payment Intent and the `payments` array… At most one entry in `payments` has `status: "paid"`." The envelope is `data.id` (event id `evt_…`) with `data.attributes.{type, livemode, created_at, data}`. The session's `data.attributes.data.id` is `cs_…`, and the paid payment has `id` `pay_…`, `attributes.amount` (centavos), `fee`, `net_amount` and `source.type` ([events](https://docs.paymongo.com/docs/developer-tools-webhooks-events.md)). "PayMongo does not send an event when a Checkout Session expires."
  - Signature ([Securing a webhook](https://docs.paymongo.com/docs/developer-tools-webhook-setup-management.md)): the header is `Paymongo-Signature: t=<unix>,te=<test sig>,li=<live sig>`. Sign the string `` `${t}.${rawBody}` `` with **HMAC-SHA256**, keyed by the endpoint's secret, then "use te for test mode events and li for live mode events". Comparing the timestamp is "optional but recommended". The [best practices](https://docs.paymongo.com/docs/developer-tools-best-practices-1.md) page adds: verify before parsing, use the raw body, and compare in constant time.
  - *(Local experiment.)* WebCrypto `crypto.subtle` HMAC-SHA256 over `t + '.' + body` gives the same hex digest as Node's `createHmac` (`webcrypto == node crypto: true`). So the same pure TS verifier runs in Deno (the Edge Function), Node (smoke and e2e signing) and Vitest.
  - Delivery: success is "an HTTP status code between 200 and 209, along with a JSON response within 30 seconds". Failures are retried "up to 12 times using exponential backoff", and missed events after that need a manual resend from the dashboard. "Returning errors for unrecognized events" causes retries, so return 200 for events we ignore. Deduplicate by event id ([retry logic](https://docs.paymongo.com/docs/developer-tools-retry-logic.md), [best practices](https://docs.paymongo.com/docs/developer-tools-best-practices.md)).
  - Registration: in the dashboard (Developers → Webhooks), or `POST /v1/webhooks` with `url` and `events`. The endpoint's secret key is shown once. The endpoint must be HTTPS ([creating a webhook endpoint](https://docs.paymongo.com/docs/creating-a-webhook-endpoint.md)).
- **Gotchas:**
  - The docs don't say whether retries are re-signed with a fresh `t`. A strict timestamp window could reject genuine late retries, so rely on idempotency rather than a tight window.
  - `livemode: true` or a non-empty `li` with an empty `te` means a live event. We're test-only, so ignore it.
  - Edge Functions read the raw body with `await req.text()` before `JSON.parse`.
- **Recommendation:**
  - `paymongo-webhook` has `verify_jwt = false`.
    1. Read the raw body and verify `te` against `PAYMONGO_WEBHOOK_SECRET` in constant time. Return 401 if it's invalid or missing. Log a timestamp older than 24 h, but don't reject it.
    2. Ignore (200) any event type other than `checkout_session.payment.paid` and any `livemode: true` event.
    3. Take the session id, the paid payment's id, amount and source **only from the signed payload**, and call the service-role RPC.
    4. Idempotency is a unique `payments.provider_payment_id`. A replay finds the existing row and returns 200 with the same outcome.
  - The RPC is a single short transaction, so we answer well within 30 s and don't need a queue.

### Mapping a session to a booking, and who may start one
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** How does a webhook find its booking, and how do we authorize guests and owners when creating the session?
- **Findings:**
  - `reference_number` and `metadata` are echoed back in the webhook ([Hosted Checkout](https://docs.paymongo.com/docs/payment-channels-hosted-checkout.md)). The signed payload means they can be trusted once the signature checks out.
  - "It is safe to send a customer back to an `active` checkout URL instead of creating a new session", and one session "can never produce more than one successful payment" ([key concepts](https://docs.paymongo.com/docs/payment-channels-key-concepts.md)).
  - `public.proof_target(ref, token, user_id)` (M4) already authorizes an owner session or the guest ref + token, and checks the booking is `pending_payment` and its hold hasn't expired.
- **Gotchas:**
  - Don't build `success_url` from client input (open redirect). Use the `PUBLIC_SITE_URL` secret plus the reference code. *(As built in T7.3: a comma-separated allow-list. The request's `Origin` is used only if it's listed, otherwise the first entry, so local dev (5173) and e2e (5179) both return to the right port.)*
  - Two tabs racing to create a session: store at most one session per booking and return the stored URL to the loser. The loser's PayMongo session is never shown to anyone.
- **Recommendation:**
  - `create-paymongo-checkout` uses `withSupabase({ auth: ['user', 'publishable'] })`, the same as `submit-payment-proof`. It authorizes through `proof_target` (moved into `_shared` together with the error mapping) and reuses the booking's stored checkout if there is one. Otherwise it creates the session and stores it with `record_paymongo_checkout`.
  - The webhook maps the session through our own `paymongo_checkouts` table (an unknown `cs_…` → logged, 200) and cross-checks `metadata.booking_id`.
  - Return URLs:
    - success: `{PUBLIC_SITE_URL}/booking/{ref}?paid=1`
    - cancel: `{PUBLIC_SITE_URL}/booking/{ref}?paid=0`
    - The guest token must **never** go into `success_url`. That URL is sent to PayMongo and stored there, and SPEC §6 says the token is never sent to servers. Today the token lives only in the `#token=` fragment (`guestLink.ts`), so it is lost across the redirect. T7.5 saves it in `sessionStorage` (same origin) before redirecting and reads it back on the `?paid=` return.

### Hold interplay and late payments
- **Status:** Decided (SPEC §10, 2026-10-18). The user chose to re-confirm late but recoverable payments (case 2).
- **Question:** How do session expiry and our `expires_at` interact, does starting a checkout extend the hold, and what happens to a payment that arrives late?
- **Findings:**
  - "**Checkout Sessions do not expire on their own.** There is no default time limit." A session only expires through the Expire endpoint. The endpoint returns 400 if a payment is already paid, or `pending` or `processing`. No webhook is sent on expiry. "No payment can be recorded on an expired session" ([key concepts](https://docs.paymongo.com/docs/payment-channels-key-concepts.md)).
  - A QR Ph code expires after 30 min, but the session stays active.
  - So even if we expired sessions at hold expiry, a payment already processing at that moment would still succeed. Late payments have to be handled either way.
- **Gotchas:**
  - Matching the session to `expires_at` would need an outbound call when a hold lapses. Holds lapse lazily or through `pg_cron` inside Postgres, which can't call PayMongo without `pg_net` plus the secret key in the database. That's too much risk for a test-mode feature.
  - Extending the hold whenever a checkout starts would let anyone keep a slot forever by re-opening checkout.
- **Recommendation:**
  - Starting a checkout **doesn't extend the hold**, and we **don't expire sessions** in M7. The webhook RPC decides under a row lock:
    1. `pending_payment` and the hold is still valid: approved PayMongo payment, booking `confirmed`.
    2. **Late but recoverable** (`pending_payment` with the hold passed, or `expired`, the slot hasn't started, the court is still active, no blackout overlaps it, and no other active booking overlaps): approved payment, booking `confirmed` again. An exclusion violation falls through to 4. *(Approved by the user, 2026-10-18. The blackout and active-court checks were added after the T7.1 review: the exclusion constraint doesn't see those.)*
    3. `payment_submitted` (a proof is waiting for review): approved PayMongo payment, booking `confirmed`. The pending proof is auto-closed as `rejected` with the note "Paid online with PayMongo instead. Check for a duplicate payment.", and `rejection_count` is **not** incremented.
    4. Anything else (cancelled, rejected, already confirmed or approved, the slot is taken or has started, or the amount doesn't match): record the payment as `review_status = 'rejected'` with an automatic note saying why ("Paid after the booking was cancelled; refund outside the app."). The booking isn't changed. Admins see it flagged (T7.6), and refunds stay a non-goal.
  - Expiring sessions when a booking closes is a possible M8 follow-up (a scheduled Edge Function).

### Data model for PayMongo payments
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** A new `method` value or a provider column? Where do PayMongo ids go, and how does this fit the unique-pending and unique-approved indexes and the takings?
- **Findings:** *(Repo.)*
  - `payments` has `payment_method` enum (`gcash, maya, bank_transfer, cash`), the unique partial indexes `payments_one_approved_per_booking` and `payments_one_pending_per_booking`, and a CHECK that a rejection has a note.
  - Takings group approved payments by `method` (`src/features/admin/dashboard.ts`).
- **Gotchas:**
  - A value added with `alter type … add value` can't be used until the transaction that added it commits ([docs](https://www.postgresql.org/docs/current/sql-altertype.html)). *(Local experiment, Postgres 17.11, rolled back.)* After `add value 'paymongo'`, a CHECK comparing `method = 'paymongo'` in the same transaction failed with `unsafe use of new value "paymongo"… must be committed`. A `method::text = 'paymongo'` CHECK parsed fine.
  - So the enum value goes in **its own migration**. Each migration file is applied separately, so the second one can use the value normally.
  - PayMongo's `source.type` (gcash/paymaya/card/qrph) isn't our `method`. Store it separately for display.
- **Recommendation:**
  - `payment_method` gets the new value `'paymongo'`. New nullable columns: `provider_payment_id text unique` (`pay_…`), `provider_checkout_id text` (`cs_…`), `provider_source text`, `provider_event_id text`. A CHECK makes `method = 'paymongo'` equivalent to `provider_payment_id is not null`.
  - A PayMongo payment is never `pending`, so the one-pending index isn't affected. The one-approved index is protected by case 4.
  - Takings count approved `paymongo` rows as their own "PayMongo" line.
  - New table `paymongo_checkouts`: `booking_id` (unique), `checkout_id` (unique), `checkout_url`, `amount_centavos`, `created_at`. RLS is on, admins can SELECT, and only service-role RPCs write.

### Local testing without a public URL
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** How do we test the checkout and webhook without PayMongo calling our laptop?
- **Findings:**
  - PayMongo only delivers to public HTTPS endpoints, and test events can be sent from the dashboard to a deployed endpoint ([webhook testing](https://docs.paymongo.com/docs/webhook-testing.md)).
  - The signature can be produced locally with the same secret (experiment above).
  - `supabase start` serves functions at `/functions/v1/<name>` (M4).
- **Gotchas:** A missing secret key must not quietly turn into "stub mode" in production.
- **Recommendation:**
  - `PAYMONGO_MODE=stub` (only in `supabase/functions/.env`) makes `create-paymongo-checkout` skip the API and return a fake `cs_stub_…` session with `checkout_url = https://checkout.paymongo.test/stub/{id}`.
  - With no key and no stub mode, the function returns 503 "Online payment isn't available right now."
  - `npm run smoke:paymongo` and the e2e flow sign fake `checkout_session.payment.paid` events with the local `PAYMONGO_WEBHOOK_SECRET` and POST them to the local function. Playwright intercepts the `checkout.paymongo.test` host.
  - The signing, parsing and verification helpers live in `supabase/functions/_shared/paymongo.ts`, which is plain TS and Vitest-tested.

### Secrets
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Recommendation:** These are Edge Function secrets only (`supabase/functions/.env` locally, `npx supabase secrets set` for the linked project), never `VITE_*` or `src/`:
  - `PAYMONGO_SECRET_KEY` (must start with `sk_test_`)
  - `PAYMONGO_WEBHOOK_SECRET` *(as built in T7.4: the committed `.env.example` holds the local-only value `whsk_local_dev_only` so smoke and e2e can sign fake events. The webhook refuses that value unless `SUPABASE_URL` is the local http stack, so it can never protect the deployed endpoint.)*
  - `PUBLIC_SITE_URL` (for return URLs; a comma-separated allow-list, the first is the default)
  - `PAYMONGO_MODE` (local stub only)

  Add them to a committed `supabase/functions/.env.example`. CLAUDE.md already states the rule.

### Verified on the linked project (T7.7)
- **Status:** Decided (2026-10-18)
- **Findings:**
  - Webhooks are registered in the dashboard under **Settings → Webhooks** (https://dashboard.paymongo.com/webhooks) with the **Test Mode** toggle on, not under Developers ([access & navigation](https://docs.paymongo.com/docs/developer-tools-dashboard-module-access-and-navigation.md)). The user registered ours there and set `PAYMONGO_WEBHOOK_SECRET` themselves.
  - Before the secret was set, the deployed webhook answered `{"code":"not_configured"}` (503), and the checkout preflight answered 204 once deployed (it was 404 before deploying, which browsers show as a CORS error).
  - A real test-mode payment on CB-6L7YXZ (₱350, QR Ph) went through PayMongo's hosted checkout. The webhook recorded it (`provider_event_id` set, no reviewer) and the booking became `confirmed` with one approved `paymongo` payment for the stored total (checked with a linked query).
- **Still open:** only QR Ph was exercised for real. The PHP 20 minimum (`MIN_CHECKOUT_CENTAVOS`) is still an assumption; all court rates are far above it.

### DB and Edge Function plan for T7.2–T7.4
- **Status:** Approved by the user on 2026-10-18, including `db:push` for both T7.2 migrations. The user also chose: methods `gcash, paymaya, card, qrph`, and re-confirm late but recoverable payments. They don't have a PayMongo account yet, so it's needed before T7.7.
1. **Migrations** (T7.2). There are two, because a new enum value must be committed before it's used (see "Data model"):
   - `paymongo_method` contains only `alter type public.payment_method add value if not exists 'paymongo'`.
   - `paymongo_payments` contains everything below. All functions are `security definer`, `set search_path = ''`, `revoke all … from public, anon, authenticated`, `grant execute … to service_role` only, with `P0001` errors and stable hints.
   - `payments` gains:
     - `provider_payment_id text unique`
     - `provider_checkout_id text`
     - `provider_source text`
     - `provider_event_id text`
     - `check ((method = 'paymongo') = (provider_payment_id is not null))`
   - `create table public.paymongo_checkouts`:
     - `booking_id uuid not null unique references bookings on delete cascade`
     - `checkout_id text not null unique`
     - `checkout_url text not null check (checkout_url like 'https://%')`
     - `amount_centavos bigint not null check (amount_centavos > 0)`
     - `created_at timestamptz not null default now()`
     - RLS enabled, with "Admins read PayMongo checkouts" (SELECT, `private.is_admin()`). No client writes.
   - `public.paymongo_checkout_for(p_booking_id uuid) returns table (checkout_id text, checkout_url text)`: the stored session, if any.
   - `public.record_paymongo_checkout(p_booking_id uuid, p_checkout_id text, p_checkout_url text, p_amount_centavos bigint) returns table (checkout_id text, checkout_url text)`. It inserts `on conflict (booking_id) do nothing`, then returns the stored row, which is the race winner. A stored session that already has a recorded payment (for example a case 4 amount mismatch while the booking is still payable) is dead, so `paymongo_checkout_for` doesn't return it and the new session replaces it.
   - `public.record_paymongo_payment(p_checkout_id text, p_payment_id text, p_event_id text, p_amount_centavos bigint, p_currency text, p_source text, p_booking_id uuid) returns table (payment_id uuid, outcome text)`. Outcomes: `confirmed`, `revived`, `superseded_proof`, `late`, `duplicate`, `unknown_checkout`. It locks the booking `for update`, applies the four cases above, and compares the amount to `(total_amount * 100)::bigint` and checks `currency = 'PHP'`.
   - Locking in `record_paymongo_payment`:
     - Resolve the checkout, lock the booking `for update`, and only then look up an existing `provider_payment_id`.
     - Lock a pending proof after the booking, in the same order as `review_payment`.
     - Run the revival inside a nested `begin … exception when exclusion_violation` block, so it can fall through to case 4.
     - In case 3, close the pending proof **before** inserting the approved row.
   - Harden the existing RPCs in the same migration, so `record_payment_proof` and `create_walk_in` reject `'paymongo'` with `P0001`/`invalid_input` instead of a raw 23514 from the new CHECK. *(As built in T7.2: a `BEFORE INSERT/UPDATE` guard trigger on `payments` (`private.payments_paymongo_guard`) instead of copying both function bodies, which covers any future path too. pgTAP covers both RPCs.)*
   - `paymongo_checkouts`: `revoke all … from anon, authenticated`, then grant only `select` to `authenticated` (the admin policy uses `(select private.is_admin())`). `00_rls_coverage` picks it up automatically.
   - Update the SPEC §6 Server API table: the webhook's four outcomes and the three new RPCs.
2. **Edge Functions** (T7.3, T7.4):
   - `create-paymongo-checkout`: POST JSON `{ reference_code, token? }` → `{ checkout_url }`. It refuses a zero total, or one below PayMongo's minimum (to confirm in T7.7), with a readable 4xx.
   - `paymongo-webhook`: POST, verified as above.
   - Shared code in `_shared/`: `proof_target` errors and auth, and `paymongo.ts` (centavos, signature parse/verify/sign, payload extraction). Both functions get `verify_jwt = false` in `config.toml`.
3. **Tests**
   - pgTAP `18_paymongo.test.sql`:
     - RLS on `paymongo_checkouts` for anon, player, admin and service_role
     - the RPC grants (anon and authenticated get 42501)
     - the method/provider CHECK
     - `record_paymongo_checkout` race and reuse
     - every outcome of `record_paymongo_payment`, including a replay (no duplicate row), an amount mismatch, revival vs a taken slot, a slot already started, and the pending proof closed without counting as a rejection
     - takings-relevant rows
   - Vitest for `_shared/paymongo.ts`.
   - Smoke `npm run smoke:paymongo` for owner, guest, wrong token, unpayable, stub session reuse, valid webhook, bad signature 401, replay and late payment.
4. **UI follow-ups this plan creates** (added to T7.5 and T7.6):
   - Player views (`BookingSummary.tsx`, `PaymentHistory.tsx`) treat every `rejected` row as a failed proof. PayMongo rows must be excluded from "last rejection". Late PayMongo rows show as "Payment received after the booking closed; the venue will arrange a refund". Notes on automatic rows must be safe for players to read, and the duplicate-check hint is shown to admins only.
   - Takings order and labels (`dashboard.ts`, `WalkInForm.tsx`, `proofInput.ts`) need the `paymongo` value after `db:types`. Case 4 money was received but isn't counted in approved takings, so T7.6 must surface it.
5. Then `npm run test:db` locally, `npm run db:push` (linked project, both migrations), `npm run db:types`, and update SPEC §4, §6, §10 and §11.

## Milestone 8: Emails and deploy

Fetched on 2026-10-18. Local experiments ran against the running local stack.

### Email provider and sender domain
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** Which provider sends the four SPEC §8 emails and the Auth emails in production, and what do we need to reach any recipient?
- **Findings:**
  - Supabase's default Auth SMTP "will refuse to deliver messages to addresses that are not part of the project's team" and is limited to "2 messages per hour". Custom SMTP is recommended for anything beyond exploration ([auth-smtp](https://supabase.com/docs/guides/auth/auth-smtp)). So on the deployed site, sign-up confirmation emails reach only team members until custom SMTP is set.
  - Resend: the `resend.dev` test sender "can only send emails to the email address associated with your Resend account". Other recipients get a 403 "You can only send testing emails to your own email address". Reaching anyone needs a verified domain ([403 resend.dev](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). The free plan allows 3,000 emails a month, 100 a day and 3 domains ([pricing](https://resend.com/pricing)).
  - Resend also works as Supabase Auth custom SMTP: `smtp.resend.com:465`, user `resend`, password = API key ([send with Supabase SMTP](https://resend.com/docs/send-with-supabase-smtp)). One provider and one domain cover both kinds of email.
  - Resend's `Idempotency-Key` header dedupes a send for 24 h ([idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)).
  - Edge Functions: "Outgoing connections to ports `25` and `587` are not allowed" ([limits](https://supabase.com/docs/guides/functions/limits)). So we send over Resend's HTTPS API, not SMTP.
- **Gotchas:** Without a domain the deployed app can only email the Resend account owner, and Auth emails only team members. That's fine for a recorded demo, but real visitors wouldn't receive anything.
- **Recommendation:** Resend over its HTTPS API for booking emails, plus Resend SMTP for Supabase Auth, both from a verified domain. *(User decision, 2026-10-18: the user has or will get a domain.)* **Superseded on 2026-10-19:** the user chose to build the pipeline without Resend for now (demo project). Production email is `disabled`; Resend is a later switch-on (API key + domain + Auth SMTP), with no code change.

### Where emails are sent from: transactional outbox
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** Do we send from DB triggers plus a queue, or have the RPCs, webhook and client call an Edge Function?
- **Findings:** *(Repo.)*
  - The four events come from several paths: `create_booking` (client RPC), `review_payment` (admin client RPC), `record_paymongo_payment` (webhook, including revival and a superseded proof), `record_payment_proof` (no email), and `cancel_booking` (owner, guest or admin). Calling a function from every caller duplicates logic, and a client that closes the tab loses the email.
  - pg_net is available but not installed (local and linked: `select name, installed_version from pg_available_extensions where name in ('pg_net','supabase_vault','pg_cron')` → pg_net `null`, vault 0.3.1, pg_cron 1.6.4). Its requests "are not started until the transaction is committed", and pending request bodies sit in `net.http_request_queue` until sent ([pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)).
  - The documented way to schedule an Edge Function is `cron.schedule(... net.http_post(url from vault.decrypted_secrets ...))` ([schedule functions](https://supabase.com/docs/guides/functions/schedule-functions)).
- **Gotchas:**
  - A trigger that calls `net.http_post` directly would put its body (recipient, booking details) into an unlogged queue table, and would have no retry once pg_net's 6 h response log expires.
  - The `net` schema grants USAGE to PUBLIC (not exposed through the Data API).
- **Recommendation:**
  - `AFTER` triggers on `bookings` and `payments` insert one `email_outbox` row in the **same transaction** as the state change, so an email is queued if and only if the change commits, whatever the path.
  - A `send-emails` Edge Function drains the outbox. pg_cron runs it every minute through pg_net, with the URL and a worker secret read from Vault. If the Vault secrets are missing (local), the job does nothing.
  - The pg_net body is just `{}`: no PII goes through the pg_net queue.

### Retries and the outbox table
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Recommendation:**
  - `public.email_outbox`:
    - `id uuid`, `booking_id` (FK, `on delete cascade`)
    - `kind` (`booking_created | payment_confirmed | proof_rejected | booking_cancelled`)
    - `to_email`
    - `data jsonb`: a snapshot of what the template needs, such as ref, court, local times, amount and note. **No token, ever.**
    - `status` (`pending | sending | sent | failed`), `attempts`, `next_attempt_at`, `last_error`, `created_at`, `sent_at`
    - `unique (booking_id, kind)` where the kind happens once (`booking_created`, `payment_confirmed`, `booking_cancelled`). `proof_rejected` can repeat (up to 2 rejections).
    - RLS on, admins can SELECT, no client writes. Service-role RPCs only.
  - The worker claims a batch with `claim_email_outbox(limit)`, which uses `for update skip locked`, sets `sending` and `attempts + 1`, and leases the row for 5 min. A crashed worker's row comes back after the lease.
  - It reports back with `finish_email(id, ok, error)`. On failure the backoff is 1, 5, 15 and 60 min, and the row becomes `failed` after 5 attempts.
  - Resend `Idempotency-Key = outbox id`, so a retry after a lost response doesn't send twice.
  - Walk-ins (`source = 'walk_in'`) and rows without an email are never queued. A PayMongo case 4 payment (refund due) sends no email in M8 (follow-up).

### The guest token and the booking-created email
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Question:** SPEC §8 wants the guest link in the booking-created email, but the token exists only in `create_booking`'s return value. Its sha256 is all we store.
- **Findings:** *(Repo.)* The token hash is checked inline in `get_guest_booking`, `proof_target`, `cancel_booking` and others (single `bookings.guest_token_hash`). Rotating it would break the link already shown on the confirmation page. Multi-token support would mean rewriting every one of those checks.
- **Gotchas:**
  - Putting the plaintext token in the outbox, in pg_net, in a log or in Resend's metadata would break SPEC §6 ("shown once… stored only as a hash").
  - The email body itself necessarily contains it: that's the link.
- **Recommendation:**
  - **Players:** the trigger queues `booking_created`, and the worker sends it with `/booking/{ref}` (a session is needed to open it).
  - **Guests:** the trigger queues `booking_created` as well. The checkout page then calls a new `email-guest-link` Edge Function with `{ reference_code, token }` (the same body pattern as `submit-payment-proof`), and does it in the background so it can't fail the booking. The function checks the token against the hash, claims the booking's own `booking_created` row (only while it's still `pending`, so at most one email per booking), renders the link in memory and sends it. The token is never stored or logged.
  - If no valid call arrives within 10 min, the worker sends a version **without** the link. That version gives the reference and explains that the guest can sign up with this email to see the booking.
  - Later guest emails (confirmed, rejected, cancelled) carry the reference and the same explanation, not a link. Re-issuing a link ("email me a new link") stays out of scope.

### Templates
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Recommendation:**
  - Plain TS functions in `supabase/functions/_shared/emailTemplates.ts`: `render(kind, data, link?) → { subject, html, text }`. They escape HTML, format money and dates in PHP/Asia/Manila, and are covered by Vitest. No template engine.
  - The guest link is a parameter of the `booking_created` render only, so a test can assert it appears in no other email.

### Local testing through Mailpit
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Findings:** *(Local experiment.)*
  - The local Mailpit is v1.31.3 (`GET http://127.0.0.1:54324/api/v1/info`).
  - `POST /api/v1/send` with `{From:{Email,Name},To:[{Email}],Subject,HTML,Text,Headers}` returned `{"ID":…}`, and the message was found with `GET /api/v1/search?query=subject:"T8.1 probe"`.
  - The edge runtime container resolves `supabase_inbucket_court-booking-system` (`getent hosts` → 172.18.0.7), and port 8025 answers on the Docker network.
- **Recommendation:**
  - `EMAIL_TRANSPORT=mailpit` plus `MAILPIT_URL=http://supabase_inbucket_court-booking-system:8025` in `supabase/functions/.env`. Like `PAYMONGO_MODE=stub`, they're honoured only when `SUPABASE_URL` is the local http stack.
  - `EMAIL_TRANSPORT` is `resend | mailpit | disabled`. On the hosted project it defaults to `disabled`: the worker marks claimed rows `skipped` and `email-guest-link` doesn't send, so rows don't pile up unsent. *(User decision, 2026-10-19.)* `resend` requires `RESEND_API_KEY` (503 `email_unavailable` without it).
  - Smoke and e2e call `send-emails` directly with the local worker secret instead of waiting for cron, then read Mailpit's API.

### Deploy: SPA host, env vars, preview vs production
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Findings:**
  - Vercel builds Vite as-is. Deep links in a SPA need a `vercel.json` rewrite of `"/(.*)"` to `"/index.html"` ([Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)). Static files still win over rewrites, so hashed assets are served normally.
  - `VITE_*` env vars are inlined at build time. Vercel has separate Production, Preview and Development scopes, and `VITE_VERCEL_ENV` exposes which one is running (same page).
- **Gotchas:**
  - There's one Supabase project, so previews talk to the same database as production. That's acceptable for a portfolio app with test-mode payments. Say so in the README.
  - Only the publishable key goes in Vercel (CLAUDE.md).
- **Recommendation:**
  - Vercel connected to the GitHub repo. Production comes from `master`, and previews from other branches.
  - Env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in Production and Preview.
  - `vercel.json` with the SPA rewrite.

### Deploy: Auth URLs, Google OAuth, PUBLIC_SITE_URL, PayMongo return
- **Status:** Decided (SPEC §10, 2026-10-18)
- **Findings:**
  - Site URL is "the default redirect URL when no `redirectTo` is specified". The Redirect URLs allow-list supports `*` (not across `.` or `/`) and `**`. For Vercel previews, add `https://*-<team-or-account-slug>.vercel.app/**` ([redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)).
  - The app already passes `redirectTo` and `emailRedirectTo` from `window.location.origin` (`GoogleButton.tsx`, `SignupPage.tsx`), so no code change is needed. The new origin just has to be on the allow-list.
  - Google: the **Authorized redirect URI** stays the Supabase callback. The app's URL goes under **Authorized JavaScript origins** ([Google login](https://supabase.com/docs/guides/auth/social-login/auth-google)).
  - `PUBLIC_SITE_URL` is an exact-match allow-list. The first entry is the default for PayMongo returns and, from M8, for email links.
- **Gotchas:**
  - A preview origin isn't in `PUBLIC_SITE_URL`, so PayMongo returns from a preview land on production. That's acceptable and documented.
  - Don't `supabase config push` the local `config.toml`: it would push `site_url = localhost`. Hosted Auth settings are set in the dashboard and recorded in the T8.6 checklist.
- **Recommendation:**
  - Hosted Auth Site URL = production origin.
  - Redirect URLs: `https://<prod>/**`, `https://*-<slug>.vercel.app/**`, `http://localhost:5173/**`.
  - Google JS origin: add the production origin.
  - `PUBLIC_SITE_URL = https://<prod>,http://localhost:5173,http://127.0.0.1:5173`.
  - PayMongo needs no change: its return links come from `PUBLIC_SITE_URL`, and the webhook URL is the Supabase function URL.

### Email and deploy plan for T8.2–T8.3 and T8.6
- **Status:** Approved by the user on 2026-10-18, including `db:push` of the T8.2 migration. The user will use a verified domain for Resend (booking emails and Auth SMTP), and chose Vercel.
1. **Migration** (T8.2), applied with `db:push` to the linked project. *(As built: one `bookings` trigger replaces the `payments` trigger, and `finish_email` takes a text outcome; see SPEC §10, 2026-10-19.)*
   - `create extension if not exists pg_net`
   - `payments (provider_checkout_id) where provider_checkout_id is not null` index
   - `email_outbox` table with the columns above. RLS: an admin SELECT policy only, and grants revoked from anon and authenticated except a `select` that the policy gates.
   - `private.queue_booking_email()` triggers:
     - `bookings` AFTER INSERT (online only) → `booking_created`
     - `bookings` AFTER UPDATE OF `status`: to `confirmed` → `payment_confirmed`, to `cancelled` → `booking_cancelled`
     - `payments` AFTER UPDATE OF `review_status`: a proof (`method <> 'paymongo'`) rejected by an admin, excluding a proof auto-closed as superseded → `proof_rejected` with the note
   - Service-role-only RPCs: `claim_email_outbox(p_limit int)`, `finish_email(p_id uuid, p_ok bool, p_error text)`, `claim_guest_link_email(p_ref text, p_token text)` (checks the hash, claims a still-pending `booking_created` row, returns its data). All `security definer`, `search_path = ''`, with `P0001` hints.
   - The cron job `send-emails`, every minute, `net.http_post` to Vault `email_worker_url` with header `x-worker-secret` from Vault `email_worker_secret`. It's a no-op when either secret is missing.
   - pgTAP `19_email_outbox.test.sql`: RLS for anon, player and admin; grants; each trigger (and no row for walk-ins, a superseded proof or a PayMongo row); claim, lease, backoff and `failed`; guest-link claim with a wrong token, a second call and a non-guest booking.
2. **Edge Functions** (T8.3):
   - `send-emails` (`verify_jwt = false`, constant-time check of the worker secret)
   - `email-guest-link` (`verify_jwt = false`, publishable key like the others)
   - `_shared/email.ts` (transport: Resend or local Mailpit) and `_shared/emailTemplates.ts` (Vitest)
   - Client: `create_booking` success calls `email-guest-link` for guests (fire-and-forget, errors ignored).
   - `npm run smoke:emails`, and an e2e check that the guest booking-created email in Mailpit has the `#token=` link.
3. **Secrets:** `EMAIL_TRANSPORT`, `EMAIL_FROM`, `EMAIL_WORKER_SECRET`, local `MAILPIT_URL`, and `RESEND_API_KEY` (unused until Resend is switched on) in `supabase/functions/.env.example`. Vault holds `email_worker_url` and `email_worker_secret` on the linked project only (set by hand in T8.6, never committed).
4. **Deploy** (T8.6), as above. **No Resend and no Auth custom SMTP for now** (user decision, 2026-10-19): `EMAIL_TRANSPORT=disabled` on the hosted project, and Auth stays on Supabase's default SMTP (team members only). Email and password sign-up therefore can't confirm for visitors, so `/signup` points them to Google or guest booking. Confirmation stays on: turning it off would let anyone claim another email's guest bookings.
5. **Refinements from the T8.1 review.** These are binding for T8.2 and T8.3. They don't change the approved design.
   - **Email triggers must never fail the business transaction.**
     - Use `insert … on conflict do nothing` with the partial-unique predicate.
     - The status trigger also checks `old.status is distinct from new.status`.
     - Add a pgTAP case: a duplicate event doesn't fail the RPC. This matters most for the webhook, where a failure would make PayMongo retry forever.
   - Guest `booking_created` rows are queued with `next_attempt_at = now() + 10 min`. Player rows send at once.
   - Before sending `booking_created`, the worker re-reads the booking's current status, so the email never reports a stale "pay within 60 min" after a later event. It skips the email, or renders it from the current state.
   - A Resend `409` on a reused idempotency key, such as the guest-link send followed by the fallback retry, counts as **sent** and isn't retried. Vitest covers this.
   - `email_outbox` grants: `select` to `authenticated` only (gated by the admin policy), nothing to `anon`.
   - `proof_rejected` is queued only for admin rejections (`reviewed_by is not null`), not for a proof auto-closed by the webhook. Its data says whether this was the final rejection (booking `rejected`, slot freed).
   - `email-guest-link` takes the recipient only from the outbox row, and gives one uniform response whatever went wrong (`not_found` convention, SPEC §6).
   - The cron `net.http_post` sets `timeout_milliseconds` explicitly. The lease covers a worker that's cut off.
   - The outbox `status` also has `skipped` (transport disabled). A daily cron purges `sent`, `skipped` and `failed` rows older than 30 days (PII retention). Note it in SPEC §6.
   - The worker secret sits in pg_net's queue for a short time. That's the documented pattern; rotate the secret if it leaks.
   - In T8.2, SPEC §6 gains the `email_outbox` model, its RLS summary and the Server API rows for the three RPCs and two functions.

## Milestone 9: Venue admin upgrades

Researched on 2026-10-20 from the current migrations and client code, with local experiments against the running local stack. The user approved the breakdown and every recommendation on 2026-10-20.

### Shipping DB changes while production is live
- **Status:** Decided (SPEC §10, 2026-10-20)
- **Question:** Since T8.6, production runs `master` against the one linked database. What happens when `db:push` lands before the matching frontend is merged?
- **Findings:**
  - `db:push` changes the live database at once, but the deployed frontend only changes when `develop` is merged into `master`. In between, the live site runs the old frontend against the new schema.
  - `create or replace function` can't change a function's result columns. Local experiment: `create or replace function pg_temp.f() returns table (a int, b text)` over `returns table (a int)` fails with `cannot change return type of existing function` and the hint "Use DROP FUNCTION … first". So `get_availability` must be dropped and recreated, which briefly removes it and loses its grants ([CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)).
- **Recommendation:** Expand, then deploy, then contract.
  - A migration only adds things or changes them compatibly. Columns stay, and a function only gains result columns. An old client reading `get_availability` ignores a new column.
  - Drop and recreate a function in the same migration (one transaction), and re-grant it.
  - Columns the new frontend no longer reads, such as `courts.photo_path`, are dropped in a later "contract" migration after that frontend is on `master`.

### Overnight and 24-hour opening hours (SPEC §5.2, §11 Q2)
- **Status:** Decided (SPEC §10, 2026-10-20)
- **Findings (current code):**
  - The rules are built on calendar days:
    - `operating_hours` has a `check (is_closed or open_time < close_time)`.
    - `private.validate_booking_slot` (create_walk_in migration) rejects a range whose local end date differs from its start date (`multi_day`) and checks `v_day + open_time … v_day + close_time`.
    - `get_availability` generates slots from `p_date + open_time` to `p_date + close_time`.
    - `private.local_today()` and `in_booking_window()` use the local calendar date.
    - `slot_price` uses the slot's own local day of week and hour.
  - The admin schedule page saves the seven `operating_hours` rows as seven separate updates (`catalog/api.ts`), which isn't atomic.
  - Experiment (local psql, Asia/Manila, opening day 2026-10-23), with the range `[d + open, d + (close <= open ? 1 : 0) + close)`:
    - 06–22 gives 16 h on the same day.
    - 06–05 gives 23 h, ending at 05:00 the next day.
    - 06–06 gives exactly 1 day (24 h).
    - 18–00 gives 6 h, ending at midnight.
  - Manila has no DST, but converting through `timestamp at time zone` stays correct even if the timezone setting changes.
- **Recommendation:**
  - **Storage:** keep `operating_hours` as it is and drop the `open < close` check. A close at or before the open means it closes the next day, and open = close means 24 hours. `is_closed` stays as it is. No new columns are needed, so the old frontend keeps working.
  - **One source of truth:**
    - `private.operating_day_range(p_day date) returns tstzrange`, null when closed.
    - `private.operating_day_of(p_ts timestamptz) returns date`: the local date `d` if `p_ts` is inside `d`'s range, else `d - 1` if it's inside that day's range, else null.
    - `private.operating_today()`: the operating day containing now, or else the local date.
  - **No overlaps between days:**
    - Day `d`'s range must end at or before day `d + 1` opens; a closed day never conflicts.
    - Checked by a new admin RPC `set_operating_hours(p_hours jsonb)`. It writes all seven rows in one transaction, validates them together, and raises a P0001 hint `hours_overlap`.
    - The client switches to it from the seven updates.
  - **Booking rules:**
    - A booking must fit inside one operating day's range. That replaces the calendar-day `multi_day` check, and the same hint is kept.
    - The booking window and "today" (walk-in form, dashboard) count operating days.
    - Blackouts are already instant ranges and don't change.
  - **Pricing:** an after-midnight slot is priced from its **operating day's** rate row at the slot's local hour. A 1 AM slot after a Friday opening uses Friday's row, hour 1, which matches how `/book` groups it under Friday. *(Alternative: the slot's calendar day, Saturday's row. That's simpler SQL, but the rate grid row then doesn't match the day the player picked.)* Existing rates don't change, because today no slot falls after midnight.
  - **Display:** `/book` keeps one operating date per grid, and after-midnight rows carry a "next day" marker. Booking pages show the real calendar date and time of the booking.

### Sport order (SPEC §11 Q3)
- **Status:** Decided (SPEC §10, 2026-10-20)
- **Findings:** `sport` is a Postgres enum, and `get_availability` and `listCourts` order by the enum's declaration order (`order by c.sport`). There are no per-sport attributes anywhere else, and the four sports are fixed (adding a sport is out of scope).
- **Recommendation:** `venue_settings.sport_order public.sport[]`. A check makes it hold every enum value exactly once, and it defaults to the current enum order. Readers order by `array_position(sport_order, sport)`. A `sports` table would be heavier (a new table, RLS and a join) for no new capability.

### Court order and deletion
- **Status:** Decided (SPEC §10, 2026-10-20)
- **Findings:** `courts.sort_order` exists but is a raw number field on `CourtEditPage`. `court_rates` has `on delete cascade` from courts. `bookings.court_id` would block deleting a court that has bookings. RESEARCH M6 says Storage objects must be removed through the Storage API, not by deleting their rows in SQL.
- **Recommendation:**
  - `move_court(p_court_id uuid, p_direction smallint)`, admin only: swaps the court with its neighbour within its sport and renumbers that sport's courts 0..n atomically.
  - `delete_court(p_court_id uuid) returns text[]`, admin only: refuses with hint `court_has_bookings` if any booking in any status ever used the court. Otherwise it deletes the court (rates and photo rows cascade) and returns the photo paths, so the client removes the files through the Storage API.
    *(As built, T9.5: it returns nothing, and the client removes every file under `courts/{id}/`. See SPEC §10, 2026-10-20.)*

### Court photos (SPEC §11 Q4)
- **Status:** Decided (SPEC §10, 2026-10-20)
- **Recommendation:**
  - A `court_photos` table (`id`, `court_id` with on delete cascade, `path` unique with a check under `courts/{court_id}/`, `sort_order`, `created_at`). Public read, admin write. **At most 6 per court** (trigger, hint `too_many_photos`).
  - **The first photo is the cover**, so the admin changes the cover by reordering. There's no separate cover flag that could disagree with the order.
  - `reorder_court_photos(p_court_id, p_ids uuid[])` reorders atomically.
  - Existing `courts.photo_path` values are copied in as photo 0. The column is dropped in the M9 contract migration after the new frontend ships.
  - The public gallery is a CSS scroll-snap strip with previous and next buttons and alt text. No library.

### Booker names on slots
- **Status:** Decided (SPEC §10, 2026-10-20; the first-name rule on 2026-10-19)
- **Recommendation:**
  - `get_availability` gains `booker_first_name text`: the first word of `bookings.guest_name` for any active booking (pending, submitted or confirmed, walk-ins included), and null otherwise. It never returns email, phone or the full name.
  - The admin day view reads `bookings` directly. Admins already have SELECT through RLS, so no new RPC is needed.

### Open play sessions (T9.11c)
- **Status:** Decided (SPEC §10, 2026-10-22; the user approved the plan, title + details + 3 links, and multi-court sessions)
- **Question:** How are one-off open play sessions stored, how do they and bookings exclude each other, and what do players see?
- **Findings** (from the current migrations and the Postgres docs):
  - `blackouts` (catalog migration) has one optional `court_id` (null = every court), a reason and no details. Admins write it **directly** through table grants. Nothing stops a blackout over existing bookings, so it has no clash check to reuse.
  - Bookings are kept apart by the exclusion constraint on `bookings (court_id, during)`. A constraint can't look at another table, so a session table needs its own rule. Each side checks the other inside its RPC, and the two must be serialized: otherwise a booking and a session that start at the same moment both see "no clash" and both commit.
  - The paths that make a booking occupy a slot are `create_booking`, `create_walk_in` (both through `private.validate_booking_slot`) and the PayMongo revival of a lapsed hold in `record_paymongo_payment`, which already re-checks blackouts. `review_payment` only acts on `payment_submitted` bookings, and a rejection gives a fresh hold to a booking that never stopped occupying its slot. `private.expire_holds()` only releases slots. So if a session can't be created over an **active** booking, `review_payment` and the cron need no change.
  - Snapshots: "STABLE and IMMUTABLE functions use a snapshot established as of the start of the calling query, whereas VOLATILE functions obtain a fresh snapshot at the start of each query they execute" ([Function Volatility Categories](https://www.postgresql.org/docs/current/xfunc-volatility.html)). `validate_booking_slot` is STABLE, so the lock has to be taken by its volatile caller in an **earlier statement**. A lock taken inside it would still check against a snapshot from before the wait.
  - Transaction-level advisory locks (`pg_advisory_xact_lock`) are released at commit or rollback ([Advisory Locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS); `.agents/skills/supabase-postgres-best-practices/references/lock-advisory.md`). T9.11 already uses one for `operating_hours`. Taking several in a fixed order avoids deadlocks (`lock-deadlock-prevention.md`).
  - Deadlock trap: `record_paymongo_payment` locks the booking row first. If it then waited for a court lock held by `create_booking`, which updates lapsed holds on that court to `expired`, the two would wait on each other. So the revival takes the court lock **before** the row lock, and the session RPCs don't update bookings at all: a lapsed hold doesn't count as a clash, and the revival re-checks sessions.
  - Changing `get_availability`'s result columns needs drop and recreate plus re-grants, in one migration (RESEARCH M9 "Shipping DB changes while production is live").
- **Recommendation:**
  - **Storage:** a new `open_play_sessions` table (`title` 1–80, `details` up to 2000, `links` jsonb, `starts_at`, `ends_at`, `created_by`, `created_at`, `updated_at`) and `open_play_courts (session_id, court_id, during)`, so **one session can cover several courts**. `during` is a copy of the session's range, written only by the RPCs, so an **exclusion constraint** (`court_id with =, during with &&`) stops two sessions overlapping on a court. Blackouts stay as they are.
  - **Links:** up to 3 `{label, url}` pairs. Labels are 1–40 characters, URLs are `https://` with a host, at most 500 characters. A check constraint calls an immutable `private.valid_open_play_links(jsonb)`. Any fee goes in the details text.
  - **Shape:** on the hour, at least one hour, within one operating day's opening hours (the grid shows nothing else), starting in the future, at least one active court.
  - **No clashes:** each court has an advisory lock key, `hashtextextended('court_slots:' || court_id, 0)`. `create_booking`, `create_walk_in` and the PayMongo revival take their court's lock before checking. The session RPCs take every affected court's lock in uuid order, then refuse active bookings (`slot_unavailable`, naming the courts and times) and overlapping sessions. `validate_booking_slot` refuses a slot in a session (hint `open_play`, "That time is reserved for open play."). The revival treats a session like a blackout (outcome `late`).
  - **RPCs** (security definer, admins only, `execute` for `authenticated`): `create_open_play(p_court_ids uuid[], p_start, p_end, p_title, p_details, p_links jsonb) returns uuid`, `update_open_play(p_id, …same)` (refused once the session has started, hint `session_started`), `delete_open_play(p_id)` (allowed at any time, which frees the remaining slots). No table write grants. RLS: anyone reads both tables, and there are no write policies.
  - **Availability:** `get_availability` gains `open_play_session_id uuid`, and the new status `open_play` sits after `booked` and `blackout` and before "in progress". The public details come from the table (public read).
  - **Production order:** the live frontend (PR #9) doesn't know `open_play`, and would show such a slot as a disabled blank button. Don't create sessions on production until T9.11d is on `master`.

### Venue info: location, socials, info sections, amenities (T9.11g)
- **Status:** Decided (SPEC §10, 2026-10-22; the user approved the plan, the key-if-set map and lucide-react)
- **Question:** How does the venue store and show its location, social links, admin-defined info sections and amenities?
- **Findings:**
  - **Embedded map.** The official Maps Embed API is "available at no charge with unlimited usage", but every URL carries `key=…`: `https://www.google.com/maps/embed/v1/place?key=API_KEY&q=…`, where `q` is a place name, an address, a plus code or a Place ID ([Embed API get started](https://developers.google.com/maps/documentation/embed/get-started)). The key ends up in the page anyway, so it's a browser key restricted by HTTP referrer, not a secret. The keyless `https://maps.google.com/maps?q=…&output=embed` works today but isn't documented anywhere, so it can stop working without notice.
  - **"Open in Google Maps."** Maps URLs need no key: `https://www.google.com/maps/search/?api=1&query=…` ([Maps URLs](https://developers.google.com/maps/documentation/urls/get-started)).
  - **Headers.** `vercel.json` has only the SPA rewrite and `index.html` has no CSP, so nothing blocks a `www.google.com` iframe. If a CSP is added later, it needs `frame-src https://www.google.com`.
  - **Body format.** `payment_instructions` is rendered by `SimpleMarkdown` (paragraphs, line breaks, `**bold**`; React escapes the rest, so there's no raw HTML). Info sections can reuse it.
  - **Ordering.** Courts are reordered with `move_court(id, direction)` (security definer; renumbers `sort_order` 0..n-1).
  - **Lesson from T9.11c.** A check constraint that calls a `private` function needs `execute` for every role that writes the table. Admin RLS writes run as `authenticated`. So the URL checks here are written inline in the constraint, without calling a function.
  - **Icons.** `lucide-react` 1.61.0 is ISC-licensed, and each icon is its own ES module, so only the icons imported reach the bundle. Measure the real cost after the build (H6).
- **Recommendation:**
  - **Location:** `venue_settings` gains `address` (≤ 300) and `maps_query` (≤ 300; what the map searches, falling back to the address). The embed URL is **built from these fields, never pasted**: the Embed API when `VITE_GOOGLE_MAPS_EMBED_KEY` is set (a free key, referrer-restricted to the production domain and localhost), otherwise the keyless URL. The "Open in Google Maps" button uses Maps URLs.
  - **Socials:** a table `venue_social_links (platform venue_social_platform primary key, url)`. Platforms are `facebook`, `instagram`, `tiktok`, `youtube`, `x`, `messenger` and `website`. The URL is `https://` (≤ 500), and an inline check limits each platform to its own hosts: facebook.com or fb.com; instagram.com; tiktok.com; youtube.com or youtu.be; x.com or twitter.com; m.me or messenger.com; any host for `website`. Anyone reads; admins write through RLS (upsert and delete).
  - **Info sections:** a table `venue_info_sections (id, title 1–80, body ≤ 5000 in the SimpleMarkdown subset, sort_order, timestamps)`. Anyone reads; admins insert, update and delete through RLS. `move_info_section(id, direction)` reorders like `move_court`. The migration pre-fills Waiver, Reminders and policies, Cancellation and refund policy (matching the app's rules: free cancellation up to the cutoff, no refunds through the app) and House rules with editable starter text.
  - **Amenities:** a table `venue_amenities (id, builtin_key, custom_name, created_at)` with exactly one of the two set. `builtin_key` is unique and limited to 15 keys (restrooms, parking, showers, canteen, cafe, tables, night_lights, wifi, lockers, aircon, water_station, first_aid, equipment_rental, seating, pro_shop); `custom_name` is 1–40 characters and unique ignoring case. A row means the amenity is switched on. They're shown in catalog order, then the custom ones in the order they were added; there's no reordering. Icons come from `lucide-react`, with a generic icon for custom amenities. Anyone reads; admins insert and delete through RLS.

### Theme (SPEC §11 Q1)
- **Status:** Decided (SPEC §10, 2026-10-20)
- **Recommendation:**
  - A **dev-only** palette preview route (`import.meta.env.DEV`, so it's never in the production bundle) shows 4 palettes on the real slot grid, buttons, badges and alerts, in light and dark mode. Each palette gets a computed WCAG contrast table (a `contrast()` helper with Vitest).
  - The user picks one. The tokens in `src/index.css` are swapped (the `--slot-*` tokens follow automatically), and the axe e2e confirms contrast.

## Milestone 10: Product improvements

Researched on 2026-10-25 (T10.1) from the current migrations and client code, with experiments on the local database and a scratch bundle build. The user approved every recommendation at the T10.1 plan gate on 2026-10-25.

### Date and hour picker
- **Status:** Decided (SPEC §10, 2026-10-25)
- **Findings:**
  - **Version.** `react-day-picker` 10.0.2 (2026-09-30) is current. v10 renamed the package to **`@daypicker/react`**; the old name stays as a compatibility alias, and `@daypicker/react` 10.0.2 depends on it (`npm view @daypicker/react dependencies`). Its peer is `react >=16.8`, so React 19 is supported. It depends on `date-fns` ^4 and `@date-fns/tz` ([Upgrading to v10](https://daypicker.dev/upgrading)).
  - **v10 changes that matter here:** the stylesheet is `@daypicker/react/style.css`; `fromDate`/`toDate` are gone (use `hidden`/`disabled` matchers with `before`/`after`, plus `startMonth`/`endMonth` to limit navigation); `initialFocus` became `autoFocus`; the `onDay*` handlers were removed ([Upgrading to v10](https://daypicker.dev/upgrading)). The `today`, `startMonth`, `endMonth`, `autoFocus` and `footer` props are in the 10.0.2 type definitions (`dist/esm/types/props.d.ts`).
  - **Bundle cost (measured).** In a scratch esbuild bundle (minified, production React), `<DayPicker mode="single" disabled={…}>` adds **74.6 kB raw / 22.5 kB gzip** of JS over a React-only baseline (298.3 vs 223.7 kB raw; 91.6 vs 69.1 kB gzip). The `timeZone` prop made no difference (the tz code is bundled either way). `style.css` is 11.3 kB, **2.2 kB gzip**. For comparison, the whole public `index` chunk is 82.9 kB (25.9 kB gzip), so a calendar loaded eagerly on `/book` would almost double it.
  - **Styling.** Override the CSS variables under `.rdp-root` after importing the stylesheet: `--rdp-accent-color`, `--rdp-accent-background-color`, `--rdp-day-width`/`--rdp-day-height` (44px by default, a good touch target), `--rdp-today-color`, `--rdp-selected-border`, `--rdp-disabled-opacity`, `--rdp-outside-opacity`. Dark mode overrides the same variables under the dark theme selector. `classNames` replaces or extends classes (`getDefaultClassNames()`) ([Styling](https://daypicker.dev/docs/styling)). So our `--accent`, `--surface` and `--text` tokens map onto the `--rdp-*` variables, and the theme follows automatically.
  - **Keyboard and screen readers.** Arrows move by day and week, Shift+arrows by month and year, PageUp/PageDown by month, Home/End to the week's start and end, Enter/Space selects; focus is managed by the component; `labels` customizes the ARIA labels, `aria-labelledby` names it, and the `footer` can be a live region that announces the selection. It follows the APG date picker dialog pattern and claims WCAG 2.1 AA ([Accessibility](https://daypicker.dev/guides/accessibility)).
  - **Time zones.** The `timeZone` prop plus `TZDate` makes it read and write instants in a zone ([Setting the time zone](https://daypicker.dev/localization/setting-time-zone)). We don't need instants: every picker value here is a venue-local calendar date (`YYYY-MM-DD`), and `lib/time.ts` already converts dates and hours to instants (`zonedLocalToISO`).
  - **Hours.** `catalog/hours.ts` already has `daySpan()` (open hour and an end past 24 for overnight days) and `operatingDayRange()`. Asia/Manila has had no DST since 1978, so every venue-local day has 24 hours. The helpers should still go through `zonedLocalToISO` rather than add hours to an instant by hand.
  - **What each form needs:**
    - `save_open_play` refuses a session that doesn't fit within one operating day (`outside_hours`), so start + duration covers it completely.
    - Blackouts are written directly, can be any length (multi-day maintenance), may cover closed hours, and are publicly readable.
- **Recommendation:**
  - **Library:** `@daypicker/react` 10.0.2 (exact pin), with `mode="single"` and **no `timeZone` prop**. Convert between `YYYY-MM-DD` and a local `Date(y, m - 1, d)` in one helper. `today` comes from `operatingToday()`/`todayInZone()`, never the browser clock. Disabled days are `{ before: first }`, `{ after: last }` and `{ dayOfWeek: closedDays }` matchers, and `startMonth`/`endMonth` limit navigation.
  - **Components** in `src/components/`:
    - `DatePicker`: "Today" and "Tomorrow" quick picks plus a button showing the chosen date. It opens the calendar in a dialog (`<dialog>`, focus returns to the button). The calendar is its own module loaded with `React.lazy`, so it costs nothing until it's opened.
    - `HourPicker`: buttons for one operating day's hours, overnight ones labelled "12 AM (next day)".
    - `DurationPicker`: 1h, 2h… up to what's left of that operating day.
  - **Helpers** in `src/lib/pickerHours.ts` (Vitest): `dayHours(hours, date, tz)` → `{ start, label, nextDay }[]`, `maxDuration(…)`, `rangeFrom(start, hours)`, and a `calendarHours(date, tz)` variant with all 24 hours for blackouts.
  - **`/book`** gets the calendar through the lazy chunk: about **+22.5 kB gzip JS and 2.2 kB CSS, loaded only when the calendar is opened**, and nothing added to `index`. Admin pages load the same chunk.
  - **Blackouts keep a range** (decides the T10.3 question): "From" date + hour and "Until" date + hour, with the 24 calendar hours (not operating hours, since blackouts may cover closed time), and "until" defaulting to the same day. **Open play** uses date + start hour + duration within the operating day.

### Merged blocks on the slot grids
- **Status:** Decided (SPEC §10, 2026-10-25)
- **Findings:**
  - `SlotGrid` and `DayView` are real `<table>`s with `th scope="col"` (courts) and `th scope="row"` (hours). `rowspan` and `colspan` keep that semantic: a spanning cell belongs to the column header and the row headers it starts in ([W3C WAI tables tutorial](https://www.w3.org/WAI/tutorials/tables/)). A CSS grid would lose the table semantics and need ARIA grid roles rebuilt by hand.
  - Every slot button already has an `aria-label` with the court, the range and the state, so a merged button just labels the full range and every court it spans ("Court 1 and Court 2, 2 PM – 5 PM, Closed"). Focus order stays row by row: a merged cell is reached once, in the row it starts.
  - `get_availability` already resolves one booking per slot (at most one, by the exclusion constraint) and one open play session (at most one). Blackouts are matched with `exists`, so it needs to pick one id. Booking ids and reference codes are private; blackouts (`Anyone can read blackouts`) and open play sessions are public, so their ids leak nothing.
  - A slot's status is `past` once it has ended, even if it was booked. A booking in progress is therefore split into its ended part (each `—`) and its booked rest, which merges.
  - Phone layout: the grid already scrolls sideways inside `.table-scroll` with sticky time and court headers. A tall merged cell scrolls with its rows; nothing changes there.
- **Recommendation:**
  - `get_availability` gains `block_key text` (expand: drop and recreate, re-grant, as in M9):
    - **booked:** `left(encode(sha256(convert_to('booking:' || b.id, 'UTF8')), 'hex'), 16)`. It stays the same across refetches (stable React keys) and can't be reversed into the uuid.
    - **open play:** the session id.
    - **blackout:** `'blackout:' || bo.id`, the lowest overlapping id. An all-courts blackout gives every court the same key.
    - free, past and in-progress free slots: null.
  - Keep the `<table>` and use `rowSpan`/`colSpan`. A pure `groupBlocks(times, courts, slotsByCourt)` returns per-cell `{ rowSpan, colSpan } | 'covered'`. It merges down while the key repeats on consecutive rows, and across only when neighbouring courts have the same key and the same rows. Blocks are cut at the first visible row, so a block that started the day before begins at the top. Free slots never merge.

### Earnings
- **Status:** Decided (SPEC §10, 2026-10-25)
- **Findings:**
  - **When money comes in.** Every approved payment already has `reviewed_at`:
    - `review_payment` sets it when staff approve a proof;
    - `record_paymongo_payment` sets it to `now()` when the webhook records the payment, which is the paid time to within a webhook delay;
    - `create_walk_in` sets it at creation.

    `payments_one_approved_per_booking` keeps one approved row per booking. PayMongo money that wasn't accepted is stored as `rejected` (refund due), so `review_status = 'approved'` already leaves it out. Today's `TakingsCard` (`fetchApprovedPayments`) reads exactly this (SPEC §10 2026-10-17: a cash basis by venue-local calendar date). **No `received_at` column is needed.**
  - **Cancelled after payment.** The approved payment stays (no refunds through the app), so it stays in "collected", as it does today.
  - **Weeks.** Postgres `date_trunc('week', …)` starts on Monday (ISO): `2026-10-25` (a Sunday) → `2026-10-19`, `2026-10-26` → `2026-10-26` (local query).
  - **Day boundaries.** Money is counted by the venue-local calendar date (as today's takings are). Hours are counted by **operating day** (`private.operating_day_range(d)`), so a session at 1 AM on an overnight Saturday is Saturday's, as in the day view.
- **Recommendation:**
  - One admin-only RPC `get_earnings(p_from date, p_to date)` (inclusive dates, at most 366 days, `security invoker` plus an explicit `private.is_admin()` check, `forbidden` otherwise). It returns jsonb:
    - **collected:** per method, total, `count`, and the same for the **previous period** (the same number of days just before);
    - **refunds_due:** count and total of `method = 'paymongo' and review_status = 'rejected'` by `reviewed_at`, the same filter as today's `fetchRefundsDue` (rejected proofs are `rejected` too, and must not count);
    - **daily:** per date, collected and booked hours;
    - **hours:** per court and per sport, `open_hours`, `blackout_hours`, `sold_hours`, `open_play_hours`;
    - **coming_up:** count and value of confirmed bookings that start after `now()`.
  - **Occupancy** = sold ÷ (open − blackout):
    - **open:** for each operating day in the range, the hours of `operating_day_range(d)` × each active court;
    - **blackout:** blackout hours clipped to the open hours (overlapping blackouts counted once, as a `tstzmultirange` union);
    - **sold:** hours of `confirmed` bookings of any source, rescheduled continuations included, clipped to the day;
    - **open play:** hours shown on their own line and kept out of "sold".

    Only courts active now are counted (a court switched off mid-range drops out; noted in the UI copy).
  - **Chart:** plain CSS bars (a `<ul>` of bars with heights from the data) with the amount as visible text on each bar and a "Show as table" list, so it doesn't rely on colour or hover. There's no chart library: one bar series doesn't need one.

### CSV export
- **Status:** Decided (SPEC §10, 2026-10-25)
- **Findings:**
  - **RFC 4180:** quote fields that contain commas, double quotes or line breaks, double the quotes inside them, and end lines with CRLF ([RFC 4180](https://www.rfc-editor.org/rfc/rfc4180)).
  - **Formula injection.** A cell starting with `=`, `+`, `-`, `@`, a tab, CR or LF (or their full-width forms `＝ ＋ － ＠`) can run as a formula. OWASP recommends quoting each field and prefixing a single quote. A tab prefix survives Excel re-saving better, but it changes the data ([OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection), which redirects to community.owasp.org). Phone numbers like `+63…` hit this rule.
  - **Excel and UTF-8.** Excel opens a double-clicked CSV in the legacy code page unless the file starts with a UTF-8 BOM, which garbles `ñ` and `₱` ([Trac #6656](https://trac.edgewall.org/ticket/6656), [domainpunch KB](https://learn.domainpunch.com/wmdsed/kb/unicode-excel/)).
  - **Row limits.** PostgREST returns at most `max_rows` (1000 on Supabase) per request, so a month of bookings has to be read in pages with `.range()`.
  - **Data Privacy Act (RA 10173).** Personal data must be processed under transparency, legitimate purpose and **proportionality**, with organizational, physical and technical security measures ([IRR of RA 10173](https://privacy.gov.ph/wp-content/uploads/2023/06/IRR_RA-10173-as-amended.pdf), Rule IV §18 and Rule VI). An export of names, phones and emails is a copy of personal data that leaves the app's access controls.
- **Recommendation:**
  - A pure `toCsv(headers, rows)` in `features/admin/csv.ts`:
    - every field quoted, with `"` doubled;
    - a leading `'` when the trimmed value starts with `= + - @`, a tab, CR, LF or a full-width form;
    - CRLF line endings and a `﻿` BOM;
    - amounts as plain numbers in a column named for the currency (`amount_php`), so the `₱` sign never appears in a number cell;
    - times as `YYYY-MM-DD HH:mm` in the venue zone, named in the header (`start (Asia/Manila)`).
  - Two exports, read in pages of 1000 through the admin's RLS:
    - **bookings** by play date: reference, court, sport, start, end, status, source, name, phone, email, amount;
    - **payments** by received date (`reviewed_at`; approved rows, plus refund due = `method = 'paymongo' and review_status = 'rejected'`, never rejected proofs): reference, method, amount, reference number, received, status.
  - Download through a `Blob` and `URL.createObjectURL`, with a filename that includes the range.
  - DPA: an "Include contact details (phone, email)" checkbox, **off by default**, plus a line under the button: "Contains personal data. Store it securely and delete it when you no longer need it." Names are always included, because staff need them to match bookings.

### Rescheduling (T10.9 design)
- **Status:** Decided (SPEC §10, 2026-10-25): walk-in slot rules, no cascade on cancel
- **Findings (current code):**
  - **Slot rules.** `validate_booking_slot(court, start, slots, p_walk_in)` checks:
    - the input shape and an active court;
    - start on the hour;
    - online bookings start in the future, while a walk-in may start in the hour in progress;
    - one operating day, and the booking window (skipped for walk-ins);
    - no blackout and no open play.

    It doesn't look at other bookings: the exclusion constraint `bookings_no_overlap` (court, during, for active statuses) does that.
  - **Locks.** `lock_court_slots(court)` is a per-court transaction advisory lock, taken by `create_booking`, the open play RPCs and the PayMongo revival before any row lock. That prevents deadlocks with `create_booking`.
  - **Emails.** `queue_booking_email` (AFTER INSERT or UPDATE OF status) returns early unless `source = 'online'`, and only reacts to status changes. So shortening a booking (`during` changes) sends nothing. A continuation inserted with `source = 'moved'` sends nothing either: no wrong `booking_created`. `email_outbox_once_per_booking` is unique on `(booking_id, kind)` except for `proof_rejected`.
  - **Guest link.** `get_guest_booking` matches on reference + `guest_token_hash` and expires 30 days after the booking's **own** end. `claim_guest_bookings` claims only `source = 'online'`. `cancel_booking` matches a guest on reference + hash.
  - **Payment invariant.** "Every confirmed booking has exactly one approved payment" is enforced by:
    - the partial unique index (at most one approved);
    - the RPCs: `record_payment_proof` needs `pending_payment`, `review_payment` needs `payment_submitted`, and the webhook needs a `paymongo_checkouts` row, so none of them can attach a payment to a confirmed continuation;
    - the pgTAP seed check in `08_payments`.

    The UI uses `payments.some(approved)` for "paid" and refund notes.
  - **Enums (local experiment).** `alter type … add value` followed by using the value in the same transaction fails with "New enum values must be committed before they can be used". `db push` runs each migration file in its own transaction ([ALTER TYPE](https://www.postgresql.org/docs/current/sql-altertype.html)).
  - **The live frontend.** The live frontend shows an unknown `source` without the walk-in label, which is harmless.
- **Recommendation:**
  - **Two migrations:** (1) `booking_source` + `'moved'` and `email_kind` + `'booking_rescheduled'` alone, then (2) everything else.
  - **Columns and constraints:**
    - `bookings.parent_booking_id uuid references bookings(id)`, indexed;
    - checks: `source = 'moved'` ⇔ `parent_booking_id is not null`, and a moved booking has `total_amount = 0`;
    - a payments BEFORE INSERT guard refuses rows for a `moved` booking (`hint = 'moved_booking'`).
  - **The parent is always the root.** A continuation points to the **original** booking, never to another continuation. A second split of a continuation also points to the root, and moving a continuation whole just updates it. So the guest read, claims and "moved part" lists are one-level queries, and `booking_changes` keeps the full history.
  - **`reschedule_booking(p_booking_id, p_from_start, p_new_court_id, p_new_start, p_reason)`** (security definer, admin only):
    1. Check the reason (1–500 characters).
    2. Read the booking's court without a lock, take `lock_court_slots` for the old and the new court **in uuid order**, then select the booking `for update` and refuse it if its court changed in between (`try_again`).
    3. Refuse anything not `confirmed` or already ended (`booking_ended`).
    4. `p_from_start` must be on the hour, within `[lower, upper)`, and not before the hour in progress (`from_past`).
    5. The new court must be active with the same sport (`different_sport`). The moved length is `upper - from_start`.
    6. Validate with `validate_booking_slot(new_court, new_start, hours, p_walk_in => true)`. That uses the walk-in rules (staff may move into the hour in progress, as at the counter, and aren't limited by the booking window). Every other rule applies.
    7. **Whole move** when `p_from_start = lower(during)` (whether or not it has started): update `court_id` and `during`. The exclusion constraint skips the row itself, so moving within the same court works.
    8. **Split** otherwise:
       - shorten the original to `[lower, from_start)`;
       - insert the continuation: `source = 'moved'`, `status = 'confirmed'`, `total_amount = 0`, a new reference code (same retry loop), `parent_booking_id` = root, and the parent's contact snapshot, `user_id`, `guest_token_hash` and `created_by` = the admin.
    9. An `exclusion_violation` becomes `slot_unavailable`.
    10. Insert the `booking_changes` row.
  - **`booking_changes`** (`id`, `booking_id`, `old_court_id`, `old_during`, `new_court_id`, `new_during`, `continuation_id`, `reason`, `changed_by`, `changed_at`) records the moved part. RLS:
    - admins read;
    - players read the changes of their own bookings (`booking.user_id = auth.uid()`);
    - no direct writes (only the RPC writes).
  - **Email:** a trigger AFTER INSERT on `booking_changes` queues `booking_rescheduled` for an `online` root booking with an email. It sets a new `email_outbox.change_id` (unique where not null), and `email_outbox_once_per_booking` also exempts `booking_rescheduled`. Walk-ins are never emailed (unchanged).
  - **Guest and player reads:**
    - `get_guest_booking` gains `continuations jsonb` (reference, court, start, end, status) and `changes jsonb` (old and new court and time, reason, when). The 30-day expiry runs from the latest end among the booking and its continuations. This changes the result shape: drop, recreate and re-grant.
    - A continuation's own reference also opens through the guest link, since it carries the same hash.
    - `claim_guest_bookings` claims `source in ('online', 'moved')` (continuations copy the parent's email).
  - **Cancel:** `cancel_booking` works on a continuation unchanged, by id or by reference + token. `queue_booking_email` returns early for `source <> 'online'`, so T10.9 extends it: cancelling a `moved` continuation whose root is `online` queues `booking_cancelled` to the root's contact. **Recommended: no cascade.** A continuation only exists once the parent has started, so the player can't cancel the parent anymore. If staff cancel the parent's remaining hour, the admin form warns: "The moved part CB-… stays booked."
  - **Invariant, restated:** every confirmed booking that isn't `moved` has exactly one approved payment, and a `moved` booking has a root booking and no payments of its own. `08_payments` and the new tests check both. The UI's "paid" checks look at the root's payments for a continuation.
  - **Earnings:** sold hours include continuations (by play time). Money doesn't move. "Coming up" values a continuation at ₱0.
