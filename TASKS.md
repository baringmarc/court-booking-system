# TASKS.md

The working plan. [SPEC.md](SPEC.md) says **what** the product does; this file says **what to build next** and tracks progress. [RESEARCH.md](RESEARCH.md) holds the technical findings behind the tasks.

## Handoff

> Update this section at the end of every session or task. Keep it short; it's the first thing the next session reads.

- **Current milestone:** M11 Plotline brand and venue upgrades (**approved by the user on 2026-10-26**; breakdown below, brand in `docs/BRAND.md`). M10 ✅ done on 2026-10-26 and M9 on 2026-10-23 (M1–M10 all done). After M11 come the SaaS milestones (M12+, `docs/SAAS-PLAN.md`), each with its own breakdown and approval.
- **Next task:** T11.26 switch-on (the code side is done and committed on 2026-10-30; the remaining steps are the user's, listed in the T11.26 Notes; the task stays `[~]` until the real-inbox proof). Meanwhile, T11.27 can start (risky: migration, plan gate). T11.25 done on 2026-10-30 (full-width QR, iPhone hint behind ⓘ). (T11.15 waits for T11.9 on production, i.e. the user's merge). T11.16 done on 2026-10-29 (RESEARCH M11, SPEC §10). T11.14 done on 2026-10-29 (the dashboard revenue split). T11.13 done on 2026-10-29: the fee shows everywhere and both functions are redeployed, but the linked project still charges **₱0**. It goes to ₱10 only after the user merges `develop` into `master` (see Blockers). New since 2026-10-28: T11.16–T11.21 (phones, waiver, admin alert) and T11.22–T11.24 (an online payments switch controlled by Plotline, the address and quick facts in the home hero; SPEC §10). New on 2026-10-29: T11.25 (QR full width, iPhone hint behind ⓘ), T11.26 (Resend from `mail.plotline.fit`, with DNS and Auth SMTP steps for the user), T11.27–T11.28 ("Paid with" the payment accounts) and T11.29–T11.30 (a fresh guest link in the re-upload email); the close-out is now T11.31. Still the user's: run `npm run smoke:prod -- --links-only` and record the demo video from `docs/demo-script.md`.
- **State:** M11: T11.1–T11.14 and T11.16–T11.25 done (T11.25 on 2026-10-30: the QR fills the card, the iPhone hint is a toggletip; T11.24 on 2026-10-30: the address and quick facts in the home hero; T11.23 on 2026-10-30: "Pay online" follows the switch; T11.22 on 2026-10-29: the online payments switch in the database and the checkout function, live on the linked project; T11.21 on 2026-10-29: Realtime booking alerts in the admin tab, live on the linked project; T11.20 on 2026-10-29: the waiver in settings, checkout, the booking page and the email, `send-emails` redeployed; T11.19 on 2026-10-29: the venue waiver in the database, blank on the linked project; T11.18 on 2026-10-29: "Mobile number (optional)" in checkout and walk-ins, `tel:` link for staff; T11.17 on 2026-10-29: phones normalized to `09…` by triggers, optional for guests, live on the linked project; T11.16 on 2026-10-29: research for phones, waiver and alerts; T11.14 on 2026-10-29: Total revenue, Your earnings and Plotline fees on the dashboard; T11.13 on 2026-10-29: the fee split in checkout, the booking page, admin, CSV, emails and the PayMongo line items, `amount_due` not null on the linked project; T11.12 on 2026-10-29: `platform_pricing`, the `booking_fee` snapshot trigger, `amount_due` and `get_earnings.split` live on the linked project at a ₱0 fee; T11.1–T11.11 on 2026-10-28; T11.11: payment accounts with QR codes in settings, and on the booking page while paying; T11.10: `venue_payment_accounts`, `reorder_payment_accounts` and the `payment-qr` bucket (1 MB, PNG) live on the linked project; T11.9: admins paste a Maps link, and players see the address with a pin linked to it on `/` and `/booking/:ref`; no embedded map; T11.15 needs T11.9 deployed to production first; T11.8: `venue_settings.maps_url` live on the linked project, backfilled from the map search; T11.7: venue color presets with the "Website colors" picker, applied for every visitor without a flash, five accents nudged for AA; T11.6: `venue_settings.theme` live on the linked project; T11.5b: bookings search and sort; T11.5a: drag to reorder, `reorder_courts`/`reorder_info_sections` live on the linked project; T11.5: admin restyle, split-bar booked hours, even form rows; T11.4a: the /book date strip; T11.4 restyled the public site and emails: Espresso dark, heading bands, Stay connected band, motion). The user's feedback of 2026-10-27 is folded in: T11.4 (Espresso dark palette, heading tints, transitions, Good to know spacing, the "Stay connected" band with brand logos), a new T11.4a (the date strip on `/book`), T11.5 (split-bar booked hours, even form rows), T11.11 ("Download QR"), and two new tasks, T11.5a (drag to reorder) and T11.5b (bookings search and sort). The picks were made on the preview page https://claude.ai/artifact/YVwmkpskANhbzAacUa55Jo (SPEC §10, 2026-10-27). The walk-in card is hidden unless `VITE_FEATURE_WALK_INS=true` (e2e server sets it). M10 done: T10.1–T10.11 (2026-10-26). Rescheduling works end to end on `develop`: `reschedule_booking`, `booking_changes` and the extended `get_guest_booking` are live on the linked project, and the UI and the `booking_rescheduled` email are built (the `send-emails` Edge Function is redeployed to the linked project). The pickers, merged grid blocks, dashboard earnings and CSV export are on `develop`. On the linked project, `get_availability.block_key` and `get_earnings` are live (expand only). M8 deploy: https://court-booking-system-ashen.vercel.app.
- **Blockers / notes:**
  - **Resend switch-on waits for the user** (2026-10-30): T11.26 Notes list the steps. Set `EMAIL_FROM` to the bare address before redeploying the two email functions (an old "Name <addr>" value still works). Production email stays `disabled` until then, and the `/signup` note is gone from `develop`, so don't merge to `master` before Auth SMTP is set.
  - **Realtime "Allow public access"** (the user's step, T11.16): turn it off in the Supabase dashboard (Project Settings → Realtime). The admin alert uses a private channel either way.
  - **Default waiver text waits for the user** (2026-10-29): after T11.20 is merged into `master` and deployed, set `venue_settings.waiver_text` to the SPEC §10 2026-10-28 default on the linked project (T11.19 rollout). Setting it earlier refuses every online booking on production.
  - **₱10 booking fee waits for the user** (2026-10-29): after merging `develop` into `master` and the Vercel deploy, run `smoke:paymongo` against the linked project, then set `platform_pricing.booking_fee = 10` there (T11.13 notes). Until then production charges ₱0.
  - **Local fee tests** (found on 2026-10-29): running `smoke:paymongo` with a non-zero local `platform_pricing.booking_fee` leaves smoke bookings with a fee, and pgTAP `35_booking_fee` test 7 ("existing bookings carry no fee") then fails. Set the fee back to 0 and clear those rows' `booking_fee` (local only), or reset the local database.
  - **Flaky pgTAP `30_reschedule` test 66** (found on 2026-10-28, about 1 run in 3): `get_guest_booking` orders a booking's change history by `changed_at` alone (`20261026131753_guest_booking_changes_chain.sql:50`), and two moves in one test transaction share `now()`, so they tie. A real bug in ordering, not the test: the fix is a migration (a tiebreaker such as an insertion sequence, or `clock_timestamp()` for `changed_at`) and needs the user's approval. Until then, rerun verify when only that test fails.
  - **Never run two test runs at once** (found on 2026-10-26). `npm run verify`, `npm run test:e2e` and the Stop hook's own gate (`.claude/hooks/verify-gate.mjs`) share the local database, port 5179 and `test-results/`, so overlapping runs gave a false `30_reschedule` pgTAP failure, "port 5179 is already used" and `ENOENT` trace errors. Before running tests, check `pgrep -fl "[v]erify-gate|[p]laywright test"` is empty (the brackets keep `pgrep` from matching itself). Full e2e on 2026-10-26 once idle: 49 passed, 3 skipped (`court-photo` flaked once earlier that day, see T10.10).
  - **Screenshots:** regenerated in T11.5 (2026-10-28) on a freshly reset local database (`npm run db:reset:local`, then `npm run screenshots`), including the new `admin-earnings-*` shot. Always reset first: leftover e2e or smoke rows show up in the dashboard shots.
  - Emails locally: `supabase/functions/.env` must keep `EMAIL_TRANSPORT=mailpit`, `MAILPIT_URL` and `EMAIL_WORKER_SECRET` (see `.env.example`) for smoke and e2e. Restart the stack after changing it. Your PayMongo test key is commented out there; uncomment it only for real local test payments, and expect `pay-online` e2e and `smoke:paymongo` to fail while it's active.
  - Scope added on 2026-10-19 (SPEC §9, §10, §11): slot status colors are in T8.5, the settings spacing fix is in T8.4, and M9 is outlined at the end of this file. The README moved there. Booker names are **first name only** in public. A court can be deleted only if it was never booked.
  - Bundle size: always measure with `.env` present. Baseline after T11.11: public `index` 105.34 kB (33.41 kB gzip), `index.css` 43.62 kB (9.49 kB gzip). After T11.9: public `index` 102.62 kB (32.70 kB gzip), `index.css` 42.44 kB (9.31 kB gzip). After T11.7: public `index` 102.54 kB (32.62 kB gzip), `index.css` 42.23 kB (9.27 kB gzip). After T11.5: public `index` 100.53 kB (32.23 kB gzip), `index.css` 37.57 kB (8.34 kB gzip); after T11.4a: public `index` 104.57 kB (33.31 kB gzip), `index.css` 34.61 kB (7.85 kB gzip); after T11.4: public `index` 100.92 kB (32.24 kB gzip), `index.css` 32.35 kB (7.47 kB gzip); after T11.3: public `index` 95.99 kB (29.72 kB gzip), `index.css` 27.78 kB (6.38 kB gzip); after T10.10: 95.96 kB (29.69 kB gzip); the lazy `Calendar` chunk is 67.6 kB (19.9 kB gzip). Without it, `lib/supabase.ts` throws at load time and the build drops supabase-js, which makes the bundle look about 330 kB smaller (SPEC §10, 2026-10-20).
  - **Production (2026-10-20):** https://court-booking-system-ashen.vercel.app (Vercel Hobby, project `court-booking-system`, team slug `marc-projects5`, production branch `master`). The user set the Supabase Auth Site URL and redirect URLs and the Google JS origin by hand. `npm run smoke:prod` books a real `E2E Smoke` booking on production. Cancel it afterwards (T8.6 notes), or use `-- --links-only`. The admin account is the user's Google login (no email and password admin on production).
  - M8 emails: no Resend for now (user decision, 2026-10-19). Build and test through Mailpit; production runs `EMAIL_TRANSPORT=disabled`. Never commit the Vault worker secret (or a Resend key, if one is added later).
  - **Flaky 25 s Vitest timeouts** come from this Mac, not the code. Its `HostName` isn't set, so `os.hostname()` sometimes waits about 25 s on a network lookup, and jsdom test files stall on it. Rerun when it's quick (`time node -e "require('os').hostname()"`). The permanent fix needs the user: `sudo scutil --set HostName Eloys-Macbook.local`.
  - Docker Desktop must be running for `npm run verify`. `npm run test:e2e` and `npm run smoke:proof` need the full local stack (`npx supabase start`).
  - Email confirmation is on locally (`config.toml`, matching the hosted project). Sign-up emails land in Mailpit at http://127.0.0.1:54324. e2e reads them with `confirmationLink()`. Don't turn it off: claims trust `email_confirmed_at`.
  - Guest links use `#token=`. Going to the same URL again is a hash-only navigation (no reload), so e2e leaves the page first (`openGuestLink`).
  - Venue media: paths are stored, not URLs (`mediaUrl()`). Uploads are downscaled in the browser and named with a new uuid. `remove()` fails silently without SELECT, so the code checks what it returned. Orphan listing query: RESEARCH M6.
  - `e2e/overnight.spec.ts` changes venue-wide hours and restores them in `afterEach` with service-role updates. It skips itself unless the chosen day is 06:00–22:00, so a local stack with edited hours loses that coverage. If T9.11 revokes direct UPDATE on `operating_hours` from `authenticated`, the service role still works.
  - `e2e/banner.spec.ts` skips itself when a banner is already set on the local stack (the banner is venue-wide). Remove it in `/admin/settings` to get the coverage back.
  - PayMongo on the linked project: secrets `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET` and `PUBLIC_SITE_URL` (production first since T8.6, then the two localhost origins). Webhook registered in the dashboard under Settings → Webhooks (Test Mode).
  - Local PayMongo setup: `supabase/functions/.env` (from `.env.example`) holds `PAYMONGO_MODE=stub`, `PUBLIC_SITE_URL` and the local webhook secret. Restart the stack (`supabase stop/start`) after adding a function or changing that file. `npm run smoke:paymongo` exercises both functions.
  - `smoke:prod` now steps with "Next day" (T10.3). After the next merge into `master`, run the full `npm run smoke:prod` once to confirm it, then cancel the `E2E Smoke` booking.
  - M10 picker: `@daypicker/react` is pinned at 10.0.2 (v10's new name; `react-day-picker` is only an alias). Keep `Calendar.tsx` behind `React.lazy` (only `DatePicker` imports it) so `/book`'s `index` doesn't take the 19.9 kB gzip calendar.
  - Open follow-ups:
    - M10 follow-ups: a whole move of a continuation emails the root's reference (needs a migration, T10.10); `MoveHistory` reads `window.location.hash` (T10.10); `DayView` merged cells have no "(next day)" marker (T10.5); an index on `payments (reviewed_at)` if earnings get slow (T10.6); `court-photo.spec.ts` flake fixed in T11.4 (viewer focus)
    - a user decision on capping the fresh hold after a rejection at the start time (T4.6)
    - the Edge Function `index.ts` is checked only by smoke and e2e (no Deno type-check)
    - the guest cancel path doesn't check the 30-day link expiry. That's harmless, since a cancel must be before the start (M7 added no token-authorized RPCs, so it's still fine).
    - The service role can't insert `open_play_sessions` directly (T9.11d follow-up). Only the RPCs can write.
    - A PayMongo case 4 payment (refund due) sends no email yet (RESEARCH M8 "Retries and the outbox table").
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

Goal (SPEC §9): emails; empty, loading and error states; an accessibility pass (including slot status colors and the settings spacing); deploy. The README, screenshots and demo video moved to the end of M9 (2026-10-19). Playwright e2e for the main flows already exists (H5) and is extended where a task changes a journey.

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

### [x] T8.2 Migration: carried DB follow-ups and email outbox
- **Depends:** T8.1
- **Do:** Add the `payments (provider_checkout_id) where provider_checkout_id is not null` index (M7 follow-up), plus whatever email storage T8.1 decides (e.g. an outbox table with RLS).
- **Acceptance:** pgTAP covers the new table's RLS and rules. `db:push` and `db:types` have been run.
- **Notes:** Migration `20261019143330_email_outbox.sql`. pgTAP `19_email_outbox.test.sql` (58 assertions) covers RLS and grants, every queueing rule (including that a queueing error never fails the booking change, and a webhook replay), the claim, lease, backoff and failure rules, the guest-link claim, the Vault-gated pg_net poke and the purge. 446 pgTAP assertions pass locally. `db:push` was run (the linked `cron.job` has send-emails and purge-email-outbox) and `db:types` too. `seed.sql` suppresses emails for demo bookings. SPEC §6, §8 and §10 are updated. The reviewer passed it, and both SPEC majors are fixed.
- **Follow-ups:** T8.3: `email-guest-link` must re-read the booking's current status after `claim_guest_link_email` (which leases the row whatever the booking's state) and finish the row as `skipped` when a later event has overtaken it. That is the reviewer's major 2, done in the function rather than with a second migration.

### [x] T8.3 Transactional emails
- **Depends:** T8.2
- **Do:** Send the four SPEC §8 emails as T8.1 decides, test them locally through Mailpit, and add a smoke script. The transport is `resend | mailpit | disabled`, and the hosted default `disabled` marks rows `skipped` (no Resend for now; the Resend adapter is written but switched off).
- **Acceptance:** Vitest covers the templates (guest link present only in the guest's own email) and the transport choice (`disabled` → skipped). The smoke test covers each trigger, and e2e checks the booking-created email in Mailpit.
- **Notes:**
  - New functions `send-emails` (x-worker-secret) and `email-guest-link` (token in the body). They share `_shared/emailTemplates.ts` and `_shared/email.ts` (transport, `emailAction`, Resend and Mailpit senders). The client asks for the link email in `useCreateBooking`'s `onSuccess`, fire and forget.
  - Tests:
    - Vitest: `emailTemplates.test.ts`, `email.test.ts`, `hooks.test.tsx`
    - `npm run smoke:emails`: every trigger, the fallback without the link, an overtaken email skipped by both the worker and the link call, and worker auth
    - e2e: `guest-and-review` reads the booking email from Mailpit
    - Results: verify passes, e2e is 24 passed with 2 known banner skips, and smoke:paymongo and smoke:proof still pass
  - The local `supabase/functions/.env` gained the email lines, and the user's `PAYMONGO_SECRET_KEY` line is commented out (the user approved it) so local runs stay in stub mode.
  - The functions are not deployed to the linked project yet; that happens in T8.6. The reviewer passed it, and its 3 majors and 1 minor are fixed (SPEC §6 and §10, `emailAction` tested in Vitest, the guest link skip covered by smoke, a 401 when the secret is missing).

### [x] T8.4 Error, loading and empty states pass
- **Do:** Go through every async view, and fix the carried follow-ups:
  - a failed profile fetch shows "Admins only" to a real admin (T5.1)
  - raw PostgREST errors in admin saves (T6.4)
  - a friendlier player label for a proof replaced by an online payment (T7.5)
  - the PayMongo return reading an older not-accepted payment as the current one (M7 review)
  - `/admin/settings`: more space between the "Save settings" button and the site banner section below it (the user's report, 2026-10-19)
- **Acceptance:** Testing Library tests cover each fixed state.
- **Notes:**
  - **Profile fetch (T5.1).** `AuthState.profileError`. The profile fetch moved to `auth/api.ts`. The admin shell and `/admin/login` show "Couldn't load your account" with Try again and Log out. Tests: `AuthProvider.test.tsx`, `AdminGuard.test.tsx`, `AdminLoginPage.test.tsx`.
  - **Errors (T6.4).** `src/lib/errors.ts` `errorMessage()` is used by `ErrorMessage`, `SaveStatus`, `SchedulePage` and `BookingPage`. Storage errors with an unmapped status are generic. Tests: `errors.test.ts`, `ErrorMessage.test.tsx`, `SaveStatus.test.tsx`, and `BannerSection` and `CourtPhotoSection` with realistic SQLSTATE codes.
  - **"Replaced by online payment" (T7.5).** `booking/paymentLabels.ts`; the constant moved out of admin code. Test: `PaymentHistory.test.tsx`.
  - **PayMongo return (M7 review).** The checkout start time is kept in `sessionStorage`. Test: `paymongoReturn.test.ts`.
  - **Settings spacing.** `.page-sections`, 40px.
  - **Sweep.** Every other async view already had its loading, empty and error states.
  - **Checks.** verify passes (Vitest 363), and e2e is 24 passed with 2 known banner skips. The reviewer passed it, and its 2 majors and 3 minors are fixed.

### [x] T8.5 Accessibility pass
- **Do:** Run axe on the main pages (home, book, checkout, booking, My bookings, admin dashboard and bookings) through Playwright. Fix keyboard and focus issues, labels and contrast. Check 360px and 200% zoom.
  - **Slot status colors** (the user's request, 2026-10-19). Give free, selected, booked, closed (blackout) and past slots clearly different styles using the current tokens, and add a legend above the grid. Color is never the only signal: each status keeps its text or pattern. M9's theme task re-tunes the values later.
- **Acceptance:** The e2e axe checks pass with no serious or critical violations, and the fixes are covered by tests. A SlotGrid test checks that each status has its own class and label, and that the legend is shown.
- **Notes:**
  - **axe.** `e2e/a11y.spec.ts` uses `@axe-core/playwright`, pinned at 4.13.0 because 4.14.0 was only 5 days old. It fails on serious or critical WCAG 2.1 A/AA violations, in light and dark mode, with no sideways page scroll. Pages covered: home, login, book (with and without a selection), checkout, the player and guest booking pages, My bookings, admin login, the admin dashboard and admin bookings. It runs at desktop width and 360px, and home and book also run at 640px (200% zoom). A sanity page proved the gate catches injected violations. The app had no serious violations before the fixes.
  - **Fixes.**
    - Native date inputs (`/book`, `/admin/bookings`) had no visible focus, found by a keyboard tab walk. Chromium focuses the inner field, so `input[type='date']:focus` now carries the outline.
    - Added a "Skip to main content" link, and focus now moves to `<main>` after a page change (`components/useMainFocus.ts`, used by both layouts). The skip link focuses in script so a guest link's `#token=` survives.
    - Slot statuses: each look has its own class and words (available outlined, selected filled with ✓, booked grey, closed hatched, past dashed). A "Slot key" legend sits above the grid. The `--slot-*` tokens are derived from the palette for M9's theme task. Measured text contrast is at least 5.2:1 for every status in both themes, and the available slot's outline is 3.16:1 (light).
  - **Tests.** `SlotGrid.test.tsx` (each status's class and label, the legend), `Layout.test.tsx` and `AdminLayout.test.tsx` (focus and the skip link), and the a11y e2e spec.
  - **Checks.** verify passes and e2e passes. The reviewer passed it, and its 3 minors are fixed: an AdminLayout test, dead CSS, and narrower SPEC wording (focus moves only within a layout).

### [x] T8.6 Deploy
- **Depends:** T8.1
- **Do:** Deploy the SPA as T8.1 decides. Set the production env vars, the Supabase Auth URLs and the real origin in `PUBLIC_SITE_URL`. Deploy all Edge Functions with `EMAIL_TRANSPORT=disabled` and the Vault worker secrets (no Resend, no Auth custom SMTP for now). Add a short note on `/signup` that points visitors to Google sign-in or guest booking, because confirmation emails don't reach them yet. Run a smoke test against production (book, proof, pay online in test mode, admin review).
- **Acceptance:** The production URL works end to end in PayMongo test mode, and the checklist is recorded in TASKS notes.
- **Notes (part 1, 2026-10-20):**
  - **Vercel.** Hobby plan (fine for a non-commercial portfolio). The project builds `master` and sets `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for Production and Preview, with no Supabase integration. `vercel.json` rewrites every path except `/assets/` to `index.html`. A missing old chunk then gets a real 404 instead of HTML.
  - **Set by the user by hand:**
    - Supabase Auth Site URL: the production origin.
    - Redirect URLs: `https://court-booking-system-ashen.vercel.app/**`, `https://*-marc-projects5.vercel.app/**` and `http://localhost:5173/**`.
    - Google OAuth JavaScript origin: the production origin.
    - Never `supabase config push`.
  - **Linked project:**
    - `functions deploy` of all 5 functions.
    - `secrets set`:
      - `EMAIL_TRANSPORT=disabled`
      - `EMAIL_WORKER_SECRET`, from `openssl rand -hex 32` and never printed
      - `PUBLIC_SITE_URL`, with production first
    - Vault `email_worker_secret` (the same value) and `email_worker_url` (the `send-emails` URL).
  - **`/signup` note.** It says confirmation emails aren't sent yet (`SignupPage.test.tsx`). Remove it when Resend and Auth SMTP are switched on.
  - **Smoke so far.** `npm run smoke:prod` booked `CB-ZR53ZA` (`E2E Smoke`, Badminton 1, 2026-11-09 6 AM) and uploaded a proof through the production UI. In the DB, the booking is `payment_submitted`, the GCash payment is pending, and the `booking_created` outbox row is `skipped`. The `send-emails` cron runs succeed every minute. The deep links returned 404 because `vercel.json` wasn't on `master` yet.
  - **Checks.** verify passes (Vitest 372). e2e: 31 passed, with 3 expected skips (walk-in late at night, and zoom on desktop only). The reviewer passed part 1, and its major and 2 minors are fixed.
- **Notes (part 2, 2026-10-20), the production checklist. Everything passed.**
  1. The user merged `develop` into `master`. `npm run smoke:prod -- --links-only` passes: `/`, `/book`, `/admin/login`, `/booking/…` and `/me/bookings` all serve the SPA.
  2. Google sign-in works on production. The user's Google account (`profiles.role = admin`) reached `/admin` through the public `/login`. `/admin/login` stays email and password only.
  3. Admin review: approving `CB-ZR53ZA`'s proof confirmed the booking. 16 s later the cron job called `send-emails`, got a 200 back (`{"transport":"disabled","skipped":1}`), and the `payment_confirmed` row went `skipped`. That proves the Vault URL and worker secret.
  4. PayMongo test mode: the guest booking `CB-V5288A` was paid with QR Ph (₱350). The webhook confirmed it (`provider_event_id` set, payment `approved`), and the user landed back on a confirmed booking.
  5. Cleanup: both smoke bookings were cancelled with `cancel_booking` as the admin (reason "T8.6 production smoke test…"), and their `booking_cancelled` emails were queued for skipping.

### [x] T8.7 Close out M8
- **Depends:** T8.3, T8.4, T8.5, T8.6
- **Do:** Bring the main chunk under Vite's 500 kB warning (604 kB measured with `.env`; the 618 kB figure came from an earlier build), mark M8 ✅ in SPEC §9 and run the milestone review. *(The README, screenshots and demo video moved to the end of M9 on 2026-10-19, so they show the final product.)*
- **Acceptance:** `npm run verify` and `npm run test:e2e` pass, and the reviewer signs off.
- **Notes:**
  - **Bundle.** With `.env` present the main chunk was 604 kB, and it has been that size since Supabase was added. Clean checkouts without `.env` built at 270 kB because `lib/supabase.ts` throws at load time and the build drops supabase-js, which is also where the old H6 "347 kB" came from. Aliasing react-router to its production build saved only about 2 kB, so it wasn't kept.
  - **Fix.** `vite.config.ts` puts vendor code in `codeSplitting` groups. Chunks are now app 62 kB, `vendor-react` 348 kB and `vendor-supabase` 214 kB, about 624 kB in total. All of them are modulepreloaded, and admin code stays in lazy chunks (checked in `dist/`).
  - **Milestone.** SPEC §9 marks M8 ✅ (v0.12). verify passes (Vitest 372, pgTAP 446, no chunk warning). e2e: 31 passed, with 3 expected skips (walk-in late at night, and zoom on desktop only).
  - **Review.** The milestone reviewer passed it. Its major (the Handoff) and 3 minors (a stale SPEC cross-reference, §1 "Planned for M7", and untracked loose ends) are fixed. The loose ends now live in the Handoff follow-ups and M9 item 9.

## Milestone 9: Venue admin upgrades

Goal (SPEC §9): the user's 2026-10-19 requests, then the portfolio close-out.

> **Status: ✅ done (2026-10-23).** The breakdown was approved by the user on 2026-10-20, with every RESEARCH M9 recommendation. Research: RESEARCH M9. Every DB task still stops at its own plan gate before `db:push`. **Production is live:** every migration must keep the deployed frontend working (expand → deploy → contract, RESEARCH M9 "Shipping DB changes while production is live").

Out of scope for M9: new sports, live payments, Resend, refunds, SMS.

### [x] T9.1 Palette preview
- **Do:**
  - A dev-only route (`import.meta.env.DEV`, never in the production bundle) shows 4 palettes on the real slot grid, buttons, badges, alerts and the booking card, in light and dark mode.
  - Each palette shows a WCAG contrast table from a new `contrast()` helper.
  - The user picks one.
- **Files:** `src/lib/contrast.ts`, `src/dev/PalettePreview.tsx`, `src/routes/router.tsx`
- **Acceptance:**
  - Vitest covers `contrast()` against known ratios.
  - The build shows no preview code in `dist/`.
  - The user has chosen a palette (recorded in SPEC §10).
- **Notes:**
  - `src/lib/contrast.ts` (`parseColor`, `mix` like `color-mix(in srgb)`, `over`, `relativeLuminance`, `contrast`) is tested in `contrast.test.ts` against the WCAG reference values and the T8.5 measurements.
  - Four palettes are defined in `src/dev/palettes.ts`. `palettes.test.ts` holds each, light and dark, to 12 AA pairs, including booked-slot text and the free-slot outline on the page and on cards.
  - The dev-only `/dev/palettes` route (`import.meta.env.DEV`) is absent from `dist/` (checked).
  - **Preview bug found and fixed:** the `--slot-*` tokens are computed on `:root`, so `palettes.css` re-declares them per frame.
  - **The user chose Court Green (the current theme)**, recorded in SPEC §10. verify passes (Vitest 385).
  - **Review.** The reviewer passed it. Its outline-background and Handoff minors are fixed.
- **Follow-ups (T9.2):** `.btn-danger` hard-codes `#fff` on `--danger`, which is about 2.8:1 in dark mode (pre-existing, and no a11y e2e page shows it). Add a danger-button pair to the checks and fix it. Also check the cancelled and pending badges.

### [x] T9.2 Apply the theme
- **Depends:** T9.1
- **Do:** Swap the light and dark tokens in `src/index.css` for the chosen palette. Check that the `--slot-*` tokens, badges and focus rings still read well, then remove the preview route.
- **Acceptance:** The a11y e2e passes (no serious or critical violations, light and dark). Text contrast is at least 4.5:1 and the free-slot outline at least 3:1, measured as in T8.5.
- **Notes:**
  - Court Green was kept, so the palette tokens are unchanged.
  - **Fixed** the T9.1 follow-up: `--danger-contrast` (dark `#1f0a08`) replaces the hard-coded white on `.btn-danger`. It was 2.79:1, and 3.77:1 on hover.
  - **Guard.** `src/lib/themeChecks.ts` (17 AA pairs, including the danger button and hover, the cancelled and pending badges, and the free-slot outline on the page and on cards) is run on the real `index.css` tokens by `src/lib/theme.test.ts`. Mutation check: putting white back fails it.
  - **e2e.** `e2e/a11y.spec.ts` now opens the cancel confirmation, so axe sees `.btn-danger`. Mutation check: with white text, axe fails "cancel confirmation (dark)" on `color-contrast`.
  - The preview (`src/dev/`, the router spread) is removed. `contrast.ts` stays for the guard.
  - **Checks.** verify passes. e2e: 31 passed, with 3 expected skips.
  - **Review.** The reviewer passed it, and its 3 minors are fixed. The test reads `index.css?raw` (`vitest.config.ts` lets that file through Vite) instead of pulling Node types into the app tsconfig. It also asserts that the copied `color-mix` formulas still exist. The Handoff is updated.

### [x] T9.3 Migration: sport order and court order
- **Do:**
  - `venue_settings.sport_order public.sport[]`: every sport exactly once, defaulting to the enum order.
  - The admin RPC `move_court(p_court_id, p_direction)` swaps a court with its neighbour in the same sport and renumbers that sport's courts.
  - `get_availability` orders by `array_position(sport_order, sport)`. Same result columns, so `create or replace` works.
- **Acceptance:**
  - pgTAP covers the check (a missing or duplicate sport is rejected), `move_court` (admin only, edges are no-ops, renumbering is contiguous) and the availability order.
  - `db:push` and `db:types` have been run.
- **Notes:**
  - Migration `20261020152306_sport_and_court_order.sql`. It's additive only.
  - `move_court` locks the sport's courts, ranks them by `(sort_order, name, id)`, swaps, then renumbers 0..n-1. Archived courts are included.
  - pgTAP `20_ordering.test.sql` covers the default, the 3 check violations, RLS (anon reads, a player's update is filtered, an admin updates), `move_court` (refused for anon and players, a bad direction or unknown court is rejected, swapping with a name tie-break, both edges are no-ops, contiguous numbering, other sports untouched) and `get_availability` in sport order.
  - Every pgTAP file passes locally. `db:push` was run (dry run first) and `db:types` too.
  - Production after the push: all deep links work, `sport_order` is `{badminton,pickleball,basketball,tennis}`, and `get_availability` returns slots.
  - **Review.** The reviewer passed it. The test now includes an archived court and asserts court order within a sport (23 assertions).
- **Follow-ups (next DB migration, T9.5):** the `sport_order` check accepts a two-dimensional array (cardinality 4, containing every sport), and `array_position` would then throw for every visitor. Only an admin can write it. Re-add the check with `array_ndims(sport_order) = 1` in a new migration, with a pgTAP case. Also: T9.4 must order the client lists by `sport_order`.

### [x] T9.4 Ordering UI
- **Depends:** T9.3
- **Do:**
  - Up and down buttons per court on `/admin/courts`, grouped by sport, and a sport order editor in `/admin/settings`. The raw sort-order number field is removed from the court form.
  - The home page, the `/book` sport picker and the court lists follow `sport_order`.
- **Acceptance:** Testing Library covers the move buttons (disabled at the edges) and the sport order editor. e2e: an admin moves a court, and `/book` shows the new order.
- **Notes:**
  - **One source of order.** `fetchCourts` reads `sport_order` and returns the courts sorted with `catalog/sportOrder.ts`'s `sortCourts`. So the home page, the `/book` sport picker, the walk-in form and the admin lists all follow it.
  - `sportOrder.test.ts` covers the fallback, sorting, `sportsOf`, `moveCourtInList` (it renumbers like `move_court`), `nextSortOrder` and `moveItem`.
  - **Move buttons.** `MoveButtons` (44 px, "Move X up"/"down", disabled at the edges) restores focus after a reorder.
  - `useMoveCourt` and `useSaveSportOrder` update the list or settings at once, roll back on error, then refetch the courts and the availability.
  - **Court form.** The order field is gone. A new court gets `nextSortOrder`, and editing a court doesn't send `sort_order`.
  - **Tests:**
    - `CourtsPage.test.tsx`: grouping, edges, immediate move and focus, rollback with an error
    - `SportOrderSection.test.tsx`: edges, immediate save, focus, rollback
    - `CourtEditPage.test.tsx`: no order field, a new court goes last, an edit keeps its order
    - `e2e/ordering.spec.ts`: a move, a reload, and the `/book` column order, with the seed order restored afterwards
  - **Review.** The reviewer passed it, and its major and 2 minors are fixed:
    - **Quick repeated presses.** Reorders now run through a `scope`, so they're saved in order, and only the last pending one refetches or rolls back.
      - `onMutate` is synchronous (TanStack calls it inside `mutate()`), so the next press sees the new order. An in-flight refetch is cancelled with `revert: false`.
      - The new "two quick moves" tests in `CourtsPage.test.tsx` and `SportOrderSection.test.tsx` first caught a real race in the earlier async `onMutate`.
    - **Court form.** Create waits for the courts list, and the list's error is shown. A court moved to another sport goes last in it.
    - **Import cycle.** `catalog/sports.ts` is a leaf module (re-exported by `api.ts`), which breaks the cycle between `api.ts` and `sportOrder.ts`.
  - **Checks.** verify passes (Vitest 403). e2e: 33 passed, with 3 expected skips.

### [x] T9.5 Delete a court
- **Do:**
  - The admin RPC `delete_court(p_court_id)` refuses with hint `court_has_bookings` if the court ever had a booking. Otherwise it deletes the court (rates and photos cascade).
  - The client then removes every file under the court's media folder through the Storage API. *(Changed from "returns the photo paths" at the plan gate, SPEC §10.)*
  - A Delete button on the court page, with a confirmation. A refusal points the admin to archiving.
  - In the same migration, re-add the `sport_order` check with `array_ndims(sport_order) = 1` (T9.3 follow-up).
- **Acceptance:**
  - pgTAP: admin only, refused when a booking exists (any status), and rates are removed.
  - Testing Library covers the confirm and refusal states.
  - e2e: an `E2E` court is created and deleted.
- **Notes:**
  - Migration `20261020154357_delete_court.sql`. `delete_court` returns nothing; the client then clears `courts/{id}/` (an approved change from "returns the photo paths", SPEC §10).
    - It locks the court row, refuses if the court ever had a booking (hint `court_has_bookings`), and maps the bookings foreign-key error to the same message.
    - The same migration re-adds the `sport_order` check as one-dimensional.
    - `db:push` (dry run first) and `db:types` were run. Production's check is confirmed.
  - **Tests:**
    - pgTAP `21_delete_court.test.sql` (18 assertions): anon and players refused, null or unknown courts rejected, refused for a confirmed and for a cancelled-only booking (court kept, hints checked), cascades (rates and the court's own blackout gone, venue-wide blackout kept), a second delete says the court doesn't exist, and 2-D and empty `sport_order` rejected.
    - `DeleteCourtSection.test.tsx`: confirm and back out, delete then navigate, the refusal with the archive tip, no tip when already archived.
    - `e2e/delete-court.spec.ts`: deletes an `E2E` court along with its media file, and is refused on the seeded Badminton 1. Mutation check: without the folder cleanup, the e2e fails.
  - **Found while debugging:** an expression-bodied `beforeEach` returns the mock, and Vitest runs a returned function as cleanup, so the mock got called again. Fixed here and in `MyBookingsPage.test.tsx`.
  - **Checks.** verify passes (Vitest 407). e2e: 35 passed, with 3 expected skips. The reviewer passed it. Its blackouts-cache minor is fixed (blackouts are refetched after a delete).
- **Follow-ups (T9.9):** if a court is deleted while someone books it, `create_booking` or `create_walk_in` would surface the raw foreign-key error (23503) to the player. That's very unlikely. Map it to a readable "court unavailable" error when T9.9 rewrites those functions.

### [x] T9.6 Migration: several photos per court
- **Do:**
  - `court_photos` table (id, court_id with cascade, path unique under `courts/{court_id}/`, sort_order, created_at). Public read, admin write. At most 6 per court (hint `too_many_photos`).
  - The first photo is the cover.
  - The admin RPC `reorder_court_photos(p_court_id, p_ids uuid[])`.
  - Copy the existing `courts.photo_path` values in as photo 0. Keep the column until T9.11 (expand → contract).
- **Acceptance:** pgTAP covers RLS (anon, player, admin), the limit, the path check, reorder (admin only, must list exactly that court's photos) and the backfill. `db:push` and `db:types` have been run.
- **Notes:**
  - Migration `20261020233215_court_photos.sql`, expand only (`courts.photo_path` stays).
    - RLS reads through the `courts` policy (`exists` on courts), so archived courts' photos stay hidden from the public.
    - The limit trigger `private.check_court_photo_limit` locks the court row and raises `too_many_photos`.
    - `reorder_court_photos` locks the photos and requires the exact set, each once.
    - The idempotent `private.backfill_court_photos()` puts a legacy photo before any existing ones. T9.11 runs it again before dropping `photo_path`.
  - pgTAP `22_court_photos.test.sql` (27 assertions) covers RLS for anon, player and admin, the 3 path rules, the limit, 4 reorder cases plus the stored order, the backfill and its idempotence, the cover position and the cascade. `00_rls_coverage` passes.
  - `db:push` (dry run first) and `db:types` were run. Production was backfilled (6 legacy photos became 6 rows), and all deep links work.
  - **Review.** The reviewer passed it with 2 majors and 2 minors. The user approved a second migration, `20261020234024_court_photos_hardening.sql`, for these:
    - **Least-privilege grants.** Everything is revoked, then `select` is granted to anon and authenticated, and `insert`/`update`/`delete` to authenticated.
    - **The limit also applies to moves** (`before insert or update of court_id`).
    - **A lighter court lock** (`for no key update`, which no longer blocks booking inserts), also taken in `reorder_court_photos`.
    - **A new photo goes last.** `sort_order` has no default; the trigger fills in the max + 1.
    - pgTAP `22_court_photos` is extended to 41 assertions: privileges, a player update filtered, an admin update, the appended order, and a move onto a full court rejected. Pushed, and production checked: anon can select but not insert.
    - The other major, syncing photos while the old frontend is live, is handled in T9.7 and T9.11 (see their Do lines).
    - A re-review passed. Its one minor is fixed: each privilege is checked on its own, because a comma list means "any of".

### [x] T9.7 Photo gallery UI
- **Depends:** T9.6
- **Do:**
  - An admin gallery editor on the court page: upload up to 6, remove, and reorder with "make cover" and arrows. It reuses the M6 resize, upload and delete code.
  - Players see the cover on the tiles, and a swipeable gallery in "About the courts" (CSS scroll-snap, previous and next buttons, alt text, no library). A missing photo shows the sport placeholder.
  - Inserts pass `sort_order` (max + 1). The generated Insert type requires it; the trigger only fills it in for SQL inserts.
  - The old single-photo UI and `courts.photo_path` writes go away, and nothing new writes `photo_path`. **Until this is live, don't edit court photos in the old admin UI** (the T9.6 review): the old UI would replace or delete a file the gallery row still points at. T9.11 reconciles anything that slipped through.
- **Acceptance:** Testing Library covers the editor (the limit, reordering, the cover) and the gallery (buttons, alt text, the placeholder). e2e: an admin uploads two photos and players see both.
- **Notes:**
  - **Data.** `fetchCourts` and `fetchCourt` embed `court_photos(id, path, sort_order)` sorted with the cover first (`CourtWithPhotos`). `useSaveCourt` merges the saved row into the cached court (the row has no photos).
  - **Public.** `CourtPhoto` takes a path. `CourtTiles` shows the cover, or `CourtGallery` in the `/book` info panel (`detailed`). The gallery is a CSS scroll-snap strip with previous and next buttons, a live "N of M", per-photo alt text, a placeholder for failed images, and reduced-motion respected.
  - **Admin.** `CourtPhotosSection` replaces `CourtPhotoSection`. It adds several at once (one at a time, `sort_order` max + 1, only as many as fit, skipped files explained), removes (row first, then the file), and reorders with `MoveButtons` or "Make cover" (`reorder_court_photos`, immediate and saved in order, like T9.4). Buttons use `aria-label`s that start with the visible text. A hidden span's leading space was being dropped from the computed name ("Removephoto 2"), which a test caught.
  - **API.** `addCourtPhoto` removes the uploaded file if the row insert fails. `setCourtPhoto`, `removeCourtPhoto` (old) and `updateCourtPhotoPath` are gone, and nothing writes `photo_path`.
  - **Tests:**
    - `CourtGallery.test.tsx`: order and alt text, buttons and edges, swipe position, single and none, a failed image
    - `CourtTiles.test.tsx` (rewritten): cover only, placeholder, failure and retry, the detailed gallery
    - `CourtPhotosSection.test.tsx`: empty state, cover badge, multi-upload order, skip message, full, bad type, over 2 MB, server error, remove, make cover, arrows
    - `e2e/court-photo.spec.ts` (rewritten): bad file, two at once, make cover, the home cover and the `/book` gallery with Next, remove (row and file), `photo_path` stays null
  - **Review.** The reviewer passed it, and its major and 3 minors are fixed:
    - **Reorders and add/remove no longer overlap.** Reorder controls wait for an add or remove, and add/remove wait for a reorder (each tested).
    - **The gallery counter is clamped** when the list shrinks.
    - **The strip is focusable**, with a focus ring and a label. The gallery e2e now runs axe on an open multi-photo gallery.
    - **The `scrollTo` spy is restored** after each test.
  - **Checks.** verify passes (Vitest 415). e2e: all passing, 1 skipped (zoom runs on desktop only).
  - **Ship note.** This frontend has to reach production (merge to `master`) before T9.11's contract migration. Until then, don't edit court photos in the old admin UI.

### [x] T9.8 Booker names
- **Do:**
  - Drop and recreate `get_availability` with a new `booker_first_name` column (the first word of `guest_name` for active bookings, walk-ins included), and re-grant it in the same migration.
  - `/book` booked cells show "Booked · Ana", and their accessible name includes it.
  - An admin day view (courts × hours with full names and references, linking to the booking) on the dashboard.
- **Acceptance:**
  - pgTAP: anon gets only the first name (no email, phone or full name), and expired, cancelled and rejected bookings show none.
  - Testing Library covers the grid cell and the day view.
  - The a11y e2e still passes.
- **Notes:**
  - **Migration** `20261021000004_booker_names.sql` drops and recreates `get_availability` in one transaction and re-grants it.
    - A lateral lookup finds the slot's active booking. `booker_first_name` = `nullif(left(split_part(btrim(guest_name), ' ', 1), 20), '')` on booked slots only.
    - It was run through `db:push` and `db:types`; production returns slots.
    - The generated type says `string`, so `fetchAvailability` maps a missing name to null, and the `Slot` type has `booker_first_name: string | null`.
  - **pgTAP** `23_booker_names.test.sql` (16 assertions) covers the exact result signature (no other personal fields), the grants, the confirmed, pending, walk-in and submitted names, expired, cancelled and rejected bookings showing none, blackout and free slots showing null, the 20-character cap, and no email, surname, phone or reference.
    - Two existing tests changed with the approved new column: `05_availability`'s column list, and `20_ordering`'s positional alias list. The old aliases made `n` name `booker_first_name`, which scrambled the order check.
  - **UI:**
    - The `/book` booked cell shows "Booked" plus the name (ellipsis at 7em) and is labelled "…, Booked by Ana".
    - `DayView` on the dashboard ("Today's courts") shows full names and references linking to that day's bookings. Its scroll region is focusable.
  - **Bugs found and fixed:**
    - **DayView compared timestamps as strings.** Slots arrive as "+00:00", bookings as ".000Z". The desktop walk-in e2e caught it; it now compares instants, with a mixed-format test (mutation-checked).
    - **The accent link on the booked grey was 4.39:1.** Links there now use the text colour.
  - **Review.** The reviewer passed it, and its major is fixed: each day-view reference opens that booking (`/admin/bookings?…&booking=<id>` preselects the row; the e2e clicks it). The CSS comments and indentation are tidied.
  - **Tests.** `SlotGrid.test.tsx` (the name), `DayView.test.tsx` (layout, names and links, mixed formats, focusable region, closed and past, the closed day), and `e2e/walk-in.spec.ts` (full name on the dashboard, "Booked by E2E" on `/book`). verify passes (Vitest 422). e2e: 37 passed, 1 skipped.
- **Follow-ups (T9.9 migration):** `create_booking` falls back to the email's local part for `guest_name` when a signed-in player has no profile name and sends none (only possible through a direct RPC call; checkout always sends a name). Since T9.8 that name is public. Drop the fallback, using `split_part` of the profile name or a plain "Player", when T9.9 rewrites the booking functions.

### [x] T9.9 Migration: overnight and 24-hour hours
- **Do:** RESEARCH M9 "Overnight and 24-hour opening hours":
  - Drop the `open < close` check.
  - `private.operating_day_range`, `private.operating_day_of` and `private.operating_today`.
  - The admin RPC `set_operating_hours(p_hours jsonb)`: all seven days at once, atomic, hint `hours_overlap`.
  - `validate_booking_slot` checks against one operating day (the `multi_day` hint is kept), and the window counts operating days.
  - `get_availability(p_date)` covers the whole operating day.
  - `slot_price` uses the operating day's rate row.
  - The walk-in "today" uses `operating_today`.
- **Acceptance:**
  - pgTAP: an overnight 06–05 day lists and books a 1 AM slot under the previous date, priced from that day's rates. A booking across midnight inside one operating day works, and one across an operating-day boundary is rejected. A 24-hour day works. Overlapping days are rejected by `set_operating_hours`. The window edges and a walk-in at 1 AM are covered.
  - Every existing pgTAP file still passes, unchanged except `02_catalog` test 3, which asserted the `open < close` rule this task drops.
  - `db:push` and `db:types` have been run.
- **Notes:**
  - Migration `20261021001821_overnight_hours.sql`, same RPC signatures and columns, so it's safe with the deployed frontend:
    - **Helpers:** `private.operating_day_range`, `operating_day_of` and `operating_today`.
    - **No-overlap rule:** the deferred constraint trigger `operating_hours_no_overlap` (it replaces `operating_hours_check`), plus `set_operating_hours(jsonb)` (admin; checks immediately).
    - **Window and pricing:** `in_booking_window` counts operating days. `slot_price(court, ts, dow)` takes the weekday; the 2-argument version and `range_price` use the operating day.
    - **Booking rules:** `validate_booking_slot` checks one operating day (`multi_day` when the booking also crosses the calendar midnight after it, otherwise `outside_hours`). `get_availability` covers the whole operating day.
    - **Follow-ups done:** `create_booking` and `create_walk_in` map `foreign_key_violation` to `court_inactive` (T9.5), and a nameless player books as "Player" (T9.8).
  - pgTAP `24_overnight_hours.test.sql` (34 assertions) covers:
    - **The operating day:** ranges, `operating_day_of` (1 AM, the gap, the next opening), `operating_today`.
    - **Availability:** 23 overnight slots, the 1 AM slot priced from the operating day's row (999, not the next day's 111), no double listing, 24 slots on a 24-hour day.
    - **Bookings:** a 1 AM booking at 999, across midnight within the day, past the overnight close (`multi_day`), in the gap (`outside_hours`), the 5 AM slot of a 24-hour day, a booking into a day that opens right then (`multi_day`), a 2 AM walk-in.
    - **Window edge:** an overnight last window day lists and books its 1 AM slot; the next day, opening that morning, is `outside_window`.
    - **Follow-ups:** "Player" instead of an email-derived name.
    - **`set_operating_hours`:** refused for anon and players, all 7 days required, whole hours only, overlap rejected, exact fit allowed, stored; a direct overlapping write is refused too.
  - Every other pgTAP file passes. Only `02_catalog` test 3 changed, because it asserted the old `open < close` rule this task replaces; it now asserts the no-overlap rule.
  - `db:push` (dry run first) and `db:types` were run. Production hours are 06:00–24:00 daily, so it behaves as before (108 slots tomorrow, today unchanged).
  - **Checks.** `npm run verify` passes (Vitest 422, pgTAP, build).
  - **Review.** The first round was a BLOCK: there was no window-edge test in operating days. It's fixed with the window-edge and touching-day assertions above, and the re-review passed (its minor is fixed: `w` comes from `local_today()`, which is deterministic).
- **Follow-ups (T9.11 migration):**
  - **`set_operating_hours` errors.** It maps every malformed element to "whole hours". Check the shape and `open_time < '24:00'` first, each with its own message. A `24:00` open would start the day on the next date.
  - **Write skew.** The deferred no-overlap trigger reads the other days under READ COMMITTED, so two hand-made concurrent per-row updates could pass together. Lock the table in the trigger, or revoke direct UPDATE on `operating_hours` once T9.10 (which uses the RPC) is live.


### [x] T9.10 Overnight hours UI
- **Depends:** T9.9
- **Do:**
  - The schedule editor saves through `set_operating_hours`. It shows "closes next day" when close ≤ open, and has an "Open 24 hours" checkbox.
  - `summarizeHours` says "6 AM – 5 AM (next day)" and "Open 24 hours".
  - The `/book` grid marks after-midnight rows.
  - The walk-in form and the dashboard use the operating day for "today" (`src/lib/time.ts` helper, mirroring the SQL).
  - The court rate grid (`CourtRatesSection`) shows each day's hours from open to close in operating order, after-midnight hours included under the operating day's row (pricing uses that row since T9.9). Today it builds `[open, close)`, which goes negative for an overnight day (T9.9 review).
- **Acceptance:** Vitest covers the time helper and `summarizeHours`. Testing Library covers the editor, the grid marker and the rate grid with overnight hours. e2e: an admin sets overnight hours, a guest books a 1 AM slot, and the hours are restored in teardown.
- **Notes:**
  - **Helpers.** `catalog/hours.ts` mirrors the SQL: `daySpan`, `isOvernight`, `isAllDay`, `findOverlap`/`overlapMessage` (the trigger's rule and message), `dowOf`, `operatingDayRange`, `operatingDateOf` (`operating_day_of` with the local-date fallback), `operatingToday` and `isAfterMidnight`. `summarizeHours` says "… (next day)" and "Open 24 hours".
  - **Schedule editor.** It saves through `set_operating_hours` (`saveOperatingHours`). It shows "closes next day", has a "24 hours" switch per day, and replaces the old close-after-open rule with the overlap check, which flags clashes before saving.
  - **`/book`.** The first date is the operating day running now, and after-midnight rows (and their slot labels) say "(next day)".
  - **Checkout (bug found by the e2e).** It looked the run up on the slot's calendar date, so an after-midnight slot read as "no longer available". It now uses `operatingDateOf`. Booking pages still show the real calendar date and time, by design.
  - **Dashboard.** "Today" is the operating day. When that day runs past midnight it also loads the next calendar date's bookings and keeps those within the operating day. Takings stay on the calendar date.
  - **Rate grid.** Columns count hours from each day's midnight (after-midnight hours are 24+, labelled "(next day)") and are stored at `hour % 24` under the operating day's row. A week where every day wraps no longer breaks it.
  - **Tests:**
    - `hours.test.ts`: 14 tests, covering spans, overlap, operating today and date, ranges, after-midnight and the summaries
    - `SchedulePage.test.tsx` (new): next-day hint and save, the 24-hour switch, overlap blocking save, the server error
    - `SlotGrid.test.tsx`: the "(next day)" marker
    - `CourtRatesSection.test.tsx` (new): after-midnight rows, saving under the operating day, an all-overnight week
    - `e2e/overnight.spec.ts` (new): an admin sets a 2 AM close, and a guest in their own context books an after-midnight slot that then shows as booked under that date. Checkout shows the real next calendar date. The hours are restored afterwards.
  - **Review.** The reviewer passed it, and its 3 majors and the cheap minors are fixed:
    - **Checkout and the selection bar** show the slot's real calendar date.
    - **Dashboard merge.** `operatingDayBookings` dedupes a booking crossing midnight, with a test.
    - **Day-view links** use the booking's own calendar date (`/admin/bookings` filters by calendar day), with a test.
    - **Accessible names.** The 24-hour checkboxes are labelled per day. From midnight, 24 hours closes at 24:00.
    - **"(next day)"** now also appears in the day view, the schedule list and the walk-in form.
    - **Zone conversion** moved into `lib/time.ts` (`localHoursInZone`).
    - **Left as is:** the rate grid's invalid-price message says the hour without "(next day)".
  - **Checks.** verify passes (Vitest 443, pgTAP, build). e2e: 39 passed, 1 skipped (zoom runs on desktop only).


### [x] T9.11 Contract migration
- **Depends:** T9.7 on production (`master`)
- **Do:**
  - **Reconcile first:** delete `court_photos` rows whose file is gone from Storage (`storage.objects`).
  - Then run `private.backfill_court_photos()` only for `photo_path` files that still exist and aren't in the gallery already. Skip a court that already has 6 photos (the backfill would raise `too_many_photos` and abort the migration). Without these checks, a cover deleted in the new gallery would come back (T9.6 review).
  - Then drop `courts.photo_path` and its check, and anything else M9 left behind for the old frontend.
  - Update what still mentions the column: `e2e/court-photo.spec.ts` (its last check reads `photo_path`) and the `photo_path: null` in the `CourtEditPage.test.tsx` fixture.
- **Acceptance:** pgTAP is updated. `db:push` runs only after the user confirms that the T9.7 frontend is live.
- **Notes:**
  - Migration `20261021120928_contract_court_photo_path.sql`. The precondition was checked: `origin/master` (PR #9) contains T9.7.
    - `private.prune_missing_court_photos()` removes rows without a `storage.objects` file. It ran here and is kept for later maintenance.
    - The last legacy copy is an inline insert, limited to files that exist, aren't in the gallery and fit (fewer than 6).
    - It drops `private.backfill_court_photos`, `courts_photo_path_check` and `courts.photo_path`.
  - **T9.9 follow-ups done:**
    - `set_operating_hours` validates each element (day 0–6, open 00–23, close 00–24, `is_closed` boolean, seven distinct days), each with its own message.
    - `check_operating_hours` takes `pg_advisory_xact_lock`, so concurrent checks are serialized (write skew).
    - Direct UPDATE on `operating_hours` isn't revoked: production's frontend (PR #9, up to T9.8) still saves hours row by row. Once T9.10 is on `master`, revoking it is optional, because the lock already closes the gap.
  - **Before `db:push`, production was checked:** 7 photos, 0 with a missing file, 0 legacy photos outside the gallery. After the push: 7 photos, no `photo_path` column, and all deep links work.
  - **Tests:**
    - `17_venue_media`: its 6 `photo_path` assertions are gone, because the column is gone. Their rules are covered in `22_court_photos`, which also gains the file-extension rule.
    - `22_court_photos`: the backfill assertions became prune assertions, plus `hasnt_column`.
    - `24_overnight_hours` (39 assertions): the per-field messages, a 24:00 open, close > 24, day 7, a non-boolean `is_closed`, a repeated day.
    - `e2e/court-photo.spec.ts`: dropped its `photo_path` check. The `CourtEditPage.test.tsx` fixture was updated. `db:types` was regenerated.
  - **Review.** The reviewer passed it, and its major and 3 minors are fixed:
    - **Advisory lock tested:** `24_overnight_hours` asserts the lock is taken.
    - **24:00 opening:** the follow-up migration `20261021121625_operating_hours_open_before_midnight.sql` adds a table check, so direct writes are held to the rule too (pushed; production opens at 06:00).
    - **Docs:** the Handoff State and the SPEC §7 `set_operating_hours` row are updated.
  - **Checks.** verify passes (Vitest 443, pgTAP incl. `24_overnight_hours` with 41 assertions, build). e2e: 39 passed, 1 skipped (zoom runs on desktop only).


### [x] T9.11a 24 hours only as 12 AM → midnight
- **Depends:** T9.10, T9.11
- **Do (the user's review of T9.10, 2026-10-21):** remove the editor's "24 hours" checkbox, which was confusing. 24 hours is set only as 12 AM → midnight; an open day closing at its opening time (6 AM → 6 AM) is refused in the database, the RPC and the editor. Production's Saturday (06:00 → 06:00) becomes 00:00 → 24:00 (the user's choice).
- **Acceptance:**
  - pgTAP: `set_operating_hours` refuses 06:00 → 06:00 and 00:00 → 00:00 with a readable message, allows 00:00 → 24:00, overnight closes and a closed day with equal times; a direct write is held to the rule; no open row has open = close.
  - The editor has no 24-hour checkbox, shows "open 24 hours" for 12 AM → midnight and blocks saving a same-time day.
  - `db:push` and `db:types` have been run.
- **Notes:**
  - Migration `20261021124431_hours_24h_midnight_only.sql` (pushed; dry run first; `db:types` unchanged): reconciles open = close rows to 00:00 → 24:00 (the no-overlap check runs right away, so a clash would fail the migration), adds `operating_hours_open_differs_from_close` (`is_closed or close_time <> open_time`), and `set_operating_hours` names the day in its message. The reconcile was dry-run locally against a production-like week (Fri 06–24, Sat 06–06) in a rolled-back transaction.
  - pgTAP `25_hours_24h.test.sql` (9; the constraint is checked by name). `24_overnight_hours`: its 24-hour day is now 00:00 → 24:00, so the "5 AM slot of a 24-hour day" and "into a day that opens right then" cases became the 11 PM slot and a booking past midnight into the next date (`multi_day`). Touching days stay covered by "exact fit allowed".
  - UI: `findSameTime`/`sameTimeMessage` in `catalog/hours.ts` mirror the RPC message. `isAllDay` is now only 00:00 → 24:00. Tests in `hours.test.ts` and `SchedulePage.test.tsx`.
  - **Checks.** verify passes (Vitest 445, pgTAP 589). The reviewer passed it; its major (Handoff) and minors (tick only after the push, check the constraint by name) are fixed.
  - **Not checked:** production bookings on Sunday 00:00–06:00 made under the old Saturday 06 → 06 (a read-only production query was blocked by the permission classifier). They stay valid but now sit outside opening hours.


### [x] T9.11b Slot grid time ranges
- **Depends:** T9.10
- **Do (the user's request, 2026-10-21):** on `/book`, each row of the slot grid shows its time as a range instead of its start: "1 PM – 2 PM", in the app's existing hour format. After-midnight rows keep "(next day)". The slot buttons' accessible labels use the same range ("Court 1, 1 PM – 2 PM, ₱300"). The selection bar and other pages stay as they are.
- **Acceptance:**
  - Testing Library: a normal row, an after-midnight row, and the last row before a midnight close ("11 PM – 12 AM") show ranges, and so do the button labels.
  - The grid still fits a 360px phone without the time column wrapping badly (checked in the e2e phone project or by hand).
  - e2e flows that select slots by accessible name are updated.
- **Notes:** UI only, no database change. Each row's end comes from its slots' `slot_end` (start only if a row had none). "(next day)" sits on its own small line (`.slot-next-day`), so the time column stays one line wide at 360px (checked with a screenshot). Tests: `SlotGrid.test.tsx` (normal, after-midnight and 11 PM – 12 AM rows and labels). e2e `overnight` and `walk-in` selectors updated; e2e 39 passed, 1 skipped (banner). The reviewer passed it with no findings.

### [x] T9.11c Research and migration: open play sessions
- **Depends:** T9.11a
- **Do (the user's request, 2026-10-21):** admins register **one-off open play sessions**. A session blocks its court(s) for a time range. Players **can't book** those slots. They see them as "Open play" on `/book` and can open the details. No online sign-up or payment.
  - **Research first** (RESEARCH M9 "Open play"), then record the decisions in SPEC §10:
    - **Storage:** a new `open_play_sessions` table, or extend `blackouts`, which already block a court or all courts for a range. Can one session cover several courts?
    - **No clashes:** how a session and bookings exclude each other. A cross-table exclusion constraint isn't possible, so `validate_booking_slot` refuses booking into a session, and creating a session over active bookings is refused, with locking so the two can't race.
    - **Availability:** `get_availability` gives the slot a new status `open_play`, plus the session id, so the grid can open its details.
    - **Detail fields:** proposed: a title, free-text details, and up to a few labelled links, **https only**, such as an RSVP form or Reclub link. Any fee is written as text in the details. The user confirms this at the plan gate.
    - **Holds and walk-ins:** the cron, `review_payment` and walk-ins all respect sessions the same way they respect blackouts.
  - Migration: the table (or columns), RLS (anyone reads, admins write through RPCs), and admin RPCs to create, edit and delete a session. A session that has already started can't be edited.
- **Acceptance:**
  - pgTAP: RLS for anon, player and admin. A booking, walk-in or held-booking reconfirm into a session is refused. A session over an active booking is refused. `get_availability` reports `open_play`. Link URLs that aren't https are refused.
  - `db:push` and `db:types` have been run.
- **Notes:** The user approved the plan on 2026-10-22: a title, details and up to 3 https links, with one session covering several courts. Migration `20261022140512_open_play_sessions.sql` adds `open_play_sessions` and `open_play_courts` (an exclusion constraint per court) and the per-court advisory lock `private.lock_court_slots`. `validate_booking_slot` refuses open play (`open_play`), and the PayMongo revival treats a session like a blackout. `get_availability` gains `open_play_session_id`, and there are three admin RPCs. RESEARCH M9 "Open play sessions" and SPEC §5.9 and §10 have the details. Tests: `26_open_play.test.sql` (47 assertions). `05`, `20` and `23` were updated only for the new result column. `db:push` and `db:types` were run on 2026-10-22. The reviewer passed it; its test gaps (player reads, live hold and submitted clashes, update clash) are fixed.
- **Follow-ups (T9.11d):** add `open_play`, `invalid_links`, `session_overlap` and `session_started` to `booking/errors.ts` `CODES`, and treat `open_play` as slot-gone in `isSlotGone`. `open_play_courts.court_id` cascades on court delete, so the admin list must tolerate a session with no courts (or `delete_court` could refuse courts with future sessions).

### [x] T9.11d Open play UI
- **Depends:** T9.11c
- **Do:**
  - **Errors:** readable messages for the new hints (`open_play`, `invalid_links`, `session_overlap`, `session_started`); `open_play` counts as "slot gone" on `/book` (T9.11c follow-up). Sessions left with no courts after a court deletion still list without breaking.
  - **Admin** (lazy-loaded): create, edit and delete sessions with a date, time range, court(s), title, details and links. List upcoming sessions. A clash with bookings shows the server's message.
  - **`/book`:** open play slots get their own status color and legend entry (distinct and accessible, like the T8.5 colors) and the label "Open play". Clicking one opens a details dialog with the title, time, courts, details and links. Links open in a new tab with `rel="noopener noreferrer"`. The slot can't be selected for booking.
  - The admin day view shows sessions too.
- **Acceptance:** Testing Library covers the admin form (including the clash error), the grid status and the details dialog (keyboard and screen reader accessible). e2e: an admin creates a session, a guest sees "Open play" on `/book`, opens the details and can't book the slot, and the session is removed in teardown (`E2E…` data).
- **Notes:** Public reads live in `src/features/openPlay/` (`api.ts`, `hooks.ts`, `session.ts`, `OpenPlayDialog.tsx`, a native modal `<dialog>`). Admin writes are in `admin/api.ts` and `admin/hooks.ts`, so the RPC calls stay in the lazy admin chunk (checked in `dist/`). The lazy page is `/admin/open-play` (`OpenPlayPage`, `OpenPlayForm`), with an "Open play" nav entry. Open play slots on the grid are pressable (`aria-haspopup="dialog"`) and never selectable. The day view shows the session title. `open_play` counts as slot-gone, and the four new hints are in `CODES`. Tests: `session.test.ts`, `OpenPlayDialog.test.tsx`, `OpenPlayPage.test.tsx` (including the clash error and an archived court), `SlotGrid.test.tsx`, `DayView.test.tsx`, `errors.test.ts`, `time.test.ts` (`isoToZonedLocal`), and e2e `open-play.spec.ts` (desktop and 360px, axe in light and dark on the grid and the dialog, Escape returns focus to the slot, deleting frees the slots). jsdom gets a `<dialog>` shim in `src/test/setup.ts`. verify passes (466); e2e 39 passed, 3 skipped (the walk-in runs after closing time, and the zoom check runs on desktop only). The reviewer passed it; its major (archived courts) and two minors (the list waits for the venue timezone, "(next day)" on overnight sessions) are fixed.
- **Follow-ups:** the service role can't INSERT `open_play_sessions` directly, because the check constraint calls `private.valid_open_play_links`, whose execute was revoked from everyone. Only the RPCs (which run as the owner) can write. Grant execute to `service_role` (or inline the check) in a later migration if seeds or scripts need direct writes.

### [x] T9.11e Photo viewer
- **Do (the user's request, 2026-10-21):** players can tap a court photo, or any gallery photo, to see it properly: a full-screen viewer that shows the whole image, swipe or previous/next between that court's photos with a "2 of 4" counter, and a close button. Escape, the arrow keys, focus trapping and returning focus all work. Uses the native `<dialog>` and the T9.7 gallery code (no library), with pinch zoom left to the browser. Also opens from the banner if that's simple.
- **Acceptance:** Testing Library covers open, next/previous, Escape and focus returning to the photo. axe passes on the open viewer. e2e on the phone project opens a photo and closes it.
- **Notes:** `src/components/PhotoViewer.tsx` is shared: a native modal `<dialog>` with a counter, previous and next, the arrow keys, a one-finger swipe (a pinch is ignored), Escape, a failed-image message, an index clamped when the list shrinks, and focus returning to the photo it opened from. `CourtPhoto` takes `onOpen`, which turns the image into a "View full screen: …" button (the placeholder never opens). `CourtGallery` opens the viewer from every photo, and its `coverOnly` mode on the home tiles opens all of a court's photos. The banner opens too. Tests: `PhotoViewer.test.tsx`, `CourtGallery.test.tsx`, `HomeBanner.test.tsx`, and e2e `court-photo.spec.ts` (desktop and 360px: axe on the viewer, previous, ArrowRight, Escape, focus returning). The jsdom `<dialog>` shim now focuses the first focusable element, as browsers do. verify passes (476). The reviewer passed it; its major (the list shrinking while open) and minor (the arrow keys after a click, via `tabIndex=-1`) are fixed. Both dialogs now capture the element that opened them on first render, so StrictMode can't lose it.

### [x] T9.11f Booking page polish: court details open, PayMongo loading
- **Do (the user's request, 2026-10-21):**
  - On `/book`, "About the … courts" is **open by default**. It's a `<details>` element that currently starts closed. Players can still collapse it.
  - A proper loading state while going to PayMongo. After "Pay online", the button and the page show a clear "Taking you to PayMongo…" state (a spinner, disabled controls, `aria-live`) until the browser leaves. It stays if the redirect is slow. If creating the checkout fails, it returns to a usable state with the error. Check the other redirects and long waits (the PayMongo return page, proof upload) for the same gap.
- **Acceptance:** Testing Library covers the open details and the pending, redirecting and error states of Pay online. The e2e `pay-online` flow still passes.
- **Notes:** `/book`'s `<details className="court-info" open>` (an uncontrolled attribute, so a collapse survives re-renders). `PayOnline` has three states (`idle`, `opening`, `redirecting`): a disabled `aria-busy` button with a spinner, then "Taking you to PayMongo…" until the browser leaves, and one `role="status"` line telling the player to keep the page open. An error brings the button back. The same spinner is on "Uploading…" and "Confirming your payment…". Tests: `BookPage.test.tsx` (new), `PayOnline.test.tsx`, `BookingPage.test.tsx`; e2e `pay-online`, `court-photo` (no longer clicks the summary) and `a11y` pass on desktop and 360px. verify passes (477). The reviewer passed it; its major (`aria-busy` moved from the wrapper to the button, so the live line isn't held back) and minor (spinner spacing) are fixed.

### [x] T9.11g Research and migration: venue info (location, socials, info sections, amenities)
- **Depends:** T9.11a
- **Do (the user's request, 2026-10-21):** the venue details admins can set and players see. **Research first** (RESEARCH M9 "Venue info"), then record the decisions in SPEC §10:
  - **Location:** an address, a Google Maps link and an embedded map. Research whether to use the official Maps Embed API (free, but needs a key restricted to our domains) or the keyless `?output=embed` URL, and how the admin supplies the place (an address, a pasted Maps share link, or a place query). Check any CSP or `frame-src` rules on Vercel. Only `https://www.google.com/maps…` embeds are allowed, built from stored fields, never a pasted iframe.
  - **Socials:** a fixed set of platforms (proposed: Facebook, Instagram, TikTok, YouTube, X, Messenger, a website), each with an optional URL. https only, checked by host per platform where practical.
  - **Info sections:** admin-defined sections, each with a title and a body, reorderable (like the T9.2 ordering). Pre-filled, but editable or deletable: Waiver, Reminders and policies, Cancellation and refund policy, House rules. The body format reuses whatever `payment_instructions` uses (plain text or the existing safe markdown), with no raw HTML.
  - **Amenities:** a built-in catalog of about 15 amenities with icons (CR/restrooms, parking, shower, canteen/food, cafe, tables, night lights, Wi-Fi, lockers, aircon, water station, first aid, equipment rental, seating, pro shop) that admins switch on or off, plus custom amenities by name with a generic icon. Ordering is decided in the research. Pick an icon set (likely `lucide-react`, tree-shaken) and check the bundle cost (H6). The user's reference is a row of pill chips with green outline icons.
  - **Storage:** new columns on `venue_settings` for the location and socials, and tables for the sections and amenities. RLS: anyone reads, admins write. Length limits and URL checks are in the database.
- **Acceptance:** pgTAP covers RLS for anon, player and admin, the URL and length checks, and the section and amenity ordering. `db:push` and `db:types` have been run.
- **Notes:** The user approved the plan on 2026-10-22, with the map using the official key when one is set and the keyless embed otherwise, and lucide-react icons. Migration `20261022151141_venue_info.sql`: `venue_settings.address`/`maps_query`; `venue_social_links`, one row per platform with an inline host check (`venue_social_links_platform_host`); `venue_info_sections`, which a trigger appends last, with `move_info_section` and four starter sections; `venue_amenities` (15 built-in keys or a custom name, insert and delete only). Anyone reads; admins write through RLS. `db:push` and `db:types` were run on 2026-10-22. Tests: `27_venue_info.test.sql` (51; it resets the venue info rows inside its transaction, so local edits can't break it). RESEARCH M9 "Venue info", SPEC §6 and §10. `.env.example` has the optional `VITE_GOOGLE_MAPS_EMBED_KEY`. The reviewer passed it; its major (missing per-operation RLS tests) and the test-isolation minor are fixed.
- **Follow-ups:** the title and custom-name checks limit only the trimmed length, so padded spaces aren't capped. A later migration should add `char_length(title) <= 80` and `char_length(custom_name) <= 40`; the admin forms trim input meanwhile. The amenity display order test is done (`venue.test.ts`, T9.11h).

### [x] T9.11h Venue info: admin
- **Depends:** T9.11g
- **Do:** in admin settings (lazy-loaded): edit the location (with a live map preview), the social links, the info sections (add, edit, delete, reorder) and the amenities (checkboxes with their icons, plus add or remove custom ones). Every form handles loading, empty and error states and shows the server's validation messages.
- **Acceptance:** Testing Library covers each form, including the validation errors and reordering. e2e: an admin enables an amenity, adds a section and sets a social link, and they appear on the public side (restored in teardown).
- **Notes:** Shared reads, the amenity catalog (lucide-react icons), the map URLs and the platform host rules (mirroring the DB check) live in `src/features/venue/`. The admin writes are in `admin/api.ts` and `admin/hooks.ts`. `/admin/settings` gains `LocationSection` (map preview on blur), `SocialLinksSection` (client host check; it refetches only after a successful save, so a failed save keeps the typed values), `InfoSectionsSection` (add, edit, delete, `MoveButtons`; add and edit have separate mutations) and `AmenitiesSection` (the toggle shows at once from component state, and the cache takes it over on success). `VITE_GOOGLE_MAPS_EMBED_KEY` is typed in `vite-env.d.ts`. Tests: `venue.test.ts` (the amenity order owed from T9.11g, map URLs, host checks), `VenueInfoSections.test.tsx` (10), e2e `venue-info.spec.ts` (desktop and 360px: an anon client reads what the admin set, and venue-wide state is restored). At T9.11h the icons were only in the lazy SettingsPage chunk (26.4 kB, 8.6 kB gzip); T9.11i brings the amenity icons to the public chunk. verify passes. The reviewer passed it; its three minors are fixed.

### [x] T9.11i Venue info: player side
- **Depends:** T9.11h
- **Do:** on the home page (exact placement settled in the plan, mobile-first):
  - amenities as a row of chips with icons, like the user's reference
  - a "Location" section with the address, the embedded map (lazy, `loading="lazy"`, with a title) and an "Open in Google Maps" button
  - social links as labelled icon links, also in the footer
  - the info sections at the bottom as expandable panels
  - Checkout links to the "Cancellation and refund policy" section when there is one. Empty parts are hidden.
- **Acceptance:** Testing Library covers each part, with data and without. axe passes on the home page. e2e on the phone project checks that the sections render.
- **Notes:** `src/features/venue/VenueInfo.tsx` holds `AmenityChips` (under the hero), `VenueLocation` (a card after the courts: address, lazy map from `mapEmbedUrl`, "Open in Google Maps", social links), `FooterSocials` (in `Layout`, every public page), `InfoSections` ("Good to know" panels with `info-<id>` anchors; a hash opens one and scrolls to it, again after page load) and `CancellationPolicyLink` (under the checkout form, in a new tab: the first section with "cancel" in its title, which the admin page and SPEC §7 say). Social links use generic icons, because lucide v1 has no brand logos. Every part renders nothing while loading, on error or when empty. Tests: `VenueInfo.test.tsx` (13), `Layout.test.tsx` (QueryClient wrapper), and e2e `venue-info.spec.ts`, extended to a signed-out player on `/` at desktop and 360px with axe in light and dark (the third-party map frame excluded). verify passes (504); full e2e 41 passed, 3 skipped. The public index chunk grew from 67.9 kB to 82.9 kB (25.9 kB gzip, +5.6 kB): the amenity icons and the venue components. The reviewer passed it; its three minors (the documented title rule, the error-state tests, the re-scroll after load) are fixed.

### [-] T9.11j Waiver acceptance (skipped)
- **Do:** whether players must accept the waiver at checkout (a required checkbox, recorded with the booking and the waiver version) or it is only displayed (already covered by T9.11i's info sections). SPEC §11 has the open question. Plan it only once the client decides. If it isn't needed, mark it `[-]`.
- **Notes:** Skipped by the user on 2026-10-23. There's no acceptance checkbox; the Waiver info section is shown on the home page (T9.11i). Revisit it as a new task if the client asks for recorded acceptance.

### [x] T9.12 Close out M9 and the project
- **Depends:** T9.1–T9.11i (T9.11j skipped)
- **Do:**
  - README: what the project is, its stack and architecture, and how to run it locally. Note that previews share the production database (RESEARCH M8).
  - Screenshots (phone and desktop), and decide on seed demo photos for them (skipped in T6.7).
  - A demo video script.
  - Mark M9 ✅ in SPEC §9 and run the final milestone review.
- **Acceptance:** `npm run verify` and `npm run test:e2e` pass, and the reviewer signs off.
- **Notes:** The user approved the plan on 2026-10-23, including generated court illustrations for the screenshots, and skipped T9.11j. `README.md` was rewritten (what it does, stack, architecture, running it locally, tests, deployment and the shared preview database). `docs/demo-script.md` is a 6-scene, roughly 3½-minute script. `npm run screenshots` (`scripts/screenshots.mjs`) regenerates `docs/screenshots/` (17 PNGs, phone and desktop) on the local stack: it points its own Vite server at the local stack, adds temporary demo data, and removes it step by step even after an error or Ctrl-C (checked: nothing left behind). Seed demo photos stay out of `seed.sql` (SPEC §10, 2026-10-23). The user approved deleting 63 leftover local smoke-test bookings. A flaky `AuthProvider.test.tsx` was fixed: the probe captures in `useLayoutEffect`, with the assertions unchanged. SPEC §9 marks M9 ✅ (v1.0). verify passes (504 Vitest, 687 pgTAP); e2e 43 passed, 1 skipped. The final milestone 9 review passed; its major (this Handoff) and two minors (screenshot cleanup, Node 22.12 in the README) are fixed.

## Milestone 10: Product improvements

Goal: the user's 2026-10-25 requests, built on the current single-venue app before the SaaS work (`docs/SAAS-PLAN.md` §7a; M11 follows, then the multi-venue phases as M12+). Product decisions were made in that plan's discussion and are repeated in each task. Research settles the technical ones.

> **Status: approved by the user on 2026-10-25.** Every DB task stops at its own plan gate before `db:push`. **Production is live:** every migration keeps the deployed frontend working (expand → deploy → contract, RESEARCH M9 "Shipping DB changes while production is live").

Out of scope for M10: multiple venues, the booking fee (M11), billing and invoices (M12+), a rain-check status with no new time yet, bulk rescheduling, player self-rescheduling (never: staff only), refunds, live payments.

### [x] T10.1 Research: M10
- **Do:** research, then record the findings in RESEARCH M10 and the accepted decisions in SPEC §10. Add M10 to SPEC §9.
  - **Picker:** `react-day-picker`. The current version, React 19 support, bundle cost (with `.env` present), styling it with our CSS tokens in light and dark, keyboard and screen-reader behavior, and disabling days (outside the booking window, closed days). The hour-button model for overnight operating days (`lib/time.ts`, `catalog/hours.ts`).
  - **Merged blocks:** table `rowSpan`/`colSpan` versus CSS grid for the slot grid. Accessibility of one button per block (labels, focus order, axe). How the phone layout scrolls. What `get_availability` must return: an opaque per-block key, never a booking id.
  - **Earnings:**
    - What "money came in" is per method: approved time for proofs, the paid time for PayMongo, creation for walk-ins. Is there a usable timestamp today, or is a `received_at` needed?
    - The occupancy formula: hours sold ÷ hours open, with blackouts subtracted and open play counted separately.
    - Week boundaries (Monday) and ranges in the venue timezone, including overnight operating days.
    - The chart: plain SVG or CSS bars, with no chart library unless research shows a need.
  - **CSV:** columns, escaping (including spreadsheet formula injection: cells starting with `=`, `+`, `-`, `@`), UTF-8 with a BOM for Excel, and Data Privacy Act notes for exporting contact details.
  - **Rescheduling:** the split design below (T10.9). How it touches:
    - `validate_booking_slot`, `lock_court_slots` and the exclusion constraint;
    - the "one approved payment per confirmed booking" invariant;
    - `get_guest_booking`, `claim_guest_bookings` and `cancel_booking`;
    - the email outbox uniqueness (a booking can be rescheduled more than once).
    - Should a continuation point to the booking it was split from, or to the original?
- **Acceptance:** RESEARCH M10 written with sources. SPEC §9 and §10 updated. The user has seen the recommendations at the plan gate.
- **Notes:** The user approved every recommendation on 2026-10-25: walk-in slot rules for rescheduling, no cascade on cancel, contact details off by default in CSV. Evidence: a scratch esbuild bundle (DayPicker +74.6 kB raw / 22.5 kB gzip JS, 2.2 kB gzip CSS), local queries (Monday `date_trunc('week')`, the enum-in-transaction failure, current function bodies). T10.3, T10.4, T10.6, T10.8 and T10.9 were updated with the decisions. No code changed. The reviewer passed it; its 5 minors were fixed (T10.9 wording, the T10.4 blackout key, the OWASP link, the refunds-due filter, and cancel emails for continuations).

### [x] T10.2 Date and hour picker component
- **Depends:** T10.1
- **Do:** shared components (where research puts them, e.g. `src/components/DatePicker.tsx` and `HourPicker.tsx`):
  - **Date:** a calendar on `react-day-picker`. Days outside a given range and closed days are disabled. "Today" and "Tomorrow" quick picks. Styled with our tokens, light and dark.
  - **Hours:** buttons for one operating day's hours only, overnight included ("12 AM (next day)"). Never minutes.
  - **Duration:** 1h, 2h, 3h… up to what fits in that operating day.
  - Pure helpers (hours for a day, start + duration → range) in a `.ts` file with Vitest.
- **Acceptance:**
  - Vitest covers the helpers, including overnight and 24-hour days and the DST-free Asia/Manila zone.
  - Component tests cover keyboard use and disabled days.
  - The bundle size is measured with `.env` present. The calendar stays out of the public bundle if only admin pages use it; if `/book` uses it, record its public cost in the Handoff.
- **Notes:** Done on 2026-10-25.
  - **Files:** `src/components/DatePicker.tsx` (Today/Tomorrow plus a lazy `Calendar.tsx` on `@daypicker/react` 10.0.2 in a native `<dialog>`), `HourPicker.tsx` (`HourPicker`, `DurationPicker`) on `ChoiceGroup.tsx` (native radio pills: arrow keys, one tab stop), and `pickerHours.ts`. The helpers live in `src/components`, not `src/lib` as RESEARCH suggested, because they build on `features/catalog/hours.ts`. They're named `operatingHourOptions`, `calendarHourOptions`, `maxDuration` and `endAfter`, and share `hourOnDate()` with `operatingDayRange`.
  - **Fixed:** `showModal()` moved focus to "previous month" once the calendar chunk was cached, so the dialog now gives focus back to the day. The dialog has less padding and the days are 42px under 380px, so a week fits on a 360px phone.
  - **Evidence:** `pickerHours.test.ts` (15 tests), `HourPicker.test.tsx` and `DatePicker.test.tsx` (13 tests, including the first and the cached opens).
  - **Bundle** (with `.env`): unused, the public `index` is unchanged at 83.1 kB (26.0 kB gzip). A trial on `/book` (reverted) gave `index` +6.4 kB raw / +1.7 kB gzip, plus a lazy `Calendar` chunk of 67.6 kB (19.9 kB gzip) and 1.8 kB gzip CSS.
  - verify passes (532 Vitest, 687 pgTAP); e2e 41 passed, 3 skipped (time-of-day walk-in, phone zoom). The reviewer passed it; its major (phone fit) and a minor (duplicated hour helper) are fixed.
- **Follow-ups (T10.3):**
  - Clear or clamp the parent's duration when the date or start changes; `DurationPicker` only hides a stale value.
  - Blackout "Until" offers 12 AM–11 PM, so midnight is the next day's 12 AM: label it clearly or add "midnight (end of day)".
  - Check what the +6.4 kB in `index` is (probably Vite's preload helper).
  - Pass `operatingToday()` and `closedDaysOfWeek(hours)` to `DatePicker`.
  - Check the calendar at 360px in the phone e2e.

### [x] T10.3 Use the picker: open play, blackouts and `/book`
- **Depends:** T10.2
- **Do:**
  - **Open play form:** date + start hour + duration replace the two `datetime-local` inputs. Editing a session shows its current values.
  - **Schedule page (blackouts):** a From/Until date + hour range over all 24 hours (blackouts may span days and cover closed time; T10.1).
  - **`/book`:** the calendar replaces the plain date input, limited to the booking window.
  - The RPCs are unchanged; this is UI only.
- **Acceptance:** Vitest and component tests updated. The e2e flows for open play, blackouts and booking use the new pickers through accessible selectors. axe is clean in light and dark.
- **Notes:** Done on 2026-10-25.
  - **Open play:** date + start hour + length within the operating day. Started hours are left out, and a stale start or length is derived away, never sent.
  - **Blackouts:** "Starts on/at" and "Ends on/at" over all 24 hours. "Midnight" ends a date (`calendarEndOptions`), the end day follows the start day, and a start day left behind past midnight moves up to today.
  - **`/book`:** `DatePicker` with `hideLabel` and `stepper` (the ‹ › arrows sit beside the date and wrap with it) replaces the date input.
  - `.choice` inputs now cover their pill, so taps land on the radio.
  - **Evidence:**
    - `OpenPlayPage.test.tsx`, `SchedulePage.test.tsx` (blackouts block), `BookPage.test.tsx` ("BookPage date") and `pickerHours.test.ts`;
    - e2e `blackout.spec.ts` (new: pickers, axe light and dark with the calendar open, the month fitting the dialog at 360px, a guest picking the date in `/book`'s calendar) and `open-play.spec.ts` (pickers);
    - the `pickDate` helper, with E2E blackouts in teardown.
  - **Bundle** (with `.env`): public `index` 88.4 kB (27.3 kB gzip), up 5.4 kB raw / 1.3 kB gzip (DatePicker, the picker helpers and Vite's preload helper). `Calendar` stays a lazy 19.9 kB gzip chunk plus 1.8 kB gzip CSS.
  - `scripts/smoke-production.mjs` steps with "Next day" instead of filling the removed date input (it works with the old and new frontend). It has only been syntax-checked, because a local run would still book on the linked project.
  - verify passes (537 Vitest, 687 pgTAP); e2e 43 passed, 3 skipped (time-of-day walk-in, phone zoom).
  - The reviewer passed it; its major (the smoke script) and both minors (the Handoff bundle baseline, the start date after midnight) are fixed.

### [x] T10.4 Migration: block keys in availability
- **Depends:** T10.1
- **Do:** `get_availability` returns a `block_key` per slot, so the grid can merge consecutive slots of the same booking, open play session or blackout.
  - Bookings use an opaque hash, never the booking id or reference.
  - Open play can use the session id (already public).
  - Blackouts use the blackout id (public); an all-courts blackout shares one key across courts.
  - Expand only: a new result column, with the old columns unchanged, so the live frontend keeps working.
- **Acceptance:**
  - pgTAP: the same booking's slots share a key and different bookings differ; the key isn't the booking id; open play and blackouts are keyed as above; free and past slots have none.
  - `05`, `20`, `23` and `26` are updated only for the new column.
  - `db:push` and `db:types` have been run.
- **Notes:** Done on 2026-10-25; the user approved the plan, including `db:push`.
  - **Migration** `20261025151341_availability_block_keys.sql`: drop and recreate with `block_key` last, the blackout `exists` turned into a lateral that picks the lowest id, and the same grants. Status precedence and every earlier column are unchanged.
  - **Evidence:** `28_block_keys.test.sql` (18 tests). The past-slot check skips before 01:00 Manila, when no slot has ended yet. `05`, `20` and `23` were updated only for the column; `26` needed no change.
  - **Pushed to the linked project:** the new signature, anon can execute and PUBLIC can't, and tomorrow's 98 slots have no unkeyed block. The live frontend ignores the column.
  - verify passes (537 Vitest, 705 pgTAP); e2e 43 passed, 3 skipped. The reviewer passed it; its two minors (the vacuous past-slot test, the Handoff) are fixed.
- **Follow-up (T10.5):** the generated type says `block_key: string`, but it's null for free and past slots (gen types marks every returned column non-null). Treat it as nullable when grouping.

### [x] T10.5 Merged blocks on the slot grids
- **Depends:** T10.4
- **Do:**
  - On `/book` and the admin day view, consecutive slots with the same `block_key` on one court become one cell spanning those hours:
    - "Open play · 10 AM – 12 PM", which opens the details as now;
    - "Booked · Ana · 2 PM – 4 PM";
    - "Closed · 2 PM – 5 PM".
  - Merge across courts only when the courts are next to each other in the grid and the span is identical.
  - Grouping logic is a pure function with Vitest. Free slots still select hour by hour.
- **Acceptance:**
  - Vitest for the grouping, covering gaps, overnight rows, a block starting before the first visible row, and cross-court merging.
  - Component tests: one button per block, labelled with the court(s) and the full range.
  - e2e at desktop and 360px; axe clean in light and dark.
  - Screenshots regenerated (`npm run screenshots`).
- **Notes:** Done on 2026-10-25.
  - **Grouping:** a pure `groupBlocks()` in `features/booking/blocks.ts`. Runs of one key go down; neighbouring courts merge only with the same key and the same rows.
  - **`SlotGrid`:** `rowSpan`/`colSpan` cells, one button per block labelled with every court and the full range (with "(next day)" when it ends after midnight). Rows keep 44px.
  - **`DayView`:** bookings group by booking id (an ended hour stays in its cell); open play and blackouts by `block_key`.
  - `Slot.block_key` is `string | null`.
  - **Evidence:** `blocks.test.ts` (12 tests), `SlotGrid.test.tsx` ("merged blocks"), `DayView.test.tsx`; the e2e `open-play` and `blackout` specs (merged cells, axe light and dark, desktop and 360px). Screenshots were regenerated with `npm run screenshots`, whose open play selector was updated.
  - **Also fixed:** `CourtEditPage` gave two sibling sections the same `key`. It predates M10 and caused React duplicate-key warnings in e2e; the keys now have prefixes.
  - A `court-photo` e2e failure in one Stop-hook run ("2 of 2" after ArrowRight in the photo viewer) didn't reproduce: it passed 3 repeats and every later full run.
  - verify passes (557 Vitest, 705 pgTAP); e2e 43 passed, 3 skipped. The reviewer passed it with no findings.
- **Follow-up (optional):** `DayView`'s range text in a merged cell has no "(next day)" marker. The row headers show it.

### [x] T10.6 Migration: earnings summary
- **Depends:** T10.1
- **Do:** admin-only RPC(s) for a date range in the venue timezone, returning:
  - **Collected:** totals per method by when the money came in (T10.1's definition), the previous period's totals for comparison, and a daily series. PayMongo money that wasn't accepted (refund due) is excluded, as on today's dashboard.
  - **Booked hours and occupancy:** per court and per sport, by play time. Open play hours are reported separately.
  - **Coming up:** confirmed bookings not yet played, as a count and a value.
  - No `received_at` column: the approved payment's `reviewed_at` is when the money came in, for every method (T10.1). One RPC `get_earnings(p_from, p_to)` (RESEARCH M10 "Earnings").
- **Acceptance:**
  - pgTAP: admin only (anon and player refused); range edges at midnight and on overnight days; the Monday week start; methods; refunds due excluded; occupancy with blackouts and open play.
  - `db:push` and `db:types` have been run.
- **Notes:** Done on 2026-10-25; the user approved the plan, including `db:push`.
  - **Migration:** `20261025155529_earnings_summary.sql`, `public.get_earnings(date, date) returns jsonb`:
    - **security definer** with an explicit admin check (the operating-day helpers are private; SPEC §10);
    - execute for `authenticated` only;
    - up to 366 days.
  - **Evidence:** `29_earnings.test.sql` (21 tests):
    - access: anon and player refused, bad ranges refused;
    - money: methods, refunds due vs rejected proofs, the previous period, payments at Monday 00:00 and Sunday 23:59:59;
    - hours: an overnight Saturday's 1 AM booking, overlapping and clipped blackouts, all-courts blackouts, open play apart, sports = the sum of their courts;
    - coming up.
  - **Pushed to the linked project:** anon and PUBLIC can't execute, authenticated can, `prosecdef` is true.
  - A year takes about 0.4 s locally, a week about 8 ms.
  - verify passes (557 Vitest, 726 pgTAP); e2e 44 passed, 2 skipped. The reviewer passed it.
- **Follow-ups:**
  - **T10.7:** clamp occupancy at 100%. Blackouts aren't checked against bookings, so a booking inside a blackout counts in both sold and blackout hours.
  - **Later, if it gets slow:** an index on `payments (reviewed_at)` in a new migration.

### [x] T10.7 Dashboard: earnings
- **Depends:** T10.6
- **Do:**
  - An earnings section on `/admin`:
    - a period switch (Today, This week, This month, Custom range);
    - the collected total with each method and the change vs the previous period;
    - booked hours and occupancy per court and per sport;
    - a daily bar chart;
    - "Coming up".
  - Keep the proofs-to-review, walk-in and today's courts cards. Lazy-loaded with the rest of admin.
  - Loading, empty and error states. Mobile-first.
  - Leave a place for the "Plotline fees" line (M11), without showing it yet.
- **Acceptance:**
  - Vitest for formatting and the period math.
  - Component tests for each state.
  - e2e: a walk-in shows up in today's collected total.
  - axe clean in light and dark. The chart is readable without color alone and has a text alternative.
- **Notes:** Done on 2026-10-26.
  - **`EarningsSection`** (on `get_earnings`) replaces "Today's takings":
    - a period switch with whole weeks (Monday to Sunday) and whole months, and a custom range up to 366 days;
    - collected per method, with the change from the period before, and refunds due shown apart;
    - coming up;
    - a booked-hours table per court and sport, with occupancy capped at 100%;
    - a labelled bar per day.
  - **Removed:** the old takings code (`TakingsCard`, `takingsByMethod`, `refundsDueSummary`, `fetchApprovedPayments`, `fetchRefundsDue`, `useTakings`, `useRefundsDue`). Walk-in and review mutations now refresh earnings.
  - **Evidence:**
    - `earnings.test.ts` (12 tests: periods, parsing, occupancy, change, bars) and `EarningsSection.test.tsx` (6 states);
    - e2e `earnings.spec.ts` (a cash walk-in payment raises today's total by its amount; This week bars; axe light and dark; no overflow at 360px);
    - `walk-in.spec.ts`: a walk-in recorded through the form raises the total by the amount received.
  - **Layout:** the hours table fits 360px (columns Court, Booked, Occupancy, Open play; headers wrap).
  - verify passes; e2e passes. The reviewer passed it; its 3 minors (the exact walk-in total, the active-courts note, a duplicate CSS rule) are fixed.

### [x] T10.8 CSV export
- **Depends:** T10.6
- **Do:**
  - "Export CSV" for the selected range, built in the browser from admin-only reads:
    - **Bookings by play date:** reference, court, sport, start, end, status, source, name, phone, email, amount.
    - **Payments by received date:** booking reference, method, amount, reference number, received time, review status.
  - Times are in the venue timezone. Cells are escaped against formula injection; UTF-8 with a BOM.
  - Phone and email only when "Include contact details" is ticked (off by default), with a note to store the file securely (T10.1).
- **Acceptance:** Vitest for the CSV builder (quotes, commas, newlines, formula prefixes, the peso sign, an empty range). e2e downloads both files and checks the headers and one row.
- **Notes:** Done on 2026-10-26.
  - **Builder:** `features/admin/csv.ts`:
    - every cell quoted, with `"` doubled;
    - a leading `'` before `= + - @`, tab, CR, LF or the full-width forms (after leading spaces too);
    - CRLF line ends and a UTF-8 BOM;
    - venue-local times named in the headers, and `amount_php` as plain numbers.
  - **Reads:** paged reads of 1000 rows (`allPages`, a stable order by time then id) in `api.ts`:
    - bookings that start in the range;
    - payments that came in during it, both accepted ones and PayMongo refunds due.
  - **UI:** the `CsvExport` block under the earnings, for the selected range. "Include contact details" is off by default, with a note to store the files securely.
  - **Evidence:** `csv.test.ts` (12 tests: quotes, commas, newlines, every formula prefix, the peso sign, an empty range, both files); `EarningsSection.test.tsx` (range bounds, contact details off and on, the payments file, a failure); e2e `earnings.spec.ts` downloads both files and checks the names, the BOM and header, and a row in each.
  - verify passes (580 Vitest, 726 pgTAP); e2e 47 passed, 1 skipped. The reviewer passed it; its 3 minors are fixed (a deferred `revokeObjectURL`, no invented court or sport, the e2e's operating-day assumption written down).

### [x] T10.9 Research and migration: rescheduling
- **Depends:** T10.1
- **Do:** RPC `reschedule_booking(booking_id, from_start, new_court_id, new_start, reason)`, admin only, for `confirmed` bookings only. The reason is required.
  - **Not started yet** (`from_start` = the booking's start): the whole booking moves. Same row, reference and guest link; `court_id` and `during` change.
  - **Already started:** `from_start` must be the hour in progress or later, and before the end. Everything from it to the end moves together.
    - The original is shortened to the hours before `from_start`.
    - A **continuation booking** is created for the moved hours:
      - `source = 'moved'`, `parent_booking_id`, status `confirmed`, `total_amount = 0`, its own reference code;
      - the parent's contact snapshot, `user_id` and `guest_token_hash`, so the same guest link shows both;
      - no payment of its own.
  - **The new range:** a court of the **same sport**, the same number of hours, free, within operating hours, not blacked out, not open play, and not already ended (walk-in rules: the hour in progress is allowed). Checked with `validate_booking_slot` under `lock_court_slots`; the exclusion constraint backs it up.
  - **Price:** unchanged. No new payment, no new charge.
  - **`booking_changes` table:** booking, old court and range, new court and range, continuation id, reason, `changed_by`, `changed_at`. Admins read; only the RPC writes.
  - **Invariant change:** "every confirmed booking has exactly one approved payment" now excludes `source = 'moved'`, which must have a root booking and no payments. Update the checks and every function that assumes it.
  - **Email:** a new outbox kind `booking_rescheduled`, one per `booking_changes` row (exempt from the per-booking uniqueness, like `proof_rejected`), sent to the booking's contact. Walk-ins are still never emailed.
  - **Guest and player reads:**
    - `get_guest_booking` returns the booking's continuation(s) and change history (old time, new time, reason).
    - `claim_guest_bookings` claims continuations too.
    - `cancel_booking` works on a continuation like any booking. Cancelling a parent doesn't cascade (T10.1); the admin cancel form warns that the moved part stays booked.
    - `queue_booking_email` skips `source <> 'online'`, so extend it: cancelling a `moved` continuation whose root is `online` queues `booking_cancelled` to the root's contact.
  - **Slot rules:** the walk-in rules (`validate_booking_slot(…, p_walk_in => true)`): staff may move into the hour in progress and aren't limited by the booking window (T10.1).
  - **Migrations:** the new enum values (`booking_source` `moved`, `email_kind` `booking_rescheduled`) ship in their own migration first.
- **Acceptance:**
  - pgTAP: admin only, confirmed only, reason required.
  - Whole move before the start; a split during play (from the hour in progress, and from a later hour); refused for a past `from_start`, a different sport, a different length, a clash with a booking, open play or a blackout, and outside hours.
  - The original is shortened correctly and the continuation is created with the right fields. Payments are untouched.
  - The invariant holds; a `booking_changes` row is written; one email row per change; the guest read shows both; claims and cancel work on continuations.
  - `db:push` and `db:types` have been run.
- **Notes:** The user approved the plan on 2026-10-26. Migrations `20261026130653_reschedule_enums`, `20261026130654_rescheduling` and `20261026131753_guest_booking_changes_chain` (a review fix: a root's guest history also lists changes to its continuations), all pushed to the linked project, types regenerated. 78 pgTAP tests in `30_reschedule.test.sql`. "A different length" can't be a separate case (the RPC derives the moved length), so it shows up as `outside_hours` or a clash (SPEC §10). The only UI change is a `Moved` source label in `BookingFiltersBar` so the types still compile. verify passes; e2e 46 passed, 2 skipped. The reviewer passed it; its major and 3 minors are fixed. Follow-up for T10.10: the `booking_rescheduled` email has no template yet, so a reschedule on the linked project before then would queue rows that fail in `send-emails`.

### [x] T10.10 Rescheduling UI and email
- **Depends:** T10.9, T10.5
- **Do:**
  - **Admin:** "Reschedule" on a confirmed booking (admin bookings list and day view). A dialog:
    - when the booking has started, "move from" hour buttons (the hour in progress or later);
    - a slot grid limited to same-sport courts, picking the same number of consecutive free hours;
    - a required reason, a confirmation summary, and readable errors for every RPC hint.
  - **Player and guest booking page:** "Moved from Sat 3 PM to Sun 4 PM (rain)", and a moved part listed under its parent ("1 hour moved to Sun 4 PM, CB-…"). My bookings shows continuations.
  - **Email:** a `booking_rescheduled` template (new time, court, reason, the guest link for guests) in `send-emails`, with tests.
- **Acceptance:**
  - Vitest and component tests for the dialog states.
  - e2e: reschedule before the start (guest sees the new time), and a split during play (both parts visible to the guest, admin day view updated).
  - The email arrives in Mailpit.
  - axe clean in light and dark.
- **Notes:** Done on 2026-10-26; the user approved the plan (including that the guest's email has no private link, and redeploying `send-emails`). No migration.
  - **Email:** `booking_rescheduled` in `emailTemplates.ts`: the new court and time, "Was" (the old ones), the reason, and the moved part's own reference after a split. It uses the snapshot's `old_*` and `new_*` fields, since the root's own time is its shortened one. A guest's copy has no private link (the token is never stored); it says to use the link from the confirmation or sign up with the same email.
  - **Booking page:** a "Schedule changes" card (`MoveHistory`, `moves.ts`): each move with its reason, and the booking's moved parts (their references open through the same link). A moved part says which booking it came from. Guests read `continuations` and `changes` from `get_guest_booking`; owners and admins read the same through RLS (`fetchOwnMoves`). My bookings says "Moved part of CB-…".
  - **Admin:** `RescheduleSection` and `RescheduleForm` in the booking panel (not a modal): "Move from" hours once it has started, a new date within the booking window, a same-sport active court, and start hours from `get_availability` where the whole moved length is free (walk-in helpers `isWalkInStartable` and `maxWalkInSlots`). Pure rules in `reschedule.ts`. The cancel form names still-booked moved parts (`useActiveMovedParts`, refreshed after a move or cancel). It uses `mutateAsync`, because a move often takes the booking out of the list's date filter and the panel unmounts before per-call callbacks run (found by the e2e).
  - **Found by axe:** the "Confirmed" badge in a selected list row had under 4.5:1 (its tint stacked on the row's); fixed in `index.css`.
  - **Evidence:** Vitest (`RescheduleForm` 12, `RescheduleSection` 7, `reschedule.ts` 12, `MoveHistory`, `hooks.test.tsx`, the email template, `AdminCancelForm`, My bookings); e2e `reschedule.spec.ts` on desktop and phone: a whole move (the guest sees the court, date and hour, the email arrives in Mailpit with no `#token=`) and a split during play (exact shortened hour in the panel, the dashboard day view, both parts through the guest link, the email). The split test opens the venue 6 AM to 5 AM while it runs (restored in `afterEach`), so it runs at nearly any time. axe light and dark and no sideways scroll at 360px.
  - **Bundle** (with `.env`): public `index` 95.96 kB (29.69 kB gzip), up 4.2 kB raw / 1.1 kB gzip from this task (91.76 kB at HEAD). The form is in the lazy admin chunk.
  - verify passes (Vitest, 804 pgTAP). The reviewer passed it on round 2; round 1's blocker (the split e2e didn't prove the admin side), a major (the moved-parts warning went stale) and 4 minors are fixed.
- **Follow-ups:**
  - A whole move of a *continuation* emails "Booking CB-ROOT was moved" with the root's reference, because the snapshot has no reference for the moved booking. Needs a migration (add it to the `queue_reschedule_email` snapshot).
  - `MoveHistory` reads `window.location.hash` for the guest link (BookingSummary's tests render without a Router); `useLocation().hash` would follow the router.
  - A same-court shift that overlaps the booking's own hours isn't offered (the grid shows them as booked), and dates are limited to the booking window (SPEC §10).
  - `e2e/court-photo.spec.ts` is flaky: "2 of 2" after ArrowRight in the photo viewer failed once in a full run (as in T10.5), and passed 6 of 6 on a rerun. The viewer wasn't touched here.

### [x] T10.11 Close out M10
- **Depends:** T10.2–T10.10
- **Do:**
  - Update the README (features and screenshots) and `docs/demo-script.md` (rescheduling and earnings scenes).
  - Mark M10 ✅ in SPEC §9 and run the milestone review.
  - Move the Handoff on to M11 (Plotline brand and venue upgrades, below).
- **Acceptance:** `npm run verify` and `npm run test:e2e` pass, and the reviewer signs off.
- **Notes:** Done on 2026-10-26.
  - **README:** the calendar and merged blocks, the earnings dashboard and CSV export, rescheduling (with its history and continuation bookings), the rescheduled email, `reschedule_booking` in the RPC list, new test counts (about 630 Vitest, 800 pgTAP), and the reschedule form as the third screenshot.
  - **Demo script:** the calendar, the earnings and CSV scene, and a new scene 6 for rescheduling (a whole move and a split during play). It's now about 4 to 5 minutes.
  - **Screenshots:** regenerated with `npm run screenshots` (merged open play block on `/book`, and so on), plus new `admin-reschedule-phone.png` and `admin-reschedule-desktop.png` (the script confirms a second demo booking to move, and removes it). The dashboard images are the older ones; see the Handoff.
  - **Evidence:** `npm run verify` passes (627 Vitest, 804 pgTAP); the full e2e passes (49 passed, 3 skipped); SPEC §9 marks M10 ✅.
  - **Review:** the milestone review passed. Its major (SPEC §5.10, the §6 schema and the §2, §5 and §8 passages weren't updated for rescheduling) and its 3 minors (the demo script's button names and scene order, the Handoff follow-ups) are fixed.

## Milestone 11: Plotline brand and venue upgrades

Goal: the user's 2026-10-26 requests, built on the single-venue app after M10 and before the SaaS work (the multi-venue phases follow as M12+, `docs/SAAS-PLAN.md`). The brand is summarized in [docs/BRAND.md](docs/BRAND.md).

> **Status: approved by the user on 2026-10-26**, with the four product decisions below. Every DB task stops at its own plan gate before `db:push`. **Production is live:** every migration keeps the deployed frontend working (expand → deploy → contract).

**Decisions (the user's, 2026-10-26):**
- **Booking fee now:** the ₱10 booking fee paid by the player is built in M11 for the single venue, brought forward from SaaS Phase 1. The dashboard's total revenue, owner earnings and platform earnings are real numbers from it. The billing ledger and invoices stay in SaaS Phase 1.
- **Themes:** Plotline's fonts, shapes and logo apply everywhere. Owners pick one of about 4–5 color presets: Plotline (the default), Court Green (today's) and a few more, each with light and dark versions checked for contrast. No custom colors.
- **Location:** the admin pastes a Google Maps link. Players see only the address with a pin icon, linked to Google Maps. The embedded map and the optional Maps Embed API key are removed.
- **Walk-ins:** one flag in the code, **hidden by default**. Existing walk-in bookings still show normally.
- **Logo:** no SVG export is available (the guide is on a free Canva account), so T11.3 optimizes the existing plotline-site tile SVG (`docs/BRAND.md`) and uses a live-text wordmark. The "km" node stays, as in the guide.

**Added on 2026-10-28 (the user's calls, SPEC §10):** T11.16–T11.21 cover phone numbers (optional for everyone, stored as `09XXXXXXXXX`), a venue waiver at checkout (not for walk-ins) and a live new-booking alert in the admin tab (counting only proofs that come in and online payments). Later that day, T11.22–T11.24 added a Plotline-controlled switch for online payments (manual is always on) and the address with quick facts in the home page hero. **Added on 2026-10-29:** T11.25–T11.30 cover full-width payment QR codes with the iPhone hint behind an ⓘ, Resend from `mail.plotline.fit`, "Paid with" listing the payment accounts, and a fresh private link in a guest's "upload a new proof" email. The close-out moved to T11.31.

Out of scope for M11: multiple venues, the billing ledger, invoices and statements (SaaS Phase 1), custom theme colors, a player light/dark toggle (the system setting decides, as today), refunds of the booking fee in the app, a server-side ban on walk-ins (SaaS Phase 1, per venue).

### [x] T11.1 Research: M11
- **Depends:** T10.11
- **Do:** research, then record the findings in RESEARCH M11 and the accepted decisions in SPEC §10.
  - **Brand tokens:** map docs/BRAND.md onto our CSS tokens for light and dark (dark: warm-brown surfaces with cream text). Sage and dusty rose fail as text and thin outlines on cream, so derive darker shades for links, focus rings, the free-slot outline and badges, and distinct slot status colors (free, selected, booked, pending, open play, closed). Every pair goes through `themeChecks.ts`.
  - **Fonts:** self-hosting Fraunces and DM Sans (`@fontsource` packages, only the weights used, `font-display: swap`) versus Google Fonts. Cost with `.env` present, layout shift, and the Data Privacy Act angle of a third-party font request.
  - **Logo:** redrawing the tile as SVG (no Canva export; keep the "km" node) and the wordmark (Fraunces as SVG paths, or live text with the font loaded). The favicon (tile only, below 32px) and an apple-touch icon.
  - **Where Plotline shows on a venue's site:** proposal: the venue name stays in the public header; the Plotline logo goes in the admin header, the admin login and a "Powered by Plotline" footer line; the favicon is the Plotline tile.
  - **Theme presets:** the preset list and names, and how a venue's preset reaches the page without a flash of the default (a `data-theme` attribute on `<html>`, the last theme cached in `localStorage` and applied by a small inline script). Does the admin area follow the venue's preset or stay in Plotline's? (Proposal: it follows the preset, with a preview in settings.)
  - **Maps links:** which pasted links to accept (`https://www.google.com/maps/…`, `https://maps.google.com/…`, `https://maps.app.goo.gl/…`, `https://goo.gl/maps/…`), checked in the database. Short links can't be expanded in the browser (no CORS), so the admin types the address; a long link's `/place/<name>/` can pre-fill it. How to move the stored `maps_query` to a link (expand → deploy → contract).
  - **Payment QR codes:** the data model (proposal: a `venue_payment_accounts` table with label, account name, account number, an optional QR image and a position; the free-text `payment_instructions` stays for extra notes), the storage path in `venue-media`, and keeping QR codes scannable: no lossy downscaling (PNG or lossless WebP, a size cap), and a "Save QR" download so players can scan it from their gallery in GCash or their bank app.
  - **Booking fee:** every place that treats `total_amount` as the amount due: `create_booking`, the PayMongo checkout and webhook amount checks, `review_payment`, the late-payment refund path, `get_guest_booking`, emails, earnings, CSV. Naming (`booking_fee` plus a computed amount due, or a stored total). Where the fee comes from (`platform_pricing`, readable by anyone, writable by no client role). Which bookings carry it (online only; walk-ins and `moved` continuations ₱0). **Rollout:** the fee starts at ₱0 on production and becomes ₱10 only after the frontend that shows it is deployed, so the live site never asks for an amount it doesn't display.
  - **Earnings split:** total revenue = court price + fees collected, owner earnings = court price, Plotline fees = fees, by when the money came in (T10.1's rule). Bookings cancelled by the venue (`cancelled_by_venue`) don't count their fee (SaaS plan §5).
  - **Walk-in flag:** a build-time flag (proposal: `VITE_FEATURE_WALK_INS`, read inline where the walk-in section is lazy-imported, off unless `true`) so the walk-in code drops out of the build when off. How e2e runs the walk-in specs (the e2e server turns it on) and still checks the hidden state.
- **Acceptance:** RESEARCH M11 written with sources. SPEC §9 and §10 updated. The user has seen the recommendations at the plan gate, including the theme preset list.
- **Notes:** RESEARCH "Milestone 11" has 9 Decided entries; SPEC §10 has the 2026-10-27 row. The user approved at the plan gate: all five presets (`plotline`, `court-green`, `ocean`, `plum`, `sunset`), the admin area following the preset, and every other recommendation. The reviewer's first round blocked on the fee inventory; fixed (`proof_target` and the live `record_paymongo_payment` body, earnings that add up from `payments.amount`, Edge Function redeploy before the fee goes to ₱10, Save QR via a download URL, storage policy folders, `private.url_encode`, a Fraunces opsz caveat).
- **Follow-ups for later tasks:** T11.12 keeps `proof_target`'s `total_amount` output column (filled with `amount_due`) or adds `amount_due` beside it, never renames it, so the live checkout works between `db:push` and the function redeploy; T11.8 raises the `maps_url` cap to 1000; T11.13 redeploys `create-paymongo-checkout` and `send-emails`, runs `smoke:paymongo` against the linked project, then sets the fee to ₱10; T11.10 replaces the `venue-media` folder policies; T11.8 adds `private.url_encode`; T11.3 compares static and variable Fraunces.

### [x] T11.2 Walk-in feature flag
- **Depends:** T11.1
- **Do:**
  - The flag `VITE_FEATURE_WALK_INS` is read inline in `DashboardPage` (an exported constant was not folded by the bundler, T11.2). With it off: no walk-in form or "+ Walk-in" action on the dashboard, and nothing else that creates a walk-in. With it on, everything works as today.
  - Existing walk-in bookings still show everywhere (lists, filters, the day view, earnings, CSV) with their "Walk-in" label.
  - Rescheduling keeps its walk-in slot rules; they don't depend on the flag.
  - `.env.example` documents the variable. Vercel keeps it unset (hidden).
- **Acceptance:**
  - Component tests for the dashboard with the flag off and on.
  - The production build with the flag off has no walk-in form code (checked in `dist/`).
  - e2e: the walk-in specs run with the flag on; one check confirms the dashboard has no walk-in action when it's off (or a unit test does, if the e2e server can run only one mode).
- **Notes:** The walk-in card moved to a lazy `WalkInSection.tsx`, loaded only when `import.meta.env.VITE_FEATURE_WALK_INS === 'true'`. The check is inline in `DashboardPage.tsx` because a constant exported from `src/lib/features.ts` was not folded by Rolldown and left the chunk in `dist/` (so that file was dropped). Flag-off build: no `WalkInSection` chunk and no "Record walk-in" string in `dist/`. Tests: `DashboardPage.test.tsx` (off and on); `playwright.config.ts` sets the flag for the e2e server, so `walk-in` and `earnings` specs pass (desktop and phone). `.env.example` and `vite-env.d.ts` document it. Existing walk-in labels, filters, CSV and rescheduling are untouched. Vercel leaves it unset.

### [x] T11.3 Brand foundation: tokens, fonts, logo
- **Depends:** T11.1
- **Do:**
  - The Plotline palette becomes the default light and dark tokens in `src/index.css`, with the shades T11.1 derived.
  - Fraunces for headings and the wordmark, DM Sans for everything else, loaded as T11.1 decides.
  - The Plotline logo as SVG components (tile, and tile + wordmark, light and dark) in `src/components/`. Start from the tile in `plotline-site/public/logo.svg` (optimized); the wordmark is live Fraunces text, as in plotline-site (docs/BRAND.md "Reference implementation"). The user checks it against the guide. Favicon and apple-touch icon replaced.
  - Shared building blocks restyled: buttons (sage with warm-brown text), inputs, cards, badges, alerts, the slot status colors, focus rings.
- **Acceptance:**
  - `theme.test.ts` checks every AA pair on the new tokens, light and dark.
  - axe is clean in light and dark (the a11y e2e).
  - Bundle and CSS size measured with `.env` present and recorded in the Handoff.
- **Notes:** `src/index.css` now holds the Plotline tokens (brand layer plus roles, light and dark). The ink accent is `#4c6b3c` (deepened from RESEARCH's `#56703f` for the tinted badges). Primary buttons are sage with brown text, a 1.5px ink border and a pill shape (`--btn`, `--btn-text`, `--btn-hover`); the old `--accent-contrast` and `--accent-hover` are gone. Inputs use `--field` and `--border-strong` (3:1). The pending badge and the warning text use rose/terracotta tokens instead of yellow. Fraunces (600, 700) and DM Sans (500, 700) are self-hosted through `@fontsource` (exact 5.3.0). Logo: the plotline-site tile optimized with svgo (51 kB to 5.4 kB, rendered identically) as `src/assets/plotline-tile.svg`, shown by `PlotlineTile` / `PlotlineLogo` (live-text wordmark) in `src/components/PlotlineLogo.tsx`; favicon, apple-touch icon and `theme-color` metas replaced. Not placed in any header yet (T11.4/T11.5). Tests: `theme.test.ts` (31 pairs per mode, resolving `var()` references; `themeChecks.ts` extended), `PlotlineLogo.test.tsx`; the axe e2e (light and dark) passes with the full e2e: 51 passed, 1 skipped.
- **Sizes (with `.env`):** public `index` JS 95.99 kB (29.72 kB gzip, unchanged); `index.css` 27.78 kB (6.38 kB gzip); fonts fetched per page: DM Sans latin 500 and 700 (14.3 kB each) plus latin-ext (7.4 kB each), Fraunces latin 600 and 700 (18 kB each).
- **Follow-ups:** the `--accent-soft` dark tint is 10% (16% failed AA on badges); the brand mark `◆` and "Claudex Courts" text in the headers stay until T11.4/T11.5; the dist folder carries every font subset and a `.woff` fallback that browsers never fetch.
### [x] T11.4 Restyle the public site and emails
- **Depends:** T11.3
- **Do:**
  - Home, `/book`, checkout, the booking page, My bookings, login and sign-up, and the error and empty pages, mobile-first.
  - The header keeps the venue name; the footer gains "Powered by Plotline" with the logo (as T11.1 decides).
  - Optional brand shapes in the hero, login and empty states, never behind text.
  - The email templates (`emailTemplates.ts`) use the palette, with web-safe font fallbacks.
  - **Shared first (the user's feedback, 2026-10-27; picked from the [preview page](https://claude.ai/artifact/YVwmkpskANhbzAacUa55Jo)):**
    - **Dark palette "Espresso" (pick B):** `--bg #2a2522`, `--surface #3f3833`, `--field #211d1b`, `--border #574d46`, `--border-strong #968779` (cream text, sand muted and the sage, rose and danger tokens stay). Today's brown page and cards were 1.13:1 apart; these are 1.32:1. The dark `theme-color` meta becomes `#2a2522`. `docs/BRAND.md` notes that the app's dark page is espresso, not the guide's warm brown.
    - **Color on purpose, light and dark:** card and section headings tinted with sage or rose (`--tint-sage` / `--tint-rose`: light `#e5ebdd` / `#f6e4dd`, plotline-site's soft shades; dark `#4b5245` / `#5e4843`, tuned by eye and for AA), the active nav tab filled sage with brown text, rose for pending. Sections stand apart clearly (surface against page, a border, the tinted heading), not by spacing alone.
    - **Transitions:** 150–250 ms ease-out on panels that expand and collapse (`<details>`: `::details-content` with `interpolate-size`, opening at once where the browser can't animate it), hover and press on buttons and slots, and dialogs opening. Nothing moves under `prefers-reduced-motion: reduce`. No page-to-page transitions.
  - **Good to know (option b):** keep one card per section, but tighter: about 12px padding and an 8px gap, with no card margin on top of the stack gap (today about 30px between panels).
  - **"Stay connected" band (the user's request and answers, 2026-10-27):**
    - A full-width band above the footer on every public page. It **replaces** today's social links: the footer row (`FooterSocials`) and the list in the home page's location block. No band when the venue has no links.
    - Fixed text (not editable): the eyebrow "Stay connected", the heading "Connect with us", and "Follow us on social media for schedules, events, announcements and community updates."
    - One card per link, in the existing platform order: a round chip with the platform's logo, then its name; opens in a new tab (the screen-reader "(opens in a new tab)" stays). Cards wrap at 360px.
    - **Logos:** Facebook, Instagram, Messenger, TikTok, YouTube and X as the real brand marks, in one color (the band's text color, which the platforms' brand rules allow). Their paths are copied from Simple Icons (CC0) into one file (e.g. `src/components/BrandIcons.tsx`, with the source and license noted), not added as a dependency. Website keeps the globe.
    - **Colors:** light mode, an Espresso band with cream text; dark mode, a band one step lighter than the page. Follows the venue's preset once T11.7 lands.
    - Below the band, the footer row: the copyright and "Powered by Plotline". No floating Messenger button (the user's call).
- **Acceptance:** component tests still pass, with selectors unchanged where possible. e2e at desktop and 360px; axe clean in light and dark. No horizontal scroll at 360px. `theme.test.ts` passes on the Espresso dark tokens and every new tint pair (heading tints, the filled tab, the band's text and chips in both modes). Component tests for the band (no links, some links, every platform's logo, website) and the `venue-info` e2e updated for its new place.
- **Notes:** `src/index.css`: Espresso dark tokens, `--tint-*` and `--band-*` tokens, `.card-head` bands (sage; rose on "Pay within" and a prominent "Save this link"), the filled `.nav a.active`, hero brand shapes (≥900px), motion (`::details-content` + `interpolate-size`, dialog rise, hover/press; all off under reduced motion), tighter `.info-panel`. Header shows `venue_settings.name` (sr-only "Home" until it loads); the footer is the band: `StayConnected` (replaces `FooterSocials` and the location card's list) then "© year venue · Powered by plotline". Logos in `src/components/BrandIcons.tsx` (`SocialIcon`, Simple Icons 16.35.0, CC0). Emails in the palette with web-safe fallbacks, headed by the venue, "Powered by Plotline" below; `send-emails` and `email-guest-link` redeployed to the linked project (2026-10-27, the user approved). Also fixed a keyboard bug in `PhotoViewer` (an end button disabling itself dropped focus outside the dialog; the cause of the court-photo flake): `press()` focuses the dialog first. e2e axe checks switch scheme through `setColorScheme`, which waits for CSS transitions. Tests: `theme.test.ts` (new tint and band pairs), `VenueInfo.test.tsx`, `Layout.test.tsx`, `PhotoViewer.test.tsx`, `emailTemplates.test.ts`, `venue-info` e2e. verify passes (638); e2e 49 passed, 3 skipped; court-photo 16/16 repeated. Reviewer: PASS on round 2.
- **Sizes (with `.env`):** public `index` JS 100.92 kB (32.24 kB gzip; +5 kB from the logo paths and footer), `index.css` 32.35 kB (7.47 kB gzip).
- **Follow-ups:** the admin header still shows `◆ Claudex Courts` (T11.5), and the admin area already gets the shared filled tab and transitions; `SignupPage` and `AdminLoginPage` hardcode "Claudex Courts"; the viewer has no open animation (full screen, left as is).

### [x] T11.4a Date strip on `/book`
- **Depends:** T11.4
- **Do (the user's request and answers, 2026-10-27):** on `/book` only (the admin pickers keep `DatePicker`), the date button and stepper become:
  - **Heading:** the big word is "Today", "Tomorrow" or the weekday, with the full date under it ("Friday, October 30, 2026"). ‹ and › step one day and are disabled at today and the last bookable day. Keep the accessible names "Previous day" / "Next day": e2e and `smoke:prod` step with "Next day" (T10.3).
  - **"Jump to date"** opens the existing lazy calendar (`Calendar.tsx` stays behind `React.lazy`), with today to the last bookable day and closed days disabled.
  - **The strip:** a month label over it ("OCT – NOV 2026" when the shown days span two months), then at most 10 day tiles (weekday abbreviation and day number), fewer when the booking window is shorter. The selected day is filled (the theme's button colors); today has a small dot (and "today" in its accessible name); days the venue is closed are greyed and can't be picked. Tiles are buttons with `aria-pressed` and full names ("Friday, October 30"), like the sport picker.
  - **Sliding window (option b):** the strip starts at today. When the arrows or "Jump to date" pick a day outside it, it moves the least it needs to show that day (it becomes the last tile going forward, the first going back), never before today or past the last bookable day.
  - **Phones:** the strip scrolls sideways inside itself (scroll snap, the selected tile scrolled into view); the page never does.
  - The URL's date parameter works as today. SPEC §7 (`/book`) updated.
- **Acceptance:** Vitest for the window (start at today, a forward and a backward step past an edge, a far jump, a booking window under 10 days, the end clamp, the month label across two months and two years); component tests (heading words, a closed day, the today dot, the arrows' limits, Jump to date); the booking e2e picks a day from the strip and through Jump to date; no page scroll at 360px; axe clean in light and dark; the public `index` bundle measured with `.env`.
- **Notes:** `src/features/booking/DateStrip.tsx` (heading `<h2>` with `aria-live`, ‹ ›, "Jump to date" through the now-exported `CalendarDialog`, tiles with `aria-pressed` and sr-only full names plus ", today" / ", closed") and the window logic in `stripWindow.ts` (not `dateStrip.ts`: it would clash with `DateStrip.tsx` on macOS's case-insensitive file system). The strip keeps its previous start in state and adjusts it during render (React's "information from previous renders" pattern). `DatePicker` stays for the admin pickers. e2e: `pickDate` also opens "Jump to date" and finds the dialog by its grid; `blackout.spec` checks the today tile; new `e2e/date-strip.spec.ts` (reads the venue's closed days and window). Tests: `stripWindow.test.ts` (10), `DateStrip.test.tsx` (7), `BookPage.test.tsx` rewritten. verify passes (655); e2e 50 passed, 4 skipped (time- and flag-dependent self-skips). Reviewer: PASS (its one minor, the heading element, fixed).
- **Sizes (with `.env`):** public `index` JS 104.57 kB (33.31 kB gzip), `index.css` 34.61 kB (7.85 kB gzip); `Calendar` still lazy (67.61 kB).

### [x] T11.5 Restyle the admin area
- **Depends:** T11.3
- **Do:**
  - The admin shell (Plotline logo in the header), admin login, dashboard and earnings, bookings, day view, courts, schedule, open play and settings, in the new style (with T11.4's shared palette, tints and transitions).
  - **Booked hours (the user's pick 3, "Split bars", 2026-10-27; [preview page](https://claude.ai/artifact/YVwmkpskANhbzAacUa55Jo)):** the table becomes one row per court with a bar of its open hours (minus blackouts) split into booked (accent), open play (`--open-play`) and free (track), under a legend. Sport heading rows carry the sport's totals; an "All courts" row closes the list. Each row also shows its numbers as text: booked hours, occupancy and open-play hours (so nothing relies on the bar or on color); the bar has a text alternative. At phone width the bar wraps under the court name. More space under the "Booked hours" heading. The occupancy note stays.
  - **Settings forms: no lopsided rows.** When a form's fields don't fit on one line, they wrap into even columns (four fields: 4, 2 + 2 or 1, never 3 + 1), at every width. Fixes Booking rules today and applies to every settings form.
- **Acceptance:** as T11.4. Component tests for the booked hours rows (text figures, a court with no open play, one sport and several). The settings forms checked at 360px, tablet and desktop widths for even rows. Screenshots regenerated (`npm run screenshots`).
- **Notes:** Admin header: `PlotlineLogo` plus an "Admin" badge; admin login: logo and "For <venue> staff." (from settings). Admin cards get the tinted heading band through one `.admin .card > h2/h3/.page-head:first-child` rule (cards whose heading is wrapped in a plain `<div>`, like Blackouts, keep a plain head). Booked hours: `HoursTable` rewritten as split bars with `hourBar` in `earnings.ts` (bookable = open − blackouts; the two shares never exceed the bar); classes are `.booked-list`/`.booked-row` because `.hours-rows`/`.hours-row` belong to the operating-hours editor. Even rows: `.form-grid` `:has()` rules per field count (3–8) with a `min()`/`max()` column formula; Social links (7) goes 4 + 3 or 1, so it's one column at tablet width. Tests: `earnings.test.ts` (`hourBar`), `EarningsSection.test.tsx` (rows, one sport, no open play), `AdminLoginPage.test.tsx`, new `e2e/admin-forms.spec.ts` (Booking rules and Social links at 360/820/1280px). `scripts/screenshots.mjs` gains `admin-earnings-*` ("This month"); all screenshots regenerated on a reset local database. verify passes (660); e2e 56 passed, 2 skipped. Reviewer: PASS on round 2 (round 1 blocked on the 7-field Social links grid).
- **Sizes (with `.env`):** see the Handoff bundle note.

### [x] T11.5a Drag to reorder
- **Depends:** T11.5
- **Do (the user's request, 2026-10-27):**
  - One shared sortable list replaces `MoveButtons` (the up and down arrows) everywhere: courts, sport order, info sections, court photos (a grid, so it drags in both directions; the first is still the cover) and, from T11.11, payment accounts.
  - Each item has one ☰ handle (three lines). Dragging it (mouse or touch) moves the item to any position.
  - **WCAG 2.5.7 (single pointer):** tapping or clicking the handle without dragging opens a small menu: Move up, Move down, Move to top, Move to bottom. Keyboard: the handle takes focus; Space or Enter picks the item up, the arrow keys move it, Space or Enter drops it and Escape cancels, with screen-reader announcements; Enter on the menu path works too. Accessible names say which item ("Reorder Badminton 1").
  - The new order saves on drop, with no Save button. On an error the list goes back to the saved order and says so.
  - Research the library first (for example `@dnd-kit`, pinned to an exact version): touch support, the keyboard path, the bundle cost (admin chunk only; measure with `.env`).
  - Courts are reordered by swapping neighbours today (`move.mutate({ id, direction })`). A drop at any position needs a "set the whole order" call like `reorder_court_photos`; if a list doesn't have one, that's a migration with pgTAP and its own plan gate.
  - SPEC §7 (`/admin/courts`, `/admin/settings`, the court page) updated.
- **Acceptance:** component tests for the sortable list (keyboard path, the tap menu, an error that restores the order); e2e: drag reorder on desktop and at 360px for courts and info sections; axe clean.
- **Notes:** Migration `20261028000906_reorder_whole_lists.sql`: `reorder_courts(sport, ids[])` and `reorder_info_sections(ids[])` (security definer, staff only, lock, refuse out-of-date lists, renumber; pgTAP `31_reorder_lists.test.sql`, 22 checks); `db:push` and `db:types` run (the user approved, 2026-10-28). `src/features/admin/SortableList.tsx` replaces `MoveButtons` on courts, sport order, info sections and court photos (a grid): dnd-kit (`@dnd-kit/core` 6.3.1, `sortable` 10.0.0, `utilities` 3.2.2, exact) for the pointer drag only; **our own keyboard path**, because dnd-kit's `KeyboardSensor` didn't move items in Chrome (Space picks up, arrows preview, Space/Enter drops and saves, Escape/blur/another move cancels); the ☰ tap/Enter menu (Move up/down/to top/to bottom). Hooks `useReorderCourts` and `useReorderInfoSections` queue saves and roll back. Tests: `SortableList.test.tsx` (11), the page tests via `src/test/reorder.ts`, `sportOrder.test.ts` (`setCourtOrder`); e2e `ordering.spec.ts` (drag, /book, keyboard back; desktop and phone) and `venue-info.spec.ts` (menu, drag), with `axeBothSchemes` on both lists closed and with a menu open. verify passes (670); e2e 57 passed, 1 skipped. Reviewer: PASS on round 2 (round 1 blocked on missing axe checks; also fixed parallel section saves, the photo keyboard preview, and holds that never ended).
- **Sizes:** dnd-kit is in the lazy `SortableList` admin chunk (46.94 kB, 15.66 kB gzip); public `index` unchanged (100.55 kB).
- **Follow-ups:** Playwright doesn't exercise real touch dragging (the phone project sends mouse events); `move_court` and `move_info_section` are dropped in T11.15.

### [x] T11.5b Bookings search and sort
- **Depends:** T11.5
- **Do (the user's request, 2026-10-27):**
  - **Search on `/admin/bookings`:** one search box. A whole reference code (with or without `CB-`, any case) shows just that booking, selected in the panel. Any other text (at least 2 characters) matches part of a reference, the contact name or the contact email (the `guest_name` and `guest_email` snapshot, which every booking has, accounts included), case-insensitive. Phone isn't searched. A search covers **all bookings**: it ignores the status, source and date filters while active (the page says so, with a Clear button). Kept in the URL (`q=`). The text is escaped for PostgREST filter syntax (commas, parentheses, `*`, `%`), or the search goes through an RPC; an RPC or an index is a migration with its own plan gate.
  - **Sort on `/admin/bookings`:** Play time, latest first (today's default); Play time, earliest first (the default when a date is picked, as today); Booked on, newest first; Booked on, oldest first (`created_at`). Sorted on the server (the 200-row cap stays), tied rows ordered by id. Kept in the URL (`sort=`).
  - **Sort on My bookings:** Play time (today's order: Upcoming soonest first, Past most recent first); Booked on, newest first; Booked on, oldest first. Applied within Upcoming and Past.
  - SPEC §7 (`/admin/bookings`, My bookings) updated.
- **Acceptance:** Vitest for parsing the search text (a whole code with and without `CB-`, a partial, a name, an email, filter-syntax characters) and the URL round trip for `q` and `sort`; component tests for search (found, nothing found, error) and both sort controls; e2e: an admin finds a booking by its reference, then by its email.
- **Notes:** No DB change: `parseSearch` in `bookingFilters.ts` builds a PostgREST `or()` over reference, contact name and email (LIKE-escaped, quoted; checked against local PostgREST: `%`, `_`, commas, parentheses and quotes match literally). A whole code (with or without `CB-`) also matches exactly and opens that booking, but still runs the text search, so six-letter names like "Marcus" work (SPEC §10). Under 2 characters the form asks for more. Sort is server-side (`during` or `created_at`, then id); a search defaults to latest first. My bookings: "Sort by" (`?sort=`), `created_at` added to its query. Tests: `bookingFilters.test.ts`, `BookingFiltersBar.test.tsx`, new `AdminBookingsSearch.test.tsx`, `myBookings.test.ts`, `MyBookingsPage.test.tsx`; e2e `booking-search.spec.ts` (reference without `CB-`, email, sort, clear, axe). verify passes; e2e 59 passed, 1 skipped. Reviewer: PASS (its three minors fixed: the §10 row, the 2-character hint, the search's default sort).
- **Follow-ups:** a trigram index on the searched columns if search gets slow (a migration).

### [x] T11.6 Migration: venue color theme
- **Depends:** T11.1
- **Do:** `venue_settings.theme`, one of the preset keys from T11.1 (a check constraint), default `plotline`. Admins write it through the existing `venue_settings` policies; anyone reads it. Expand only.
- **Acceptance:** pgTAP: the default, the check refuses an unknown key, admins can update it, anon and players can't. `db:push` and `db:types` have been run.
- **Notes:** Migration `20261028121458_venue_theme.sql`: `venue_settings.theme text not null default 'plotline'` with the named check `venue_settings_theme_preset` (the five T11.1 presets); no new grants or policies (the table-wide update grant and the admin UPDATE policy cover it). pgTAP `32_venue_theme.test.sql` (13). `db:push` and `db:types` run on 2026-10-28 (the user approved). Reviewer: PASS, no findings.
- **Follow-ups for T11.7:** the generated type is a plain `string`; define the preset keys once in TypeScript and test them against the DB list.

### [x] T11.7 Theme picker
- **Depends:** T11.6, T11.3
- **Do:**
  - Each preset defined once (light and dark tokens) and applied through `data-theme` on `<html>`, without a flash of the default theme on load (T11.1). The `plotline` preset's dark tokens are T11.4's Espresso; every preset gets the same heading tints, filled active tab and "Stay connected" band, from its own colors.
  - In `/admin/settings`, a "Website colors" section: one card per preset with swatches and a small live preview (a button, a badge and a few slots) in light and dark. Saving applies it at once.
- **Acceptance:**
  - `theme.test.ts` checks every preset's AA pairs, light and dark.
  - Component tests for the picker (loading, error, save).
  - e2e: the admin picks a preset and a signed-out player sees it on `/` (restored in teardown); axe clean with each preset.
- **Notes:** Done on 2026-10-28. No migration. `src/lib/themes.ts` holds the keys, labels, preview swatches and `applyTheme()` (sets `data-theme` on `<html>`, caches `plotline-theme` in `localStorage`). `src/index.css`: one `[data-theme]` block per non-default preset (accent, button, heading tint `--tint-sage`, footer eyebrow `--band-accent`) plus a dark media block. `index.html`: an inline `<head>` script applies the cached preset before first paint. `ThemeSync` (mounted in `main.tsx`) applies `venue_settings.theme` for every visitor. `ThemePicker` ("Website colors" on `/admin/settings`): a light and a dark preview per card, a tap saves and applies at once, and a failed save rolls back. **The user's calls:** (1) five accents nudged from RESEARCH M11 because the rose-band countdown and the confirmed badge failed AA (court-green light and dark, and ocean, plum and sunset dark; values in SPEC §10); (2) a tap saves at once. Tests: `theme.test.ts` (every preset AA in light and dark, swatches against `index.css`, keys against the T11.6 check constraint and the `index.html` list), `ThemePicker.test.tsx` (5), `ThemeSync.test.tsx` (3), e2e `theme.spec.ts` (an admin picks Ocean and a fresh signed-out context sees it on `/`; with settings blocked, the cached preset is already set at `DOMContentLoaded`; axe on `/` for every preset in both schemes, and on the picker). verify passes (705 Vitest, pgTAP); full e2e 62 passed, 2 skipped. Reviewer: PASS; its 3 minors are fixed (an unasked section reorder reverted, the inline list tested, a parse-time e2e check).
- **Sizes (with `.env`):** public `index` JS 102.54 kB (32.62 kB gzip), `index.css` 42.23 kB (9.27 kB gzip).
- **Follow-ups:** a first-ever visit can show Plotline's colors until settings load (accepted in RESEARCH M11); sunset's light heading tint `#f5e7dc` is close to the rose band `#f6e4dd`, so the two bands barely differ in that preset.

### [x] T11.8 Migration: Google Maps link
- **Depends:** T11.1
- **Do:** `venue_settings.maps_url` (https, the hosts T11.1 settles, a length cap of 1000, checked in the database), backfilled from `maps_query` as a Maps search URL. `maps_query` stays until the contract migration (T11.15).
- **Acceptance:** pgTAP: accepted and refused links (http, other hosts, too long), the backfill, RLS as for the other `venue_settings` columns. `db:push` and `db:types` have been run.
- **Notes:** Done on 2026-10-28; the user approved the plan, including `db:push`. Migration `20261028133210_maps_url.sql`: `private.url_encode` (percent-encodes every UTF-8 byte outside the unreserved set), `private.maps_search_url` (a Maps search URL, or `''` when blank or over 1000 characters), and `venue_settings.maps_url text not null default ''` with the check `venue_settings_maps_url_link` (empty, or https on the four hosts followed by `/ ? #` or the end, no whitespace, ≤ 1000). It's backfilled from `maps_query`, or from the address when that's blank. No new grants or policies. **The plan's call:** RESEARCH's cap assumed ASCII; a backfilled link over 1000 characters (100+ accented letters) stays `''` rather than raising the cap (SPEC §10). pgTAP `33_maps_url.test.sql` (44): accepted and refused links (lookalike host, userinfo, `/mapsfoo`, `javascript:`, whitespace, 1001 characters), the encoder, the backfill statement (map search first, the address fallback, an existing link kept, the 948-character worst ASCII case, the multibyte skip), function privileges, and RLS for anon, player and admin. `db:push` and `db:types` were run; on the linked project the venue's link was backfilled from its map search. verify passes. Reviewer: PASS; its major (a vacuous backfill check) and two minors (function privileges, the worst ASCII case) are fixed.
- **Follow-ups:** until T11.9 deploys, admin edits to the old map search don't update `maps_url`. `private.url_encode` is labelled `immutable` but calls `convert_to` (`stable`); that's harmless, but don't index it or use it in a generated column without relabelling it in a new migration.

### [x] T11.9 Location: paste a link, show the address
- **Depends:** T11.8, T11.4
- **Do:**
  - **Admin:** `LocationSection` takes the address and a pasted Google Maps link (with the same host check in the client, and the address pre-filled from a long link's place name when it's empty). No map preview.
  - **Player:** the address with a pin icon, as a link to the Maps URL (new tab), on the home page and the booking page. The embedded map, `mapEmbedUrl` and the `VITE_GOOGLE_MAPS_EMBED_KEY` code are removed (and from `.env.example` and the Handoff).
  - Nothing shows when there's no address.
- **Acceptance:** component tests (with and without an address or link, a refused link); the `venue-info` e2e updated (no map frame; the link has the pasted URL); axe clean.
- **Notes:** Done on 2026-10-28. `venue/map.ts` is now `mapsUrlProblem` (it mirrors `venue_settings_maps_url_link`; the reviewer found the client equal or stricter in every case) and `placeNameFromMapsUrl`. `LocationSection` has the address and a pasted "Google Maps link" field. A refused link shows an alert, marks the field invalid and saves nothing. A long `/maps/place/` link fills an empty address but never overwrites one. The map search field and preview are gone. `VenueLocation` shows the address with a pin, and the address is the link (new tab, sr-only "(opens Google Maps in a new tab)", 44px target). A stored link that fails the check shows as plain text, and nothing shows without an address. The card is on `/` and `/booking/:ref`. Removed: the iframe, `.map-frame`, `mapEmbedUrl`/`mapQueryOf`/`mapsSearchUrl`, `VITE_GOOGLE_MAPS_EMBED_KEY` (`vite-env.d.ts`, `.env.example`, README, Handoff), and the screenshot script's map wait. The frontend no longer reads or writes `maps_query`. Tests: `venue.test.ts` (accepted and refused links, place names), `VenueInfo.test.tsx` (4), `VenueInfoSections.test.tsx` (4), `BookingPage.test.tsx` ("where to play"), e2e `venue-info.spec.ts` (a refused link, no iframe, the pasted URL in a new tab, `axeBothSchemes`). verify passes (713); full e2e 62 passed, 2 skipped. Reviewer: PASS; its two minors are fixed (a leftover type comment, "at most 1000").
- **Follow-ups:** the README location screenshot still shows the old map; regenerate it in T11.31. Axe runs on the card on `/` only (the same component is on `/booking/:ref`). Deploy this to production before T11.15 drops `maps_query`.

### [x] T11.10 Migration: payment accounts and QR codes
- **Depends:** T11.1
- **Do:** the model T11.1 settles (proposal: `venue_payment_accounts` with label such as GCash, InstaPay, Maya or a bank, account name, account number, an optional `qr_path` in `venue-media`, and a position, set as a whole order so T11.5a's drag reorder can save it). Anyone reads; admins write. Length checks in the database. Upload policies for the QR folder (images only, a size cap).
- **Acceptance:** pgTAP: RLS for anon, player and admin; the checks; ordering; storage policies. `db:push` and `db:types` have been run.
- **Notes:** Done on 2026-10-28; the user approved the plan, including `db:push`. Migration `20261028141030_payment_accounts.sql`:
  - `venue_payment_accounts`: label 1–40, account name ≤ 80 and number ≤ 60 (all trimmed), `qr_path` null or a `<uuid>.png`, a position, timestamps.
  - An insert trigger appends each account last and caps the list at 10, serialized by an advisory lock.
  - Anyone reads; admins write through RLS. Column grants keep `position` out of client inserts and updates.
  - `reorder_payment_accounts(uuid[])` (security definer, staff only) saves the whole order, as T11.5a.
  - **The user's call:** QR codes get their own public `payment-qr` bucket (1 MB, PNG only), not a folder in `venue-media`. A local probe showed a storage policy can't see an upload's size or type when it runs, so only a bucket of their own gives a server-side cap. Admins can upload only a top-level `<uuid>.png` (no update policy, no upsert), and can read and delete. `venue-media` is unchanged.
  - Checked through the real local Storage API: 413 over 1 MB, 415 for JPEG, 403 in a folder, public read 200.
  - pgTAP `34_payment_accounts.test.sql` (60): grants, the checks, the cap, append and reorder (stale, duplicate, unknown, null), RLS for anon, player and admin, the bucket, and the storage policies (uploads, listing, the delete rule). `09_payment_proofs_storage` lists the two new write policies by exact name.
  - `db:push` and `db:types` were run; on the linked project the bucket, 3 QR policies and 4 table policies were checked by query. verify passes. Reviewer: PASS; its minor (thin anon delete and storage listing coverage) is fixed.
- **Follow-ups for T11.11:**
  - Upload a fresh `<uuid>.png`, then save `qr_path`, and remove the upload if the save fails.
  - On replace or delete, save the row first, then `remove()` the old object, and check what it returned.
  - Never send `position` (the generated Insert and Update types still list it; it's refused with 42501). Use `reorder_payment_accounts`.
  - Map the `too_many` hint to a readable message.
  - Hide the QR if its image fails to load (there's no foreign key to the object).

### [x] T11.11 Payment QR codes: admin and player
- **Depends:** T11.10, T11.4, T11.5a
- **Do:**
  - **Admin (settings, near the payment instructions):** add, edit, delete and reorder payment accounts (T11.5a's drag handle); upload or replace each QR image (kept scannable, T11.1).
  - **Player (where the manual payment instructions show today):** a card per account with the label, account name and number (a copy button), and the QR code, which opens full size on tap and has a **"Download QR"** button (the user's wording, 2026-10-27). On iPhone a download lands in Files, not Photos, so a short hint under it says to press and hold the image to save it to Photos (GCash and bank apps scan from the gallery). The free-text instructions stay below.
  - The amount to send is the amount due, including the booking fee once T11.13 ships.
- **Acceptance:** component tests for both sides (empty, loading, error, an account without a QR); e2e: an admin adds an account with a QR and a guest sees it while paying (restored in teardown); axe clean; the QR fits a 360px screen.
- **Notes:** Done on 2026-10-28. No migration.
  - **Shared:** `venue/api.ts` holds `fetchPaymentAccounts`, `qrImageUrl` and `qrDownloadUrl` (`getPublicUrl(path, { download })`: `<a download>` is ignored across origins).
  - **Admin:** "Payment accounts" (`PaymentAccountsSection`) sits right after the payment instructions. Accounts are added, edited and deleted in place and reordered with the ☰ handle (`reorder_payment_accounts`, optimistic with rollback). The add form is hidden at 10 accounts. A QR (PNG, JPG or WEBP) is re-encoded by `qrImage.ts` as lossless PNG on white, at most 1200 px on its long side with high-quality smoothing, and refused over 1 MB. The upload, save and cleanup order follows `mediaReplace`, so a row never points at a missing file, and `position` is never sent.
  - **Player:** `PaymentAccountList` goes in the "Pay within" section above the free-text instructions. Each card has the label, the name, the number with Copy (it announces success or failure, then resets), and the QR on a white tile, which opens full size in `PhotoViewer`. "Download QR" and Copy are 44 px targets. A hint explains saving to Photos on iPhone. A QR that fails to load is hidden, and nothing shows with no accounts.
  - **Tests:** `qrImage.test.ts` (8), `PaymentAccountsSection.test.tsx` (10), `PaymentAccountList.test.tsx` (8), `BookingPage.test.tsx` (the list's place). e2e `payment-accounts.spec.ts`: an admin adds an account with a QR (stored as `<uuid>.png`); a guest sees it while paying; the image really loads, the download is served as an attachment, the viewer opens, there's no sideways scroll at 360px, and axe passes on both sides. Global teardown removes `E2E` accounts and their files.
  - verify passes (740); full e2e 63 passed, 3 skipped (time-dependent self-skips). Reviewer: PASS; its three minors are fixed (smoothing on downscale, 44 px player buttons and copy feedback, focus after "Remove QR code" and a reset file input). The e2e's first version read the lazy image before it had loaded (the Stop hook caught it); it now waits for the decoded image.
- **Follow-ups:** the amount to send becomes the amount due with the fee in T11.13. `payment-qr` has no orphan-listing query (files left by a failed best-effort removal). A label of only spaces gets the database's generic check message.

### [x] T11.12 Migration: booking fee
- **Depends:** T11.1
- **Do:**
  - `platform_pricing` (the fee, as data; no client writes) and `bookings.booking_fee` (snapshotted by `create_booking` for online bookings; ₱0 for walk-ins, `moved` continuations and existing bookings).
  - The amount due is the court price + fee in every place T11.1 lists: PayMongo checkout and webhook checks, the late-payment refund, `get_guest_booking`, the email payload.
  - `get_earnings` returns total revenue, owner earnings and Plotline fees for the range and the previous period (fees of bookings cancelled by the venue excluded).
  - **Rollout:** the fee is ₱0 on production until T11.13 is deployed; then a data change sets it to ₱10 (recorded in the Handoff).
- **Acceptance:** pgTAP: the snapshot (online, walk-in, moved), changing `platform_pricing` doesn't touch existing bookings, PayMongo and manual amounts include the fee, the earnings split (including a venue cancellation), RLS on `platform_pricing`. `db:push` and `db:types` have been run.
- **Notes:** Done on 2026-10-29; the user approved the plan, `db:push` and the function redeploy. Migration `20261029132323_booking_fee.sql`:
  - `platform_pricing` (one row, fee 0, anyone reads, no client writes) and `bookings.booking_fee` plus the generated `amount_due`.
  - The snapshot is a `BEFORE INSERT` trigger (`private.set_booking_fee`), not an edit to `create_booking`. Online bookings get the platform fee; every other source gets 0, backed by `bookings_fee_online_only`.
  - `proof_target` returns `amount_due` beside `total_amount`, `record_paymongo_payment` checks against it, and `get_guest_booking` and the email payload carry `booking_fee` and `amount_due`.
  - `get_earnings.split` holds total revenue, Plotline fees (once per booking, at its first approved payment, venue cancellations left out) and owner earnings, for the range and under `previous`.
  - `create-paymongo-checkout` charges `amount_due` and is **redeployed** to the linked project. `smoke:paymongo` asserts the amount due.
  - On the linked project the fee is ₱0 and no booking carries one (checked by query).
  - Tests: pgTAP `35_booking_fee.test.sql` (61, test-writer). `smoke:paymongo` passed locally at a fee of 10 (charged 360 for a 350 court) and at 0. Full gate passed (e2e included). Reviewer: PASS with one minor (below).
- **Follow-ups for T11.13:** `amount_due` is nullable in the generated types (a generated column without `not null`), so add `alter column amount_due set not null` in a migration and regenerate the types. `_shared/emailTemplates.ts` still prints `total_amount` as "Total"; switch it to the split before the fee goes to 10. Redeploy `send-emails` before setting the fee.

### [x] T11.13 Booking fee in the UI, PayMongo and emails
- **Depends:** T11.12, T11.4
- **Do:**
  - Checkout, the booking page and the manual payment amount show court price, booking fee and total, all from the server.
  - The PayMongo checkout lists the fee as its own line item.
  - Booking emails show the split.
  - Admin booking details and the CSV export show the fee apart from the court price (a `booking_fee_php` column).
  - T11.12's follow-ups: `amount_due set not null` (a migration, then `db:types`), and the email "Total" from the split.
  - Then, once the frontend and `send-emails` are deployed (`create-paymongo-checkout` already charges `amount_due` since T11.12), set the fee to ₱10 on the linked project (T11.12 rollout).
- **Acceptance:** Vitest and component tests for the totals; the booking e2e (manual proof and PayMongo stub) checks the amounts; `smoke:paymongo` passes; the email shows the fee in Mailpit.
- **Notes:** Done on 2026-10-29; the user approved the plan, `db:push` and both redeploys. The ₱10 step waits for the user's merge (their call, below).
  - Migration `20261029135333_amount_due_not_null.sql` (pushed; `db:types` regenerated, `amount_due` is now `number`).
  - Checkout reads `platform_pricing` (`fetchPlatformFee`/`usePlatformFee`) and shows Court price, Booking fee and Total. The booking page, My bookings, the admin row and review panel, the proof amount and the emails use the stored `amount_due`; the fee row shows only above 0. The admin mismatch warning compares with `amount_due`. The bookings CSV adds `booking_fee_php` after `amount_php`. PayMongo gets a separate `Booking fee` line item.
  - `send-emails` and `create-paymongo-checkout` are **redeployed** to the linked project; the fee there is still ₱0.
  - Tests (test-writer): pgTAP `36_amount_due_not_null` (12); Vitest `CheckoutPage.test.tsx`, `booking/bookingFee.test.tsx`, `booking/api.test.ts`, `admin/bookingFee.test.tsx`, plus new cases in `paymongo.test.ts` and `emailTemplates.test.ts`; e2e `guest-and-review` (amounts and the Mailpit email at a local fee of 10) and `pay-online` (webhook pays `amount_due`). Existing fixtures gained the two fields, and the CSV expectations in `csv.test.ts` and `earnings.spec.ts` gained the new column. `smoke:paymongo` passed locally at 10 and at 0. Full gate passed (e2e 61 passed, 3 skipped). Reviewer: PASS; its one minor (a misplaced comment) is fixed.
  - **Rollout left (the user's merge first):** once `develop` is merged into `master` and Vercel has deployed it, run `npm run smoke:paymongo` against the linked project, then `update platform_pricing set booking_fee = 10;` on the linked project and record it here.

### [x] T11.14 Dashboard: revenue, owner earnings and Plotline fees
- **Depends:** T11.12, T11.5
- **Do:** the earnings section gains three totals for the selected period, each with the change from the period before: **Total revenue**, **Your earnings** (the court owner's) and **Plotline fees** (the platform's commission), in the place T10.7 left for the fees line. A short note explains the fee (₱10 per confirmed online booking, paid by the player).
- **Acceptance:** Vitest for the math; component tests for each state; e2e: a confirmed online booking raises all three totals by the right amounts; axe clean; fits 360px.
- **Notes:** Done on 2026-10-29. `parseEarnings` reads `get_earnings.split` (`RevenueSplit`), `changeText` words every "more/less than" line (the Collected card uses it too), and `RevenueSplitList` in the Collected card shows Total revenue, Your earnings and Plotline fees against the period before, with a fee note that reads the live fee (`usePlatformFee`), so it says ₱0 until the fee goes up. No migration.
  - Tests (test-writer): `earnings.test.ts`, `EarningsSection.test.tsx` (revenue split cases), e2e `earnings.spec.ts` "a confirmed online booking paid today raises …" (+787 / +777 / +10 at a local fee of 10, axe, 360px). Full gate passed.
  - Test dispute (settled): I changed the zero-state test's "The same as yesterday." count myself; the reviewer blocked round 1 on it, and the test-writer replaced it with a stricter check (once outside the split, once per split row). Reviewer round 2: PASS, no findings.

### [ ] T11.15 Contract migration
- **Depends:** T11.9 deployed to production
- **Do:** drop `venue_settings.maps_query`, `move_court` and `move_info_section` (replaced by `reorder_courts` and `reorder_info_sections` in T11.5a; the frontend no longer calls them), and anything else T11.1–T11.14 left for contraction. Only after the frontend that no longer reads them is live.
- **Acceptance:** pgTAP updated; `db:push` and `db:types` have been run; the production site still works (`npm run smoke:prod -- --links-only`).

### [x] T11.16 Research: phones, waiver and admin alerts
- **Depends:** T11.10
- **Do:** research, then add the findings to RESEARCH M11 and the accepted decisions to SPEC §10:
  - **Phone:** the PH mobile formats to accept and the exact normalizing rule (SPEC §10, 2026-10-28), shared by SQL and TypeScript. Where phones are written today: `create_booking`, `create_walk_in`, `reschedule_booking`, and the profile trigger. How many existing `bookings.guest_phone` and `profiles.phone` values normalize on the linked project (a read-only count).
  - **Waiver:** how to add `create_booking`'s acceptance argument without breaking the deployed checkout (the old signature, PostgREST overloads); the text cap; how it reaches the booking page and the email payload.
  - **Alerts:** Supabase Realtime from current docs: Broadcast from the database (`realtime.broadcast_changes` or `realtime.send` from a trigger), private channels and the RLS on `realtime.messages` that limits a topic to admins, versus Postgres Changes. The payload (ids and statuses only, no contact details), how supabase-js authorizes a private channel, reconnect behavior, and what changes for M12's per-venue topics. Title and visibility handling (`visibilitychange`), and the a11y of a nav count badge.
- **Acceptance:** RESEARCH M11 has a section with sources for each part; open questions are listed for the user.
- **Notes:** Done on 2026-10-29. RESEARCH M11 "Phone numbers", "Venue waiver", "Admin alerts with Realtime" and "Open questions"; SPEC §10 2026-10-29 row. The user's answers: a blank waiver in the migration, then the default text as a data change after the T11.20 merge; Realtime "Allow public access" turned off by the user in the dashboard (T11.21); a 2000-character cap. Linked project: 12 booking phones, all normalizable. Reviewer: PASS, no findings.

### [x] T11.17 Migration: phone numbers
- **Depends:** T11.16
- **Do:**
  - `private.normalize_ph_mobile(text)`: the rule from T11.16; `null` for blank; an error hint (`invalid_phone`) for anything else.
  - Every RPC that writes a phone uses it. `create_booking` no longer requires a guest's phone (the deployed checkout still sends one, so this is backward compatible).
  - Backfill `bookings.guest_phone` and `profiles.phone` where a value normalizes; leave the rest. Add checks (`^09[0-9]{9}$` or null) as `NOT VALID`, so only new rows are checked.
- **Acceptance:** pgTAP: each accepted format (spaces, dots, dashes, `+63`, `63`, 10 digits), refused ones (landline, too short or long, letters), a guest booking without a phone, the walk-in path, the backfill, the constraints. `db:push` and `db:types` have been run.
- **Notes:** Done on 2026-10-29 (pre-approved, no plan gate). Migration `20261029145041_phone_numbers.sql`: `private.normalize_ph_mobile`, `security definer` `BEFORE` triggers on `bookings.guest_phone` and `profiles.phone` (a player's own profile update can't call the private helper otherwise), a backfill through the trigger, and `bookings_guest_phone_format`/`profiles_phone_format` added `NOT VALID` and validated when clean. `create_booking` (same signature) no longer needs a guest phone. **Pushed** to the linked project: 12 booking phones, all normalized, the bookings check validated (read-only query). `db:types`: no change.
  - Tests: pgTAP `37_phone_numbers` (50, test-writer); expectations in `06_create_booking`, `13_create_walk_in` and `30_reschedule` updated to normalized phones and `invalid_phone`. pgTAP 38 files, 1066 tests; full gate passed.
  - Test dispute (settled): `37` planned 52 for 50 assertions; the test-writer set `plan(50)`. Reviewer: PASS; its minor (a stale test description in `06`) is fixed.

### [x] T11.18 Phone numbers in the UI
- **Depends:** T11.17
- **Do:**
  - A `normalizePhMobile` in `src/lib/` that mirrors the SQL (Vitest over the same cases).
  - Checkout and the walk-in form: "Mobile number (optional)" for everyone, normalized on submit; the error "Enter an 11-digit mobile number, like 09171234567." A short hint says the venue uses it only to reach you about your booking.
  - Admin booking panel and dashboard: the number as a `tel:` link.
- **Acceptance:** Vitest for the helper; component tests (blank, each format, refused); the guest booking e2e books without a phone, and with `+63 917 123 4567` and the admin sees `09171234567`; axe clean.
- **Notes:** Done on 2026-10-29. `src/lib/phone.ts` (`normalizePhMobile`, `PHONE_ERROR`); `contact.ts` makes the phone optional; checkout and the walk-in form say "Mobile number (optional)" with the hint and submit the `09…` form; the admin booking panel (`ReviewPanel`, the only admin view that shows phones) has a `tel:` link. The e2e locators for the old "Phone" label are renamed; `smoke:prod` matches either label until the merge.
  - Tests (test-writer): `phone.test.ts`, `contact.test.ts`, `CheckoutForm.test.tsx`, `WalkInForm.test.tsx`, `ReviewPanel.test.tsx`, e2e `guest-and-review` (a booking with `+63 917 123 4567` stored and shown as `09171234567` with `tel:`, and one without a number). Vitest 814; full gate passed. Reviewer: PASS; its minor (this tick) done.

### [x] T11.19 Migration: venue waiver
- **Depends:** T11.16
- **Do:**
  - `venue_settings.waiver_text` (default: the text in SPEC §10, 2026-10-28; a length cap from T11.16). `bookings.waiver_accepted_at` and `bookings.waiver_text` (the copy that was accepted).
  - `create_booking` takes the acceptance (signature from T11.16). When the venue's text isn't blank it refuses without acceptance (`waiver_required` hint) and stores the time and the copy. Walk-ins and `moved` continuations store nothing (a continuation keeps its root's acceptance).
  - `get_guest_booking` and the email payload include the accepted text.
  - **Rollout:** the existing venue row gets `''` (no waiver) on production until T11.20 is deployed; then a data change sets the default text (recorded in the Handoff).
- **Acceptance:** pgTAP: refused without acceptance, accepted (time and copy stored), a blank waiver needs nothing, walk-ins and reschedules, editing the venue text doesn't change existing bookings, RLS for the new columns. `db:push` and `db:types` have been run.
- **Notes:** Done on 2026-10-29 (pre-approved). Migration `20261029150958_venue_waiver.sql`: `venue_settings.waiver_text` (≤ 2000, the SPEC default for new venues, the live venue set to `''`), `bookings.waiver_accepted_at`/`waiver_text` (`bookings_waiver_pair`), `create_booking` dropped and recreated with `p_waiver_accepted boolean default false` (`waiver_required`), `get_guest_booking` and `booking_email_data` carry the copy. **Pushed** (`db:types` regenerated); on the linked project the waiver is blank and one `create_booking` exists (read-only query).
  - Tests: pgTAP `38_venue_waiver` (41, test-writer); `06_create_booking`'s two privilege checks name the new signature. pgTAP 39 files, 1107 tests; full gate passed. Reviewer: PASS, no findings.

### [x] T11.20 Waiver in the UI
- **Depends:** T11.19, T11.4
- **Do:**
  - **Admin settings:** a "Waiver" text box with the default text, "Reset to default", and a note that it's the venue's own text and worth having checked. Blank turns the waiver off.
  - **Checkout:** the text and a required "I have read and accept the waiver" checkbox; Confirm can't submit until it's ticked (with an error message that says why). Nothing shows when the waiver is blank.
  - The booking page and the confirmation email show the accepted text.
  - Then set the default text on the linked project (T11.19 rollout).
- **Acceptance:** component tests (blank waiver, unticked, ticked, admin edit and reset); the guest booking e2e ticks the box; Mailpit shows the text; axe clean; fits 360px.
- **Notes:** Done on 2026-10-29; the user approved the plan and the `send-emails` redeploy (done). `WaiverSection` in settings (`DEFAULT_WAIVER_TEXT`, `WAIVER_MAX` in `src/features/venue/waiver.ts`), the checkout checkbox (`CheckoutForm` `waiverText`, `onSubmit(contact, waiverAccepted)`, `createBooking` sends `p_waiver_accepted`), "Waiver you accepted" on the booking page, and the text in the `booking_created` email. `waiver_required` and `invalid_phone` map to readable messages (the second was a T11.18 gap).
  - Tests (test-writer): `waiver.test.ts`, `WaiverSection.test.tsx`, `CheckoutForm.waiver`, `CheckoutPage.waiver`, `api.waiver`, `errors.waiver`, `BookingSummary.waiver`, `emailTemplates.waiver`, e2e `waiver.spec.ts` (tick, booking page, Mailpit, axe, 360px). Older fixtures gained the null waiver fields; `CheckoutForm.test` expects `onSubmit(…, false)`. Vitest 842; full gate passed.
  - Test dispute (settled): `BookingSummary.waiver.test.tsx` passed `paymentInstructions={null}` to a `string` prop; the test-writer changed it to `""`. Reviewer: PASS, no findings.
  - **Rollout left (the user's merge first):** set the default waiver text on the linked project (Handoff blockers).

### [x] T11.21 New-booking alert in the admin tab
- **Depends:** T11.16, T11.5
- **Do:**
  - **Migration:** the Realtime setup T11.16 settles (proposal: a trigger on `bookings` broadcasting the id, old and new status and source to a private per-venue topic, and an admin-only RLS policy on `realtime.messages`).
  - **Admin (lazy chunk only):** `AdminLayout` subscribes once. Every event invalidates the admin booking and dashboard queries. Only a change into `payment_submitted`, or into `confirmed` from `pending_payment`, adds to the count. The title reads "(2) New bookings · <venue>" while the tab is hidden and resets when it's visible again; the Bookings nav link shows the count (with an accessible label) until that page is opened. Refetch on reconnect.
- **Acceptance:** pgTAP: the trigger's messages (which changes send what, no contact data) and that only admins can receive the topic. Vitest for the counting rule and the title. e2e: with the admin page open, a guest uploads a proof in another context; the bookings list updates without a reload and the nav count shows 1. axe clean.
- **Notes:** Done on 2026-10-29 (pre-approved). Migration `20261029153423_booking_alerts.sql` (**pushed**): `bookings_broadcast_change` → `realtime.send` to the private topic `admin:bookings` (`booking_id`, `status`, `old_status`, `source`), and the admin-only SELECT policy on `realtime.messages`. Client: `bookingAlerts.ts` (`countsAsNew`, `alertTitle`), `subscribeToBookingChanges` in `admin/api.ts`, `useBookingAlerts` in the admin nav (rendered only for a signed-in admin, keyed by user: a channel joined before login carries the anon token and is refused), "Bookings, N new" by `aria-label`, the hidden-tab title.
  - Tests (test-writer): pgTAP `39_booking_alerts` (29), `bookingAlerts.test.ts`, `useBookingAlerts.test.tsx`, `AdminLayoutAlerts.test.tsx`, e2e `booking-alerts.spec.ts` (desktop and 360px). Vitest 860; full gate passed.
  - Test disputes (settled): the `proconfig` literal and the `id` that `realtime.send` adds to the stored payload; the test-writer fixed both. Reviewer: PASS, no findings.
  - **User step:** turn off Realtime "Allow public access" in the Supabase dashboard (Handoff).

### [x] T11.22 Migration: online payments switch
- **Depends:** T11.10
- **Do (the user's calls, 2026-10-28; SPEC §10):**
  - `venue_settings.online_payments_enabled boolean not null default false`. Manual proof upload is always on; this only adds "Pay online with PayMongo".
  - **Plotline only:** a `private` trigger refuses any change to the column unless it comes from the service role or `postgres` (venue admins keep updating every other setting through the existing policy). Plotline sets it with `npx supabase db query --linked` for now; SaaS gets a Plotline control.
  - **Backfill:** `true` for the existing venue (Claudex Courts), so the live site and the PayMongo e2e and smoke tests keep working. New venues start off.
  - `proof_target` (or the checkout's own read) exposes the flag to `create-paymongo-checkout`, which refuses with a readable error (`online_payments_off`) when it's off. The webhook is unchanged: a checkout started before a switch-off still confirms its booking. Redeploy the function after `db:push` (expand first: the deployed frontend only hides the button once T11.23 ships).
- **Acceptance:** pgTAP: the default, the backfill, an admin's update of the column refused (and of another column still allowed), anon and players unable to change it, the service role able to; the checkout refuses with the flag off (smoke test against the local stack, `npm run smoke:paymongo`). `db:push` and `db:types` have been run.
- **Notes:** Done on 2026-10-29 (pre-approved). Migration `20261029160000_online_payments_switch.sql` (**pushed**; the flag is true on the linked project, checked by query): the column, the backfill and the security-invoker guard trigger (`forbidden` unless `postgres`/`service_role`). `create-paymongo-checkout` refuses with 409 `online_payments_off` before any session (**redeployed**); the webhook is unchanged. `online_payments_off` added to the client error codes.
  - Tests: pgTAP `40_online_payments_switch` (24, test-writer); `smoke:paymongo` gains the off/on checks (the builder's, since the guard keeps the test-writer out of `scripts/`). Full gate passed. Reviewer: PASS, no findings.

### [x] T11.23 Online payments switch in the UI
- **Depends:** T11.22
- **Do:**
  - `/booking/:ref`: "Pay online with PayMongo" (and the "Pay online / Or pay manually" headings) only when the venue has it on; otherwise the manual instructions, payment accounts and proof upload as today.
  - The home page lead ("pay with GCash, Maya or a bank transfer") follows the setting (mentions card and online payment only when it's on).
  - `/admin/settings`: a read-only line, "Online payments (PayMongo): On / Off. Managed by Plotline."
  - T11.13 (the fee as a PayMongo line item) applies only when it's on; the manual amount due includes the fee either way.
- **Acceptance:** component tests (on and off for the booking page, the lead and the settings line); the PayMongo e2e still passes (flag on); a new e2e turns it off with the service role, checks a guest sees no "Pay online" and can still upload a proof, and restores it in teardown. axe clean.
- **Notes:** Done on 2026-10-30. `BookingPage` passes `payOnline` only when `online_payments_enabled`; the home lead follows the flag; `OnlinePaymentsStatus` (read-only, "Managed by Plotline") on `/admin/settings`. No fee change needed (no checkout when off; the manual amount due has the fee).
  - Tests (test-writer): `BookingPage.test.tsx` on/off cases (its fixture gained the flag), `HomePage.test.tsx`, `OnlinePaymentsStatus.test.tsx`, e2e `online-payments-off.spec.ts`; `pay-online.spec.ts` unchanged. Vitest 867; full gate passed.
  - Test dispute (settled): the HomePage fixture's `maps_url: null` (a `not null` column); the test-writer set `''`. Reviewer: PASS; its minor (this tick) done.

### [x] T11.24 Home page hero: address and quick facts
- **Depends:** T11.9
- **Do (the user's calls, 2026-10-28; the reference image from that day):**
  - Under the venue name in the hero: the address with the pin, linked to the venue's Maps URL in a new tab (the T11.9 link: plain text when there's no valid link, nothing without an address), then a line of quick facts with icons: the number of active courts and the slot length (e.g. "3 courts · 60-min slots"). The opening hours summary stays.
  - The address wraps in full on phones (never truncated).
  - The "Location" card is removed from the home page; it stays on `/booking/:ref`.
  - Facts come from data already loaded (`useCourts`, `venue_settings.slot_minutes`); each is hidden while loading or on error, and the courts fact when there are none.
- **Acceptance:** component tests (address with and without a link, no address, the facts, one court vs several); the `venue-info` e2e updated (address and link in the hero, no Location card on `/`); no sideways scroll at 360px; axe clean in light and dark; screenshots regenerated in the close-out.
- **Notes:** Done on 2026-10-30. `VenueAddress` (pulled out of `VenueLocation`, which `/booking/:ref` keeps) and `QuickFacts` in the hero under the venue name; the home Location card is gone. Also removed T11.20's duplicate `.prewrap` (identical to `.pre-line`).
  - Tests (test-writer): `VenueHero.test.tsx`, `HomePage.hero.test.tsx`, e2e `venue-info.spec.ts` updated (hero link, no Location region on `/`, 360px, axe light and dark). Full gate passed. Reviewer: PASS; its minor (this tick) done. Screenshots: in T11.31.

### [x] T11.25 Payment QR: full width, iPhone hint on tap
- **Depends:** T11.11
- **Do (the user's calls, 2026-10-29; SPEC §10):**
  - `PaymentAccountList`: the QR tile fills the card's width (`.qr-open` and its image at 100%, still square with `object-fit: contain` on white); it still opens full size on tap.
  - The iPhone paragraph moves behind an **ⓘ toggletip** next to "Download QR": a 44 px button labelled "How to save to Photos on iPhone" with `aria-expanded`, opening a short bubble below it on tap or click (no hover: phones have none). Escape, the button again or a tap outside closes it, and focus stays on the button. The text is unchanged.
- **Acceptance:** component tests (the hint hidden at first, opens and closes by click and Escape, `aria-expanded`); `payment-accounts.spec.ts` updated (the QR's width fills the card, the hint opens on tap); no sideways scroll at 360px; axe clean in light and dark.
- Test dispute: e2e/payment-accounts.spec.ts "an admin adds a payment account with a QR code, and a guest sees it while paying": asserts the QR `<img>` width equals the card's content width vs the Do line ("`.qr-open` and its image at 100%", the tile keeping its white padding): the image fills the tile's content box, 22 px (padding + border) narrower than the card's. Also the padding `evaluate` string returns NaN (not invoked with the element). Settled: the test-writer fixed both (image measured against the tile's content box, typed `evaluate`), and the reviewer upheld it.
- **Notes:** Done on 2026-10-30. `IphoneHint` toggletip in `PaymentAccountList.tsx` (opens below the Download row; closes on the button, Escape or an outside pointerdown); `.qr-open` and its image at 100%.
  - Tests (test-writer): `PaymentAccountList.test.tsx` (iPhone hint block), e2e `payment-accounts.spec.ts` (tile fills the card, image fills the tile, hint on tap, Escape keeps focus, 360px, axe light and dark). Full gate passed. Reviewer: PASS; its minors (bubble below the row, no pre-filled live region, this tick) are done. Screenshots: in T11.31.

### [~] T11.26 Email through Resend
- **Depends:** T8.3
- **Do (the user's calls, 2026-10-29; replaces the 2026-10-19 "Emails without a provider" decision):**
  - **The user, by hand** (the plan lists the exact values): add `mail.plotline.fit` to Resend and its DNS records (SPF, DKIM, the MX for bounces) to the Cloudflare zone; create a sending-only API key; set Supabase Auth's custom SMTP (`smtp.resend.com`, port 465, user `resend`, the key as password, sender `no-reply@mail.plotline.fit`).
  - Hosted function secrets: `EMAIL_TRANSPORT=resend`, `RESEND_API_KEY`, `EMAIL_FROM` with the From name taken from `venue_settings.venue_name` (`<venue name> <bookings@mail.plotline.fit>`; the From is built per email in `_shared/email.ts`, so it carries over to many venues). No key in the repo; `.env.example` documents the names.
  - Check Resend's current free-plan limits on signup and note them in the Handoff.
  - Remove the "confirmation emails aren't sent yet" note from `/signup`, and update PLATFORM.md §2 (`mail` is in use) and SPEC §8.
  - Emails already queued while it was `disabled` are `skipped` and stay that way (no backfill).
- **Acceptance:** unit tests for the From built from the venue name (`email.test.ts`); after the switch, one real email of each kind (booking created with the guest link, payment confirmed, proof rejected, cancelled, rescheduled) and an Auth sign-up confirmation reach a real inbox from production, recorded in the Notes; `smoke:prod` passes. Auth and secret changes stop at the plan gate.
- **Notes (2026-10-30, code side done):** `fromFor` in `_shared/email.ts` (tests in `email.test.ts` 'fromFor'), used by `send-emails` and `email-guest-link`; `/signup` note removed (`SignupPage.test.tsx`); `.env.example`, SPEC §8/§10, PLATFORM.md §2 updated. Full verify passed, reviewer PASS. **Still open (the user's switch-on, in order):** 1. Resend: add `mail.plotline.fit`, put its SPF, DKIM and bounce MX records in the Cloudflare zone, wait for Verified; check the free-plan limits (RESEARCH M8 says 3,000/month, 100/day, 3 domains) and note them in the Handoff. 2. Create a sending-only API key. 3. Supabase Auth → SMTP: `smtp.resend.com`, port 465, user `resend`, the key as password, sender `no-reply@mail.plotline.fit`. 4. `npx supabase secrets set EMAIL_TRANSPORT=resend RESEND_API_KEY=… EMAIL_FROM=bookings@mail.plotline.fit`. 5. Redeploy `send-emails` and `email-guest-link`. 6. Real-inbox proof of each email kind plus an Auth sign-up confirmation, then `smoke:prod`. Then tick the task.

### [ ] T11.27 Migration: "Paid with" a payment account
- **Depends:** T11.10
- **Do (the user's calls, 2026-10-29):**
  - `payments.payment_account_id uuid references venue_payment_accounts on delete set null` and `payments.paid_with text` (a copy of the account's label at submit time, ≤ 40), plus a new `payment_method` value `account` (its own migration, before the rest, as in T10.9).
  - The proof RPC behind `submit-payment-proof` takes an account id: it must be one of the venue's accounts, and then the method is `account` and the label is copied. With no account id it keeps today's `method` (expand: the deployed frontend still sends `method`). A venue with no accounts uses today's list.
  - `get_earnings` and the admin reads group account payments by `paid_with`; `get_guest_booking` returns it.
  - Redeploy `submit-payment-proof` after `db:push`. Removing the old `method` path waits for a contract step once T11.28 is live.
- **Acceptance:** pgTAP: the account id must belong to the venue, the label snapshot survives a rename and a delete (`payment_account_id` becomes null), the old `method` path still works, earnings group by label, RLS unchanged for anon, player and admin. `db:push` and `db:types` have been run.

### [ ] T11.28 "Paid with" in the UI
- **Depends:** T11.27
- **Do:**
  - `ProofForm`: "Paid with" lists the venue's payment accounts (`usePaymentAccounts`, admin order) and sends the account id; with no accounts, today's GCash / Maya / Bank transfer list. Loading and error states as `PaymentAccountList`.
  - Admin `ReviewPanel`, the Earnings "Collected by method" list and the CSV show `paid_with` for account payments (`METHOD_LABELS` for the rest).
- **Acceptance:** component tests (accounts listed in order, the fallback with none, the id sent, the label in review and earnings); the proof e2e picks an `E2E` account and the admin sees its label; axe clean; 360px.

### [ ] T11.29 Migration: fresh guest links for the re-upload email
- **Depends:** T5.5, T8.2
- **Do (the user's calls, 2026-10-29; reverses part of SPEC §5):**
  - `guest_link_tokens` (booking_id, token_hash sha256, created_at), RLS on with no client policies. The original `bookings.guest_token_hash` stays valid.
  - `issue_guest_link(booking_id)`, service role only, security definer: for a guest booking still in its 30-day window, it makes a 256-bit random token, stores its hash and returns the token once.
  - One `private` helper checks a token against the booking's hash **or** any `guest_link_tokens` hash. `get_guest_booking`, guest `cancel_booking`, the proof RPCs behind `submit-payment-proof` and the PayMongo checkout's lookup all use it. Expiry is unchanged.
  - Deleting a booking deletes its tokens.
- **Acceptance:** pgTAP: only the service role can call `issue_guest_link`; an issued token opens, cancels and uploads like the original; both stay valid; a wrong token and an expired booking get the same not-found response; no raw token is stored; no client can read `guest_link_tokens`. `db:push` and `db:types` have been run.

### [ ] T11.30 Re-upload link in the email and the booking page
- **Depends:** T11.29 (reaches production guests once T11.26 is live)
- **Do:**
  - `send-emails`: for a **guest's non-final `proof_rejected`** only (not the final rejection, not other kinds), call `issue_guest_link` right before sending and pass the token to `renderEmail`, in memory only (never in the outbox row, logs or errors). A retry issues a new token, which is fine. The template's link reads "Upload a new proof" and points to `/booking/:ref#token=…`.
  - `/booking/:ref`: opened on a booking waiting for a new proof, the page scrolls the proof form into view and puts focus on its heading.
  - SPEC §5 and §8: the guest-link rule names this exception.
- **Acceptance:** `emailTemplates` tests (the link only in that email, only for guests; signed-in players keep their plain link); the reject → re-upload e2e follows the link from the Mailpit email, uploads a new proof without the original link, and the admin approves it; axe clean; 360px.

### [ ] T11.31 Close out M11
- **Depends:** T11.2–T11.30
- **Do:**
  - Update the README (the new look, features and screenshots) and `docs/demo-script.md`.
  - Update `docs/SAAS-PLAN.md` with what M11 built (the fee, the walk-in flag, themes).
  - Mark M11 ✅ in SPEC §9 and run the milestone review.
  - Move the Handoff on to M12 (the multi-venue database, `docs/SAAS-PLAN.md` Phase 1), which needs its own breakdown and approval.
- **Acceptance:** `npm run verify` and `npm run test:e2e` pass, and the reviewer signs off.

---

## Harness backlog
- [x] H1 Vitest + `npm run verify` (typecheck, lint, test, build)
- [x] H1b pgTAP via `supabase test db` in verify (`npm run test:db`, tests in `supabase/tests/database/`)
- [x] H2 Stop hook that blocks "done" until verify passes (`.claude/hooks/verify-gate.mjs`)
- [x] H3 `reviewer` agent (`.claude/agents/reviewer.md`)
- [x] H4 `/implement` command (`.claude/skills/implement/SKILL.md`)
- [x] H5 Playwright e2e: `npm run test:e2e` (Chromium desktop + 360px phone, local stack, serial). Flows: guest booking and proof upload, admin reject → re-upload → approve, signed-in player, walk-in. Tagged test data is removed in global teardown. The Stop hook runs it when UI-facing files change (blocking if the local stack is down).
- [x] H6 >500 kB main chunk warning: fixed in T8.7 with vendor chunks (`vendor-react` 348 kB, `vendor-supabase` 214 kB, app 62 kB). The earlier "347 kB" was measured without `.env`, which drops supabase-js (SPEC §10, 2026-10-20). Watch it as the app grows, and always measure with `.env` present.
- [x] H7 Phone layouts (360px) checked by hand in a real browser by the user (2026-10-17). The e2e phone project now runs every flow at 360px.
