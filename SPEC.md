# Court Booking System — Product Spec

> Status: draft v0.4 (2026-10-16). Portfolio project: one realistic venue, simplified operations.

## 1. Overview

A web app for booking courts at **Claudex Courts**, a single multi-sport venue in the Philippines. Players (with or without an account) pick a court and time slots. They then pay outside the app (GCash, Maya or bank transfer) and upload a proof of payment. Staff review the proof and confirm the booking, or ask for the proof to be uploaded again.

### Goals

- Show real-time court availability and make double-booking impossible.
- Run the whole flow: browse → reserve → upload proof → admin confirms.
- Show good Supabase practice: Row Level Security (RLS) everywhere, database-enforced invariants, typed client.

### Non-goals (v1)

- Multiple venues or owners, online payment gateways, recurring bookings, memberships, refunds, native mobile apps, SMS notifications, a public demo login (the README uses screenshots and a video instead).

## 2. Roles

| Role       | Auth                                            | Can do                                                                                                                                                                             |
| ---------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guest**  | none                                            | View availability; create a booking with name, email and phone; view and manage _that_ booking through a private link; upload payment proof; cancel.                               |
| **Player** | Supabase Auth: Google OAuth or email + password | Everything a guest can do, plus see a "My bookings" history and have profile details prefilled. Their earlier guest bookings are attached to the account automatically (see §5.7). |
| **Admin**  | Supabase Auth, `profiles.role = 'admin'`        | Manage courts, rates, hours and blackouts; see all bookings; review payment proofs; confirm or reject proofs; cancel any booking; create walk-in bookings (§5.8).                  |

Admins are promoted manually in the database (no self-signup as admin).

## 3. Core concepts

- **Venue settings**: one row holding:
  - name (`Claudex Courts`), timezone (`Asia/Manila`) and currency (`PHP`)
  - slot length (60 min)
  - booking rules: booking window, payment hold, cancellation cutoff and maximum rejections
  - payment instructions: the GCash, Maya and bank account details shown to players
- **Court**: name, sport (`badminton` | `pickleball` | `basketball` | `tennis`), description, **default hourly rate**, active flag.
- **Rate table**: optional per-court price overrides for each day-of-week × hour slot. A slot with no override uses the court's default hourly rate.
- **Operating hours**: open and close time per day of week, for the whole venue.
- **Blackout**: a time range when a court (or every court, if `court_id` is null) can't be booked, e.g. maintenance or a tournament.
- **Slot**: a fixed 60-minute block inside operating hours, the same for every court. A booking covers 1 or more _consecutive_ slots on one court, on one day.
- **Booking**: a reservation for one court and time range, with a status, a human-readable reference code (e.g. `CB-7KQ2XD`) and a **source**: `online` (made by a player or guest) or `walk_in` (entered by an admin at the counter).
- **Payment**: a record of money paid toward a booking. It holds the method (`gcash` | `maya` | `bank_transfer` | `cash`), the amount, an optional transaction reference number and an optional proof file.
  - Online bookings: the player uploads the proof, and an admin reviews it. A booking can have several payment rows, one per attempt.
  - Walk-ins: the payment is recorded directly by an admin and is approved immediately.
  - Every `confirmed` booking has exactly one approved payment, so revenue reports and cash counts come from one table.

### Demo seed data

- Badminton: 4 courts
- Pickleball: 2 courts
- Basketball: 1 full court
- Tennis: 1 court
- Opening hours: 06:00–22:00 every day
- Pricing: peak overrides on weekday evenings and on weekends, to show the rate table in use

## 4. Booking lifecycle

```
            create
              │
              ▼
      ┌─────────────────┐  no proof before expires_at   ┌─────────┐
      │ pending_payment │ ─────────────────────────────▶│ expired │
      └─────────────────┘                               └─────────┘
          ▲       │ upload proof
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
- **Hold window**: a `pending_payment` booking expires after `payment_hold_minutes` (default **60**). Expiry is enforced lazily (availability queries ignore expired holds) and swept by a scheduled job (`pg_cron`) that sets status to `expired`.
- **Rejected proof**: the admin must give a reason, which is shown to the player.
  - First rejection: the booking goes back to `pending_payment` with a fresh hold window, and the player keeps the slot and can upload a new proof.
  - Second rejection (`max_rejections`, default **2**): the booking becomes `rejected` and the slot is freed.
- **Cancellation cutoff**: players and guests can cancel up to `cancel_cutoff_hours` (default **1**) before the start time. Admins can cancel at any time.

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
7. **Guest auto-claim.** When a player signs in with a **verified** email (Google accounts always have one; email + password accounts once confirmed), every guest booking whose `guest_email` matches and whose `user_id` is null is linked to that account through `user_id`. This runs in a `claim_guest_bookings()` RPC that the client calls after sign-in. The RPC is idempotent and only uses the email from the authenticated user's record (`auth.users`), never one sent by the client.
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
                  payment_instructions (text/markdown)
courts            id, name, sport, description, default_hourly_rate numeric, is_active, sort_order, created_at
court_rates       court_id, day_of_week (0–6), start_hour (0–23), price numeric
                  PK (court_id, day_of_week, start_hour)
operating_hours   day_of_week (0–6) PK, open_time, close_time, is_closed
blackouts         id, court_id (nullable = all courts), starts_at, ends_at, reason, created_by
                  (gist index on tstzrange(starts_at, ends_at))
bookings          id, reference_code unique, court_id, user_id (nullable),
                  guest_name, guest_email, guest_phone,
                  during tstzrange, total_amount numeric, status booking_status,
                  source ('online'|'walk_in') default 'online', created_by (admin, nullable),
                  rejection_count int default 0,
                  guest_token_hash, expires_at, cancelled_at, cancel_reason,
                  created_at, updated_at
                  EXCLUDE USING gist (court_id WITH =, during WITH &&) WHERE (status IN active)
payments          id, booking_id, method ('gcash'|'maya'|'bank_transfer'|'cash'),
                  amount numeric, reference_number (nullable), storage_path (nullable; proof file),
                  submitted_at, recorded_by (admin, nullable; set for walk-ins),
                  review_status ('pending'|'approved'|'rejected'), reviewed_by, reviewed_at, review_note
                  UNIQUE (booking_id) WHERE review_status = 'approved'
```

Storage: a private bucket called `payment-proofs`. Files live at `{booking_id}/{uuid}.{ext}`. Allowed types are jpg, png, webp and pdf, up to 5 MB.

### Access (RLS summary)

- `courts`, `court_rates`, `operating_hours`, `venue_settings`, `blackouts`: anyone can read; only admins can write.
- `bookings`: players read their own rows (`user_id = auth.uid()`); admins read and write all rows. **Nobody inserts directly.** Every write goes through RPCs.
- Public availability comes from an RPC that returns busy ranges and prices only, with no personal data.
- `payments` and the storage bucket: the booking owner and admins can read. Writes go through RPCs or an Edge Function.

### Server API (RPCs / Edge Functions)

| Name                                                                               | Who         | Purpose                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_availability(date, court_id?)`                                                | anyone      | Returns the slots for each court on that date, each with free or busy and its price.                                                                                                                          |
| `create_booking(court_id, start, slots, guest_info?)`                              | anyone      | Validates the rules, computes the price, inserts the booking and returns `{id, reference_code, guest_token?}`.                                                                                                |
| `get_guest_booking(reference_code, token)`                                         | guest       | Returns one booking with its proofs and rejection notes, after checking the token against its hash.                                                                                                           |
| `cancel_booking(id \| ref+token)`                                                  | owner/admin | Applies the cutoff rule and sets the status.                                                                                                                                                                  |
| `submit_payment_proof` (Edge Function)                                             | owner/guest | Only allowed while the booking is `pending_payment`. Checks ownership or the guest token, returns a signed upload URL, and records the proof. The status changes to `payment_submitted`.                      |
| `review_payment(booking_id, approve, note)`                                        | admin       | Approve: the status becomes `confirmed`. Reject: increments `rejection_count`, then sets `pending_payment` with a new `expires_at`, or `rejected` if the limit is reached. A note is required when rejecting. |
| `create_walk_in(court_id, start, slots, name, phone?, method, amount, reference?)` | admin       | Creates a confirmed walk-in booking and its approved payment in one transaction (§5.8).                                                                                                                       |
| `claim_guest_bookings()`                                                           | player      | Links matching guest bookings to the signed-in, email-verified user (§5.7).                                                                                                                                   |

Guest access uses a random token. It is shown once (in the confirmation page link and email) and stored only as a hash.

## 7. Pages (React Router)

| Route               | Access             | Content                                                                                                                                  |
| ------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                 | public             | Venue info, courts grouped by sport, "Book now".                                                                                         |
| `/book`             | public             | Date picker and sport filter, then a court × time slot grid with the price per slot, then select consecutive slots.                      |
| `/book/checkout`    | public             | Summary and total price. Guest form (name, email, phone) or prefilled for a logged-in player. Confirm.                                   |
| `/booking/:ref`     | owner or `?token=` | Status, payment instructions, countdown to expiry, proof upload, rejection reason and re-upload, cancel button.                          |
| `/login`, `/signup` | public             | "Continue with Google" and email + password.                                                                                             |
| `/me/bookings`      | player             | Upcoming and past bookings, including claimed guest bookings.                                                                            |
| `/admin`            | admin              | Dashboard: today's schedule, proofs waiting for review, a "+ Walk-in" quick action, and today's takings by method.                       |
| `/admin/bookings`   | admin              | Filterable list (status, source, date). Review a proof (image or PDF preview, amount-mismatch warning), approve or reject with a reason. |
| `/admin/courts` | admin | Court list with an "Add court" button. |
| `/admin/courts/:id` | admin | Edit or archive a court (`new` creates one). Weekly rate grid editor (day × hour) with a "fill a range" helper. |
| `/admin/schedule`   | admin              | Operating hours and blackouts.                                                                                                           |
| `/admin/settings`   | admin              | Venue settings and payment instructions.                                                                                                 |

The UI is mobile-first: most players will book from a phone.

## 8. Notifications (stretch)

Email on booking created (with the guest link), payment confirmed, proof rejected (with the reason and the re-upload link) and cancelled. Use Supabase Auth emails for auth and an Edge Function plus Resend for booking emails. Until that is built, the confirmation page shows the private link with a "save this link" prompt.

## 9. Milestones

1. ✅ **Foundation**: Supabase project linked, migrations folder, generated types, layout, routing, auth (Google + email/password), `profiles` and role.
2. ✅ **Catalog**: courts, rate table, operating hours and venue settings, with admin CRUD (including the rate grid editor) and the public home page. Seed data.
3. **Booking**: `get_availability` with prices, the slot grid, `create_booking` with the exclusion constraint and pricing, and the booking detail page.
4. **Payments**: storage bucket, proof upload, admin review queue with the reject → re-upload loop, expiry job, walk-in flow.
5. **Accounts**: My bookings, cancellation, guest token flow hardened, `claim_guest_bookings`.
6. **Polish**: emails, empty, loading and error states, a11y pass, deploy (e.g. Vercel + Supabase), README screenshots and a demo video.

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
| 2026-10-16 | Walk-ins go straight to `confirmed` with `source = 'walk_in'` and an approved payment row (default cash) recorded by the admin. `payment_proofs` is generalized into `payments`. |

## 11. Open questions

- None right now.
