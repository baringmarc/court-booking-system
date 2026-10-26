# Plotline SaaS plan

> Status: **planning, not approved scope** (last updated 2026-10-25). Once it's agreed, turn each phase into a milestone in TASKS.md (research → migrations → UI → close out), the way M3–M9 were run. Prices and landing page copy aren't final.

## 1. Product and business model

- **Plotline** is a court booking platform for venues in the Philippines.
  - `court-booking-system` is the product, today a single-venue demo (Claudex Courts).
  - `plotline-site` is the marketing site.
- **No self-serve signup and no free trial.** Interested owners fill in a contact form on the marketing site. We talk with them, then set up their venue and invite them.
- **Pricing (2026-10-25; amounts not final):** commission only, **₱5 per billable court-hour**, for every court, sport and venue size. No subscription and no setup fee; no setup fee is the edge over competitors.
- **Two ways a venue's players pay:**
  - **PayMongo venues:** the venue is onboarded as a **child account under Plotline's PayMongo platform account**. Every online checkout splits automatically: ₱5 × hours to Plotline, the rest to the venue.
  - **Manual venues:** players upload a proof of a GCash, Maya or bank payment made to the venue's own details.
- **Commission collection:**
  - PayMongo-paid hours are collected by the split.
  - Every other billable hour is invoiced monthly: manual proofs, walk-ins, open play, and PayMongo payments whose split failed or was reversed.
  - So a PayMongo venue still gets a monthly invoice for its walk-ins and open play.
- **Venues pay their invoices** by GCash or bank transfer: 7 days' grace, then suspension.

## 2. Architecture

| Host | What | Runs on |
| --- | --- | --- |
| `plotline.ph` (+ `www`) | Marketing site (`plotline-site`) | Cloudflare Workers, static assets (free) |
| `<slug>.plotline.ph` | A venue's booking site; `/admin` is its staff area | Cloudflare Workers, the `court-booking-system` build, through the wildcard route `*.plotline.ph/*` (free) |
| `app.plotline.ph` | Platform console (us): venues, owners, invoices | Same build as the venues; the hostname decides the mode |
| `claudex.plotline.ph` | Venue #1: Claudex Courts, the demo venue on production, demo data reset nightly (`demo.` can redirect to it) | Same build |
| Supabase **production** | New project, Singapore (`ap-southeast-1`). App data plus the marketing site's leads and reviews | Free until the first paying venue, then Pro |
| Supabase **staging** | The current `court-booking-system` project (Singapore) | Free |
| Email | Auth emails and booking emails from our domain | Resend or Brevo free tier, through custom SMTP |
| DNS and TLS | Cloudflare DNS, with a proxied wildcard record `*.plotline.ph`; Universal SSL covers the root and `*.plotline.ph` | Free |
| Backups | Nightly `pg_dump` of production, kept outside Supabase | GitHub Action (free) |

- **Domain:** not bought yet. First choice `plotline.ph`, then `plotline.app`, then `plotlinecourts.com` or `getplotline.com`. Buy it at any registrar and point the nameservers to Cloudflare. Note: a funded company already uses the Plotline name at plotline.so, in another industry.
- **Reserved subdomains:** `www`, `app`, `api`, `admin`, `demo`, `staging`, `mail`, `help`, `blog`, `status`, `support`.
- **Why not Vercel:** the Hobby plan is non-commercial only, and Plotline both takes payments and advertises a product. Pro is about $20 a month per member. Cloudflare's free plan allows commercial use.
- **Why not Supabase Free long-term:** no backups or point-in-time recovery, 500 MB database and 1 GB storage (payment proofs and photos add up), and inactive projects pause. Our own nightly dump covers backups until we upgrade.
- **One production project, not two:** the free plan allows 2 active projects (production and staging). Plotline-site hasn't been deployed, so its tables move into production.

## 3. Decisions log

| Date | Decision |
| --- | --- |
| 2026-10-24 | One shared database with a `venue_id` on every row, enforced by RLS. No project per venue. The tenant table is `venues`. |
| 2026-10-24 | Venue URLs are subdomains (`smash-arena.plotline.ph`) from the start. The root domain is the marketing site. |
| 2026-10-24 | Host on Cloudflare (free). Supabase production in Singapore. The current project becomes staging and demo. |
| 2026-10-24 | Supabase Pro from the first paying venue. |
| 2026-10-24 | No self-serve signup and no free trial. A contact form, then we set up the venue and invite the owner. |
| 2026-10-24 | ~~Each venue uses its own PayMongo account.~~ Replaced on 2026-10-25 by child accounts under Plotline's platform. |
| 2026-10-24 | Billable hours are confirmed bookings, including those cancelled after confirmation. Rejected proofs aren't monitored: rejecting reopens the slot, so it costs the venue. |
| 2026-10-24 | ~~₱499 capped at 2 active courts; plan by the month's highest court count.~~ Replaced on 2026-10-25. |
| 2026-10-24 | One owner can manage several venues (branches); each is its own venue, billed separately. |
| 2026-10-24 | Venues pay by GCash or bank transfer against an invoice: 7 days' grace, then suspension. |
| 2026-10-24 | The demo is a real venue on production, reset nightly. Since 2026-10-25 it's Claudex Courts at `claudex.<domain>`. |
| 2026-10-24 | Pilot invoices may go to personal accounts. Register as a sole proprietor (DTI business name, BIR) before invoicing for real. |
| 2026-10-24 | Walk-ins are billable. They're already confirmed bookings, so they need no extra tracking. The walk-in form stays. |
| 2026-10-24 | A booking is billed in the month it was confirmed. |
| 2026-10-24 | No pilot venue yet. Build first, starting with Phase 1. |
| 2026-10-25 | **Replaces the ₱499 plan and the 2-court cap:** commission only, with no setup fee. |
| 2026-10-25 | The rate is ₱5 per court-hour for every court and sport. |
| 2026-10-25 | Hybrid collection: PayMongo split payments for venues that onboard with PayMongo (child accounts under Plotline's platform), a monthly invoice for everything else. No prepaid credits. |
| 2026-10-25 | Every confirmed hour is billable whatever the payment method: PayMongo, manual proof or walk-in. |
| 2026-10-25 | Open play is billed per court-hour. |
| 2026-10-25 | PayMongo is offered only through Plotline's platform account. A venue's own standalone PayMongo account isn't supported (not two integrations). |
| 2026-10-25 | Open play is charged when the session starts. |
| 2026-10-25 | Every venue is invoiced every month, whatever the amount (no threshold). |
| 2026-10-25 | A venue that wants PayMongo must complete PayMongo's own verification (KYC) as a child account under Plotline. Venues that can't, or don't want to, use manual proofs. |
| 2026-10-25 | End state: the marketing site on the main domain, the product serving every venue on subdomains. Claudex Courts (the current demo) is venue #1, e.g. `claudex.plotline.app`. Both sites' design and features will still change. |

## 4. Open questions

1. **PayMongo Platforms** (Marc to ask PayMongo sales; this blocks only Phase 4):
   - requirements for Plotline as the platform, and whether a sole proprietor qualifies;
   - requirements for venues as child accounts;
   - whether a venue's existing PayMongo account can be linked, or a new child account is needed;
   - Payment Splitting (being deprecated) vs Workflows, and whether either works with Checkout Sessions and a fixed platform fee;
   - pricing, payout timing, refunds (can they come from the venue's share only?), and whether the webhook reports the split result.
2. Domain: `.ph` or `.app`, after checking availability.
3. Demo slug: `claudex` only, or `demo` as well, redirecting to it?

## 5. Billing rules

**What's billable (₱5 per court-hour, rate snapshotted on each charge):**

| Event | Billable hours | When it's charged | How it's collected |
| --- | --- | --- | --- |
| Online booking paid through PayMongo | The booking's hours | When it's confirmed (webhook) | Split at checkout |
| Online booking paid by manual proof | The booking's hours | When staff approve the proof | Monthly invoice |
| Walk-in | The booking's hours | When it's created (it's confirmed at once) | Monthly invoice |
| Open play session | Courts × hours | When the session starts, through pg_cron (deleting it before then costs nothing) | Monthly invoice |
| Confirmed, then cancelled | Still billable | Already charged | Unchanged |
| Proof rejected, hold expired, never confirmed | Not billable | | |
| Late PayMongo payment for an expired hold (refund due) | Not billable | | The split share goes back with the refund |
| Blackouts | Not billable | | |

**Notes:**
- **One rate everywhere removes the incentive to steer players.** Manual and PayMongo cost the venue the same ₱5, so it gains nothing by pushing players to GCash instead.
- **Loopholes we accept:**
  - Not recording walk-ins, which brings back double bookings.
  - Rejecting a proof after collecting the money, which reopens the slot.
  - Using a free blackout instead of open play, which hides the session from players.

  Each one costs the venue more than ₱5.
- **The split is fixed when the checkout is created:** ₱5 × hours, in centavos. PayMongo's fee comes off before the split, so the venue's share absorbs the whole fee. Splits that exceed the net amount fail silently, so the webhook and a monthly reconciliation must catch a missing split.
- **Refunds done in PayMongo** take back Plotline's share in proportion, by default. For a confirmed booking that's later refunded, the hours stay billable, so the reversed ₱5 becomes an invoice line. Better: ask PayMongo whether refunds can come from the venue's share only (`refund_sources`).

**Data:**
- **`bookings.confirmed_at`:** set the first time a booking becomes `confirmed`. Backfill it from the approved payment.
- **`billing_charges` ledger, one row per billable event:**
  - `venue_id`, `booking_id` or `open_play_session_id` (unique), `hours`, `rate`, `amount`, `charged_at`, `billing_month`.
  - `collection` (`split` | `invoice`), `payment_id` for splits, `split_status` (`pending` | `collected` | `failed` | `reversed`), `invoice_id`.
  - Written by triggers and RPCs inside the same transaction that confirms the booking or starts the session.
  - Charges are never deleted. A correction is a new adjustment row.
- **`platform_pricing`:** the rate and the grace days, stored as data.
- **`venues`:** `paymongo_child_merchant_id`, `paymongo_status` (`none` | `onboarding` | `active`), and `collection_note`.

**Invoices and statements:**
- **Draft invoice.** A pg_cron job on the 1st creates a draft per venue: every `invoice` charge, plus split charges that failed or were reversed. We review it, send it, and mark it paid by hand (method and reference).
- **Statement in the venue's admin area.** This month so far: hours collected by split, hours to be invoiced, the running total. Past invoices. Each line links to its booking, so disputes are easy.
- **Monthly reconciliation.** Compare the split charges against PayMongo's split report.
- **Suspension.** Manual, by us, after 7 days' grace:
  - The public site stops taking new bookings.
  - Existing bookings are still honored.
  - The admin area keeps working.

## 6. Where the current code is single-venue

- **Database.**
  - `venue_settings` is a singleton, read without a filter by about 20 functions: `create_booking`, `create_walk_in`, `review_payment`, `cancel_booking`, `get_availability`, `get_guest_booking`, the open play RPCs, `private.local_today()`, `private.operating_today()` and the email outbox trigger.
  - `operating_hours` (PK `day_of_week`), `venue_social_links` (PK `platform`), `venue_amenities` (unique keys), `venue_info_sections` (`sort_order` renumbered across the whole table), `blackouts` (`court_id is null` = every court) and `sport_order` are all keyed as if there's one venue.
  - Admin is global: `profiles.role = 'admin'` and `private.is_admin()`.
- **Storage.** `venue-media` paths (`courts/…`, `banner/…`) clash across venues. Admin writes check only `is_admin()`.
- **Edge Functions.**
  - PayMongo uses one global key and webhook secret.
  - The `PUBLIC_SITE_URL` allow-list holds exact origins.
  - Email data takes the venue from the singleton.
- **Frontend.**
  - The router has no venue concept.
  - `features/*/api.ts` read the singleton and every row.
  - `AdminGuard` checks the global role.
  - `GoogleButton` builds `redirectTo` from `window.location.origin`, which works with subdomains once Supabase allows `https://*.plotline.ph/**`.
- **Ops.** Vercel-specific `vercel.json`. Previews share production data. SPEC §1 lists multiple venues as a non-goal.
- **Already in place and kept:**
  - RLS everywhere with a coverage test
  - RPC-only booking writes and server-side prices
  - the exclusion constraint
  - timestamptz handling
  - hashed guest tokens
  - PayMongo and manual proofs
  - the email outbox
  - pg_cron jobs
  - pgTAP, Vitest and Playwright suites

## 7. Phases

### 7a. Before Phase 1: product improvements (M10)
Built on the current single-venue app first (approved 2026-10-25; breakdown in TASKS.md M10):
- a date and hour picker for open play, blackouts and `/book`;
- merged blocks on the slot grids (one cell per booking, open play session or blackout);
- an earnings section on the dashboard (collected per method, occupancy, a daily chart, coming up) and CSV export;
- staff-only rescheduling, including moving the rest of a booking that has already started.

### Phase 0: Accounts and groundwork (no code)
- [ ] Choose and buy the domain. Move its nameservers to Cloudflare.
- [ ] Create the Supabase production project in Singapore. Keep the current project as staging.
- [ ] Set up the email sender on the domain (SPF, DKIM, DMARC). Set it as custom SMTP on both projects.
- [ ] Turn on Cloudflare Turnstile for the contact form.
- [ ] Before the first real invoice: DTI business name, BIR registration, and a business GCash or bank account.
- [ ] Before the first PayMongo venue: Plotline's own PayMongo account, verified, with Platforms or splitting enabled by PayMongo support. This needs the registration above.

### Phase 1: Multi-venue database (largest phase)
Expand-then-contract migrations, as the M9 contract migration did.
- [ ] **`venues` table.**
  - Columns: `id`, `slug` (unique; `a-z0-9-`, 3–40 characters, not reserved), `status` (`draft` | `active` | `suspended` | `closed`), `created_at`.
  - Each venue gets one `venue_settings` row, keyed by `venue_id`. Only `active` venues are public. `draft` is visible to its staff and to us, for setup and preview.
- [ ] **`venue_members` table.**
  - Columns: `venue_id`, `user_id`, `role` (`owner` | `staff`).
  - Add `private.is_venue_admin(venue_id)`.
  - Platform admins get their own table (`platform_admins`) and `private.is_platform_admin()`. `profiles.role` is retired.
- [ ] **Add `venue_id`.**
  - Add it to every venue-owned table, and denormalize it onto `bookings`, `payments`, `court_rates`, `court_photos`, `open_play_courts`, `paymongo_checkouts` and `email_outbox`.
  - Use composite foreign keys (`(venue_id, court_id) → courts (venue_id, id)`) so a child row can't cross venues.
  - Rekey the venue-wide tables, e.g. `operating_hours` PK `(venue_id, day_of_week)`.
  - Backfill everything to Claudex Courts, which becomes venue `claudex` on staging and on production.
- [ ] **RLS rewrite.**
  - Public reads only active venues.
  - Writes need `is_venue_admin(venue_id)`.
  - Platform admins read everything.
- [ ] **RPC rewrite.**
  - Every RPC derives the venue from the row it touches; it never trusts a client `venue_id`.
  - Settings are loaded per venue, and the timezone helpers take the venue.
  - Reorders stay inside one venue.
  - Suspended and draft venues refuse public bookings.
- [ ] **Storage.**
  - New paths: `{venue_id}/courts/…` and `{venue_id}/banner/…`. Policies check `is_venue_admin` on the first folder.
  - Payment proofs: venue admins read their own venue's.
- [ ] **Billing data.** `bookings.confirmed_at` (with backfill), the `billing_charges` ledger and its triggers (bookings and open play), `platform_pricing`, `invoices`. pgTAP covers every row of the table in §5.
- [ ] **Isolation tests (pgTAP).**
  - Use a second venue in the fixtures.
  - For every table, RPC and bucket, venue A's staff can't read or change venue B.
  - The coverage test fails if a table with `venue_id` lacks venue-scoped policies.
- [ ] **Existing tests.** Update about 690 of them to run under a venue (most of the effort).
- [ ] **SPEC.md.** Update roles, data model, RLS summary and the decisions log.

### Phase 2: Subdomains and Cloudflare hosting
- [ ] **`getVenueSlug()`.**
  - Production: the subdomain of `*.plotline.ph`, ignoring the reserved names.
  - Locally: `smash-arena.localhost:5173` (Chrome resolves `*.localhost`).
  - Staging and previews: a `?venue=` override, saved for the session.
- [ ] **`VenueProvider`.**
  - Resolves the venue once.
  - Shows "venue not found" and "not taking bookings" pages.
  - Every `api.ts` function takes `venueId`, and every query key includes it.
- [ ] **Host modes.**
  - `app.plotline.ph` loads the platform console (lazy-loaded, like admin today).
  - The apex and `www` never reach this build.
- [ ] **Admin access.** `AdminGuard` checks `venue_members` for this venue. Owners with several venues get a switcher that links to the other subdomains.
- [ ] **Auth.**
  - Add `https://*.plotline.ph/**` to the Supabase redirect URLs.
  - Login is per subdomain: localStorage is per origin, so a player logs in again at another venue.
  - My bookings shows only the current venue.
- [ ] **Edge Functions.** The PayMongo return-URL and CORS checks accept `https://<slug>.plotline.ph` for an existing venue slug, instead of an exact list. Email links use the venue's subdomain.
- [ ] **Cloudflare deploy.**
  - A `wrangler` config with SPA fallback replaces `vercel.json`.
  - The route is `*.plotline.ph/*`, plus a proxied wildcard DNS record.
  - Preview deployments point to staging.
- [ ] **Redirects.** The old Vercel demo URL redirects to `claudex.plotline.ph`.
- [ ] **e2e.** Run under a venue subdomain, and add a two-venue isolation flow.

### Phase 3: Platform console (`app.plotline.ph`, us only)
- [ ] **Leads.** Contact form submissions from the marketing site, with a status (`new` → `talking` → `won` / `lost`) and notes.
- [ ] **Create a venue from a lead.**
  - Set the slug, name, timezone, and how the venue collects payments (PayMongo or manual).
  - The venue starts as `draft`.
  - Owners are invited by email (Supabase invite through a service-role Edge Function). The invite lands on `<slug>.plotline.ph/admin`.
- [ ] **Set up together.**
  - We, or the owner, add courts, rates, hours, payment details and photos.
  - A setup checklist in the venue dashboard.
  - "Publish" sets the venue to `active`.
- [ ] **Venues list.** Status, PayMongo status, this month's billable hours (split and invoiced), open invoices. Suspend or reactivate.
- [ ] **Invoices.** Review the monthly drafts, mark them sent and paid. A printable invoice page. A reconciliation view of split charges that are `pending` or `failed`.
- [ ] **Demo venue.** A nightly job resets `claudex` to its seed data.
- [ ] **Venue showcase.** A public, opt-in list of active venues (name, city, logo, link) that the marketing site's venue slider reads, instead of hard-coded placeholders.

### Phase 4: PayMongo platform (split payments) and emails
- [ ] **Research.** PayMongo's answers to §4 question 1. Pick Payment Splitting or Workflows, and record the decision in RESEARCH.md.
- [ ] **Venue onboarding.**
  - Create the venue's child account through PayMongo's Onboarding API, or hosted onboarding, from the platform console.
  - Store the child merchant id on `venues`. Plotline holds one secret key, so no per-venue secrets are stored.
- [ ] **Checkout.** `create-paymongo-checkout` uses Plotline's key and adds the split: ₱5 × hours to Plotline, the remainder to the venue's child account. Only venues with `paymongo_status = active` show "Pay online."
- [ ] **Webhook.**
  - The webhook stays a single function.
  - The booking's venue must match the session's child account.
  - Record the split result on the `billing_charges` row.
  - Handle refund events: a reversed split becomes an invoice line.
- [ ] **Live mode.** Accept live signatures, and test GCash, Maya and card for real.
- [ ] **Emails on in production.**
  - The sender name is the venue's name; replies go to the venue's email.
  - Owner alerts for new bookings and proofs, which the landing page promises.

### Phase 5: Marketing site changes
- [ ] **Contact form.**
  - Replace the owner sign-up and trial with a lead form: name, phone, email, venue, location, courts, message. No auth account.
  - A Turnstile check, then an insert into `leads` in the production project. We get an email alert.
- [ ] **Move to production.** Move `reviews` and `leads` into the production Supabase project. Drop plotline-site's own project.
- [ ] **Copy.** Remove the free-trial wording. Match the feature list to what ships, or schedule the gaps:
  - open play slots, waitlist and skill levels
  - reminders
  - pay at the venue
  - a venue logo
- [ ] **Links and deploy.** Real links (support email, Messenger, demo at `claudex.plotline.ph`), a real Terms page, and a Privacy page covering the Data Privacy Act. Deploy on Cloudflare.

### Phase 6: Launch readiness
- [ ] Nightly backups of production, with one restore tested on staging.
- [ ] Sentry free tier, for both sites and the Edge Functions.
- [ ] Uptime check on `claudex.plotline.ph` and the Supabase API.
- [ ] Supabase Pro when the first venue pays.
- [ ] A runbook: onboarding a venue (manual and PayMongo), monthly invoicing and reconciliation, suspending a venue, restoring a backup.

## 8. Later, only when needed

- Custom domains for venues (`book.smasharena.ph`) through Cloudflare for SaaS.
- Logging in once across all venue subdomains: a shared auth host, or cookie storage on `.plotline.ph`.
- A dedicated database as a premium plan.
- Automated invoice payments.
- Finding courts across venues for players.

## 9. Order

Phase 0 → **Phase 1** (about half the work) → Phase 2 → Phase 3 (with invoicing) → Phase 5 → first pilot venue on manual proofs and invoices → Phase 6 → Phase 4 once Plotline is registered and PayMongo has enabled its platform.

The invoice path ships first because every venue needs it, PayMongo venues included (walk-ins and open play). Splits are an upgrade on top.
