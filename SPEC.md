# Court Booking System — Product Spec

> Status: draft v0.9 (2026-10-18, M6 done; next: M7 PayMongo, then M8 polish). Portfolio project: one realistic venue, simplified operations.

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
- **Payment**: a record of money paid toward a booking. It holds the method (`gcash` | `maya` | `bank_transfer` | `cash`), the amount, an optional transaction reference number and an optional proof file.
  - Online bookings, PayMongo (*planned, M7*): the player pays on PayMongo's hosted checkout. A verified PayMongo webhook records an approved payment and confirms the booking; no admin review. (Exact columns and the `method` value are decided in T7.1.)
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
- **PayMongo** (*planned, M7*): the player can start a checkout only while the booking is `pending_payment` and its hold hasn't expired. The verified `checkout_session.payment.paid` (or equivalent) webhook confirms it. A payment that arrives after the hold expired or the slot was lost is handled as decided in T7.1 (refunds stay a non-goal).
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
payments          id, booking_id, method ('gcash'|'maya'|'bank_transfer'|'cash'),
                  amount numeric, reference_number (nullable), storage_path (nullable; proof file),
                  submitted_at, recorded_by (admin, nullable; set for walk-ins),
                  review_status ('pending'|'approved'|'rejected'), reviewed_by, reviewed_at, review_note
                  UNIQUE (booking_id) WHERE review_status = 'approved'
                  UNIQUE (booking_id) WHERE review_status = 'pending'   -- one attempt awaits review at a time
                  CHECK rejected => review_note present; CHECK storage_path under '{booking_id}/'
```

Storage: a private bucket called `payment-proofs`. Files live at `{booking_id}/{uuid}.{ext}`. Allowed types are jpg, png, webp and pdf, up to 5 MB.

A **public** bucket called `venue-media` holds court photos (`courts/{court_id}/{uuid}.{ext}`) and the banner (`banner/{uuid}.{ext}`) (M6). Anyone can read it through public URLs (no listing); only admins can write. Allowed types are jpg, png and webp, up to 2 MB after the browser downscales the image (court photos at most 1600 px wide, the banner at most 2200 px, re-encoded as WEBP with a JPEG fallback). A replaced image gets a new file name (cached for a year) and the old file is deleted. Public photos are lazy-loaded at 16:9 with fixed dimensions, and a missing or failed photo shows a sport placeholder.

### Access (RLS summary)

- `courts`, `court_rates`, `operating_hours`, `venue_settings`, `blackouts`: anyone can read; only admins can write.
- `bookings`: players read their own rows (`user_id = auth.uid()`); admins read and write all rows. **Nobody inserts directly.** Every write goes through RPCs.
- Public availability comes from an RPC that returns busy ranges and prices only, with no personal data.
- `payments` and the storage bucket: the booking owner and admins can read. Writes go through RPCs or an Edge Function.
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
| `create-paymongo-checkout` (Edge Function, M7)                                    | owner/guest | Same payable check and ownership/guest-token check as `submit-payment-proof`. Creates a PayMongo (test mode) checkout session for the booking's stored `total_amount` (never a client amount) and returns its URL. |
| `paymongo-webhook` (Edge Function, M7)                                            | PayMongo    | Verifies the webhook signature, is idempotent per PayMongo event/payment id, records the approved payment and confirms the booking through a service-role-only RPC under a row lock. |
| `claim_guest_bookings()`                                                           | player      | Links matching guest bookings to the signed-in, email-verified user (§5.7).                                                                                                                                   |

Guest access uses a random token. It is shown once (in the confirmation page link and email) and stored only as a hash. The link carries it in the URL **fragment** (`/booking/:ref#token=…`), which browsers never send to servers. Old `?token=` links are rewritten to the fragment. A guest link stops working 30 days after the booking ends (same "not found" response). If the link is lost, the guest can sign up or log in with the booking's email to see the booking in My bookings. "Email me a new link" waits for emails (M8). There is no lookup throttle, because a 256-bit token can't be guessed (RESEARCH M5).

## 7. Pages (React Router)

| Route               | Access             | Content                                                                                                                                  |
| ------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                 | public             | Site banner when set (M6), venue info, courts grouped by sport (with each court's photo, or a sport placeholder; M6), "Book now".       |
| `/book`             | public             | Date picker and sport filter, a collapsed "About the … courts" panel with each court's photo (or sport placeholder) and description (M6), then a court × time slot grid with the price per slot, then select consecutive slots. |
| `/book/checkout`    | public             | Summary and total price. Guest form (name, email, phone) or prefilled for a logged-in player. Confirm.                                   |
| `/booking/:ref`     | owner or `#token=` | Status, payment instructions, countdown to expiry, proof upload, rejection reason and re-upload, cancel button.                          |
| `/login`, `/signup` | public             | "Continue with Google" and email + password.                                                                                             |
| `/me/bookings`      | player             | Upcoming and past bookings, including claimed guest bookings.                                                                            |
| `/admin/login`      | public             | Admin sign-in in the admin shell: email + password only, with no Google sign-in and no sign-up (admins are promoted in the database, §2). A signed-in non-admin is refused ("Admins only", with Log out). |
| `/admin`            | admin              | Dashboard: today's schedule, proofs waiting for review, a "+ Walk-in" quick action, and today's takings by method.                       |
| `/admin/bookings`   | admin              | Filterable list (status, source, date). Review a proof (image or PDF preview, amount-mismatch warning), approve or reject with a reason. |
| `/admin/courts` | admin | Court list with an "Add court" button. |
| `/admin/courts/:id` | admin | Edit or archive a court (`new` creates one). Weekly rate grid editor (day × hour) with a "fill a range" helper. Court photo upload, replace and remove (M6). |
| `/admin/schedule`   | admin              | Operating hours and blackouts.                                                                                                           |
| `/admin/settings`   | admin              | Venue settings and payment instructions. Site banner upload with alt text, and remove (M6).                                              |

The UI is mobile-first: most players will book from a phone.

**Site banner (M6).** When the venue has a banner, the **home page** (`/`) shows it just below the header, before the page content. Other pages never show it. It's an image with alt text only (no headline or link). Without one (or while settings load or fail), the section isn't rendered at all.

**Admin shell.** Every `/admin/*` route renders in its own `AdminLayout` (admin nav, no public header, footer or booking nav), not inside the public `Layout`. The public header has no Admin link; staff go to `/admin` directly, and unauthenticated visits redirect to `/admin/login` and return to the requested page after sign-in. The shell only controls what is shown: admin access itself is enforced in the database (`profiles.role` can't be changed by users, and every admin read and write checks `private.is_admin()`). It is still one Vite app, and admin code stays lazy-loaded out of the public bundle.

## 8. Notifications (stretch)

Email on booking created (with the guest link), payment confirmed, proof rejected (with the reason and the re-upload link) and cancelled. Use Supabase Auth emails for auth and an Edge Function plus Resend for booking emails. Until that is built, the confirmation page shows the private link with a "save this link" prompt.

## 9. Milestones

1. ✅ **Foundation**: Supabase project linked, migrations folder, generated types, layout, routing, auth (Google + email/password), `profiles` and role.
2. ✅ **Catalog**: courts, rate table, operating hours and venue settings, with admin CRUD (including the rate grid editor) and the public home page. Seed data.
3. ✅ **Booking**: `get_availability` with prices, the slot grid, `create_booking` with the exclusion constraint and pricing, and the booking detail page.
4. ✅ **Payments**: storage bucket, proof upload, admin review queue with the reject → re-upload loop, expiry job, walk-in flow, admin dashboard.
5. ✅ **Admin shell and accounts**: separate admin layout and login; My bookings, cancellation, guest token flow hardened, `claim_guest_bookings`.
6. ✅ **Venue media**: court photos and an optional site banner, uploaded by admins.
7. **Online payments**: PayMongo (test mode) checkout with webhook auto-confirm, alongside manual proof.
8. **Polish**: emails, empty, loading and error states, a11y pass, deploy (e.g. Vercel + Supabase), README screenshots and a demo video.

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
| 2026-10-16 | Walk-ins go straight to `confirmed` with `source = 'walk_in'` and an approved payment row (default cash) recorded by the admin. `payment_proofs` is generalized into `payments`. |

## 11. Open questions

To be settled in T7.1 (PayMongo research, M7):
- Checkout Sessions (hosted) vs Payment Intents. Hosted checkout is the working assumption.
- How a PayMongo payment is stored in `payments` (a new `method` value or a provider column, plus the PayMongo ids), and how it interacts with the "one pending attempt" and "one approved payment" constraints.
- Late payment: PayMongo reports a payment after the hold expired, the booking was cancelled, or a proof was already approved.
- Whether a checkout session's expiry can be matched to `expires_at`, and whether starting a checkout extends the hold.
- Testing webhooks locally (no public URL): signed fake events in the smoke and e2e tests.
