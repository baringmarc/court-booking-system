# TASKS.md

The working plan. [SPEC.md](SPEC.md) says **what** the product does; this file says **what to build next** and tracks progress. [RESEARCH.md](RESEARCH.md) holds the technical findings behind the tasks.

## Handoff

> Update this section at the end of every session or task. Keep it short; it's the first thing the next session reads.

- **Current milestone:** 4 (Payments) ✅ done; 5 (Accounts) outline proposed
- **Next task:** waiting for the user to approve the M5 outline, then T5.1 (research), which ends with a DB plan for approval
- **State:** M4 is complete and live on the linked project: payments, proof bucket, the `submit-payment-proof` Edge Function, review, expiry job, walk-ins, the booking-page upload loop, the admin review queue and the dashboard. Every task and the milestone itself were reviewer-PASSed. M3 and M4 are both uncommitted.
- **Blockers / notes:** Docker Desktop must be running for `npm run verify`. `npm run smoke:proof` needs the full local stack (`npx supabase start`). Open follow-ups: H7 (check 360px phone layouts in a real browser); a user decision on capping the fresh hold after a rejection at the start time (see T4.6); the Edge Function's `index.ts` is checked only by the smoke test (no Deno type-check).

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

## Milestone 5: Accounts

Goal (SPEC §9): My bookings, cancellation, a hardened guest token flow, `claim_guest_bookings`.

> **Status: outline proposed, waiting for user approval.** T5.1 (research) runs first. Its findings turn T5.2–T5.4 into a concrete DB plan, which needs its own approval before any migration.

Out of scope for M5: refunds (a SPEC non-goal), emails (M6).

### [ ] T5.1 Research: accounts
- **Do:** Research and record in RESEARCH.md:
  - cancellation rules: the cutoff in the venue timezone, which statuses can be cancelled, and what happens to payments (no refunds)
  - claiming guest bookings: verified email from `auth.users` (`email_confirmed_at`, Google identities) and how to trigger the claim after sign-in
  - what "hardened" should mean for the guest token flow: lookup rate limits, the token in the URL query or fragment, token lifetime after the booking ends, a lost-link path
  - the My bookings query (upcoming vs past, effective status)
- **Acceptance:** Every entry is Decided with sources or local experiments, the DB plan for T5.2–T5.4 is written up, and the user has approved it.

### [ ] T5.2 RPC `cancel_booking(id | ref + token, reason?)`
- **Depends:** T5.1
- **Do:** The owner (session) or guest (token) can cancel an active booking up to `cancel_cutoff_hours` before the start; admins can cancel any time. Sets `cancelled_at` and `cancel_reason`, and frees the slot.
- **Acceptance:** pgTAP covers the cutoff boundary (venue timezone), each status, guest, owner, other player and admin, and that the freed slot can be booked again.

### [ ] T5.3 RPC `claim_guest_bookings()`
- **Depends:** T5.1
- **Do:** Link guest bookings whose `guest_email` matches the caller's **verified** `auth.users` email and whose `user_id` is null. Idempotent, returns a count, and never trusts client input (SPEC §5.7).
- **Acceptance:** pgTAP covers an unverified email (nothing claimed), case-insensitive matching, idempotency, never stealing another user's booking, and anon being refused.

### [ ] T5.4 Guest token hardening
- **Depends:** T5.1
- **Do:** Whatever T5.1 decides, for example a lookup throttle and moving the token out of server-visible URLs.
- **Acceptance:** Defined in T5.1.

### [ ] T5.5 Cancel in the UI
- **Depends:** T5.2
- **Do:** A cancel button with a confirmation and a cutoff message on `/booking/:ref` (guest and owner), and an admin cancel in the review panel.
- **Acceptance:** Testing Library tests cover the confirmation, the cutoff-passed state and errors.

### [ ] T5.6 Claim after sign-in and `/me/bookings`
- **Depends:** T5.3
- **Do:** Call `claim_guest_bookings` after a verified sign-in. Add the My bookings page (upcoming and past, effective status, links to `/booking/:ref`).
- **Acceptance:** Testing Library tests cover the list states and the claim trigger. Loading, empty and error states are handled.

### [ ] T5.7 Close out M5
- **Depends:** T5.6
- **Do:** Mark M5 ✅ in SPEC §9, run a milestone review, and propose the M6 breakdown.
- **Acceptance:** `npm run verify` passes and the reviewer signs off.

## Milestone 6: Polish
Emails, empty, loading and error states, a11y pass, deploy, README screenshots and a demo video, Playwright e2e for the main flows. *(Break down at the end of M5.)*

---

## Harness backlog
- [x] H1 Vitest + `npm run verify` (typecheck, lint, test, build)
- [x] H1b pgTAP via `supabase test db` in verify (`npm run test:db`, tests in `supabase/tests/database/`)
- [x] H2 Stop hook that blocks "done" until verify passes (`.claude/hooks/verify-gate.mjs`)
- [x] H3 `reviewer` agent (`.claude/agents/reviewer.md`)
- [x] H4 `/implement` command (`.claude/skills/implement/SKILL.md`)
- [ ] H5 Playwright e2e (later)
- [x] H6 >500 kB main chunk warning: gone since the admin pages became lazy chunks (2026-10-17 build: largest chunk 347 kB). Watch it as the app grows.
- [ ] H7 Check the phone layouts (360px) in a real browser: booking grid, checkout, booking page with proof upload, admin review panel and walk-in form. Can be folded into H5 (Playwright) viewport tests.
