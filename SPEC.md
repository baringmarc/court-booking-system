# Court Booking System — Product Spec

> Status: draft v0.11 (2026-10-19, M7 done; M8 polish in progress; M9 venue admin upgrades added). Portfolio project: one realistic venue, simplified operations.

## 1. Overview

A web app for booking courts at **Claudex Courts**, a single multi-sport venue in the Philippines. Players (with or without an account) pick a court and time slots. They then pay outside the app (GCash, Maya or bank transfer) and upload a proof of payment. Staff review the proof and confirm the booking, or ask for the proof to be uploaded again. *Planned for M7:* players can instead **pay online through PayMongo** (test mode, hosted checkout), which confirms the booking automatically. Staff work in a separate admin area with its own layout and login.

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
| **Admin**  | Supabase Auth, `profiles.role = 'admin'`        | Manage courts, rates, hours and blackouts; see all bookings; review payment proofs; confirm or reject proofs; cancel any active booking until it ends (§4); create walk-in bookings (§5.8).                  |

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
  2. Hold lapsed (`pending_payment` past `expires_at`, or `expired`), but the slot hasn't started, the court is still active, no blackout covers it and nobody else holds it: the booking is `confirmed` again.
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
   - start and end on the same day (in the venue timezone)
   - stay inside that day's operating hours
   - not touch a blackout
   - line up with slot boundaries

   There is no other limit on length. These checks live in the `create_booking` RPC.

   *Planned for M9:* opening hours may run **past midnight or around the clock** (e.g. 6:00 AM to 5:00 AM, or 24 hours). The plan is an **operating day**: a slot belongs to the day whose opening it follows. A 1:00 AM slot after a 6:00 AM opening belongs to the previous date, and `/book` shows it under that date. "One day" in this rule then means one operating day. The details (pricing per hour, the booking window, blackouts, walk-in "today", the dashboard) are an open question (§11) for M9 research.

3. **Booking window.** Bookings can be made from now up to `booking_window_days` ahead (default **30**). Slots that have already started can't be booked.
4. **Pricing.** The price is calculated **on the server**:
   - Add up the price of each 1-hour slot in the booking.
   - For each slot, use the `court_rates` entry for that day of week and hour if there is one, otherwise the court's `default_hourly_rate`.
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

   Walk-ins still respect the no-overlap rule, operating hours and blackouts. They skip the booking window and **may start in the slot that is currently in progress**. "Play now, pay later" is out of scope for v1.

## 6. Data model (Supabase / Postgres)

```
-- day_of_week: 0 = Sunday … 6 = Saturday (matches JS getDay / Postgres extract(dow))
profiles          id (= auth.users.id) PK, full_name, phone, role ('player'|'admin'), created_at
venue_settings    id (singleton), name, timezone, currency, slot_minutes (60), booking_window_days (30),
                  payment_hold_minutes (60), cancel_cutoff_hours (1), max_rejections (2),
                  payment_instructions (text/markdown),
                  banner_path (nullable), banner_alt (nullable)   -- M6; CHECK banner_path under 'banner/'; set together;
                                                                  -- alt stored trimmed, 1–200 chars
courts            id, name, sport, description, default_hourly_rate numeric, is_active, sort_order,
                  photo_path (nullable; M6; CHECK under 'courts/{id}/'), created_at
court_rates       court_id, day_of_week (0–6), start_hour (0–23), price numeric
                  PK (court_id, day_of_week, start_hour)
operating_hours   day_of_week (0–6) PK, open_time, close_time, is_closed
blackouts         id, court_id (nullable = all courts), starts_at, ends_at, reason, created_by
                  (gist index on tstzrange(starts_at, ends_at))
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
- `bookings`: players read their own rows (`user_id = auth.uid()`); admins read and write all rows. **Nobody inserts directly.** Every write goes through RPCs.
- Public availability comes from an RPC that returns busy ranges and prices only, with no personal data. *Planned for M9 (the user's call):* a booked slot also shows the booker's **first name only** (the first word of the booking's contact name, shortened). No email, phone, surname or reference code is exposed. Admin views show the full name.
- `payments` and the storage bucket: the booking owner and admins can read. Writes go through RPCs or an Edge Function.
- `email_outbox` (M8): only admins can read (players can't, not even for their own bookings); anon has no access. Only the trigger and service-role RPCs write.
- `venue-media` bucket (M6): anyone can read through public URLs (there's no anon or player SELECT policy, so files can't be listed); only admins (`private.is_admin()`) can select, insert, update or delete, and uploads must go under `courts/` or `banner/`. `courts.photo_path` and the banner columns are written through the existing admin-only RLS on `courts` and `venue_settings`.

### Server API (RPCs / Edge Functions)

| Name                                                                               | Who         | Purpose                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_availability(date, court_id?)`                                                | anyone      | Returns the slots for each court on that date, each with free or busy and its price.                                                                                                                          |
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
| `claim_guest_bookings()`                                                           | player      | Links matching guest bookings to the signed-in, email-verified user (§5.7).                                                                                                                                   |

Guest access uses a random token. It is shown once (in the confirmation page link and email) and stored only as a hash. The link carries it in the URL **fragment** (`/booking/:ref#token=…`), which browsers never send to servers. Old `?token=` links are rewritten to the fragment. A guest link stops working 30 days after the booking ends (same "not found" response). If the link is lost, the guest can sign up or log in with the booking's email to see the booking in My bookings. "Email me a new link" is out of scope (decided in M8): emails can't re-issue a token, because only its hash is stored. There is no lookup throttle, because a 256-bit token can't be guessed (RESEARCH M5).

## 7. Pages (React Router)

| Route               | Access             | Content                                                                                                                                  |
| ------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                 | public             | Site banner when set (M6), venue info, courts grouped by sport (with each court's photo, or a sport placeholder; M6), "Book now".       |
| `/book`             | public             | Date picker and sport filter, a collapsed "About the … courts" panel with each court's photo (or sport placeholder) and description (M6), then a court × time slot grid with the price per slot, then select consecutive slots. |
| `/book/checkout`    | public             | Summary and total price. Guest form (name, email, phone) or prefilled for a logged-in player. Confirm.                                   |
| `/booking/:ref`     | owner or `#token=` | Status, payment instructions, countdown to expiry, "Pay online with PayMongo" (M7) next to proof upload, rejection reason and re-upload, cancel button. After PayMongo: `?paid=1` polls every 3 s until the webhook confirms (then "Payment received"; a refund note if the payment wasn't accepted). After 90 s it says so and keeps checking every 30 s. `?paid=0` says it was cancelled. The return moves from the URL into history state, so copied links don't replay it. A guest's token is kept in `sessionStorage` across the redirect and restored to the fragment. Staff viewing a booking without its link get no Pay online button. |
| `/login`, `/signup` | public             | "Continue with Google" and email + password.                                                                                             |
| `/me/bookings`      | player             | Upcoming and past bookings, including claimed guest bookings.                                                                            |
| `/admin/login`      | public             | Admin sign-in in the admin shell: email + password only, with no Google sign-in and no sign-up (admins are promoted in the database, §2). A signed-in non-admin is refused ("Admins only", with Log out). |
| `/admin`            | admin              | Dashboard: today's schedule, proofs waiting for review, a "+ Walk-in" quick action, and today's takings by method (PayMongo as its own line, M7). PayMongo money received but not accepted is shown apart from the total, for a refund outside the app. |
| `/admin/bookings`   | admin              | Filterable list (status, source, date). Review a proof (image or PDF preview, amount-mismatch warning), approve or reject with a reason. PayMongo payments (M7) show in the panel with source, PayMongo id and paid time, and have no review actions. Rows and the panel flag "Refund due" (paid online but not accepted) and "Check duplicate" (a proof closed because the customer also paid online). |
| `/admin/courts` | admin | Court list with an "Add court" button. |
| `/admin/courts/:id` | admin | Edit or archive a court (`new` creates one). Weekly rate grid editor (day × hour) with a "fill a range" helper. Court photo upload, replace and remove (M6). |
| `/admin/schedule`   | admin              | Operating hours and blackouts.                                                                                                           |
| `/admin/settings`   | admin              | Venue settings and payment instructions. Site banner upload with alt text, and remove (M6).                                              |

The UI is mobile-first: most players will book from a phone.

**Site banner (M6).** When the venue has a banner, the **home page** (`/`) shows it just below the header, before the page content. Other pages never show it. It's an image with alt text only (no headline or link). Without one (or while settings load or fail), the section isn't rendered at all.

**Admin shell.** Every `/admin/*` route renders in its own `AdminLayout` (admin nav, no public header, footer or booking nav), not inside the public `Layout`. The public header has no Admin link; staff go to `/admin` directly, and unauthenticated visits redirect to `/admin/login` and return to the requested page after sign-in. The shell only controls what is shown: admin access itself is enforced in the database (`profiles.role` can't be changed by users, and every admin read and write checks `private.is_admin()`). It is still one Vite app, and admin code stays lazy-loaded out of the public bundle.

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
8. **Polish**: emails, empty, loading and error states, an a11y pass (including distinct slot status colors and the settings page spacing), and deploy (Vercel + Supabase). Deploy happens here so later work ships automatically.
9. **Venue admin upgrades** (added 2026-10-19):
   - a new theme and colors (the palette is chosen from a preview)
   - court and sport ordering
   - deleting never-booked courts
   - several photos per court
   - booker first names on booked slots (public), with full names in an admin day view
   - opening hours past midnight and 24 hours
   - then the README, screenshots, a demo video and close-out (moved from M8)

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
| 2026-10-18 | Emails and deploy (M8, T8.1): Resend from a verified domain (API for booking emails, SMTP for Supabase Auth; superseded on 2026-10-19, see the row above). A transactional outbox (`email_outbox`, filled by triggers) is drained by the `send-emails` Edge Function, run every minute by pg_cron + pg_net (URL and worker secret in Vault). Retries use backoff, at most 5 attempts, with the Resend idempotency key = outbox id. The guest link is only in the booking-created email, sent by the token-checked `email-guest-link` function, and the token is never stored. Deploy on Vercel (production from `master`, previews from branches, SPA rewrite), one Supabase project shared by previews and production, hosted Auth URLs set in the dashboard, and the production origin first in `PUBLIC_SITE_URL`. |
| 2026-10-16 | Walk-ins go straight to `confirmed` with `source = 'walk_in'` and an approved payment row (default cash) recorded by the admin. `payment_proofs` is generalized into `payments`. |

## 11. Open questions

For M9 (added 2026-10-19):

1. **Theme:** which palette? It's chosen from a preview of 3–4 options on real screens (slot grid, buttons, badges), in light and dark mode, with contrast checked.
2. **Overnight and 24-hour hours:**
   - how to store them (for example a close time not after the open time means "next day", and open = close means 24 hours)
   - which date and day of week an after-midnight slot is priced under
   - how the booking window, blackouts, the walk-in form's "today" and the dashboard's "today" use the operating day
3. **Sport order:** stored in `venue_settings` or in a small `sports` table.
4. **Court photos:** the most per court (e.g. 6), and whether the first photo is the cover or the admin picks one.

The T7.1 questions (checkout API, data model, late payments, hold interplay, local webhook testing) were settled on 2026-10-18 (§4, §6, §10).
