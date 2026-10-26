# Court Booking System — Product Spec

> Status: v1.0 (2026-10-23, M1–M9 done; M9's frontend reaches production when `develop` is merged into `master`). Portfolio project: one realistic venue, simplified operations.

## 1. Overview

A web app for booking courts at **Claudex Courts**, a single multi-sport venue in the Philippines. Players (with or without an account) pick a court and time slots. They then pay outside the app (GCash, Maya or bank transfer) and upload a proof of payment. Staff review the proof and confirm the booking, or ask for the proof to be uploaded again. Players can instead **pay online through PayMongo** (test mode, hosted checkout), which confirms the booking automatically. Staff work in a separate admin area with its own layout and login.

### Goals

- Show real-time court availability and make double-booking impossible.
- Run the whole flow: browse → reserve → pay online (auto-confirm) or upload proof → admin confirms.
- Show good Supabase practice: Row Level Security (RLS) everywhere, database-enforced invariants, typed client.

### Non-goals (v1)

- Multiple venues or owners, live (real-money) payments, refunds (including PayMongo refunds), recurring bookings, memberships, native mobile apps, SMS notifications, a public demo login (the README uses screenshots and a video instead).

## 2. Roles

| Role       | Auth                                            | Can do                                                                                                                                                                             |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guest**  | none                                            | View availability; create a booking with name, email and phone; view and manage _that_ booking through a private link; upload payment proof; cancel.                               |
| **Player** | Supabase Auth: Google OAuth or email + password | Everything a guest can do, plus see a "My bookings" history and have profile details prefilled. Their earlier guest bookings are attached to the account automatically (see §5.7). |
| **Admin**  | Supabase Auth, `profiles.role = 'admin'`        | Manage courts, rates, hours, blackouts and open play sessions (M9); see all bookings; review payment proofs; confirm or reject proofs; cancel any active booking until it ends (§4); create walk-in bookings (§5.8).                  |

Admins are promoted manually in the database (no self-signup as admin).

## 3. Core concepts

- **Venue settings**: one row holding:
  - name (`Claudex Courts`), timezone (`Asia/Manila`) and currency (`PHP`)
  - slot length (60 min)
  - booking rules: booking window, payment hold, cancellation cutoff and maximum rejections
  - payment instructions: the GCash, Maya and bank account details shown to players
  - site banner: an optional image with alt text (no headline or link), shown on the home page just below the header. No banner means no banner section at all.
- **Court**: name, sport (`badminton` | `pickleball` | `basketball` | `tennis`), description, **default hourly rate**, active flag, and an optional **photo** that shows players what the court looks like.
- **Rate table**: optional per-court price overrides for each day-of-week × hour slot. A slot with no override uses the court's default hourly rate.
- **Operating hours**: open and close time per day of week, for the whole venue.
- **Blackout**: a time range when a court (or every court, if `court_id` is null) can't be booked, e.g. maintenance or a tournament.
- **Slot**: a fixed 60-minute block inside operating hours, the same for every court. A booking covers 1 or more _consecutive_ slots on one court, on one day.
- **Booking**: a reservation for one court and time range, with a status, a human-readable reference code (e.g. `CB-7KQ2XD`) and a **source**: `online` (made by a player or guest) or `walk_in` (entered by an admin at the counter).
- **Payment**: a record of money paid toward a booking. It holds the method (`gcash` | `maya` | `bank_transfer` | `cash` | `paymongo`), the amount, an optional transaction reference number and an optional proof file.
  - Online bookings, PayMongo (M7, test mode): the player pays on PayMongo's hosted checkout. A verified PayMongo webhook records the payment (`method = 'paymongo'`, with the PayMongo ids; see §6) and confirms the booking; no admin review. A payment it can't accept is recorded for a refund outside the app (§4).
  - Online bookings, manual proof: the player uploads the proof, and an admin reviews it. A booking can have several payment rows, one per attempt.
  - Walk-ins: the payment is recorded directly by an admin and is approved immediately.
  - Every `confirmed` booking has exactly one approved payment, so revenue reports and cash counts come from one table.

### Demo seed data

- Badminton: 4 courts
- Pickleball: 2 courts
- Basketball: 1 full court
- Tennis: 1 court
- Opening hours: 06:00–22:00 every day
- Pricing: peak overrides on weekday evenings and on weekends, to show the rate table in use
- Bookings: a few demo bookings (confirmed and payment submitted) for tomorrow and the day after, so the grid shows busy slots

## 4. Booking lifecycle

```
            create
              │
              ▼
      ┌─────────────────┐  no payment before expires_at ┌─────────┐
      │ pending_payment │ ─────────────────────────────▶│ expired │
      └─────────────────┘                               └─────────┘
          ▲       │ │ PayMongo paid (verified webhook; M7)
          │       │ └──────────────────────────────▶ confirmed
          │       │ upload proof
          │       ▼
          │  ┌───────────────────┐
          │  │ payment_submitted │
          │  └───────────────────┘
          │       │         │ admin approves
          │       │         ▼
          │       │    ┌───────────┐
          │       │    │ confirmed │ ──▶ completed (after end time, display only)
          │       │    └───────────┘
          │       │ admin rejects
          │       ▼
          │   rejection_count < 2 ?
          └── yes: back to pending_payment, new hold window, keeps the slot
              no:  ──▶ rejected (slot freed)

  cancelled ◀── user (before cutoff) or admin, from any active state

  walk-in (admin) ──▶ confirmed directly, with an approved payment row
```

- **Active statuses** (these hold the slot): `pending_payment`, `payment_submitted`, `confirmed`.
- **Hold window**: a `pending_payment` booking expires after `payment_hold_minutes` (default **60**). Expiry is enforced lazily: availability queries ignore expired holds, and `create_booking` sets any overlapping expired hold on the same court to `expired` before it inserts, because the exclusion constraint can't use `now()`. A scheduled job (`pg_cron`, M4) also sweeps expired holds to `expired`.
- **PayMongo** (M7, test mode; decided in T7.1): the player can start a hosted checkout (GCash, Maya, card, QR Ph; test mode only) only while the booking is `pending_payment` and its hold hasn't expired. Starting a checkout doesn't extend the hold, and one checkout session is kept and reused per booking. PayMongo sessions don't expire on their own, so the verified `checkout_session.payment.paid` webhook decides under a row lock:
  1. Hold still valid: an approved PayMongo payment, and the booking is `confirmed`.
  2. Hold lapsed (`pending_payment` past `expires_at`, or `expired`), but the slot hasn't started, the court is still active, no blackout or open play session (M9) covers it and nobody else holds it: the booking is `confirmed` again.
  3. A proof is waiting for review (`payment_submitted`): the booking is `confirmed` with the PayMongo payment. The pending proof is closed automatically as "paid online instead" without counting as a rejection, and admins are told to check for a duplicate payment.
  4. Anything else (cancelled, rejected, already confirmed, slot taken or started, or the amount doesn't match the stored total): the payment is recorded as not accepted, with a note, and the booking is unchanged. Admins see it flagged for a refund outside the app (refunds stay a non-goal).
  - Players never see these PayMongo outcomes as a failed proof. A late payment shows as "payment received after the booking closed; the venue will arrange a refund". The guest token never goes to PayMongo: it's kept in `sessionStorage` across the checkout redirect.
- **Rejected proof**: the admin must give a reason, which is shown to the player.
  - First rejection: the booking goes back to `pending_payment` with a fresh hold window, and the player keeps the slot and can upload a new proof.
  - Second rejection (`max_rejections`, default **2**): the booking becomes `rejected` and the slot is freed.
- **Cancellation cutoff**: players and guests can cancel an active booking up to `cancel_cutoff_hours` (default **1**) before the start time (`now() <= start - cutoff`, an absolute duration, shown in venue time). Admins can cancel any active booking until it ends, and must give a reason, which the player sees.
  - Only effectively active bookings can be cancelled. A hold whose `expires_at` has passed is already `expired`.
  - Cancelling frees the slot at once. Payment rows are never changed (no refunds, a non-goal): an approved payment stays counted in takings, a pending proof drops out of the review queue, and the admin view flags "cancelled after payment" so staff can settle any refund outside the app.

## 5. Business rules

1. **No overlaps.** Two active bookings can never overlap on the same court. This is enforced with a Postgres exclusion constraint (`btree_gist` on `court_id` + `tstzrange`), not only in the UI.
2. **One day, within opening hours.** A booking must:
   - stay inside one **operating day's** opening hours (see below)
   - not touch a blackout or an open play session (M9, hint `open_play`)
   - line up with slot boundaries

   There is no other limit on length. These checks live in `private.validate_booking_slot`, shared by `create_booking` and `create_walk_in`.

   **Operating day (M9, T9.9).** Opening hours may run **past midnight or around the clock**. A close before the open means the next day (6:00 AM to 5:00 AM). **24 hours is set only as 12:00 AM to midnight**; an open day can't close at its opening time (6:00 AM to 6:00 AM is refused). A slot belongs to the day whose opening it follows: a 1:00 AM slot after a 6:00 AM opening belongs to the previous date, and `/book` lists it under that date.
   - A booking runs into another day (`multi_day`) if it goes past the end of its operating day and also past the calendar midnight after it. Otherwise it runs past closing (`outside_hours`).
   - Days may not overlap: a day can run past midnight only until the next day opens (`hours_overlap`). This is checked for every write by a deferred constraint trigger.
   - Blackouts are instant ranges and need nothing extra. "Today" (the walk-in form, the dashboard) is the operating day running now, or the local date while the venue is closed (`private.operating_today()`).

3. **Booking window.** Bookings can be made from now up to `booking_window_days` ahead (default **30**), counted in operating days from today's operating day. Slots that have already started can't be booked.
4. **Pricing.** The price is calculated **on the server**:
   - Add up the price of each 1-hour slot in the booking.
   - For each slot, use the `court_rates` entry for its **operating day's** day of week and the slot's hour if there is one, otherwise the court's `default_hourly_rate`. A 1 AM slot after a Friday opening uses Friday's row (M9).
   - Store the total on the booking, so later rate changes don't affect existing bookings.

   The client never sends the price. `get_availability` returns the price of each slot so the UI can show it.

   For walk-ins, the admin may edit the amount (e.g. a discount), and the payment row records the amount actually received.

5. **Payment proof.** The amount paid should match `total_amount`. If it doesn't, the admin sees a warning, but the system does not block the proof.
6. **Timestamps.** All timestamps are stored as `timestamptz` and shown in `Asia/Manila`.
7. **Guest auto-claim.** When a player signs in with a **verified** email (Google accounts always have one; email + password accounts once confirmed), every guest booking whose `guest_email` matches and whose `user_id` is null is linked to that account through `user_id`. This runs in a `claim_guest_bookings()` RPC that the client calls after sign-in and on app load with an existing session. The RPC is idempotent, returns how many bookings it linked, only claims `online` bookings made as a guest (`guest_token_hash` set) with no `user_id`, and only uses the email from the authenticated user's record (`auth.users`, which requires `email_confirmed_at`), never one sent by the client. "Confirm email" must be on in every environment (local `config.toml` included), because without it Supabase marks every email as confirmed.
8. **Walk-ins.** An admin creates a walk-in booking with:
   - court, start time and number of slots
   - customer name (required) and phone (optional); no email is needed
   - payment method (default `cash`) and amount received (prefilled with the computed total)

   One RPC call (`create_walk_in`) then inserts the booking as `confirmed` with `source = 'walk_in'` and `created_by = <admin>`. It also inserts an approved payment row with `recorded_by = <admin>`.

   Walk-ins still respect the no-overlap rule, operating hours, blackouts and open play sessions. They skip the booking window and **may start in the slot that is currently in progress**. "Play now, pay later" is out of scope for v1.
9. **Open play sessions (M9, T9.11c).** An admin registers a **one-off** session (no recurring sessions) on one or more courts: a title, free-text details (any fee is written there) and up to 3 labelled `https://` links (an RSVP form, Reclub). It starts and ends on the hour, lasts at least an hour, fits within one operating day's opening hours and starts in the future. Players can't book or join through the app; `/book` shows the slots as open play and their details.
   - A session can't overlap an **active** booking (refused with the courts named, hint `slot_unavailable`) or another session on the same court (`session_overlap`). A lapsed hold doesn't count; if it's paid later through PayMongo, it isn't revived into the session (`late`, refund note).
   - Bookings and sessions can't race: `create_booking`, `create_walk_in`, the PayMongo revival and the session RPCs take a per-court transaction lock (`private.lock_court_slots`) before checking.
   - A session that has started can't be edited, but it can be deleted at any time, which frees its remaining slots.
   - A session may overlap a blackout; the slot then shows as closed (`blackout` comes first in `get_availability`).

## 6. Data model (Supabase / Postgres)

```
-- day_of_week: 0 = Sunday … 6 = Saturday (matches JS getDay / Postgres extract(dow))
profiles          id (= auth.users.id) PK, full_name, phone, role ('player'|'admin'), created_at
venue_settings    id (singleton), name, timezone, currency, slot_minutes (60), booking_window_days (30),
                  payment_hold_minutes (60), cancel_cutoff_hours (1), max_rejections (2),
                  payment_instructions (text/markdown),
                  address (≤ 300), maps_query (≤ 300; what the map searches)   -- M9, T9.11g
                  banner_path (nullable), banner_alt (nullable)   -- M6; CHECK banner_path under 'banner/'; set together;
                                                                  -- alt stored trimmed, 1–200 chars
                  sport_order sport[] (M9: every sport exactly once; defaults to the enum order)
courts            id, name, sport, description, default_hourly_rate numeric, is_active, sort_order, created_at
                  -- photos live in court_photos (M9); the M6 photo_path column was dropped in T9.11
court_photos (M9) id, court_id (on delete cascade), path unique (CHECK under 'courts/{court_id}/'), sort_order,
                  created_at. The lowest sort_order is the cover; a photo inserted without one goes last. At most 6 per
                  court, also when a photo moves court (trigger, P0001 too_many_photos). Grants: select for anon and
                  authenticated, writes for authenticated only (RLS limits them to admins).
                  private.prune_missing_court_photos() removes rows whose file is gone from Storage (run by T9.11,
                  which also copied in the last legacy photo_path files before dropping that column).
court_rates       court_id, day_of_week (0–6), start_hour (0–23), price numeric
                  PK (court_id, day_of_week, start_hour)
operating_hours   day_of_week (0–6) PK, open_time, close_time, is_closed   -- whole hours; close <= open: the next day
                  (M9); days may not overlap (deferred constraint trigger, P0001 hours_overlap)
blackouts         id, court_id (nullable = all courts), starts_at, ends_at, reason, created_by
                  (gist index on tstzrange(starts_at, ends_at))
venue_social_links  platform venue_social_platform PK (facebook, instagram, tiktok, youtube, x, messenger, website),
                  url (https only, ≤ 500, an inline check limits each platform to its own hosts), updated_at   (M9)
venue_info_sections id, title (1–80), body (≤ 5000, the SimpleMarkdown subset), sort_order (a new one goes last;
                  move_info_section reorders), created_at, updated_at   (M9; four starter sections)
venue_amenities   id, builtin_key (one of 15 keys, unique) xor custom_name (1–40, unique ignoring case and
                  spaces), created_at   -- a row means it's switched on (M9)
open_play_sessions  id, title (1–80), details (≤ 2000), links jsonb (≤ 3 {label, url}, https only; checked by
                  private.valid_open_play_links), starts_at, ends_at, created_by, created_at, updated_at   (M9)
open_play_courts  session_id, court_id, during tstzrange (a copy of the session's range)   PK (session_id, court_id)
                  exclusion (court_id with =, during with &&): sessions can't overlap on a court   (M9)
bookings          id, reference_code unique, court_id, user_id (nullable),
                  guest_name not null, guest_email, guest_phone   -- contact snapshot for every booking (guest, player, walk-in)
                  during tstzrange, total_amount numeric, status booking_status,
                  source ('online'|'walk_in') default 'online', created_by (admin, nullable),
                  rejection_count int default 0,
                  guest_token_hash bytea (sha256 of the guest token), expires_at, cancelled_at, cancel_reason,
                  cancelled_by (profile, nullable, indexed; null when cancelled through a guest link),
                  cancelled_by_venue boolean default false   -- stored at cancel time: true when an admin cancelled
                  created_at, updated_at
                  EXCLUDE USING gist (court_id WITH =, during WITH &&) WHERE (status IN active)
payments          id, booking_id, method ('gcash'|'maya'|'bank_transfer'|'cash'|'paymongo'),
                  amount numeric, reference_number (nullable), storage_path (nullable; proof file),
                  submitted_at, recorded_by (admin, nullable; set for walk-ins),
                  review_status ('pending'|'approved'|'rejected'), reviewed_by, reviewed_at, review_note
                  UNIQUE (booking_id) WHERE review_status = 'approved'
                  UNIQUE (booking_id) WHERE review_status = 'pending'   -- one attempt awaits review at a time
                  CHECK rejected => review_note present; CHECK storage_path under '{booking_id}/'
                  -- M7: method also 'paymongo'; provider_payment_id unique (pay_…),
                  -- provider_checkout_id (cs_…), provider_source (gcash|paymaya|card|qrph), provider_event_id;
                  -- CHECK method = 'paymongo' <=> provider_payment_id present; a trigger turns 'paymongo' from
                  -- the proof and walk-in RPCs into a readable P0001 invalid_input
paymongo_checkouts (M7)  booking_id unique, checkout_id unique (cs_…), checkout_url, amount_centavos,
                  created_at. Admins read; only service-role RPCs write.
                  -- M8: payments also has an index on provider_checkout_id (where not null)
email_outbox (M8) id, booking_id, payment_id (the rejected proof; proof_rejected only), kind ('booking_created'|
                  'payment_confirmed'|'proof_rejected'|'booking_cancelled'), to_email, for_guest,
                  data jsonb (template snapshot: reference, venue, court, times, amount, name, status, note, …;
                  never the guest token), status ('pending'|'sending'|'sent'|'skipped'|'failed'), attempts,
                  next_attempt_at, locked_until (lease), last_error, created_at, sent_at
                  UNIQUE (booking_id, kind) WHERE kind <> 'proof_rejected'; UNIQUE (payment_id)
                  Filled only by the bookings_queue_email trigger (online bookings with an email; walk-ins never;
                  skipped while app.suppress_booking_emails = on, as in seed.sql). Errors while queueing become a
                  warning, so they never fail the booking change. Rows that are sent, skipped or failed are
                  purged after 30 days (daily pg_cron job).
```

Storage: a private bucket called `payment-proofs`. Files live at `{booking_id}/{uuid}.{ext}`. Allowed types are jpg, png, webp and pdf, up to 5 MB.

A **public** bucket called `venue-media` holds court photos (`courts/{court_id}/{uuid}.{ext}`) and the banner (`banner/{uuid}.{ext}`) (M6). Anyone can read it through public URLs (no listing); only admins can write. Allowed types are jpg, png and webp, up to 2 MB after the browser downscales the image (court photos at most 1600 px wide, the banner at most 2200 px, re-encoded as WEBP with a JPEG fallback). A replaced image gets a new file name (cached for a year) and the old file is deleted. Public photos are lazy-loaded at 16:9 with fixed dimensions, and a missing or failed photo shows a sport placeholder.

### Access (RLS summary)

- `courts`, `court_rates`, `operating_hours`, `venue_settings`, `blackouts`: anyone can read; only admins can write.
- `venue_social_links`, `venue_info_sections`, `venue_amenities` (M9, T9.11g): anyone can read; only admins can write (RLS). Amenities are only inserted or deleted, never updated.
- `open_play_sessions`, `open_play_courts` (M9): anyone can read; there are no write grants, and admins write only through the open play RPCs.
- `court_photos` (M9): readable when the court is (archived courts' photos are hidden from the public through the `courts` policy); only admins can write.
- `bookings`: players read their own rows (`user_id = auth.uid()`); admins read and write all rows. **Nobody inserts directly.** Every write goes through RPCs.
- Public availability comes from an RPC that returns busy ranges and prices only, with no personal data. A booked slot also shows the booker's **first name only** (M9, the user's call): `booker_first_name`, the first word of the booking's contact name, at most 20 characters, for active bookings including walk-ins. No email, phone, surname or reference code is exposed. Admin views show the full name.
- `payments` and the storage bucket: the booking owner and admins can read. Writes go through RPCs or an Edge Function.
- `email_outbox` (M8): only admins can read (players can't, not even for their own bookings); anon has no access. Only the trigger and service-role RPCs write.
- `venue-media` bucket (M6): anyone can read through public URLs (there's no anon or player SELECT policy, so files can't be listed); only admins (`private.is_admin()`) can select, insert, update or delete, and uploads must go under `courts/` or `banner/`. Court photo rows (`court_photos`, M9) and the banner columns are written through admin-only RLS.

### Server API (RPCs / Edge Functions)

| Name                                                                               | Who         | Purpose                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_availability(date, court_id?)`                                                | anyone      | Returns the slots for each court on that date, each with free or busy and its price. Sports come in `venue_settings.sport_order`, then courts by `sort_order` and name (M9). Booked slots carry `booker_first_name` (M9, T9.8). Status `open_play` (after `booked` and `blackout`, before a started free slot's `past`) comes with `open_play_session_id` (M9, T9.11c). Each `booked`, `blackout` and `open_play` slot carries a `block_key` shared by the slots of the same block: an opaque 16-character hash for a booking, the session id, or `blackout:<id>` (the same on every court for an all-courts blackout); other slots have none (M10, T10.4). |
| `get_earnings(from, to)` | admin | Earnings for venue dates `from`–`to` (up to 366 days), as JSON. **Collected:** approved payments by `reviewed_at` on venue calendar dates, per method, plus the same for the period of equal length just before. **Refunds due:** PayMongo payments stored as rejected. **Daily:** collected and sold hours per date. **Courts** and **sports:** open, blackout (unioned, clipped to opening hours), sold (`confirmed`, any source) and open play hours, by operating day. **Coming up:** confirmed bookings not yet started, count and value. Others get `forbidden`; a bad range gets `invalid_input` (M10, T10.6). |
| `create_booking(court_id, start, slots, guest_info?)`                              | anyone      | Validates the rules, computes the price, inserts the booking and returns `{id, reference_code, guest_token?}`.                                                                                                |
| `get_guest_booking(reference_code, token)`                                         | guest       | Returns one booking with its proofs and rejection notes, after checking the token against its hash.                                                                                                           |
| `cancel_booking(id?, ref?, token?, reason?)`                                      | owner/admin/guest | Guest path: ref + token (never counts as admin). Session path: booking id, as the owner or an admin. Applies the cutoff (§4), requires a reason from admins, sets `cancelled`, `cancelled_at`, `cancel_reason`, `cancelled_by` and `cancelled_by_venue`. Unknown, wrong-token and not-yours all return the same `not_found`. |
| `submit-payment-proof` (Edge Function)                                             | owner/guest | Only allowed while the booking is `pending_payment` and its hold hasn't expired. Accepts a multipart upload (≤ 5 MB; JPG, PNG, WEBP or PDF, checked by file bytes), checks ownership or the guest token, stores the file in `payment-proofs` and records the proof. The status changes to `payment_submitted`. |
| `review_payment(booking_id, approve, note)`                                        | admin       | Approve: the status becomes `confirmed`. Reject: increments `rejection_count`, then sets `pending_payment` with a new `expires_at`, or `rejected` if the limit is reached. A note is required when rejecting. |
| `create_walk_in(court_id, start, slots, name, phone?, method, amount, reference?)` | admin       | Creates a confirmed walk-in booking and its approved payment in one transaction (§5.8).                                                                                                                       |
| `proof_target(ref, token, user_id)` / `record_payment_proof(...)`                 | service_role | Used only by `submit-payment-proof`: authorize the caller and check the booking is payable, then record the proof and set `payment_submitted` under a row lock. They are in `public` (PostgREST doesn't expose `private`), but only `service_role` can execute them. |
| `create-paymongo-checkout` (Edge Function, M7)                                    | owner/guest | POST `{ reference_code, token? }` → `{ checkout_url }`. Same payable check and ownership/guest-token check as `submit-payment-proof` (shared `_shared/payable.ts`). Reuses the booking's stored session, otherwise creates a PayMongo test-mode session for the stored `total_amount` (never a client amount; below PHP 20 → 422 `amount_too_low`). Return links come from the `PUBLIC_SITE_URL` allow-list. With no test key and no stub mode → 503 `payments_unavailable`; a PayMongo error → 502 with a generic message. |
| `paymongo-webhook` (Edge Function, M7)                                            | PayMongo    | `verify_jwt = false`. Verifies the webhook signature (HMAC-SHA256 over `t.rawBody`, `te` only; live signatures are never accepted) before parsing: 401 if it fails. Handles only test-mode `checkout_session.payment.paid` (200 with `ignored` for anything else) and passes only signed-payload values to `record_paymongo_payment`. 200 with the outcome once handled, 500 on a database error so PayMongo retries, 503 if the secret isn't configured (the local dev secret is refused on the hosted project). |
| `paymongo_checkout_for(booking_id)` / `record_paymongo_checkout(...)` (M7)        | service_role | Used only by `create-paymongo-checkout`: return the booking's stored, still usable session, or store a new one (the first stored wins a race; a session with a recorded payment is replaced). Only for a payable booking. |
| `record_paymongo_payment(checkout_id, payment_id, event_id, amount_centavos, currency, source, booking_id?)` (M7) | service_role | Used only by `paymongo-webhook`. Locks the booking and applies the four cases in §4. Outcomes: `confirmed`, `revived`, `superseded_proof`, `late` (stored as a not-accepted payment with a player-safe refund note), `duplicate` (replay, idempotent on the PayMongo payment id) or `unknown_checkout` (a session we didn't create, or a metadata mismatch). |
| `claim_email_outbox(limit)` / `finish_email(id, outcome, error?)` (M8)           | service_role | Used only by `send-emails`. Claim leases due rows for 5 min (`for update skip locked`; a row whose lease ran out is due again, or `failed` once it has used 5 attempts) and returns each booking's effective status now, so an overtaken `booking_created` can be dropped. Finish: `sent`, `skipped` or `failed` (retried after 1, 5, 15 and 60 min, then `failed` on the 5th attempt). |
| `claim_guest_link_email(ref, token)` (M8)                                         | service_role | Used only by `email-guest-link`. Checks the token against its hash and leases the guest's still-pending `booking_created` row, so at most one email carries the link. Any failure is the same `not_found`. |
| `send-emails` (Edge Function, M8, T8.3)                                            | pg_cron     | Called every minute through pg_net by `private.kick_email_worker()`, only when work is due and the Vault secrets `email_worker_url` and `email_worker_secret` are set (linked project only). The body is `{}`; the secret goes in the `x-worker-secret` header. |
| `email-guest-link` (Edge Function, M8, T8.3)                                       | guest       | `verify_jwt = false`, publishable key. POST `{ reference_code, token }`, called by the checkout page (the create-booking hook) right after a guest booking, fire and forget. Claims the row through `claim_guest_link_email`, then reads the booking's current status. If the booking was cancelled, expired or rejected meanwhile (or email is disabled), the email is finished as `skipped`; otherwise `booking_created` is written for the current status and sent with the `#token=` link to the outbox row's recipient only. A bad reference, a wrong token, an unknown booking or an email already claimed all get the same 404 `not_found`. 503 `email_unavailable` (misconfigured transport, nothing claimed) and 500 don't depend on the booking. |
| `move_court(court_id, direction)` (M9, T9.3)                                       | admin       | Swaps a court with its upper (-1) or lower (1) neighbour within its sport, archived courts included, and renumbers that sport's `sort_order` 0..n-1. The first court moving up, or the last moving down, does nothing. |
| `delete_court(court_id)` (M9, T9.5)                                                | admin       | Deletes a court that never had a booking, in any status. Its rates and court-specific blackouts cascade. Otherwise P0001 `court_has_bookings` ("…Archive it instead."); the bookings FK (on delete restrict) backs this up. Locks the court row, so a booking being created at the same time waits for it. The client then removes every file under `courts/{id}/` (best effort). |
| `reorder_court_photos(court_id, ids[])` (M9, T9.6)                                 | admin       | Stores the court's photos in the given order (`sort_order` 0..n-1; the first is the cover). The list must be exactly that court's photos, each once; otherwise P0001 `invalid_input` ("…out of date. Reload…"). |
| `set_operating_hours(hours jsonb)` (M9, T9.9)                                      | admin       | Saves all seven days in one step: an array of `{day_of_week, open_time, close_time, is_closed}`. Each day is checked first, with its own `invalid_input` message: day 0–6, opening a whole hour from 00:00 to 23:00 (a 24:00 opening is refused, and a table check holds direct writes to the same rule), closing a whole hour up to 24:00, `is_closed` a boolean, an open day not closing at its opening time (24 hours is 00:00 → 24:00; a table check holds direct writes to it too), and seven distinct days. Overlapping days give `hours_overlap`, checked before returning (T9.11). |
| `create_open_play(court_ids[], start, end, title, details?, links?)` / `update_open_play(id, …same)` / `delete_open_play(id)` (M9, T9.11c) | admin | Create, replace or delete a one-off open play session (§5.9). Errors: `invalid_input`, `invalid_links`, `court_inactive`, `not_aligned`, `slot_started`, `outside_hours`, `slot_unavailable` (active bookings, courts named), `session_overlap`; update also `session_started` and `not_found`, delete `not_found`. |
| `move_info_section(id, direction)` (M9, T9.11g) | admin | Swaps a venue info section with its upper (-1) or lower (1) neighbour and renumbers `sort_order` 0..n-1, like `move_court`. A missing section gives `not_found`. |
| `claim_guest_bookings()`                                                           | player      | Links matching guest bookings to the signed-in, email-verified user (§5.7).                                                                                                                                   |

Guest access uses a random token. It is shown once (in the confirmation page link and email) and stored only as a hash. The link carries it in the URL **fragment** (`/booking/:ref#token=…`), which browsers never send to servers. Old `?token=` links are rewritten to the fragment. A guest link stops working 30 days after the booking ends (same "not found" response). If the link is lost, the guest can sign up or log in with the booking's email to see the booking in My bookings. "Email me a new link" is out of scope (decided in M8): emails can't re-issue a token, because only its hash is stored. There is no lookup throttle, because a 256-bit token can't be guessed (RESEARCH M5).

## 7. Pages (React Router)

| Route               | Access             | Content                                                                                                                                  |
| ------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                 | public             | Site banner when set (M6), venue info, courts grouped by sport in the venue's sport order (M9), each with its cover photo (the first in its gallery, M9) or a sport placeholder (M6), "Book now". Venue info (M9, T9.11i), in this order: amenity chips with icons under the hero; a "Location" card after the courts (the address, a lazy embedded map, "Open in Google Maps" and the social links); "Good to know" at the bottom, one expandable panel per info section (a link to `/#info-<id>` opens and scrolls to it). Each part is hidden while loading, on error or when empty. The social links are also in the footer on every public page, as labelled links in a fixed platform order (generic icons, no brand logos). |
| `/book`             | public             | Date picker (Today, Tomorrow, previous and next day, and a month calendar limited to the booking window with closed days disabled; M10) and sport filter, an "About the … courts" panel (open by default since M9; players can collapse it) with each court's description and its photos as a swipeable gallery (scroll-snap, previous and next buttons, "2 of 4"; M9), or a sport placeholder, then a legend and a court × time slot grid whose rows show each slot's time range ("1 PM – 2 PM", M9) with the price per slot (booked slots show "Booked" and the booker's first name, M9). The hours of one booking, open play session or blackout are one cell showing their full range ("Booked · Ana · 2 PM – 4 PM"), spanning neighbouring courts when they share it exactly; free slots stay one per hour (M10, T10.5). The first date is the operating day running now, and after-midnight rows are marked "(next day)" (M9), then select consecutive slots. Open play slots (M9) can't be selected: pressing one opens a modal dialog with the session's title, time, courts, details and links (new tab, `rel="noopener noreferrer"`); Escape or Close returns focus to the slot. |
| `/book/checkout`    | public             | Summary and total price. Guest form (name, email, phone) or prefilled for a logged-in player. Confirm. Under the form, a link to the venue's cancellation and refund policy opens it in a new tab, so the form isn't lost (M9): the first info section whose title contains "cancel" (case-insensitive; the admin page says so), and no link without one. |
| `/booking/:ref`     | owner or `#token=` | Status, payment instructions, countdown to expiry, "Pay online with PayMongo" (M7) next to proof upload, rejection reason and re-upload, cancel button. After PayMongo: `?paid=1` polls every 3 s until the webhook confirms (then "Payment received"; a refund note if the payment wasn't accepted). After 90 s it says so and keeps checking every 30 s. `?paid=0` says it was cancelled. The return moves from the URL into history state, so copied links don't replay it. A guest's token is kept in `sessionStorage` across the redirect and restored to the fragment. Staff viewing a booking without its link get no Pay online button. |
| `/login`, `/signup` | public             | "Continue with Google" and email + password.                                                                                             |
| `/me/bookings`      | player             | Upcoming and past bookings, including claimed guest bookings.                                                                            |
| `/admin/login`      | public             | Admin sign-in in the admin shell: email + password only, with no Google sign-in and no sign-up (admins are promoted in the database, §2). A signed-in non-admin is refused ("Admins only", with Log out). |
| `/admin`            | admin              | Dashboard ("today" is the operating day running now; takings stay on that calendar date, M9): "Today's courts" (courts × hours with each booker's full name and reference; a booking, session or blackout is one cell over its hours, M10; the reference opens that booking on `/admin/bookings`; M9), today's schedule, proofs waiting for review, a "+ Walk-in" quick action. **Earnings** (M10, replacing today's takings): a period switch (Today; This week, Monday to Sunday; This month; a custom range up to 366 days) over `get_earnings`. It shows money collected per method with the change from the period before, PayMongo money received but not accepted apart from the total (a refund outside the app), booked hours, occupancy (capped at 100%) and open play per court and sport, a labelled bar per day, and confirmed bookings still to come. **CSV export** for the selected range (T10.8), built in the browser from paged admin reads: bookings by play date (reference, court, sport, start, end, status, source, name, amount; phone and email only when "Include contact details" is ticked, off by default) and payments by the date the money came in (accepted, and PayMongo refunds due). Times are venue-local, cells are quoted and defused against formula injection, and files are UTF-8 with a BOM and CRLF lines; a note asks staff to store the files securely. |
| `/admin/bookings`   | admin              | Filterable list (status, source, date). Review a proof (image or PDF preview, amount-mismatch warning), approve or reject with a reason. PayMongo payments (M7) show in the panel with source, PayMongo id and paid time, and have no review actions. Rows and the panel flag "Refund due" (paid online but not accepted) and "Check duplicate" (a proof closed because the customer also paid online). |
| `/admin/courts` | admin | Courts grouped by sport in the venue's sport order, archived ones included, with an "Add court" button. Up and down buttons per court reorder it within its sport (`move_court`, M9). The list updates at once, and focus stays on the pressed button (or its partner at an edge). |
| `/admin/courts/:id` | admin | Edit or archive a court (`new` creates one, last in its sport). There's no order field; order is set on the list (M9). "Delete court" (with a confirmation) is allowed only for a court that was never booked; otherwise the page says to archive it (M9). Weekly rate grid editor (day × hour) with a "fill a range" helper; an overnight day's after-midnight hours appear under that day, marked "(next day)", and price from its row (M9). Photo gallery editor (M9): up to 6 photos, add several at once, reorder with arrows or "Make cover" (the first is the cover), remove. |
| `/admin/schedule`   | admin              | Operating hours and blackouts. A blackout is picked as a start date and hour and an end date and hour over all 24 hours (ending at "Midnight" closes that date); hours that have ended aren't offered (M10). A close before the open shows "closes next day", and 12 AM to midnight shows "open 24 hours" (there's no separate 24-hour switch). A day closing at its opening time, or running into the next day's opening, is flagged before saving; the week saves in one step through `set_operating_hours` (M9). |
| `/admin/open-play`  | admin              | One-off open play sessions (M9, T9.11d): a form (courts as checkboxes; a date, a start hour and a length within that operating day, hours that have started left out (M10); title, details, up to 3 labelled https links) and the upcoming sessions. A session that hasn't started can be edited; any session can be deleted after a confirmation. A clash shows the server's message (the booked courts are named). The dashboard's "Today's courts" shows open play cells with the session title. |
| `/admin/settings`   | admin              | Venue settings and payment instructions. Sport order, with up and down buttons that save at once (M9). Site banner upload with alt text, and remove (M6). Venue info (M9, T9.11h): the address and map search with a map preview; one link per social platform (checked against that platform's hosts before saving); info sections (add, edit, delete, reorder with up and down buttons); amenities (built-in checkboxes with icons that save at once and show the change immediately, plus custom ones added and removed by name). |

The UI is mobile-first: most players will book from a phone.

**Site banner (M6).** When the venue has a banner, the **home page** (`/`) shows it just below the header, before the page content. Other pages never show it. It's an image with alt text only (no headline or link). Tapping it opens the whole image in the photo viewer (M9). Without one (or while settings load or fail), the section isn't rendered at all.

**Photo viewer (M9, T9.11e).** Tapping a court photo (a home page cover, any `/book` gallery photo) or the banner opens a full-screen viewer: a native modal `<dialog>` with the whole image (`object-fit: contain`, always on a dark background), a "2 of 4" counter, previous and next buttons, the arrow keys and a one-finger swipe between that court's photos (a home page cover opens all of them), and Close. Escape closes it, focus is trapped while it's open and returns to the photo afterwards, and the gallery strip follows to the photo it closed on. Pinch zoom is the browser's. No library.

**Admin shell.** Every `/admin/*` route renders in its own `AdminLayout` (admin nav, no public header, footer or booking nav), not inside the public `Layout`. The public header has no Admin link; staff go to `/admin` directly, and unauthenticated visits redirect to `/admin/login` and return to the requested page after sign-in. The shell only controls what is shown: admin access itself is enforced in the database (`profiles.role` can't be changed by users, and every admin read and write checks `private.is_admin()`). It is still one Vite app, and admin code stays lazy-loaded out of the public bundle. If a signed-in account's profile (and so its role) can't be loaded, the admin shell says "Couldn't load your account" with Try again and Log out, never "Admins only" (M8).

**Accessibility (M8).** The main pages pass axe (WCAG 2.1 A and AA) with no serious or critical violations, in light and dark mode, at desktop width, 360px and 200% zoom, with no sideways page scroll (`e2e/a11y.spec.ts`). Slot statuses look different in more than colour, and a legend above the grid names them:
- available: outlined, shows the price
- selected: filled, with a ✓ and the price
- booked: solid grey, "Booked"
- closed (blackout): hatched, "Closed"
- open play (M9): purple tint with a thick left bar, "Open play"; pressable, it opens the session's details
- past: dashed and empty, "—"

The colours come from tokens derived from the palette (`--slot-*` in `index.css`), so the M9 theme task can retune them. Both layouts have a "Skip to main content" link, and after a client-side page change within a layout, focus moves to `<main>`. Switching between the public and admin shells leaves focus to the browser. Neither one changes the URL hash, because guest links keep their token there.

**Waits (M9, T9.11f).** Going to PayMongo shows a busy state until the browser leaves: the button is disabled with a spinner ("Opening PayMongo…", then "Taking you to PayMongo…" once the checkout exists, even if the redirect is slow), the button is `aria-busy` (not its section, so the live line isn't held back), and a live line says to keep the page open. If the checkout can't start, the button comes back with the error. The proof upload's "Uploading…" and the return page's "Confirming your payment…" show the same spinner.

**Error messages (M8).** Every async view has loading, empty and error states. Error text goes through `errorMessage()` (`src/lib/errors.ts`); booking and payment forms use `bookingErrorMessage()`, which shows our RPC and function messages and a generic line otherwise. `errorMessage()` works like this:
- Our RPC messages (P0001) and Edge Function messages (an HTTP status plus our code) are shown as written.
- Raw database errors from admin table writes are translated into plain sentences (permission, expired session, duplicate value, invalid or too-long value, still in use).
- Unknown codes get a generic line, even when PostgREST adds a hint. A Storage error with an unmapped status also gets a generic line.
- Network failures say the server couldn't be reached.

On a player's booking, a proof that was closed because they paid online is labelled "Replaced by online payment", not "Not accepted". After a PayMongo return, only online payments made since this tab left for the checkout count, so an older not-accepted payment isn't reported as this attempt's outcome.

## 8. Notifications (M8)

Emails go out on four events: booking created (online bookings only), payment confirmed, proof rejected (with the reason) and booking cancelled. Walk-ins get no email. **For now this is a demo, so no email provider is set up in production** (`EMAIL_TRANSPORT=disabled`: queued emails are marked `skipped`). Locally, every email goes to Mailpit. Switching on Resend later (API for booking emails, SMTP for Auth, from a verified domain) only needs a key, a domain and settings, with no code change. Until then, Auth uses Supabase's default email, which reaches project team members only, so `/signup` points visitors to Google sign-in or guest booking.

- **Queueing.** One trigger on `bookings` (insert, or a status change) adds a row to `email_outbox` in the same transaction as the change, whatever the path (RPC, webhook or cancellation).
- **Sending and retries.** A `send-emails` Edge Function, run every minute by pg_cron through pg_net, sends the queued rows. It retries with backoff and gives up after 5 attempts.
- **Stale emails.** Before sending a booking-created email, the sender reads the booking's status now. It drops the email if the booking was cancelled, expired or rejected meanwhile, and otherwise writes it for the current status, so a guest who already paid gets "confirmed" (with their link) instead of "please pay".
- **Transport** (`EMAIL_TRANSPORT`): `mailpit` locally, `disabled` on the hosted project for now (emails are finished as `skipped`), `resend` once a key and a domain exist. A setting that can't work (Resend without a key, Mailpit on the hosted project) leaves emails queued instead of dropping them. A Resend `409` (reused idempotency key) counts as sent.
- **The guest link.** Only the booking-created email carries it. The checkout page passes the token to `email-guest-link`, which checks it against the hash and sends that one email. The token is never stored, queued or logged. If the call doesn't arrive within 10 minutes, the email goes out without the link. Other guest emails carry the reference and explain that signing up with the same email shows the booking in My bookings.
- **Local testing.** Locally, emails go to Mailpit.

Until emails ship, the confirmation page shows the private link with a "save this link" prompt.

## 9. Milestones

1. ✅ **Foundation**: Supabase project linked, migrations folder, generated types, layout, routing, auth (Google + email/password), `profiles` and role.
2. ✅ **Catalog**: courts, rate table, operating hours and venue settings, with admin CRUD (including the rate grid editor) and the public home page. Seed data.
3. ✅ **Booking**: `get_availability` with prices, the slot grid, `create_booking` with the exclusion constraint and pricing, and the booking detail page.
4. ✅ **Payments**: storage bucket, proof upload, admin review queue with the reject → re-upload loop, expiry job, walk-in flow, admin dashboard.
5. ✅ **Admin shell and accounts**: separate admin layout and login; My bookings, cancellation, guest token flow hardened, `claim_guest_bookings`.
6. ✅ **Venue media**: court photos and an optional site banner, uploaded by admins.
7. ✅ **Online payments**: PayMongo (test mode) checkout with webhook auto-confirm, alongside manual proof.
8. ✅ **Polish**: emails, empty, loading and error states, an a11y pass (including distinct slot status colors and the settings page spacing), and deploy (Vercel + Supabase). Deploy happens here so later work ships automatically.
9. ✅ **Venue admin upgrades** (added 2026-10-19; done 2026-10-23):
   - a new theme and colors (the palette is chosen from a preview)
   - court and sport ordering
   - deleting never-booked courts
   - several photos per court
   - booker first names on booked slots (public), with full names in an admin day view
   - opening hours past midnight and 24 hours
   - time ranges on the slot grid ("1 PM – 2 PM")
   - open play sessions: admins block courts for one-off open play sessions, shown on `/book` with their details (added 2026-10-21)
   - a full-screen photo viewer; court details open by default on `/book`; a clear loading state while going to PayMongo
   - venue info set by admins: location with an embedded Google map, social links, admin-defined info sections (waiver, reminders and policies, cancellation and refund policy, house rules) and amenities with icons (added 2026-10-21)
   - then the README, screenshots, a demo video script and close-out (moved from M8). Waiver acceptance was skipped (§11). The video itself is recorded from `docs/demo-script.md`.
10. **Product improvements** (added 2026-10-25; breakdown in TASKS.md, research in RESEARCH M10):
   - a date and hour picker for open play, blackouts and `/book`
   - merged blocks on the slot grids (one cell per booking, open play session or blackout)
   - earnings on the dashboard (collected per method, occupancy, a daily chart, coming up) and CSV export
   - staff-only rescheduling, including moving the rest of a booking that has already started

## 10. Decisions log

| Date       | Decision                                                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-16 | Single venue; PHP currency, `Asia/Manila` timezone; GCash, Maya and bank transfer, with manual proof of payment.                                                                 |
| 2026-10-16 | Rejected proof: the player re-uploads on the same booking and keeps the slot; after the 2nd rejection the booking becomes `rejected`.                                            |
| 2026-10-16 | Pricing: per-court rate table (day × hour) that falls back to the court's default hourly rate.                                                                                   |
| 2026-10-16 | Mixed sports (badminton, pickleball, basketball, tennis); 60-min slots for the whole venue.                                                                                      |
| 2026-10-16 | Rules: 30-day booking window, no length limit as long as the booking stays within one day's opening hours, 60-min payment hold, 1-hour cancellation cutoff.                      |
| 2026-10-16 | Auth: Google OAuth and email + password; guest bookings are auto-claimed by a verified matching email.                                                                           |
| 2026-10-16 | No public demo login; booking emails are a stretch goal (Resend).                                                                                                                |
| 2026-10-16 | Venue name: Claudex Courts.                                                                                                                                                      |
| 2026-10-17 | Blackouts use `starts_at`/`ends_at` columns instead of a `tstzrange` column, which is simpler for the client. The overlap check uses `tstzrange(starts_at, ends_at)`. |
| 2026-10-17 | Booking engine (from RESEARCH.md, M3): the overlap rule is a `btree_gist` exclusion constraint (`bookings_no_overlap`, with the extension in the `extensions` schema), and `create_booking` expires overlapping stale holds before inserting. Slot, day-of-week and hour math always uses `at time zone venue_settings.timezone`. |
| 2026-10-17 | Reference codes are `CB-` plus 6 characters from a 32-character unambiguous alphabet, drawn from `gen_random_bytes`, with a unique constraint and a retry on collision. Guest tokens are 32 random bytes in base64url, shown once and stored as `sha256` (`bytea`). |
| 2026-10-17 | RPCs are `security definer` with `search_path = ''`, and their execute grant is revoked from `public, anon, authenticated` before being granted explicitly (Supabase grants new `public` functions to `anon`/`authenticated` by default). Business errors are `P0001` (HTTP 400) with a readable `message` and a stable code in `hint`. The client maps on `hint`. |
| 2026-10-17 | `bookings.guest_name`, `guest_email` and `guest_phone` are a contact snapshot taken at booking time for every booking, not only guest bookings. The name is required, so a booking stays contactable after its player is deleted (`user_id` becomes null). `create_booking` fills them from the arguments or the player's profile, and auto-claim (§5.7) still matches only rows where `user_id` is null. |
| 2026-10-17 | The booking window is counted in venue-local days: a slot can be booked if its local date is between today and today + `booking_window_days`, inclusive. `get_availability` and `create_booking` share `private.in_booking_window()`. `get_availability` returns no rows for closed days and for dates outside the window, and gives each slot one status, in this precedence: `past`, then `booked`, then `blackout`, then `free`. |
| 2026-10-17 | `get_guest_booking` matches the reference code case-insensitively (codes are stored in upper case) and also returns the guest's own name and email. Any status shown to a user is the effective status: a `pending_payment` hold whose `expires_at` has passed is displayed as `expired`, in the RPC and in client code that reads bookings through RLS. |
| 2026-10-17 | No advisory locks for booking: the exclusion constraint alone guarantees one winner when two bookings race (verified with two concurrent sessions, see RESEARCH "Concurrency"). |
| 2026-10-17 | Payments (M4): guests and players upload proofs through one Edge Function (`submit-payment-proof`) that checks the file's bytes, stores it with the secret key and records it through service-role-only RPCs. The proof bucket is readable only by the booking owner and admins. **Guests see their payment attempts' details (time, method, amount, review status and note) but not the file.** |
| 2026-10-17 | `get_availability` status for the slot in progress: a slot that has ended is `past`; otherwise `booked` beats `blackout`; a started slot that is free is `past`. This replaces the earlier `past`-first precedence so staff see who is playing now and the walk-in form only offers the current slot when it is really free. |
| 2026-10-17 | Admin dashboard (M4): the walk-in form books **today** only (counter use; `create_walk_in` itself accepts other days). **Today's takings** are approved payments whose `reviewed_at` falls on the venue-local day, so they are counted on a cash basis (a proof approved today for next week's booking counts today). |
| 2026-10-17 | Accounts (M5, from RESEARCH.md): `cancel_booking` lets players and guests cancel until the cutoff and admins until the booking ends (reason required), records `cancelled_by`, and leaves payments untouched. `claim_guest_bookings` claims only unclaimed `online` bookings matching the confirmed `auth.users` email. "Confirm email" is on locally too. Guest links move to the URL fragment and expire 30 days after the booking. No lookup throttle. My bookings filters on `user_id` explicitly, because admins' RLS sees every booking. |
| 2026-10-17 | Scope change: **PayMongo online payments in test mode** are added next to manual proof upload (not replacing it). Players choose; walk-ins stay admin-recorded. Live keys, real money and refunds stay out of scope. Secret and webhook keys live only in Edge Function secrets. |
| 2026-10-17 | Scope change: the **admin area gets its own shell** (own layout and `/admin/login`, no Admin link in the public header) in the same SPA, still lazy-loaded. It is built first in M5, together with Accounts. |
| 2026-10-17 | PayMongo is **postponed**, after Accounts, because manual payment and admin confirmation already cover the flow. |
| 2026-10-17 | New feature, **venue media (M6)**: one optional photo per court, and an optional site banner under the public header that is hidden when none is set. Both are uploaded by admins to a public `venue-media` bucket. PayMongo moves to M7 and Polish to M8. |
| 2026-10-18 | Venue media (M6, T6.1): public `venue-media` bucket with admin-only SELECT/INSERT/UPDATE/DELETE policies (`remove()` needs SELECT); 2 MB, JPG/PNG/WEBP. No Supabase image transformations (Pro only, off locally): admins' browsers downscale and re-encode images before upload, which also strips EXIF. Paths are stored (not URLs), new uuid name per upload, old file removed best effort. Banner 2:1 on phones, 3:1 from 640 px, `object-fit: cover`; alt text required while a banner is set. |
| 2026-10-18 | Site banner (M6): shown on the home page only, just below the header, and it's just an image with alt text (no headline or link). Closes the §11 banner questions. |
| 2026-10-18 | PayMongo (M7, T7.1): Hosted Checkout `/v2/checkout_sessions` in test mode only (the function refuses non-`sk_test_` keys), methods GCash, Maya, card, QR Ph, amount in centavos from the stored total, one reused session per booking. Webhook `checkout_session.payment.paid` verified with HMAC-SHA256 over `t.rawBody` (`te`), idempotent on the PayMongo payment id, 2xx once handled. No hold extension and no session expiry in M7. Late payments follow the four cases in §4, including re-confirming a lapsed hold whose slot is still free (the user's call). Stored as `method = 'paymongo'` with `provider_*` ids plus a `paymongo_checkouts` table. Locally, `PAYMONGO_MODE=stub` and webhook events signed locally. |
| 2026-10-18 | PayMongo live in test mode on the linked project (M7, T7.7): both functions deployed. `PUBLIC_SITE_URL` is `http://localhost:5173,http://127.0.0.1:5173` until the app is deployed (M8 adds the real site). The test-mode webhook is registered for `checkout_session.payment.paid`. A real test payment (QR Ph) confirmed CB-6L7YXZ through the webhook. |
| 2026-10-19 | New scope (M9, the user's call): theme, court and sport ordering, court deletion, several photos per court, booker names on slots, and overnight or 24-hour opening hours. **Booker names:** the public grid shows the first name only, and admins see full names. **Deleting a court** is allowed only when it has never had a booking (with its photos and rates); a booked court can only be archived, so booking history keeps its court. M8 keeps deploy (early, so later work ships automatically) and gains slot status colors and the settings spacing fix. The README, screenshots and video move to the end of M9. No extra features for now. |
| 2026-10-19 | Email sending as built (T8.3): a booking-created email is **written for the booking's current status** (skipped only when it was cancelled, expired or rejected meanwhile) instead of being dropped after any later event, so a guest who paid within minutes still gets their link. An unusable transport answers 503 without claiming anything, so emails wait instead of being dropped. The worker answers 401 to everyone when its secret isn't configured, and the committed local worker secret is refused on the hosted project. A Resend 409 counts as sent. The guest-link call lives in the create-booking hook, fire and forget. |
| 2026-10-19 | Email outbox as built (T8.2): **one** trigger on `bookings` instead of one on `bookings` plus one on `payments`, because `review_payment` updates the payment before the booking, so a payments trigger couldn't tell whether a rejection was final. `proof_rejected` = the booking moving from `payment_submitted` to `pending_payment` or `rejected`, for the latest admin-rejected payment (`reviewed_by` set) that has no email yet. `finish_email` takes a text outcome (`sent`, `skipped` or `failed`) instead of a boolean, because `skipped` needs a third value. Demo seed data sets `app.suppress_booking_emails`. |
| 2026-10-19 | Emails without a provider for now (demo project, the user's call): the full pipeline is built and tested through Mailpit, but production runs `EMAIL_TRANSPORT=disabled` (rows marked `skipped`) and Auth stays on the default SMTP. Resend is a later switch-on with no code change. Email confirmation stays on (guest-booking claims trust it). |
| 2026-10-20 | Accessibility (T8.5): axe runs in Playwright (`@axe-core/playwright`, pinned) and fails on serious or critical WCAG 2.1 A/AA violations; moderate and minor ones aren't gated. 200% zoom is checked as a 640px-wide viewport (a 1280px window at 200%). Focus moves to `<main>` after a client-side page change, and the skip link focuses `<main>` in script instead of using `#main`, so a guest link's `#token=` is never replaced. |
| 2026-10-20 | Deploy as built (T8.6): production is https://court-booking-system-ashen.vercel.app on Vercel Hobby (fine for a non-commercial portfolio with test-mode payments; real payments for a real venue would need Pro). Production builds from `master`, previews from other branches, and both use the one Supabase project. `vercel.json` rewrites every path except `/assets/` to `index.html`, so deep links work and a stale chunk still gets a real 404. Hosted function secrets: `EMAIL_TRANSPORT=disabled`, `EMAIL_WORKER_SECRET`, and `PUBLIC_SITE_URL` with production first. Vault holds `email_worker_url` and `email_worker_secret`. All 5 functions are deployed. `/signup` tells visitors that confirmation emails aren't sent yet and points them to Google or guest booking. The note is removed when Resend and Auth SMTP are switched on. `npm run smoke:prod` checks deep links and books one tagged guest booking (`E2E Smoke`) with a proof on production. |
| 2026-10-20 | Bundle (T8.7): React, React Router and React Query go in a `vendor-react` chunk, and `@supabase/*` in a `vendor-supabase` chunk (Vite 8 `codeSplitting` groups). Every chunk stays under the 500 kB warning and the vendor chunks stay cached across deploys. The admin pages stay lazy. Measure bundle size with `.env` present: without it, `lib/supabase.ts` throws at load time and supabase-js is dropped as dead code, which made earlier builds look about 330 kB smaller. |
| 2026-10-20 | M9 plan (the user approved RESEARCH M9 and the T9.1–T9.12 breakdown). **Overnight hours:** `operating_hours` is kept; a close at or before the open means the next day, and open = close means 24 hours. Days may not overlap, which `set_operating_hours` checks. A slot belongs to its operating day, and so do the booking window and "today". An after-midnight slot is priced from its **operating day's** rate row. **Sport order:** `venue_settings.sport_order`. **Court photos:** at most 6, and the first is the cover. **Booker names:** the first word of `guest_name` for active bookings. **Live production:** migrations expand, then the frontend deploys, then a contract migration. |
| 2026-10-20 | Theme (T9.1): the user kept **Court Green**, the current palette, after comparing four options (Court Green, Clay Court, Indigo Night, Berry) on real components in light and dark mode. All four met WCAG AA for the 12 pairs checked. The danger button, which wasn't checked, failed in dark mode and was fixed in T9.2. The tokens in `src/index.css` stay as they are. |
| 2026-10-20 | Theme applied (T9.2): new token `--danger-contrast` (white in light mode, `#1f0a08` in dark mode). `.btn-danger` used hard-coded white text, which was 2.8:1 on the dark-mode danger red. `src/lib/theme.test.ts` reads the real tokens from `index.css` and holds both modes to WCAG AA on 17 pairs, so a token change can't silently break contrast. The palette preview was removed. |
| 2026-10-20 | Deleting a court (T9.5): `delete_court` returns nothing instead of photo paths. The client removes every file under `courts/{id}/` in Storage after a successful delete (best effort: a leftover file is only an orphan). That also covers T9.6's multiple photos, so the function won't need to change. A court with any booking, even a cancelled one, can't be deleted. The `sport_order` check now also requires a one-dimensional array. |
| 2026-10-21 | Booker names as built (T9.8): `get_availability` gains `booker_first_name`, the first word of the contact name capped at 20 characters, for active bookings including walk-ins (dropped and recreated in one transaction, re-granted). `/book` shows "Booked" plus the name, labelled "Booked by …". The dashboard's "Today's courts" shows full names; a reference opens `/admin/bookings?…&booking=<id>`, which preselects the booking. Links on the booked grey use the text colour, because the accent is 4.39:1 there. |
| 2026-10-21 | Overnight hours as built (T9.9): helpers `private.operating_day_range`, `operating_day_of` and `operating_today`. The window, pricing (`slot_price` with an operating-day weekday), `validate_booking_slot` and `get_availability` all use them, so `create_booking` and `create_walk_in` follow. The old `open < close` check became the no-overlap trigger, and `set_operating_hours` saves the week. The old `multi_day` and `outside_hours` hints keep their meaning for normal days. Also: a signed-in player with no name books as "Player" (no email-derived name, which T9.8 would expose), and a court deleted mid-booking reports `court_inactive`. |
| 2026-10-21 | Overnight hours UI as built (T9.10): client helpers in `catalog/hours.ts` mirror the SQL (the zone conversion is in `lib/time.ts`). `/book`, the dashboard and the walk-in form treat "today" as the operating day; after-midnight hours say "(next day)" in the grid, the day view, the schedule list, the walk-in form and the rate grid. Checkout looks the run up on its operating date but shows the slot's **real calendar date**, like the booking pages. When the operating day runs past midnight, the dashboard fetches both calendar dates and merges them (each booking once). Takings stay on the calendar date. A day-view reference opens `/admin/bookings` on the booking's own calendar date. |
| 2026-10-21 | Contract migration (T9.11), run once the T9.7 frontend was on `master`. `court_photos` was reconciled with Storage: `private.prune_missing_court_photos()` removes rows whose file is gone, and the last legacy `photo_path` files that still existed were copied in (only where a gallery had room). Then `courts.photo_path`, its check and the expand-phase backfill were dropped. Production: 7 photos, none missing, none left to copy. Also: `set_operating_hours` checks each day's shape with its own message (a 24:00 opening is refused), and the no-overlap trigger takes a transaction advisory lock, so concurrent single-day updates can't both pass into an overlap. Direct UPDATE on `operating_hours` stays, because the live frontend until T9.10 ships still writes rows. |
| 2026-10-21 | 24 hours simplified (the user's call, after reviewing T9.10): the schedule editor's "24 hours" checkbox was confusing, so it's gone, and **24 hours is only 12 AM to midnight** (00:00 → 24:00). An open day can't close at its opening time: the check `operating_hours_open_differs_from_close` (a closed day may keep any times) and `set_operating_hours` ("Monday opens and closes at the same time…") refuse it, and the editor flags it before saving. Overnight closes (6 AM to 5 AM) are unchanged. The migration moved stored open = close days to 00:00 → 24:00 (production's Saturday was 06:00 → 06:00, so it now runs Sat 12 AM to Sun 12 AM instead of Sat 6 AM to Sun 6 AM). |
| 2026-10-21 | New M9 scope (the user's call), placed before the close-out. **Time ranges:** each `/book` grid row and slot button label shows its range ("1 PM – 2 PM"). The selection bar and other pages are unchanged. **Open play:** admins register **one-off** open play sessions (no recurring sessions; recurring bookings stay a non-goal). A session blocks its court(s), and players **can't book or join online**: `/book` shows the slots as "Open play", and clicking one shows details the admin set (for example an RSVP or Reclub link). No payment through the app. The storage, the clash rules and the exact detail fields are settled in T9.11c's research. |
| 2026-10-21 | More M9 scope (the user's call), also before the close-out. **Photos:** tap to open a full-screen viewer. **`/book`:** "About the … courts" starts open. **PayMongo:** a clear loading state while redirecting. **Location:** an address, an embedded Google map and an "Open in Google Maps" button. **Socials:** links for a fixed set of platforms. **Info sections:** admin-defined (title and body, reorderable), pre-filled with Waiver, Reminders and policies, Cancellation and refund policy, and House rules. **Amenities:** a built-in list with icons that admins switch on or off, plus custom ones with a generic icon. Whether players must **accept the waiver** is open (§11). How it's stored and rendered is settled in T9.11g's research. |
| 2026-10-22 | Open play sessions (T9.11c; the user approved the plan, the detail fields and multi-court sessions). A new `open_play_sessions` table plus `open_play_courts` (one session, several courts) instead of extending `blackouts`, which are written directly and never checked against bookings. Sessions and bookings check each other under a per-court advisory lock taken in an earlier statement than the STABLE `validate_booking_slot` (RESEARCH M9 "Open play sessions"); the PayMongo revival takes it before its row lock, so it can't deadlock with `create_booking`. `get_availability` was dropped and recreated with `open_play_session_id`. Details: a title, free text and up to 3 https links. **Don't create sessions on production** until T9.11d's frontend is on `master`: the live grid would show them as blank disabled slots. |
| 2026-10-22 | Venue info (T9.11g; the user approved the plan, the map approach and lucide-react). `venue_settings.address` and `maps_query`; the embed is built from them (the Maps Embed API with `VITE_GOOGLE_MAPS_EMBED_KEY`, a referrer-restricted browser key, otherwise the keyless embed URL), and "Open in Google Maps" uses keyless Maps URLs. Social links are one row per platform, with an inline host check per platform. Info sections are admin-defined, reordered with `move_info_section`, and pre-filled with Waiver, Reminders and policies, Cancellation and refund policy, and House rules. Amenities are 15 built-in keys or custom names, shown in catalog order and then the custom ones as added, with lucide-react icons. URL checks are inline (no function), because admins write through RLS as `authenticated` (RESEARCH M9 "Venue info"). |
| 2026-10-23 | Close-out (T9.12; the user approved the plan). README screenshots come from `npm run screenshots` (`scripts/screenshots.mjs`), run against the **local** stack. It points its own Vite server at the local stack (`.env` targets the linked project), adds temporary demo data (generated court illustrations, never third-party photos; venue info; an open play session; a guest booking), saves phone (360px) and desktop PNGs to `docs/screenshots/`, and removes everything again. Seed demo photos stay out of `seed.sql` (the T6.7 question). Headless Chromium needs software GL to draw the embedded map. |
| 2026-10-25 | M10 research (T10.1; the user approved every recommendation in RESEARCH M10). **Picker:** `@daypicker/react` 10.0.2 (v10's new package name), no `timeZone` prop (values are venue dates, converted through `lib/time.ts`), loaded with `React.lazy` only when the calendar opens (measured +22.5 kB gzip JS, 2.2 kB CSS), with Today/Tomorrow quick picks. Open play uses date + start hour + duration within one operating day; **blackouts keep a From/Until date + hour range** over all 24 hours. **Grid:** keep the `<table>` and merge with `rowSpan`/`colSpan`; `get_availability` gains `block_key` (a 16-character sha256 of the booking id, the session id, or the blackout id). **Earnings:** "money came in" is the approved payment's `reviewed_at` for every method (no `received_at` column), counted by venue calendar date; hours by operating day; occupancy = sold ÷ (open − blackout), open play on its own line; weeks start on Monday; plain CSS bars with a table, no chart library. **CSV:** every field quoted, a `'` before formula characters, CRLF, a UTF-8 BOM, paged reads; contact details (phone, email) only when the admin ticks "Include contact details" (**off by default**, Data Privacy Act proportionality). |
| 2026-10-25 | Earnings RPC as built (T10.6; the user approved the plan). `get_earnings(from, to)` is **security definer** with an explicit `private.is_admin()` check (RESEARCH M10 said invoker, but the operating-day helpers are private, and the other admin RPCs work this way); execute for `authenticated` only. It returns one JSON object; occupancy (sold ÷ (open − blackout)) is worked out by the client. A year's range takes about 0.4 s locally. |
| 2026-10-25 | Dashboard earnings as built (T10.7). The section replaces "Today's takings" (same money rule, now any period). Periods are whole: Today, This week (Monday to Sunday), This month (the 1st to its last day), each compared with the same number of days just before ("yesterday", "last week", "the previous N days"); a custom range starts as the last 30 days. Occupancy is capped at 100%, since blackouts aren't checked against bookings, and only active courts count (said in the UI). The daily chart is a labelled bar per day (date, amount and hours as text), shown for ranges longer than a day. The future "Plotline fees" line has a place under the collected total. |
| 2026-10-25 | Rescheduling design (T10.1, for T10.9; the user's calls). Staff move bookings under the **walk-in slot rules** (they may move into the hour in progress and aren't limited by the booking window; everything else applies). A split creates a `source = 'moved'` continuation (₱0, no payments) that always points to the **root** booking. Cancelling a parent **doesn't cascade**: each part is cancelled on its own, and the cancel form warns that the moved part stays booked. The new enum values ship in their own migration first (Postgres can't use a value in the transaction that adds it). |
| 2026-10-18 | Emails and deploy (M8, T8.1): Resend from a verified domain (API for booking emails, SMTP for Supabase Auth; superseded on 2026-10-19, see the 2026-10-19 "Emails without a provider" row). A transactional outbox (`email_outbox`, filled by triggers) is drained by the `send-emails` Edge Function, run every minute by pg_cron + pg_net (URL and worker secret in Vault). Retries use backoff, at most 5 attempts, with the Resend idempotency key = outbox id. The guest link is only in the booking-created email, sent by the token-checked `email-guest-link` function, and the token is never stored. Deploy on Vercel (production from `master`, previews from branches, SPA rewrite), one Supabase project shared by previews and production, hosted Auth URLs set in the dashboard, and the production origin first in `PUBLIC_SITE_URL`. |
| 2026-10-16 | Walk-ins go straight to `confirmed` with `source = 'walk_in'` and an approved payment row (default cash) recorded by the admin. `payment_proofs` is generalized into `payments`. |

## 11. Open questions

- **Waiver acceptance (2026-10-21; closed 2026-10-23):** the user skipped it (T9.11j). The Waiver is an info section players can read; there's no acceptance checkbox or record. A new task would add one if the client asks.

The M9 questions (theme, overnight hours, sport order, court photos) were settled on 2026-10-20 (§10, RESEARCH M9). The palette was chosen in T9.1 (Court Green).

The T7.1 questions (checkout API, data model, late payments, hold interplay, local webhook testing) were settled on 2026-10-18 (§4, §6, §10).
