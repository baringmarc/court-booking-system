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
