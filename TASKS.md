# TASKS.md

The working plan. [SPEC.md](SPEC.md) says **what** the product does; this file says **what to build next** and tracks progress. [RESEARCH.md](RESEARCH.md) holds the technical findings behind the tasks.

## Handoff

> Update this section at the end of every session or task. Keep it short; it's the first thing the next session reads.

- **Current milestone:** 8 (Polish). The breakdown was approved on 2026-10-18. M7 ✅ done on 2026-10-18.
- **Next task:** T8.2 (migration: email outbox + payments index). Its plan is already approved (RESEARCH M8 "Email and deploy plan"), including `db:push`.
- **State:** T8.1 done: the email and deploy plan is approved. M7 is complete, reviewer-passed and committed (7eb46be). PayMongo test mode is live on the linked project.
- **Blockers / notes:**
  - The >500 kB main chunk warning is back (`index-*.js` 614 kB in the 2026-10-18 build, see H6). Check it during T8.5/T8.7.
  - M8 emails: no Resend for now (user decision, 2026-10-19). Build and test through Mailpit; production runs `EMAIL_TRANSPORT=disabled`. T8.6 needs a Vercel project from the user. Never commit the Vault worker secret (or a Resend key, if one is added later).
  - Docker Desktop must be running for `npm run verify`. `npm run test:e2e` and `npm run smoke:proof` need the full local stack (`npx supabase start`).
  - Email confirmation is on locally (`config.toml`, matching the hosted project). Sign-up emails land in Mailpit at http://127.0.0.1:54324. e2e reads them with `confirmationLink()`. Don't turn it off: claims trust `email_confirmed_at`.
  - Guest links use `#token=`. Going to the same URL again is a hash-only navigation (no reload), so e2e leaves the page first (`openGuestLink`).
  - Venue media: paths are stored, not URLs (`mediaUrl()`). Uploads are downscaled in the browser and named with a new uuid. `remove()` fails silently without SELECT, so the code checks what it returned. Orphan listing query: RESEARCH M6.
  - `e2e/banner.spec.ts` skips itself when a banner is already set on the local stack (the banner is venue-wide). Remove it in `/admin/settings` to get the coverage back.
  - **Local PayMongo key trap:** the user's `sk_test_` key is now in the local `supabase/functions/.env`, and a test key always beats `PAYMONGO_MODE=stub`. The running edge runtime still has an empty key. After the next `supabase stop/start`, local runs would call the real PayMongo API, and `pay-online.spec.ts`, `smoke:paymongo` and the Stop hook would fail. Keep the local key **blank** for test runs (the key lives on the linked project). The user chose to manage that file themselves.
  - PayMongo on the linked project: secrets `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` and `PUBLIC_SITE_URL` (localhost only until T8.6). Webhook registered in the dashboard under Settings → Webhooks (Test Mode).
  - Local PayMongo setup: `supabase/functions/.env` (from `.env.example`) holds `PAYMONGO_MODE=stub`, `PUBLIC_SITE_URL` and the local webhook secret. Restart the stack (`supabase stop/start`) after adding a function or changing that file. `npm run smoke:paymongo` exercises both functions.
  - Open follow-ups:
    - a user decision on capping the fresh hold after a rejection at the start time (T4.6)
    - the Edge Function `index.ts` is checked only by smoke and e2e (no Deno type-check)
    - if the profile fetch fails, a real admin sees "Admins only" (T5.1, for the M8 error pass)
    - raw PostgREST errors in admin media saves (T6.4, for the M8 error pass)
    - the guest cancel path doesn't check the 30-day link expiry. That's harmless, since a cancel must be before the start (M7 added no token-authorized RPCs, so it's still fine).
    - M7 carry-overs: only QR Ph was paid for real (GCash, Maya and card are untested); the PHP 20 minimum is an assumption; a replay after a session is replaced returns `unknown_checkout`; the webhook stores an empty `provider_source` as `''`.

## How tasks work

- Only the **current milestone** is broken into tasks. Later milestones stay one-liners until we reach them, so each plan can use what we learned in the milestone before it.
- Tasks run **in order** unless `Depends` says otherwise. Each task should fit in one focused session.
- Status: `[ ]` todo, `[~]` in progress, `[x]` done, `[-]` dropped (say why).
- **Definition of done** (all three are required before ticking a box):
  1. Every acceptance criterion holds. DB criteria are proven by pgTAP tests in `supabase/tests/database/`.
  2. `npm run verify` passes.
  3. The `reviewer` agent reports no blocking issues against SPEC.md and this task.
- If a task changes behavior, update SPEC.md in the same task (and add a row to its decisions log if a choice was made).
- If a task turns out to be too big, split it here before continuing (T3.4a, T3.4b, …).

---

## Milestone 3: Booking

Goal (SPEC §9): `get_availability` with prices, the slot grid, `create_booking` with the exclusion constraint and pricing, and the booking detail page.

Out of scope for M3: proof upload, the payments table, the expiry cron job (M4); cancellation and claiming guest bookings (M5); emails (M6).

### [x] T3.1 Research: booking engine
- **Do:** Answer the M3 questions in RESEARCH.md (exclusion constraint, timezone-safe slot math in SQL, reference codes, guest tokens, error mapping, how to test RPCs). Record the decisions in SPEC §10.
- **Files:** `RESEARCH.md`, `SPEC.md`
- **Acceptance:**
  - Every M3 entry in RESEARCH.md has findings, sources and a recommendation.
  - Any choice that changes SPEC is logged in SPEC §10.
- **Notes:** Every M3 entry is Decided, backed by local-database experiments (default function grants, exclusion constraint, stale holds, two-session race, timezone math) and docs. SPEC §4, §6 and §10 are updated, and the findings are folded into T3.2–T3.6 and T3.10. The reviewer passed it and its minor findings are fixed. The local database was reset afterwards so the T3.2 migration has to install `btree_gist` itself.

### [x] T3.2 Migration: bookings table
- **Depends:** T3.1
- **Do:**
  - Add the `booking_status` and `booking_source` enums and the `bookings` table as in SPEC §6, without payments.
  - Install `btree_gist` in the `extensions` schema and add the `bookings_no_overlap` exclusion constraint over active statuses. Add `check (not isempty(during) and lower_inc(during) and not upper_inc(during))`.
  - Add an `updated_at` trigger and indexes on the foreign keys and on `user_id`.
  - Enable RLS. Players read their own rows and admins read everything. Grant no insert, update or delete to `anon` or `authenticated`.
- **Files:** `supabase/migrations/<ts>_bookings.sql`, `src/lib/database.types.ts` (regenerated)
- **Acceptance:**
  - pgTAP checks that two overlapping active bookings on the same court can't both exist.
  - An `expired`, `rejected` or `cancelled` booking doesn't block its range.
  - `anon` and `authenticated` can't insert into `bookings` directly.
  - `db:push` and `db:types` have been run.
- **Notes:** Migrations `20261017024421_bookings` and `20261017024910_bookings_contact_name_required` (a reviewer fix: the contact name is required so deleting a player can't fail). 22 tests in `supabase/tests/database/03_bookings.test.sql`. Pushed to the linked project and types regenerated. The reviewer passed it. SPEC §6 and §10 now describe the contact snapshot.

### [x] T3.3 Pricing function
- **Depends:** T3.2
- **Do:**
  - Add the timezone helpers `private.venue_tz()`, `private.local_day_bounds(date)` and `private.local_dow_hour(timestamptz)` (RESEARCH: Slot math).
  - Add `private.slot_price(court_id, slot_start timestamptz)` and `private.range_price(court_id, during tstzrange)`. They read `court_rates` for the day of week and hour in the venue timezone, and fall back to `default_hourly_rate`.
- **Files:** new migration
- **Acceptance:**
  - Weekday-evening and weekend peak rates from the seed data are applied.
  - A slot without an override uses the default rate.
  - Day of week and hour are computed in `Asia/Manila`, not UTC. Test with a slot that starts at 07:00 Manila time (23:00 UTC the previous day).
- **Notes:** Migration `20261017024946_pricing` adds `private.venue_tz`, `local_day_bounds`, `local_dow_hour`, `slot_price` and `range_price`, none callable by clients. 12 tests in `04_pricing.test.sql`, including a Friday-UTC trap rate. The reviewer passed it with no findings. `range_price` returns NULL for empty ranges or unknown courts, so callers must validate input first.

### [x] T3.4 RPC `get_availability(date, court_id?)`
- **Depends:** T3.3
- **Do:** Return one row per active court and slot on that venue-local date: `court_id`, `slot_start`, `slot_end`, `price` and `status` (`free` | `booked` | `blackout` | `past`). Only operating hours count. Expired `pending_payment` holds (`expires_at < now()`) count as free. No personal data.
- Follow the RESEARCH conventions: `security definer` (it reads `bookings`, which anon can't select), `search_path = ''`, revoke from `public, anon, authenticated` and then grant to `anon, authenticated`.
- **Files:** new migration
- **Acceptance:**
  - Callable by `anon`.
  - A closed day returns no slots.
  - Blackouts, both venue-wide and per court, are marked.
  - Slots that have already started are `past`.
  - Prices match `range_price` for each slot.
- **Notes:** Migration `20261017025156_get_availability` also adds `private.local_today()` and `private.in_booking_window()`. 20 tests in `05_availability.test.sql`. The reviewer passed it; the `past` test now forces 00:00–23:00 hours so it can't pass vacuously. A hold is expired when `expires_at <= now()`, and T3.5 must use the same comparison.

### [x] T3.5 RPC `create_booking(court_id, start, slots, guest_info?)`
- **Depends:** T3.4
- **Do:**
  - Validate every rule in SPEC §5.1–5.4: same venue day, inside operating hours, aligned to slots, no blackout, inside the booking window, not started, active court.
  - Compute the price on the server.
  - Generate `reference_code` (`CB-XXXXXX`).
  - For guests, require name, email and phone, generate a random token and store only its hash.
  - Set `expires_at = now() + payment_hold_minutes`.
  - Return `{id, reference_code, guest_token?}`.
  - Before inserting, set overlapping expired `pending_payment` holds on the same court to `expired` (RESEARCH: Exclusion constraint).
  - Map an exclusion violation to a clear "slot no longer available" error.
  - Follow the RESEARCH conventions: `security definer` with `search_path = ''`, revoke from `public, anon, authenticated` and then grant, and `P0001` errors with a `hint` code from the list in RESEARCH.
- **Files:** new migration
- **Acceptance:**
  - Each rule rejects with a distinct, readable error, with one pgTAP test per rule.
  - A logged-in user's booking gets `user_id = auth.uid()`, and the client can't override it.
  - Two concurrent bookings for the same slot produce exactly one success. Covered by the constraint (two-session evidence in RESEARCH); pgTAP checks the `slot_unavailable` mapping.
  - An expired-but-unswept hold doesn't block a new booking.
- **Notes:** Migration `20261017025456_create_booking` also adds `private.new_reference_code()`. 29 tests in `06_create_booking.test.sql` cover every error code, the guest and player flows, the server price, the 60-minute hold, stale-hold release and the reference-code retry and give-up. Checks run in this order: input, court, alignment, `slot_started`, window, `multi_day`, hours, blackout, so a past slot reports "already started". The reviewer passed it.
  - Follow-ups: (1) a signed-in user with no profile name and no email (only possible with phone or anonymous auth, which we don't use) gets a raw 23514 instead of `invalid_input`; fix it if phone auth is added. (2) The generated type shows `guest_token: string` but the value is null for players, so client code must treat it as `string | null`.
  - The client never sends a price.

### [x] T3.6 RPC `get_guest_booking(reference_code, token)` and the owner read path
- **Depends:** T3.5
- **Do:** Guests read one booking by reference code and token, compared in SQL as `guest_token_hash = sha256(convert_to(token, 'UTF8'))`. Follow the RESEARCH RPC conventions (`security definer`, `search_path = ''`, revoke and then grant, a `P0001` `not_found` error). Logged-in owners read their booking through RLS. Return court name, range, status, total, `expires_at` and the payment instructions.
- **Files:** new migration
- **Acceptance:**
  - A wrong token returns nothing, and the response doesn't reveal whether the reference code exists.
  - The token is never stored or logged in plain text.
- **Notes:** Migration `20261017025902_get_guest_booking`. 13 tests in `07_guest_booking.test.sql`: a wrong token and an unknown reference code give identical errors, effective `expired` status, the token isn't stored in plain text, and owner and other-player reads through RLS. Reference codes match case-insensitively, and the result includes the guest's own name and email (SPEC §10). The reviewer passed it. T3.7 needs a shared client `effectiveStatus()` because the owner path reads the raw status.

### [x] T3.7 Booking client layer and slot-selection logic
- **Depends:** T3.6
- **Do:**
  - Add `features/booking/api.ts` and `hooks.ts`, following the catalog pattern.
  - Add pure functions in `features/booking/selection.ts` for selecting consecutive slots: toggling, extending, rejecting gaps or busy slots, and showing the client-side total (display only).
- **Files:** `src/features/booking/*`
- **Acceptance:**
  - The selection logic has Vitest unit tests that cover edge cases: a gap in the selection, tapping a busy slot, deselecting a slot in the middle, and switching courts.
- **Notes:** Added `selection.ts`, `status.ts` (`displayStatus`: effective expired and display-only completed), `errors.ts` (hint codes, `isSlotGone`), `api.ts` and `hooks.ts`. `unwrap()` now throws `ApiError` with `code` and `hint`. `lib/time.ts` gains `todayInZone`, `addDays` and `parseTstzRange`. 25 new Vitest tests. Middle tap starts over, so a selection never has holes. The reviewer passed it. The UI must always render status through `displayStatus()`.

### [x] T3.8 `/book` page: slot grid
- **Depends:** T3.7
- **Do:** A date picker (from today to the end of the booking window) and a sport filter, then a court × time grid with the price per slot. Selection follows T3.7. A sticky summary bar shows the slots and total, with a "Continue" button that goes to checkout. Mobile-first.
- **Files:** `src/features/booking/BookPage.tsx` (+ components), `src/routes/router.tsx`
- **Acceptance:**
  - Loading, empty (closed day or no courts) and error states are handled.
  - Busy, blackout and past slots can't be selected.
  - The grid is usable at 360px wide.
  - Times are shown in the venue timezone.
- **Notes:** Added `BookPage`, `SlotGrid` (with a Testing Library test), `SelectionBar` and `checkoutParams` (the URL hand-off to checkout), plus the booking grid CSS. Date and sport live in the URL, and the selection is reconciled after each refetch. The reviewer passed it and its 3 minor findings are fixed. Follow-up: nobody has looked at the 360px layout in a real browser yet (it holds by design); check it by hand or with Playwright (H5).

### [x] T3.9 `/book/checkout`
- **Depends:** T3.8
- **Do:**
  - Show the summary and the server-priced total (from the availability response).
  - Guests fill in a form (name, email, phone). Logged-in players get the form prefilled from their profile.
  - Confirming calls `create_booking`, then redirects to `/booking/:ref`, with `?token=` for guests.
  - Handle the "slot taken" race with a message and a link back to the grid.
- **Files:** `src/features/booking/CheckoutPage.tsx`
- **Acceptance:**
  - Opening checkout without a selection redirects to `/book`.
  - The form validates its fields.
  - Server errors are shown in a readable form.
  - The availability query is invalidated after a booking succeeds.
- **Notes:** Added `CheckoutPage`, `CheckoutForm` (with a Testing Library test; field errors are accessible descriptions, outside the labels) and `contact.ts` (validation mirroring `create_booking`). The total comes from server slot prices. Redirects go to `/booking/:ref?token=` for guests, with `state.justBooked`. The reviewer passed it and its 2 minor findings are fixed.

### [x] T3.10 `/booking/:ref` detail page
- **Depends:** T3.9
- **Do:**
  - Show status, court, date and time, total, payment instructions (rendered markdown) and a countdown to `expires_at`.
  - For guests, show a "save this link" prompt.
  - Proof upload and cancel are placeholders for M4/M5.
  - Add `<meta name="referrer" content="no-referrer">` to `index.html` so the guest token in the URL never leaves in a `Referer` header (RESEARCH: Guest access tokens).
- **Files:** `src/features/booking/BookingPage.tsx`, `index.html`
- **Acceptance:**
  - Works for an owner who is logged in and for a guest with `?token=`.
  - A missing or invalid token shows a "booking not found" state.
  - The countdown shows as expired once `expires_at` has passed.
- **Notes:** Added `BookingPage` (guest and owner paths, a login prompt, not-found, and a save-link card with a copy button), `BookingSummary` (with a test; live countdown and effective status), `useNow`, `countdown.ts` and `components/SimpleMarkdown` (safe `**bold**` and line breaks, tested), plus the no-referrer meta tag in `index.html`. The reviewer passed it and its 2 minor findings are fixed: an empty `?token=` now shows not-found, and the cancel note appears only for active bookings.

### [x] T3.11 Close out M3
- **Depends:** T3.10
- **Do:**
  - Seed a few demo bookings so the grid shows busy slots, keeping `seed.sql` idempotent.
  - Mark M3 ✅ in SPEC §9.
  - Break M4 into tasks here, after running its research first.
- **Acceptance:**
  - `npm run verify` passes.
  - The reviewer signs off on the whole milestone diff.
- **Notes:** `seed.sql` now adds 5 demo bookings relative to venue-local today, idempotent, and skipping any that would overlap a real booking. They're applied locally and on the linked project. SPEC §9 marks M3 ✅. The milestone reviewer passed it. **Deferred:** breaking down M4 needs its own research and user approval, so it wasn't done in this run.
  - Follow-ups for M4: (1) the demo `confirmed` and `payment_submitted` bookings have no payment rows. Backfill approved or pending payments, or change their statuses, when `payments` lands, or they'll break the SPEC §3 "one approved payment per confirmed booking" rule. (2) Demo booking dates are fixed at the first run and go stale on the linked project.

---

## Milestone 4: Payments

Goal (SPEC §9): storage bucket, proof upload, admin review queue with the reject → re-upload loop, expiry job, walk-in flow, and the admin dashboard (`/admin`, SPEC §7).

> **Approved by the user on 2026-10-17**, including about 7 `db:push` runs, one Edge Function deploy, re-seeding the linked project, and pulling the full local Supabase stack. Running in milestone mode. Research is in RESEARCH.md, "Milestone 4".

Out of scope for M4: cancellation, My bookings and claiming guest bookings (M5); emails (M6).

### [x] T4.1 Research: payments
- **Notes:** RESEARCH.md M4 entries cover the Edge Function design, the storage bucket and read access, the pg_cron expiry job, and the review and walk-in rules. Local experiments: pg_cron re-scheduling by name is an upsert, and the storage schema can be tested with pgTAP. One point is checked in T4.5: whether `withSupabase` accepts `['user', 'publishable']`.

### [x] T4.2 Migration: `payments` table
- **Do:**
  - Add the `payment_method` and `payment_review_status` enums and the `payments` table as in SPEC §6.
  - Add `unique (booking_id) where review_status = 'approved'`, plus a partial unique index allowing one `pending` payment per booking.
  - Index the foreign keys.
  - Enable RLS: owners read their booking's payments, admins read all, and nobody writes directly.
  - Backfill payments for the M3 demo bookings in `seed.sql`: an approved payment for each confirmed booking, and a pending one with no file for the payment-submitted booking.
- **Acceptance:**
  - pgTAP covers both unique rules, owner, other-player, anon and admin reads, and that direct writes are rejected.
  - After seeding, every `confirmed` booking has exactly one approved payment.
- **Notes:** Migration `20261017032826_payments`. 17 tests in `08_payments.test.sql`: both unique rules, the checks, reads by anon, owner, other player and admin, no direct writes (admins included), and the seed rules. The seed backfills demo payments (the linked project gets them in T4.12). The reviewer passed it and its 3 minor findings are fixed, with SPEC §6 updated.

### [x] T4.3 Storage bucket `payment-proofs`
- **Depends:** T4.2
- **Do:**
  - Create the private bucket with a 5 MB limit and jpg/png/webp/pdf MIME types, in a migration.
  - Add SELECT policies on `storage.objects` for admins and the booking owner, matched on the first folder of the path. No client writes.
- **Acceptance:**
  - pgTAP checks the bucket config.
  - pgTAP checks that owners and admins can select their objects, other players and anon can't, and nobody but the service role can insert.
- **Notes:** Migration `20261017033115_payment_proofs_bucket`, live on the linked project. 10 tests in `09_payment_proofs_storage.test.sql`. Storage blocks direct SQL deletes, so the no-client-writes rule is checked through the policy list, which now rejects any storage write policy. The reviewer passed it. The signed-URL check against the live Storage API is in T4.10.

### [x] T4.4 Proof RPCs (service-role only) and guest view of payments
- **Depends:** T4.3
- **Do:**
  - Add `public.proof_target(ref, token, user_id)` and `public.record_payment_proof(booking_id, storage_path, method, amount, reference_number)`. Only `service_role` can execute them.
  - They check:
    - ownership: the user owns the booking, or the guest token matches
    - the booking is `pending_payment` and not expired
    - there's no other pending payment
    - the storage path is under `booking_id/`
  - Recording sets `payment_submitted`.
  - Recreate `get_guest_booking` so it also returns the payment attempts (method, amount, submitted time, review status, review note), without file paths.
- **Acceptance:**
  - pgTAP covers every rule and error code.
  - anon and authenticated can't execute the proof RPCs.
  - A wrong token gives `not_found`.
  - An expired hold can't receive a proof.
- **Notes:** Migration `20261017033337_proof_rpcs` (`get_guest_booking` recreated with `payments jsonb`, metadata only). 30 tests in `10_proof_rpcs.test.sql`: all 6 role/function privilege pairs and every branch of each error code. The reviewer passed it and both minor findings (test gaps) are fixed. Note: "one pending payment" relies on status checks plus the T4.2 unique index; T4.6 and T4.8 must never leave a `pending_payment` booking with a pending payment.

### [x] T4.5 Edge Function `submit-payment-proof`
- **Depends:** T4.4
- **Do:**
  - Add `supabase/functions/submit-payment-proof/index.ts` using `withSupabase`.
  - Add `supabase/functions/_shared/proof.ts` for multipart field validation and magic-byte file sniffing (≤ 5 MB; jpg, png, webp, pdf), and add that folder to the Vitest `include`.
  - Upload to `{booking_id}/{uuid}.{ext}` with the admin client, call `record_payment_proof`, and delete the object if recording fails.
  - First check locally whether `auth: ['user', 'publishable']` works, falling back to `none` with manual JWT verification (RESEARCH).
  - Deploy with `npx supabase functions deploy`.
- **Acceptance:**
  - Vitest covers sniffing (real headers, a spoofed MIME type, oversize) and form validation.
  - A local smoke test with `supabase functions serve` succeeds for a guest and for a player, and fails for a wrong token.
  - The function is deployed.
- **Notes:** `submit-payment-proof` uses `withSupabase({ auth: ['user', 'publishable'] })` with `verify_jwt = false` (checked locally; no fallback needed). `_shared/proof.ts` has 7 Vitest tests. `npm run smoke:proof` passes on the local stack: guest, player-session, wrong token, spoofed file, second proof, signed URL, and a refused direct upload. It's deployed to the linked project (GET returns 405 from the handler). The reviewer passed it; its minor findings are fixed (early Content-Length check, logged cleanup failures) and it was redeployed. Note: `index.ts` itself is checked only by the smoke test, because Deno isn't installed for type-checking.

### [x] T4.6 RPC `review_payment(booking_id, approve, note)`
- **Depends:** T4.4
- **Do:** Implement the approve and reject loop from RESEARCH "Review and walk-in rules" (admin only, note required on reject, `max_rejections`, a fresh hold window).
- **Acceptance:**
  - pgTAP covers approve, a first rejection (back to `pending_payment` with a new `expires_at` and the slot still held), a second rejection (`rejected`, slot freed), a missing note, a non-admin caller, and the wrong state.
- **Notes:** Migration `20261017034431_review_payment`. 23 tests in `11_review_payment.test.sql` (the full reject loop, `max_rejections = 1`, and players reading the rejection reason). The reviewer passed it with no findings, and confirmed that a `pending_payment` booking never coexists with a pending payment.
  - Follow-up (user decision): after a rejection, the fresh hold is `now() + payment_hold_minutes` with no cap, so it can run past the booking's start time. Should it be capped at the start time?

### [x] T4.7 Expiry job
- **Depends:** T4.2
- **Do:** Add `private.expire_holds()` and schedule it every minute with pg_cron (`expire-holds`).
- **Acceptance:**
  - pgTAP checks that only expired `pending_payment` holds change, the count it returns, and that the cron job exists with the right command.
- **Notes:** Migration `20261017034632_expire_holds_job`: `private.expire_holds()` with the pg_cron job `expire-holds` running every minute, live on the linked project. The proof RPCs now report `hold_expired` for swept holds too. 10 tests in `12_expire_holds.test.sql`. The reviewer passed it with no findings, after confirming the replaced functions differ only in the expiry check.

### [x] T4.8 RPC `create_walk_in`
- **Depends:** T4.6
- **Do:**
  - Move the shared slot checks into `private.validate_booking_slot(...)` and use them from both `create_booking` (recreated) and `create_walk_in`.
  - Walk-ins have no booking window and may start in the slot that is currently in progress.
  - Insert a `confirmed` walk-in booking and its `approved` payment in one transaction.
- **Acceptance:**
  - All existing `create_booking` pgTAP tests still pass unchanged.
  - New pgTAP tests cover the current-slot start, overlap, closed hours, blackouts, admin-only access, the amount override, `created_by` and `recorded_by`.
- **Notes:** Migration `20261017034910_create_walk_in` adds `private.validate_booking_slot` (the slot checks moved out of `create_booking`; the only differences are the two walk-in exceptions), recreates `create_booking` on top of it, and adds `create_walk_in`. 19 tests in `13_create_walk_in.test.sql`; `06_create_booking` passes unchanged. The reviewer passed it with no findings.

### [x] T4.9 Booking page: upload proof and the re-upload loop
- **Depends:** T4.5
- **Do:**
  - On `/booking/:ref`, replace the placeholder with a proof form: method, amount prefilled with the total, optional reference number, and a file with a preview.
  - Submit through the `api.ts` `functions.invoke` wrapper.
  - Show the payment history, the rejection reason and the re-upload prompt.
  - Show a warning (not a block) when the entered amount differs from the total.
- **Acceptance:**
  - Testing Library tests cover form validation, the mismatch warning and the rejected-proof state.
  - Loading, empty and error states are handled.
- **Notes:** Added `submitPaymentProof` (`functions.invoke` with FormData, errors become `ApiError` with a hint), `PaymentAttempt` on `BookingDetail` (guest JSON or owner RLS read), `proofInput.ts` (shares its limits with the Edge Function), `ProofForm` and `PaymentHistory`, plus the rejection, re-upload, under-review and final-rejection states in `BookingSummary`. 12 new Vitest tests. The reviewer passed it and both findings are fixed: the booking polls every 30 s while under review, and a keyed `ProofUpload` clears stale errors.

### [x] T4.10 `/admin/bookings`: list and review
- **Depends:** T4.6
- **Do:**
  - A lazy-loaded admin page with a list filtered by status, source and date.
  - A review panel: a signed-URL preview (image or PDF), the amount-mismatch warning, and approve or reject with a required reason.
- **Acceptance:**
  - Testing Library tests cover the filters and the review panel.
  - The page stays in the lazy admin chunk.
  - A signed URL works for an admin and is refused for a player, checked against local storage.
- **Notes:** Added `features/admin/api.ts` and `hooks.ts`, `bookingFilters.ts` (filters in the URL, review queue by default), `BookingFiltersBar`, `ReviewPanel` (image or PDF preview through a 60 s signed URL, mismatch warning, approve, reject with a reason) and `AdminBookingsPage`, lazy-loaded into its own 10 kB chunk. 12 new Vitest tests. `npm run smoke:proof` now checks that an admin's signed URL works (download 200), another player's is refused, and an admin can approve. The reviewer passed it and all 3 findings are fixed: newest first with a note at the 200-row cap, the panel scrolls into view on phones, and a review shows its outcome.

### [x] T4.11 `/admin` dashboard and walk-in form
- **Depends:** T4.8, T4.10
- **Do:** Show today's schedule, the number of proofs waiting (linking to the review queue), a "+ Walk-in" form (court, start, slots, name, phone, method, amount prefilled from availability), and today's takings by method.
- **Acceptance:**
  - Testing Library tests cover the walk-in form and the takings aggregation.
  - Loading, empty and error states are handled.
- **Notes:** Added `dashboard.ts` (startable walk-in slots and takings by method), `WalkInForm` (with a test) and `DashboardPage`, lazy-loaded into its own chunk. The proofs count links to the review queue. The reviewer passed it in 2 rounds. Round 1 found that a booked in-progress slot showed as `past`; the root-cause fix is migration `20261017040615_availability_in_progress_status`, which changes the status precedence: ended slots are `past`, then booked, then blackout, then started-but-free slots are `past` (SPEC §10). Today-only walk-ins and cash-basis takings are logged in SPEC §10.

### [x] T4.12 Close out M4
- **Depends:** T4.11
- **Do:** Re-apply the seed to the linked project, mark M4 ✅ in SPEC §9, and run a milestone review.
- **Acceptance:**
  - `npm run verify` passes.
  - The reviewer signs off on the milestone.
  - The M5 breakdown is proposed for approval.
- **Notes:** The seed was re-applied to the linked project: each confirmed demo booking has exactly one approved payment and CB-DEMQB3 has one pending payment (checked with a query). SPEC §9 marks M4 ✅ (v0.6). The milestone reviewer passed it, and its 4 minor findings are fixed (Handoff, keyless smoke script, RESEARCH and SPEC drift, H6 closed). The M5 breakdown is proposed below, waiting for approval.

## Milestone 5: Admin shell and accounts

Goal (SPEC §9): a separate admin area (own layout and login), then My bookings, cancellation, a hardened guest token flow and `claim_guest_bookings`.

> **Status: ✅ done (2026-10-18).** T5.2 (accounts research) ends with a DB plan for T5.3–T5.5, which needs its own approval before any migration.

Out of scope for M5: court photos and the banner (M6), online payments (M7), refunds (a SPEC non-goal), emails (M8).

### [x] T5.1 Admin shell and `/admin/login`
- **Do:**
  - Move the `/admin` route tree out from under the public `Layout` in `src/routes/router.tsx`. `AdminLayout` becomes a full shell (brand, admin nav, signed-in user and log out, mobile nav) with no public header or footer. Keep every admin page lazy-loaded.
  - Add `/admin/login` (email + password) inside the admin shell. A signed-in non-admin is refused there with a clear message. Unauthenticated `/admin/*` redirects to `/admin/login` and returns to the requested page after sign-in.
  - Remove the Admin link from the public header.
  - Update SPEC §7 if anything differs from the plan.
- **Files:** `src/routes/router.tsx`, `src/features/admin/AdminLayout.tsx`, `src/features/admin/AdminLoginPage.tsx`, `src/features/auth/RouteGuards.tsx`, `src/components/Layout.tsx`, `e2e/`
- **Acceptance:**
  - Testing Library tests: the guard redirects to `/admin/login`, non-admins are refused, and the public header has no Admin link.
  - The e2e admin flows sign in through `/admin/login` and pass on desktop and at 360px.
  - The build still keeps admin code out of the public chunk.
- **Notes:** `/admin` is a top-level lazy route with its own `AdminLayout` shell. A lazy `AdminGuard` layout route guards every page except `login`, and unknown admin paths get a 404. `/admin/login` is email + password only, with no Google sign-in and no sign-up (the user's call). The public `RequireAdmin` and `logIn` e2e helper are gone. Tests: `AdminGuard.test.tsx`, `AdminLoginPage.test.tsx`, `components/Layout.test.tsx` (fake auth from `src/test/authState.ts`), and the new `e2e/admin-shell.spec.ts`. `walk-in` and `guest-and-review` now sign in through `logInAdmin`. e2e passes 12/12 on desktop and 360px. Admin strings appear only in lazy chunks (checked in `dist/`). The DB separation the user asked about already existed; a new `01_profiles` assertion now proves that a role in sign-up metadata is ignored. The reviewer passed it.
- **Follow-ups:** if the profile fetch fails, a real admin sees "Admins only" instead of an error with a retry. This is older `AuthProvider` behavior; fix it in the M8 error-state pass, or earlier if it bites.

### [x] T5.2 Research: accounts
- **Do:** Research and record in RESEARCH.md:
  - cancellation rules: the cutoff in the venue timezone, which statuses can be cancelled, and what happens to payments (no refunds)
  - claiming guest bookings: verified email from `auth.users` (`email_confirmed_at`, Google identities) and how to trigger the claim after sign-in
  - what "hardened" should mean for the guest token flow: lookup rate limits, the token in the URL query or fragment, token lifetime after the booking ends, a lost-link path
  - the My bookings query (upcoming vs past, effective status)
- **Acceptance:** Every entry is Decided with sources or local experiments, the DB plan for T5.3–T5.5 is written up, and the user has approved it.
- **Notes:** RESEARCH.md "Milestone 5" has four Decided entries and the DB plan, which the user approved on 2026-10-17 (that approval covers `db:push` for the T5.3–T5.5 migrations).
  - The key finding came from a local experiment: with `enable_confirmations = false`, sign-ups get `email_confirmed_at` at once, so claims would be unsafe. The user chose to turn confirmations on locally too. The hosted project already has "Confirm email" on.
  - Other choices: guest links expire 30 days after the booking, the token moves to the URL fragment, and there's no throttle.
  - SPEC §4, §5.7, §6, §7 and §10 are updated. No code changed.
  - The reviewer passed it. Its findings were fixed in the docs: a stored `cancelled_by_venue` flag plus a `cancelled_by` index, claims limited to bookings with a guest token (so a deleted player's old bookings aren't claimable), `displayStatus()` and `completed` in the My bookings split, SPEC §2 wording, and source labels.

### [x] T5.3 RPC `cancel_booking(id | ref + token, reason?)`
- **Depends:** T5.2
- **Plan:** approved in T5.2 (RESEARCH "DB plan", item 1): `bookings.cancelled_by` (indexed) and `cancelled_by_venue`, plus `cancel_booking(p_booking_id?, p_reference_code?, p_token?, p_reason?)`.
- **Do:** The owner (session) or guest (ref + token) can cancel an effectively active booking while `now() <= start - cutoff`. Admins can cancel until the booking ends, with a required reason. The function locks the row, sets `cancelled`, `cancelled_at`, `cancel_reason`, `cancelled_by` and `cancelled_by_venue` (guest path: null and false; session path: `auth.uid()` and `is_admin()`), leaves payments alone and frees the slot. When both a token and an id are given, the guest path wins; when neither is, it's `not_found`.
- **Acceptance:** pgTAP covers:
  - the cutoff boundary (exactly at the cutoff allowed, one second after refused)
  - each status, including a stale `pending_payment` (`not_cancellable`)
  - guest with the right token, guest with a wrong token (`not_found`), owner, another player (`not_found`), and anon without a token
  - admin: reason required, after the end (`booking_ended`), a walk-in
  - a signed-in admin using the guest path doesn't get admin rights
  - `cancelled_by` and `cancelled_by_venue` for guest, owner and admin; an admin cancelling their own player booking still needs a reason; both or neither of token and id
  - payments unchanged, and the freed slot can be booked again
  - `db:push` and `db:types` have been run
- **Notes:** Migration `20261017075113_cancel_booking` adds `bookings.cancelled_by` (indexed), `cancelled_by_venue` and `public.cancel_booking(uuid, text, text, text)`, which is `security definer` and granted to anon and authenticated. Its errors are `not_found`, `not_cancellable`, `cutoff_passed`, `booking_ended`, `reason_required` and `invalid_input`. It's pushed to the linked project, and the types are regenerated.
  - 37 assertions in `supabase/tests/database/14_cancel_booking.test.sql`. Fixtures sit at exact offsets from the transaction's fixed `now()`, so the cutoff boundary is tested to the second.
  - The reviewer passed it. Its minors are fixed: the stored admin reason is asserted, the positive both-arguments case is added, and `cancelled_by_venue` is in the SPEC §6 row.
  - `get_guest_booking` doesn't return the cancellation fields yet; that's T5.5.

### [x] T5.4 RPC `claim_guest_bookings()`
- **Depends:** T5.2
- **Plan:** approved in T5.2 (RESEARCH "DB plan", item 2).
- **Do:** Link `online` guest bookings (`guest_token_hash` set) whose `guest_email` matches the caller's **confirmed** `auth.users` email and whose `user_id` is null. Idempotent, returns a count, and never trusts client input (SPEC §5.7). Add the partial index `bookings_unclaimed_email_idx`. Set `[auth.email] enable_confirmations = true` in `supabase/config.toml` and restart the local stack. Update the e2e sign-up flow to confirm through the local mail catcher, or switch to admin-created confirmed users where sign-up isn't what's being tested.
- **Acceptance:** pgTAP covers:
  - an unconfirmed email (nothing claimed)
  - case-insensitive matching (mixed-case `auth.users.email`)
  - idempotency (a second call returns 0)
  - never moving a booking that already has a `user_id`, and never claiming a walk-in or a deleted player's old booking (no guest token)
  - anon refused (`42501`)
  - `db:push` and `db:types` have been run
  - `npm run test:e2e` still passes with confirmations on
- **Notes:** Migration `20261018083342_claim_guest_bookings` adds the partial index `bookings_unclaimed_email_idx` and `public.claim_guest_bookings() returns integer` (`security definer`, authenticated only). It's pushed to the linked project and the types are regenerated.
  - 13 assertions in `supabase/tests/database/15_claim_guest_bookings.test.sql`, including a misleading JWT `email` claim that is ignored.
  - `supabase/config.toml` now has `enable_confirmations = true`, and `127.0.0.1:5179/**` is added to the redirect URLs for e2e. The local stack was restarted.
  - Experiment after the restart: sign-up returns no session, `email_confirmed_at` is null, and Mailpit gets the email.
  - e2e: `confirmationLink()` reads Mailpit, and `player.spec` now confirms its sign-up. `smoke:proof` creates confirmed users with the local service key. e2e passes 12/12 and the smoke test passes.
  - The reviewer passed it; its minor (no `sub`, so `P0001`) is fixed. The client-side claim call is T5.7.

### [x] T5.5 Guest token hardening
- **Depends:** T5.2
- **Plan:** approved in T5.2 (RESEARCH "DB plan", item 3, and the "Guest token flow hardening" entry).
- **Do:**
  - DB: replace `get_guest_booking` so links stop matching 30 days after the booking ends (same `not_found`), and have it also return `cancelled_at`, `cancel_reason` and `cancelled_by_venue`.
  - Client: read the token from `#token=`, rewrite old `?token=` links with `history.replaceState`, and make `CheckoutPage` and the save-link card build fragment links. Show the "sign up with your booking email" recovery hint on the not-found state.
- **Acceptance:**
  - pgTAP covers the 30-day boundary and the new columns.
  - Vitest/Testing Library cover token parsing (fragment, legacy query, both, empty) and the rewrite.
  - e2e: the guest flow uses a fragment link, and a legacy `?token=` link still opens and is rewritten.
  - `db:push` and `db:types` have been run.
- **Notes:** Migration `20261018084414_guest_link_hardening` recreates `get_guest_booking` with the 30-day limit and the cancellation columns. It's pushed and the types are regenerated.
  - pgTAP: `16_guest_link_hardening.test.sql` (7 assertions, both sides of the boundary).
  - Client: `features/booking/guestLink.ts` (with tests). `BookingPage` reads `#token=` and rewrites `?token=` with `<Navigate replace>`, keeping the page state. Checkout links to the fragment. A recovery hint shows on not-found and in the save-link card.
  - e2e checks the fragment URL and the legacy rewrite. It also confirms that supabase-js ignores `#token=`.
  - Gotcha: going to the same URL with a fragment is a hash-only navigation with no reload, so `openGuestLink()` in the spec leaves the page first.
  - The reviewer passed it.
- **Follow-ups:** T5.6 maps the cancellation fields into `BookingDetail`. The recovery hint promises My bookings, so T5.7 must land before M5 closes or deploys. Optional: a component-level test of the rewrite.

### [x] T5.6 Cancel in the UI
- **Depends:** T5.3, T5.5
- **Do:** A cancel button with a confirmation and a cutoff message (deadline in venue time) on `/booking/:ref` for guests and owners. Show the cancelled state with the venue's reason. In the admin review panel, add a cancel action with a required reason and a "cancelled after payment, settle any refund outside the app" flag. Extend e2e with a guest cancel and an admin cancel.
- **Acceptance:** Testing Library tests cover the confirmation, the cutoff-passed state and errors.
- **Notes:** Pure rules in `features/booking/cancellation.ts` (tested), mirroring `cancel_booking`.
  - Booking page: `CancelBooking` has a confirmation step, an optional reason, a refund note when paid, and the deadline in venue time after the cutoff. `BookingSummary` shows the cancelled state with the venue's reason.
  - Admin: `AdminCancelForm` has a required reason, and `ReviewPanel` flags "cancelled by staff/customer" and "cancelled after payment". A staff member viewing `/booking/:ref` signed in is pointed to Admin → Bookings.
  - Tests: `cancellation.test.ts`, `CancelBooking.test.tsx`, `AdminCancelForm.test.tsx`, plus cases in `BookingSummary.test.tsx` and `ReviewPanel.test.tsx`. New `e2e/cancel.spec.ts` covers a guest cancel freeing the slot and an admin cancel showing the reason to the guest. e2e passes 16/16.
  - The reviewer passed it; both minors are fixed, and admin hooks now use `bookingKeys.allAvailability`.

### [x] T5.7 Claim after sign-in and `/me/bookings`
- **Depends:** T5.4
- **Do:** Call `claim_guest_bookings` from an effect keyed on the user id (after sign-in and on app load with a session, never inside `onAuthStateChange`), and invalidate My bookings when it links any. Add the My bookings page: an RLS select with an explicit `.eq('user_id', user.id)` (admins' RLS sees everything), and a pure `splitMyBookings(rows, now)` built on `displayStatus()` (which also maps an ended `confirmed` booking to `completed`) that splits upcoming from past, each linking to `/booking/:ref`. Extend e2e: a guest books, then signs up with the same email and confirms it, and the booking shows in My bookings.
- **Acceptance:** Testing Library tests cover the list states and the claim trigger. Loading, empty and error states are handled.
- **Notes:** New `src/features/account/` area.
  - `fetchMyBookings` filters on `user_id` explicitly and caps at 200.
  - `splitMyBookings` is built on `isActive`/`displayStatus`.
  - The claim trigger is a React Query query keyed on the user id (`useClaimGuestBookings`, mounted once as `GuestBookingClaimer` in `main.tsx`, only for confirmed emails). That's instead of the planned effect: same intent, no effect needed. RESEARCH is updated.
  - `/me/bookings` is now `MyBookingsPage`, with loading, empty, error/retry, upcoming/past and a dismissible "we added N" notice. The `ComingSoon` placeholder is deleted.
  - Tests: `myBookings.test.ts` and `MyBookingsPage.test.tsx` (claimer: once, not for anon or unconfirmed). New `e2e/claim.spec.ts`: guest → sign up with the same email → confirm via Mailpit → My bookings → opens as owner. e2e passes 18/18.
  - The reviewer passed it; both minors are fixed.

### [x] T5.8 Close out M5
- **Depends:** T5.1, T5.6, T5.7
- **Do:** Mark M5 ✅ in SPEC §9, run a milestone review, and re-confirm the M6 (venue media) breakdown.
- **Acceptance:** `npm run verify` passes and the reviewer signs off.
- **Notes:** The milestone reviewer passed it.
  - The major is fixed: booking mutations (create, proof, cancel) didn't refresh My bookings. They now invalidate `accountKeys.allMyBookings`, tested in `features/booking/hooks.test.tsx`.
  - The minors are fixed: the Handoff is rewritten and a stale router comment is removed.
  - SPEC §9 marks M5 ✅ (v0.8).
  - Final gates: verify (vitest, pgTAP 291, build), e2e 18/18 at desktop and 360px, and smoke:proof all pass.
  - Re-confirming the M6 outline is left for the user (see Handoff).

## Milestone 6: Venue media

Goal (SPEC §9): admins upload one photo per court and an optional site banner. Players see the court photos. The banner (image + alt text only) sits on the home page just below the header, hidden while none is set. Added on 2026-10-17; banner placement confirmed 2026-10-18.

> **Status: ✅ done (2026-10-18).** The milestone review passed. The DB plan was approved in T6.1, and the migration is live on the linked project.

Out of scope for M6: several photos per court (galleries), several or rotating banners, image editing or cropping beyond a simple downscale.

### [x] T6.1 Research: venue media
- **Do:** Answer in RESEARCH.md, with sources and local experiments:
  - A public bucket (`venue-media`, read without auth, CDN-cacheable URLs) vs a private bucket with signed URLs. Recommendation: public, because these images aren't sensitive.
  - Storage policies: admin-only insert, update and delete through `private.is_admin()`; a bucket-level MIME allow-list (JPG, PNG, WEBP) and a size limit.
  - Image size: whether Supabase image transformations are available on our plan, otherwise a client-side downscale (e.g. at most 1600px wide, WEBP) before upload.
  - Replacing a photo: new uuid filenames (so caches never serve the old one), deleting the old object, and orphan cleanup.
  - Banner layout: aspect ratio, `object-fit`, avoiding layout shift, alt text.
- **Files:** `RESEARCH.md`, `SPEC.md`
- **Acceptance:** Every entry is Decided. The DB and storage plan for T6.2 is written up, and the user has approved it.
- **Notes:** Five RESEARCH entries are Decided, each checked by a local probe (throwaway `zz-probe-media` bucket, cleaned up):
  - `remove()` and upsert need an admin SELECT policy. Without one, `remove()` silently deletes nothing.
  - The bucket checks only the declared type. HTML labelled `image/png` was accepted, so the client re-encodes every image.
  - Transformations are Pro-only and off locally, so images are downscaled in the browser (WEBP with a JPEG fallback).
  - Public URLs are served with `max-age=3600` by default; `cacheControl` can raise it.
  
  SPEC §6 and §10 are updated. The user approved the T6.2 plan, including `db:push`, on 2026-10-18. The reviewer passed it, and its 4 minors are folded in: a stricter `banner_alt` CHECK, the folder rule on the UPDATE policy, an exact policy-name list for the narrowed `09` check, and the §10 row order. verify passes (vitest 163, pgTAP 291).

### [x] T6.2 Migration: media columns and the `venue-media` bucket
- **Depends:** T6.1
- **Do:** Add `courts.photo_path` and `venue_settings.banner_path` / `banner_alt` (nullable), with CHECKs that keep each path under its prefix. Create the bucket with its MIME and size limits, plus the storage policies.
- **Acceptance:** pgTAP covers anon, player and admin on the storage objects (only admins can write; anyone can read), the path CHECKs and the column updates going through the existing admin RLS. `db:push` and `db:types` have been run.
- **Notes:** Migration `20261018102500_venue_media.sql`:
  - adds `courts.photo_path`, `venue_settings.banner_path` and `banner_alt`, with CHECKs for the path prefixes and the alt-text rules
  - creates the public `venue-media` bucket (2 MB, JPG/PNG/WEBP) with four admin-only policies; INSERT and UPDATE must stay under `courts/` or `banner/`
  - adds no RPC and no new grant
  
  Tests: `17_venue_media.test.sql` (35 assertions). `09_payment_proofs_storage.test.sql` now excludes the three venue-media write policies by exact name and checks that an admin insert into `payment-proofs` gets 42501. `db:push` was applied to the linked project and checked by query (bucket config and 4 policies), and `db:types` was regenerated. verify passes (vitest 163, pgTAP 327), and e2e passes 18/18. The reviewer passed it with no findings.

### [x] T6.3 Admin: court photo
- **Depends:** T6.2
- **Do:** A photo section on `/admin/courts/:id` with upload (type and size checked before sending, downscaled as T6.1 decides), preview, replace and remove.
- **Acceptance:** Testing Library tests cover the upload, wrong type or size, replace, remove and errors.
- **Notes:** `CourtPhotoSection` on `/admin/courts/:id`.
  - Shared helpers for T6.4 to reuse:
    - `admin/mediaInput.ts`: checks, `fitWithin`, `newMediaPath`, `storageErrorMessage`
    - `admin/imageResize.ts`: canvas downscale, WEBP with a JPEG fallback
    - `admin/mediaReplace.ts`: upload → save → remove old; the new file is cleaned up if the save fails
    - storage functions in `admin/api.ts`, where `remove()` must return the object
    - `catalog/media.ts` `mediaUrl()` for public URLs
  - Tests: `CourtPhotoSection.test.tsx` (11), `mediaInput.test.ts`, `mediaReplace.test.ts`, `imageResize.test.ts` (stubbed canvas).
  - New e2e `court-photo.spec.ts` runs the real browser downscale, storage policies and path CHECK: a non-image is refused, then upload → replace (old file deleted) → remove. It passes at desktop and 360px. Teardown removes `E2E…` courts and their photos through the Storage API.
  - verify passes (vitest 197, pgTAP 327), e2e 20/20. Admin media code stays in the lazy `CourtEditPage` chunk.
  - Reviewer: PASS. Both findings are fixed: the e2e flow was added, and Storage 403/413/415 now show plain messages.

### [x] T6.4 Admin: site banner
- **Depends:** T6.2
- **Do:** A banner section on `/admin/settings` with upload, alt text (required when a banner is set), preview and remove.
- **Acceptance:** Testing Library tests cover setting, replacing and removing the banner, the required alt text and errors.
- **Notes:** `BannerSection` on `/admin/settings`.
  - Alt text is required and trimmed in the form, and `validateBannerAlt` matches the DB CHECK. The image is downscaled to 2200 px wide. Saving with no new image updates only the alt text. The preview shows both crops (3:1 and 2:1, the phone copy with empty alt).
  - Tests: `BannerSection.test.tsx` (13) and `validateBannerAlt` in `mediaInput.test.ts`.
  - New e2e `banner.spec.ts`: alt required, set, remove, with storage and DB checked. It skips itself if a local banner is already set. Teardown clears only a banner whose alt starts with `E2E`.
  - verify passes (vitest 212, pgTAP 327), and e2e passes 22/22. The reviewer passed it, and the SPEC wording is fixed.
- **Follow-ups:** PostgREST errors from the `venue_settings`/`courts` updates are shown as they are (as in every admin form today). Map them in the M8 error pass.

### [x] T6.5 Public: court photos
- **Depends:** T6.2
- **Do:** Show each court's photo on the home page court cards and as court info on `/book`, lazy-loaded with fixed dimensions. Courts without a photo get a neutral placeholder for their sport, never a broken image.
- **Acceptance:** Testing Library tests cover a court with a photo and one without.
- **Notes:** New `catalog/CourtPhoto.tsx` and `CourtTiles.tsx`.
  - Photos are 16:9, `loading="lazy"`, with fixed 640×360 dimensions and alt "Photo of {name}".
  - A missing photo, or one that fails to load, shows a sport placeholder (`role="img"` "{Sport} court"). A new path gets a fresh try.
  - The home page sport cards show court tiles instead of name chips. `/book` has a collapsed "About the … courts" panel above the grid, so phones keep the grid near the top.
  - Tests: `CourtTiles.test.tsx` (6). `court-photo.spec.ts` now also checks the photo on `/` and in the `/book` panel; the court is activated briefly, with try/finally.
  - verify passes (vitest 218), and e2e passes 22/22. The reviewer passed it, and its 3 minors are fixed (SPEC sentence, try/finally, /book check).

### [x] T6.6 Public: home page banner
- **Depends:** T6.2
- **Do:** On the home page only, render the banner just below the header, before the page content, when `banner_path` is set. It's an image with its alt text, no headline or link. Render nothing at all (no empty space) when it isn't set, or while settings load or fail.
- **Acceptance:** Testing Library tests cover banner set, unset, loading and error. An e2e flow covers an admin uploading a banner, the banner showing on `/` and not on `/book`, the admin removing it and the banner disappearing (desktop and 360px).
- **Notes:** New `catalog/HomeBanner.tsx`, the first child of the home page.
  - It uses the cached settings query and renders nothing while loading, on error, when no banner is set, or if the image fails.
  - The image is eager with `fetchPriority="high"`, fixed 2200×733, at 2:1 on phones and 3:1 from 640px.
  - Tests: `HomeBanner.test.tsx` (5; it waits on the query state). `banner.spec.ts` now also checks that the banner shows on `/` above the h1, not on `/book`, and is gone from `/` after removal (desktop and 360px).
  - verify passes (vitest 223), and e2e passes 22/22 with nothing skipped. The reviewer passed it with no findings.

### [x] T6.7 Close out M6
- **Depends:** T6.3, T6.4, T6.5, T6.6
- **Do:** Optionally add demo photos for the seed courts. Mark M6 ✅ in SPEC §9, run a milestone review, and re-confirm the M7 (PayMongo) breakdown.
- **Acceptance:** `npm run verify` and `npm run test:e2e` pass, and the reviewer signs off.
- **Notes:** SPEC §9 marks M6 ✅ (v0.9). The seed demo photos were skipped (the user's call on 2026-10-18; revisit for the M8 README screenshots). Final gates: verify (vitest 223, pgTAP 327, build) and e2e 22/22 at desktop and 360px, with nothing skipped. The milestone reviewer passed it; its major (stale Handoff) and 2 minors (RESEARCH placeholder wording, orphan cases) are fixed. The user re-confirmed the M7 breakdown as drafted on 2026-10-18.

## Milestone 7: Online payments (PayMongo, test mode)

Goal (SPEC §9): PayMongo test-mode checkout next to the manual proof flow, with a verified webhook confirming bookings automatically. Postponed from M5 on 2026-10-17 because manual payment and confirmation already work.

> **Status: ✅ done (2026-10-18).** A real test-mode payment confirmed a booking on the linked project, and the milestone review passed.

Out of scope for M7: live keys and real money, refunds, PayMongo for walk-ins, emails (M8).

### [x] T7.1 Research: PayMongo (test mode)
- **Do:** Answer in RESEARCH.md, with sources (PayMongo docs) and local experiments where possible:
  - Checkout Sessions vs Payment Intents. Which test-mode methods to offer (GCash, Maya, card, QR Ph, …). Amounts in centavos.
  - Webhooks: which events, signature verification (`Paymongo-Signature`, test vs live signature), retries, idempotency, and registering the webhook for the deployed function.
  - Mapping a session to a booking (metadata or reference number) and how to tell guest from owner callers when creating it.
  - Hold interplay: session expiry vs `expires_at`, whether starting a checkout extends the hold, and the late-payment cases (paid after expiry or cancellation, or after a proof was approved). Refunds stay a non-goal, so decide what we record and show to admins.
  - Data model: a new `method` value vs a provider column, PayMongo ids, and how this fits the unique-pending and unique-approved constraints and today's takings.
  - Local testing without a public URL: signed fake webhook events in `smoke` and e2e.
  - Secrets: `PAYMONGO_SECRET_KEY` and the webhook secret only as Edge Function secrets (`supabase/functions/.env` locally, `supabase secrets set` for the linked project). Never `VITE_*`.
- **Files:** `RESEARCH.md`, `SPEC.md` (§4, §6, §10, and close the §11 open questions)
- **Acceptance:** Every entry is Decided. The DB and Edge Function plan for T7.2–T7.4 is written up, and the user has approved it.
- **Notes:** RESEARCH "Milestone 7" has 7 Decided entries and the T7.2–T7.4 plan, approved on 2026-10-18 including `db:push`. The user's choices: re-confirm late but recoverable payments, methods GCash/Maya/card/QR Ph, and no PayMongo account yet.
  - Local experiments: WebCrypto HMAC matches Node's. A new enum value can't be used in the same transaction, so it gets its own migration.
  - SPEC §4, §6, §10 and §11 are updated.
  - Reviewer: PASS. Its 4 majors are folded into the plan as tightening (no scope change): revival also requires an active court and no blackout; the guest token goes in `sessionStorage`, never in `success_url`; UI items for PayMongo rows in T7.5/T7.6; existing RPCs reject `'paymongo'` readably. The minors are folded in too (bigint centavos, zero total refused, dead session replaced, SPEC API table in T7.2).
  - verify passes (vitest 223, pgTAP 327).

### [x] T7.2 Migration: PayMongo payments
- **Depends:** T7.1
- **Do:** The schema change T7.1 decides, plus the service-role-only RPCs that record a PayMongo payment and confirm the booking under a row lock (same pattern as `record_payment_proof`).
- **Acceptance:** pgTAP covers the RLS (anon, player, admin, service_role), idempotency for a replayed event, the amount check, each late-payment case and the constraint interactions. `db:push` and `db:types` have been run.
- **Notes:** Migrations `20261018123351_paymongo_method.sql` (the enum value on its own) and `20261018123355_paymongo_payments.sql`:
  - `provider_*` columns and CHECKs on `payments`
  - the `paymongo_checkouts` table (admins read)
  - three service-role-only RPCs; `record_paymongo_payment` implements the four §4 cases under a booking lock and is idempotent on the PayMongo payment id
  - deviation: the existing RPCs reject `'paymongo'` through a guard trigger (`private.payments_paymongo_guard`, readable P0001) instead of `create or replace`, recorded in RESEARCH
  
  Tests: `18_paymongo.test.sql` (61 assertions: grants, RLS, the guard via both RPCs and an update, checkout race, reuse and dead-session replacement, every outcome including replay, amount and currency mismatch, revival vs taken, blackout, archived or started slot, superseded proof without a rejection count).

  Both migrations were pushed to the linked project and checked by query. `db:types` was regenerated. The `paymongo` label and takings order were added so approved PayMongo money isn't dropped (`dashboard.test.ts`).

  verify passes (vitest 224, pgTAP 388), and e2e passes 22/22. The reviewer passed it; minor 3 (tests) is fixed.
- **Follow-ups** (each needs a migration, so do it in T7.3's or T7.4's):
  - Index `payments (provider_checkout_id) where provider_checkout_id is not null`.
  - After a dead session is replaced, a replay of the old event returns `unknown_checkout` rather than `duplicate`. It's harmless (nothing written, 2xx); check `provider_payment_id` first or expect it in T7.4.
  - A non-PHP payment's amount is stored as if in PHP. It's unreachable with PHP-only sessions; note the currency in the review note if touched.
  - `record_paymongo_checkout` says `invalid_state` for an `expired` booking and `hold_expired` for a lapsed hold. Map both in T7.3.

### [x] T7.3 Edge Function `create-paymongo-checkout`
- **Depends:** T7.2
- **Do:** Authorize the owner session or the guest ref + token, check the booking is payable, create a test-mode checkout session for the stored `total_amount` with success and cancel URLs back to `/booking/:ref`, and return the checkout URL. Share the auth and payable checks with `submit-payment-proof` (`_shared`).
- **Acceptance:** A smoke test (`npm run smoke:paymongo` or an extension of `smoke:proof`) covers owner, guest, wrong token, an unpayable booking and the amount coming from the database. PayMongo is stubbed locally unless a test key is present.
- **Notes:** `create-paymongo-checkout` (POST `{ reference_code, token? }` → `{ checkout_url }`, `verify_jwt = false`, auth `['user', 'publishable']`).
  - Shared code: `_shared/payable.ts` (caller id, RPC error mapping, ref check), now also used by `submit-payment-proof`, and `_shared/paymongo.ts` (centavos, test-key check, mode selection, return-URL allow-list, request body, response parsing, stub session).
  - A real `sk_test_` key always wins. `PAYMONGO_MODE=stub` is honoured only on the local http stack. A live key or no key gives 503.
  - `PUBLIC_SITE_URL` is an allow-list matched against `Origin` (no open redirect). The guest token never goes to PayMongo.
  - Local env: `supabase/functions/.env` (gitignored), copied from the new committed `.env.example`. The local stack needs a restart to pick up new functions or env.
  - Tests: Vitest `paymongo.test.ts` and `payable.test.ts`. `npm run smoke:paymongo` passes 11/11 (owner, guest, wrong or missing token, anon on a player's booking, amount from the DB with a client amount ignored, session reuse, cancelled 409, lapsed hold 409, malformed ref). `smoke:proof` is unchanged.
  - The `18_paymongo` checkout counts are now scoped to the test's own fixtures (the smoke runs add local rows).
  - verify passes (vitest 246, pgTAP 388), and e2e passes 22/22. The reviewer passed it, and both minors are fixed (key precedence, stub only on the local stack).
- **Follow-ups:**
  - The T7.2 index follow-up is still open (do it in T7.4 if it adds a migration).
  - If the hold lapses between `proof_target` and `record_paymongo_checkout`, a PayMongo session is created but never stored (harmless in test mode).
  - After T7.7 switches to a real key, local bookings with a stored `cs_stub_…` session keep returning it. Test with fresh bookings or `db:reset:local`.

### [x] T7.4 Edge Function `paymongo-webhook`
- **Depends:** T7.2
- **Do:** Verify the signature, ignore events we don't handle, and record the payment through the T7.2 RPC. Idempotent, always 2xx once an event has been handled, and the function never trusts amounts or ids that aren't in the signed payload.
- **Acceptance:** The smoke test covers a valid paid event (booking confirmed), a bad signature (401, nothing changes), a replay (no duplicate payment) and a late payment (handled as T7.1 decided).
- **Notes:** `paymongo-webhook` (`verify_jwt = false`, `withSupabase({ auth: 'none' })`, which still gives `ctx.supabaseAdmin`; checked locally).
  - Order: raw body, then a constant-time `te` HMAC check (401 if it fails; `li` is never accepted), then parse, then ignore anything that isn't a test-mode `checkout_session.payment.paid` (200), then `record_paymongo_payment` with signed-payload values only.
  - Responses: 200 with the outcome once handled; 200 ignored for invalid input, Postgres 22P02, or a metadata booking id that isn't a uuid; 500 on other DB errors so PayMongo retries; 503 if the secret is missing.
  - The committed local secret `whsk_local_dev_only` is refused unless `SUPABASE_URL` is http.
  - Helpers live in `_shared/paymongo.ts`. Tests: `paymongo-webhook.test.ts` (node env, HMAC computed independently).
  - `npm run smoke:paymongo` passes 23/23. The webhook checks are: valid → confirmed with one approved payment; replay → duplicate, no second payment; bad, missing or tampered signature → 401 with nothing changed; payment after cancel → late, refund note, booking stays cancelled; other event type and live mode → ignored; unknown session → `unknown_checkout`.
  - verify passes (vitest 257, pgTAP 388). e2e passes 21 with 1 skipped (the walk-in phone run has no start times left late in the day, which is time-dependent and not related). The reviewer passed it, and both minors are fixed.
- **Follow-ups:**
  - The T7.2 index on `payments (provider_checkout_id)` still needs a migration and approval. Fold it into the next migration (T7.6, if it needs one, or M8).
  - A replay of an old event after its dead session was replaced returns `unknown_checkout` (200, nothing written). It's harmless and not exercised by the smoke test.

### [x] T7.5 Booking page: "Pay online"
- **Depends:** T7.3
- **Do:** On `/booking/:ref`, offer "Pay online with PayMongo" next to "Upload proof" while the booking is payable. Redirect to checkout. On return, show a "confirming payment…" state that refetches until the webhook has confirmed the booking (with a timeout message). Also handle the cancel return. For guests, save the token in `sessionStorage` before redirecting and restore it on the `?paid=` return; never put it in `success_url`. In `BookingSummary` and `PaymentHistory`, PayMongo rows don't count as proof rejections, and late PayMongo rows show "payment received after the booking closed; the venue will arrange a refund" (RESEARCH M7 plan, item 4).
- **Acceptance:** Testing Library tests cover the button states, the return polling, the guest token surviving the redirect, late PayMongo rows not shown as failed proofs, and errors. An e2e flow covers pay online → (signed fake webhook) → confirmed on desktop and at 360px.
- **Notes:** "Pay online with PayMongo" sits above "Or pay manually" in the pay card (`PayOnline.tsx`, `useStartPaymongoCheckout` → `startPaymongoCheckout`).
  - Return handling is in `paymongoReturn.ts`:
    - On `?paid=1`/`?paid=0` the guest token comes back from `sessionStorage` and `?paid` moves into history state, so copied links don't replay the return.
    - The booking polls every 3 s while confirming. After 90 s it shows a timeout message and polls every 30 s. It stops once confirmed or not accepted.
  - The button is hidden while confirming and for staff without the link. It resets on a back/forward-cache restore.
  - PayMongo rows don't count as proof rejections; they show "Paid online" or "Refund due" with the player-safe note.
  - Tests: `paymongoReturn.test.ts`, `PayOnline.test.tsx`, 4 new in `BookingSummary.test.tsx`, and the new e2e `pay-online.spec.ts` (success path with a signed webhook, plus the cancel return; desktop and 360px).
  - verify passes (vitest 282, pgTAP 388). e2e passes 25 with 1 skipped (the time-dependent walk-in phone run). The reviewer passed it; both majors (polling after the timeout, `?paid` kept in links) and minors 3 and 5 are fixed.
  - Fixed afterwards: the staff rule also hid the button on an admin's **own** booking (found while testing on the linked project). `BookingDetail` now carries `user_id` (owner fetch; null on the guest path), and the button is hidden only when an admin views someone else's booking without its link. Covered by two `BookingPage.test.tsx` cases.
  - Added afterwards (the follow-up): `BookingPage.test.tsx` (11 tests) covers the page wiring with only `api.ts` and `goToCheckout` mocked: token restore with `?paid` dropped, no saved token, polling until confirmed (fake timers), the 90 s timeout with continued checking, cancel return, refund note, starting a checkout (token saved, redirect, button disabled), a checkout error, a normal visit, owner by session, and staff without a link. A mutation check reintroduced the stop-after-timeout and button-while-confirming bugs; both made tests fail.
- **Follow-ups:**
  - A superseded proof shows "Not accepted · Reason: Paid online with PayMongo instead." Consider a friendlier label in T7.6 or M8.

### [x] T7.6 Admin: PayMongo payments
- **Depends:** T7.4
- **Do:** Show PayMongo payments (method, source, PayMongo id, paid time) in the `/admin/bookings` list and detail panel with no review actions. Flag late payments (case 4) and superseded proofs (case 3, "check for a duplicate") that need manual follow-up. Count approved ones in the dashboard's takings by method, and show money received but not accepted separately. Add `paymongo` to the takings order and the method labels.
- **Acceptance:** Testing Library tests cover the PayMongo row, the late-payment flag and the takings breakdown.
- **Notes:**
  - Data and flags: `AdminPayment` now carries `reviewed_at`, `reviewed_by` and the PayMongo ids. `paymentFlags.ts`:
    - refund due = a rejected PayMongo row
    - superseded proof = a rejected proof with no reviewer **and** the webhook's fixed note
  - Panel: an "Online payments" section (source, PayMongo id, paid time, Accepted/Refund due) with no actions, plus the refund-due and duplicate-check warnings.
  - List rows: "Paid online", "Refund due" and "Check duplicate" badges.
  - Dashboard: `TakingsCard` shows takings by method with PayMongo as its own line, and money received but not accepted apart from the total (`fetchRefundsDue`, with an error and retry if that query fails).
  - Tests: `paymentFlags.test.ts`, `ReviewPanel.test.tsx` (+4), `BookingRow.test.tsx`, `TakingsCard.test.tsx` and `dashboard.test.ts`. `pay-online.spec.ts` now also checks the admin row badge and panel.
  - verify passes (vitest 313, pgTAP 388). e2e passes 24 with 2 skipped (walk-in skips itself on both projects late at night, when no start times are left today; time-dependent). The reviewer passed it, and both minors are fixed.
- **Follow-ups:** the T7.2 index on `payments (provider_checkout_id)` moves to M8 (still needs a migration and approval).

### [x] T7.7 Close out M7
- **Depends:** T7.5, T7.6
- **Do:** Set the PayMongo secrets on the linked project, deploy both functions, register the test-mode webhook, and do one real test-mode payment end to end. Mark M7 ✅ in SPEC §9, run a milestone review, and propose the M8 breakdown.
- **Acceptance:** `npm run verify` and `npm run test:e2e` pass, a real test-mode payment confirms a booking on the linked project, and the reviewer signs off.
- **Notes:**
  - With the user's approval: `PUBLIC_SITE_URL=http://localhost:5173,http://127.0.0.1:5173` set on the linked project, and both functions deployed (ACTIVE, `verify_jwt` off).
  - The user set `PAYMONGO_SECRET_KEY`, registered the test webhook (Settings → Webhooks, Test Mode) and set `PAYMONGO_WEBHOOK_SECRET` themselves.
  - Real test payment **CB-6L7YXZ** (₱350, QR Ph): booking `confirmed` with one approved `paymongo` payment equal to the total, a real `cs_`/`pay_`, recorded by the webhook (checked with a linked query).
  - SPEC §9 marks M7 ✅ (v0.10).
  - Final gates: verify (vitest 313, pgTAP 388, build); e2e 24 passed, 2 skipped (walk-in skips itself at night when no start times are left today, which is time-dependent); `smoke:paymongo` 23/23 (stub).
  - Milestone review: PASS. Minors 2 and 3 are fixed (SPEC method lists, Handoff). Major 1 is left to the user (their local key; see Handoff). Minor 4 and the notes are carried into M8.

## Milestone 8: Polish

Goal (SPEC §9): emails; empty, loading and error states; an accessibility pass; deploy; README screenshots and a demo video. Playwright e2e for the main flows already exists (H5) and is extended where a task changes a journey.

> **Status: breakdown approved by the user (2026-10-18).** T8.1 ends with an email and deploy plan that needs approval before any migration, Edge Function or deploy.

Out of scope for M8: live PayMongo keys and real money, refunds, SMS, new features.

### [x] T8.1 Research: emails and deploy
- **Do:** Answer in RESEARCH.md, with sources:
  - Emails (SPEC §8: booking created with the guest link, payment confirmed, proof rejected, cancelled):
    - provider (e.g. Resend or Supabase's SMTP)
    - where they're sent from: database trigger plus queue vs the RPCs/webhook calling an Edge Function
    - retries and an outbox table
    - templates
    - never putting the guest token anywhere but the link itself
    - local testing through Mailpit
  - Deploy:
    - host for the SPA (e.g. Vercel), with rewrites for client routes
    - env vars
    - Supabase Auth site URL and redirect URLs
    - adding the real origin to `PUBLIC_SITE_URL`, and the PayMongo return links
    - Google OAuth redirect
    - preview vs production
- **Files:** `RESEARCH.md`, `SPEC.md`
- **Acceptance:** Every entry is Decided. The email and deploy plan (migrations, functions, secrets) is written up and approved.
- **Notes:** RESEARCH M8 has 8 Decided entries plus the approved plan. SPEC §8 is rewritten, and §10 has a new row. The user approved it on 2026-10-18: Resend from a verified domain the user has or will get (API for booking emails, SMTP for Auth); the outbox with triggers, plus `send-emails` run by pg_cron and pg_net; the token-checked `email-guest-link`; Vercel. That approval includes `db:push` of the T8.2 migration. Local experiment: Mailpit's `POST /api/v1/send` works, and the edge runtime reaches `supabase_inbucket_court-booking-system:8025`. pg_net is available but not installed (local and linked).
- **Follow-ups:** The reviewer passed it. Its 2 majors and 2 minors (triggers must never fail the RPC, the stale booking-created email, Resend 409 on a reused key, anon grants), plus the extra notes, are written into the plan as item 5 "Refinements from the T8.1 review" for T8.2 and T8.3.

### [ ] T8.2 Migration: carried DB follow-ups and email outbox
- **Depends:** T8.1
- **Do:** Add the `payments (provider_checkout_id) where provider_checkout_id is not null` index (M7 follow-up), plus whatever email storage T8.1 decides (e.g. an outbox table with RLS).
- **Acceptance:** pgTAP covers the new table's RLS and rules. `db:push` and `db:types` have been run.

### [ ] T8.3 Transactional emails
- **Depends:** T8.2
- **Do:** Send the four SPEC §8 emails as T8.1 decides, test them locally through Mailpit, and add a smoke script. The transport is `resend | mailpit | disabled`, and the hosted default `disabled` marks rows `skipped` (no Resend for now; the Resend adapter is written but switched off).
- **Acceptance:** Vitest covers the templates (guest link present only in the guest's own email) and the transport choice (`disabled` → skipped). The smoke test covers each trigger, and e2e checks the booking-created email in Mailpit.

### [ ] T8.4 Error, loading and empty states pass
- **Do:** Go through every async view, and fix the carried follow-ups:
  - a failed profile fetch shows "Admins only" to a real admin (T5.1)
  - raw PostgREST errors in admin saves (T6.4)
  - a friendlier player label for a proof replaced by an online payment (T7.5)
  - the PayMongo return reading an older not-accepted payment as the current one (M7 review)
- **Acceptance:** Testing Library tests cover each fixed state.

### [ ] T8.5 Accessibility pass
- **Do:** Run axe on the main pages (home, book, checkout, booking, My bookings, admin dashboard and bookings) through Playwright. Fix keyboard and focus issues, labels and contrast. Check 360px and 200% zoom.
- **Acceptance:** The e2e axe checks pass with no serious or critical violations, and the fixes are covered by tests.

### [ ] T8.6 Deploy
- **Depends:** T8.1
- **Do:** Deploy the SPA as T8.1 decides. Set the production env vars, the Supabase Auth URLs and the real origin in `PUBLIC_SITE_URL`. Deploy all Edge Functions with `EMAIL_TRANSPORT=disabled` and the Vault worker secrets (no Resend, no Auth custom SMTP for now). Add a short note on `/signup` that points visitors to Google sign-in or guest booking, because confirmation emails don't reach them yet. Run a smoke test against production (book, proof, pay online in test mode, admin review).
- **Acceptance:** The production URL works end to end in PayMongo test mode, and the checklist is recorded in TASKS notes.

### [ ] T8.7 README, screenshots, demo video and close out
- **Depends:** T8.3, T8.4, T8.5, T8.6
- **Do:** Write a README (what it is, stack, architecture, how to run locally, tests and harness), add screenshots (phone and desktop), record a short demo video, mark M8 ✅, and run a final milestone review.
- **Acceptance:** `npm run verify` and `npm run test:e2e` pass, and the reviewer signs off.

---

## Harness backlog
- [x] H1 Vitest + `npm run verify` (typecheck, lint, test, build)
- [x] H1b pgTAP via `supabase test db` in verify (`npm run test:db`, tests in `supabase/tests/database/`)
- [x] H2 Stop hook that blocks "done" until verify passes (`.claude/hooks/verify-gate.mjs`)
- [x] H3 `reviewer` agent (`.claude/agents/reviewer.md`)
- [x] H4 `/implement` command (`.claude/skills/implement/SKILL.md`)
- [x] H5 Playwright e2e: `npm run test:e2e` (Chromium desktop + 360px phone, local stack, serial). Flows: guest booking and proof upload, admin reject → re-upload → approve, signed-in player, walk-in. Tagged test data is removed in global teardown. The Stop hook runs it when UI-facing files change (blocking if the local stack is down).
- [x] H6 >500 kB main chunk warning: gone since the admin pages became lazy chunks (2026-10-17 build: largest chunk 347 kB). Watch it as the app grows.
- [x] H7 Phone layouts (360px) checked by hand in a real browser by the user (2026-10-17). The e2e phone project now runs every flow at 360px.
