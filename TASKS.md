# TASKS.md

The working plan. [SPEC.md](SPEC.md) says **what** the product does; this file says **what to build next** and tracks progress. [RESEARCH.md](RESEARCH.md) holds the technical findings behind the tasks.

## Handoff

> Update this section at the end of every session or task. Keep it short; it's the first thing the next session reads.

- **Current milestone:** 3 (Booking)
- **Next task:** T3.1
- **State:** Milestones 1–2 are done. The harness is set up (guide docs, `npm run verify`, the Stop hook verify gate, the `reviewer` agent and `/implement`). Start M3 with `/implement`.
- **Blockers / notes:** none. Docker Desktop must be running for `npm run verify` (pgTAP runs against the local db).

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

### [ ] T3.1 Research: booking engine
- **Do:** Answer the M3 questions in RESEARCH.md (exclusion constraint, timezone-safe slot math in SQL, reference codes, guest tokens, error mapping, how to test RPCs). Record the decisions in SPEC §10.
- **Files:** `RESEARCH.md`, `SPEC.md`
- **Acceptance:**
  - Every M3 entry in RESEARCH.md has findings, sources and a recommendation.
  - Any choice that changes SPEC is logged in SPEC §10.

### [ ] T3.2 Migration: bookings table
- **Depends:** T3.1
- **Do:**
  - Add the `booking_status` and `booking_source` enums and the `bookings` table as in SPEC §6, without payments.
  - Enable `btree_gist` and add the exclusion constraint over active statuses.
  - Add an `updated_at` trigger and indexes on the foreign keys and on `user_id`.
  - Enable RLS. Players read their own rows and admins read everything. Grant no insert, update or delete to `anon` or `authenticated`.
- **Files:** `supabase/migrations/<ts>_bookings.sql`, `src/lib/database.types.ts` (regenerated)
- **Acceptance:**
  - pgTAP checks that two overlapping active bookings on the same court can't both exist.
  - An `expired`, `rejected` or `cancelled` booking doesn't block its range.
  - `anon` and `authenticated` can't insert into `bookings` directly.
  - `db:push` and `db:types` have been run.

### [ ] T3.3 Pricing function
- **Depends:** T3.2
- **Do:** Add `private.slot_price(court_id, slot_start timestamptz)` and `private.range_price(court_id, during tstzrange)`. They read `court_rates` for the day of week and hour in the venue timezone, and fall back to `default_hourly_rate`.
- **Files:** new migration
- **Acceptance:**
  - Weekday-evening and weekend peak rates from the seed data are applied.
  - A slot without an override uses the default rate.
  - Day of week and hour are computed in `Asia/Manila`, not UTC. Test with a slot that starts at 07:00 Manila time (23:00 UTC the previous day).

### [ ] T3.4 RPC `get_availability(date, court_id?)`
- **Depends:** T3.3
- **Do:** Return one row per active court and slot on that venue-local date: `court_id`, `slot_start`, `slot_end`, `price` and `status` (`free` | `booked` | `blackout` | `past`). Only operating hours count. Expired `pending_payment` holds (`expires_at < now()`) count as free. No personal data.
- **Files:** new migration
- **Acceptance:**
  - Callable by `anon`.
  - A closed day returns no slots.
  - Blackouts, both venue-wide and per court, are marked.
  - Slots that have already started are `past`.
  - Prices match `range_price` for each slot.

### [ ] T3.5 RPC `create_booking(court_id, start, slots, guest_info?)`
- **Depends:** T3.4
- **Do:**
  - Validate every rule in SPEC §5.1–5.4: same venue day, inside operating hours, aligned to slots, no blackout, inside the booking window, not started, active court.
  - Compute the price on the server.
  - Generate `reference_code` (`CB-XXXXXX`).
  - For guests, require name, email and phone, generate a random token and store only its hash.
  - Set `expires_at = now() + payment_hold_minutes`.
  - Return `{id, reference_code, guest_token?}`.
  - Map an exclusion violation to a clear "slot no longer available" error.
- **Files:** new migration
- **Acceptance:**
  - Each rule rejects with a distinct, readable error, with one pgTAP test per rule.
  - A logged-in user's booking gets `user_id = auth.uid()`, and the client can't override it.
  - Two concurrent bookings for the same slot produce exactly one success.
  - The client never sends a price.

### [ ] T3.6 RPC `get_guest_booking(reference_code, token)` and the owner read path
- **Depends:** T3.5
- **Do:** Guests read one booking by reference code and token (hash comparison in SQL). Logged-in owners read their booking through RLS. Return court name, range, status, total, `expires_at` and the payment instructions.
- **Files:** new migration
- **Acceptance:**
  - A wrong token returns nothing, and the response doesn't reveal whether the reference code exists.
  - The token is never stored or logged in plain text.

### [ ] T3.7 Booking client layer and slot-selection logic
- **Depends:** T3.6
- **Do:**
  - Add `features/booking/api.ts` and `hooks.ts`, following the catalog pattern.
  - Add pure functions in `features/booking/selection.ts` for selecting consecutive slots: toggling, extending, rejecting gaps or busy slots, and showing the client-side total (display only).
- **Files:** `src/features/booking/*`
- **Acceptance:**
  - The selection logic has Vitest unit tests that cover edge cases: a gap in the selection, tapping a busy slot, deselecting a slot in the middle, and switching courts.

### [ ] T3.8 `/book` page: slot grid
- **Depends:** T3.7
- **Do:** A date picker (from today to the end of the booking window) and a sport filter, then a court × time grid with the price per slot. Selection follows T3.7. A sticky summary bar shows the slots and total, with a "Continue" button that goes to checkout. Mobile-first.
- **Files:** `src/features/booking/BookPage.tsx` (+ components), `src/routes/router.tsx`
- **Acceptance:**
  - Loading, empty (closed day or no courts) and error states are handled.
  - Busy, blackout and past slots can't be selected.
  - The grid is usable at 360px wide.
  - Times are shown in the venue timezone.

### [ ] T3.9 `/book/checkout`
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

### [ ] T3.10 `/booking/:ref` detail page
- **Depends:** T3.9
- **Do:**
  - Show status, court, date and time, total, payment instructions (rendered markdown) and a countdown to `expires_at`.
  - For guests, show a "save this link" prompt.
  - Proof upload and cancel are placeholders for M4/M5.
- **Files:** `src/features/booking/BookingPage.tsx`
- **Acceptance:**
  - Works for an owner who is logged in and for a guest with `?token=`.
  - A missing or invalid token shows a "booking not found" state.
  - The countdown shows as expired once `expires_at` has passed.

### [ ] T3.11 Close out M3
- **Depends:** T3.10
- **Do:**
  - Seed a few demo bookings so the grid shows busy slots, keeping `seed.sql` idempotent.
  - Mark M3 ✅ in SPEC §9.
  - Break M4 into tasks here, after running its research first.
- **Acceptance:**
  - `npm run verify` passes.
  - The reviewer signs off on the whole milestone diff.

---

## Milestone 4: Payments
Storage bucket, proof upload, admin review queue with the reject → re-upload loop, expiry job, walk-in flow. *(Break down at the end of M3.)*

## Milestone 5: Accounts
My bookings, cancellation, guest token flow hardened, `claim_guest_bookings`. *(Break down at the end of M4.)*

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
- [ ] H6 Fix the >500 kB main chunk warning (split vendor chunks, e.g. supabase-js)
