# Plotline SaaS plan

> Status: **planning, not approved scope** (last updated 2026-10-27). Once it's agreed, turn each phase into a milestone in TASKS.md (research → migrations → UI → close out), the way M3–M9 were run, starting with M12 (M10 and M11 come first, §7a and §7b). Prices and landing page copy aren't final.

## 1. Product and business model

- **Plotline** is a court booking platform for venues in the Philippines.
  - `court-booking-system` is the product, today a single-venue demo (Claudex Courts).
  - `plotline-site` is the marketing site.
  - How the two repos share one database and depend on each other: [PLATFORM.md](PLATFORM.md). This repo owns all schema and Edge Functions.
- **No self-serve signup and no free trial.** Interested owners fill in a contact form on the marketing site. We talk with them, then set up their venue and invite them.
- **Pricing (2026-10-26; amount not final):** a **₱10 booking fee per transaction, paid by the player**. A transaction is a booking a player makes on the site that gets confirmed, whatever its length, court or sport.
  - The fee is shown before the player pays (court price + booking fee = total) and is collected by the venue together with the court price.
  - Venues pay no subscription, no setup fee and nothing per hour. That's the pitch: Plotline costs the venue nothing out of pocket.
  - Walk-ins and open play aren't transactions. The walk-in form is to be hidden or removed, so venues can't book players offline to skip the fee.
- **Two ways a venue's players pay:**
  - **PayMongo venues:** the venue **connects its own PayMongo account** (2026-10-26). Players pay straight into it, and PayMongo pays the venue out. Plotline never holds venue money and takes nothing at checkout.
  - **Manual venues:** players upload a proof of a GCash, Maya or bank payment made to the venue's own details.
- **Commission collection: invoice only (2026-10-26).**
  - The venue receives the fees with each booking's payment, and every fee is billed back on one monthly invoice per venue.
  - PayMongo and manual venues are billed the same way. The payment method only decides where the player's money goes, never how we collect.
- **Venues pay their invoices** by GCash or bank transfer: 7 days' grace, then suspension.

## 2. Architecture

| Host | What | Runs on |
| --- | --- | --- |
| `plotline.fit` (+ `www`) | Marketing site (`plotline-site`) | Cloudflare Workers, static assets (free) |
| `<slug>.plotline.fit` | A venue's booking site; `/admin` is its staff area | Cloudflare Workers, the `court-booking-system` build, through the wildcard route `*.plotline.fit/*` (free) |
| `app.plotline.fit` | Platform console (us): venues, owners, invoices | Same build as the venues; the hostname decides the mode |
| `claudex-courts.plotline.fit` | Venue #1: Claudex Courts, the demo venue on production, demo data reset nightly (`demo.` can redirect to it) | Same build |
| Supabase **production** | New project, Singapore (`ap-southeast-1`). App data plus the marketing site's leads and reviews | Free until the first paying venue, then Pro |
| Supabase **staging** | The current `court-booking-system` project (Singapore) | Free |
| Email | Auth emails and booking emails from our domain | Resend or Brevo free tier, through custom SMTP |
| DNS and TLS | Cloudflare DNS, with a proxied wildcard record `*.plotline.fit`; Universal SSL covers the root and `*.plotline.fit` | Free |
| Backups | Nightly `pg_dump` of production, kept outside Supabase | GitHub Action (free) |

- **Domain: `plotline.fit`** (chosen 2026-10-27). Buy it at any registrar and point the nameservers to Cloudflare. `.fit` is less familiar to owners than `.ph` or `.com`, so spell it out on posters and in chats. Note: a funded company already uses the Plotline name at plotline.so, in another industry.
- **Reserved subdomains:** `www`, `app`, `api`, `admin`, `demo`, `staging`, `mail`, `help`, `blog`, `status`, `support`.
- **Why not Vercel:** the Hobby plan is non-commercial only, and Plotline both takes payments and advertises a product. Pro is about $20 a month per member. Cloudflare's free plan allows commercial use.
- **Why not Supabase Free long-term:** no backups or point-in-time recovery, 500 MB database and 1 GB storage (payment proofs and photos add up), and inactive projects pause. Our own nightly dump covers backups until we upgrade.
- **One production project, not two:** the free plan allows 2 active projects (production and staging). Plotline-site hasn't been deployed, so its tables move into production.

## 3. Decisions log

| Date | Decision |
| --- | --- |
| 2026-10-24 | One shared database with a `venue_id` on every row, enforced by RLS. No project per venue. The tenant table is `venues`. |
| 2026-10-24 | Venue URLs are subdomains (`smash-arena.plotline.fit`) from the start. The root domain is the marketing site. |
| 2026-10-24 | Host on Cloudflare (free). Supabase production in Singapore. The current project becomes staging and demo. |
| 2026-10-24 | Supabase Pro from the first paying venue. |
| 2026-10-24 | No self-serve signup and no free trial. A contact form, then we set up the venue and invite the owner. |
| 2026-10-24 | Each venue uses its own PayMongo account. (Replaced on 2026-10-25 by child accounts, then reinstated on 2026-10-26.) |
| 2026-10-24 | Billable bookings are confirmed ones, including those cancelled after confirmation (since 2026-10-26: unless the venue cancels). Rejected proofs aren't monitored: rejecting reopens the slot, so it costs the venue. |
| 2026-10-24 | ~~₱499 capped at 2 active courts; plan by the month's highest court count.~~ Replaced on 2026-10-25. |
| 2026-10-24 | One owner can manage several venues (branches); each is its own venue, billed separately. |
| 2026-10-24 | Venues pay by GCash or bank transfer against an invoice: 7 days' grace, then suspension. |
| 2026-10-24 | The demo is a real venue on production, reset nightly. Since 2026-10-25 it's Claudex Courts at `claudex.<domain>`. |
| 2026-10-24 | Pilot invoices may go to personal accounts. Register as a sole proprietor (DTI business name, BIR) before invoicing for real. |
| 2026-10-24 | ~~Walk-ins are billable. They're already confirmed bookings, so they need no extra tracking. The walk-in form stays.~~ Replaced on 2026-10-26: walk-ins aren't transactions, and the walk-in form is to be hidden or removed. |
| 2026-10-24 | A booking is billed in the month it was confirmed. |
| 2026-10-24 | No pilot venue yet. Build first, starting with Phase 1. |
| 2026-10-25 | **Replaces the ₱499 plan and the 2-court cap:** commission only, with no setup fee. |
| 2026-10-25 | ~~The rate is ₱5 per court-hour for every court and sport.~~ Replaced on 2026-10-26 by ₱10 per transaction, paid by the player. |
| 2026-10-25 | ~~Hybrid collection: PayMongo split payments for venues that onboard with PayMongo (child accounts under Plotline's platform), a monthly invoice for everything else.~~ Replaced on 2026-10-26 by invoice-only collection. No prepaid credits (still holds). |
| 2026-10-25 | Every confirmed online booking is billable whatever the payment method: PayMongo or manual proof. (Walk-ins dropped on 2026-10-26.) |
| 2026-10-25 | ~~Open play is billed per court-hour.~~ Replaced on 2026-10-26: open play isn't billable (players don't book or pay for it in the app). |
| 2026-10-25 | ~~PayMongo is offered only through Plotline's platform account. A venue's own standalone PayMongo account isn't supported (not two integrations).~~ Replaced on 2026-10-26: venues use their own accounts only. |
| 2026-10-25 | ~~Open play is charged when the session starts.~~ Replaced on 2026-10-26: open play isn't billable. |
| 2026-10-25 | Every venue is invoiced every month, whatever the amount (no threshold). |
| 2026-10-25 | A venue that wants PayMongo must complete PayMongo's own verification (KYC). Venues that can't, or don't want to, use manual proofs. (Since 2026-10-26 they verify their own account, not a child account.) |
| 2026-10-25 | End state: the marketing site on the main domain, the product serving every venue on subdomains. Claudex Courts (the current demo) is venue #1, e.g. `claudex.plotline.app`. Both sites' design and features will still change. |
| 2026-10-26 | **Replaces the hybrid collection: invoice only.** No PayMongo split. Every charge is invoiced monthly, for PayMongo and manual venues alike. Players' PayMongo payments go to the venue, and Plotline never holds venue money. |
| 2026-10-26 | Why invoice only: one billing path, no dependence on PayMongo's splitting feature (being deprecated), no split failures or refund reversals to reconcile, and the same treatment for every venue. The trade-off: we carry the collection risk for every hour, covered by the 7-day grace and suspension. |
| 2026-10-26 | **Replaces child accounts: each PayMongo venue uses its own PayMongo account.** Plotline needs no PayMongo account of its own, no Platforms approval from PayMongo, and carries no parent-account liability for venues' refunds or chargebacks. Venues sign up and pass KYC with PayMongo themselves, and handle refunds and payouts in their own dashboard. The cost is per-venue secrets, stored encrypted and used only by Edge Functions (Phase 4). One integration only: there's no child-account path. |
| 2026-10-26 | **Replaces ₱5 per court-hour: ₱10 per transaction, paid by the player** as a booking fee shown at checkout. More predictable for everyone, and the venue pays nothing itself. A transaction is one confirmed online booking (PayMongo or manual proof), whatever its length. |
| 2026-10-26 | Walk-ins and open play aren't transactions. The walk-in form will be hidden or removed, so owners can't route players through walk-ins to avoid the fee. Staff with a counter or phone customer book through the site like a player, fee included. |
| 2026-10-26 | The fee is non-refundable once the booking is confirmed, except when the venue cancels: the player gets the fee back and we don't bill it. |
| 2026-10-26 | **The booking fee is built before the SaaS work, in M11**, for the single venue: `platform_pricing`, `bookings.booking_fee`, the fee in the amount due, at checkout, in PayMongo and in emails, and the dashboard's total revenue, owner earnings and Plotline fees. Phase 1 adds `venue_id`, `confirmed_at`, the `billing_charges` ledger and invoices on top. |
| 2026-10-26 | Walk-ins are hidden behind a code flag, off by default (M11), not removed. |
| 2026-10-26 | The product follows the Plotline brand (`docs/BRAND.md`, M11). Each venue picks one of a few color presets for its site; fonts and the logo stay Plotline's. |
| 2026-10-27 | Domain `plotline.fit`: the marketing site on the apex, venues on `<slug>.plotline.fit`, our console on `app.plotline.fit`. The demo venue's slug is `claudex-courts`. |
| 2026-10-27 | Two repos, one database. court-booking-system is the **platform repo**: it owns every migration and Edge Function for every shared Supabase project. plotline-site is frontend only. Shared facts and the contract between them live in one file, [PLATFORM.md](PLATFORM.md). Not a monorepo for now. |
| 2026-10-27 | plotline-site's backend moves here in Phase 5: `venue_signups` → `leads` (no account), `reviews` stays, `register` → `site-contact`, `feedback` → `site-review`, validation → `_shared/siteForms.ts` with an exact copy in plotline-site for instant feedback. |
| 2026-10-27 | PayMongo per venue, hardened (Phase 4): every use of a venue's key is logged, the code uses keys only to create checkouts, register our webhook and refund late payments, a daily health check hides "Pay online" when a venue's key or webhook stops working, and each venue's setup is proven with one small live payment and refund during onboarding. |

## 4. Open questions

1. **PayMongo per venue** (settled in Phase 4 research, no PayMongo sales call needed):
   - what a venue needs to open a PayMongo account (sole proprietor, corporation, an individual without DTI?) and how long KYC takes, so we can tell owners up front;
   - whether there's a safer way for a venue to grant access than pasting its secret key (restricted keys or an OAuth-style connect);
   - limits on webhooks per account, and creating ours on the venue's account through the Webhooks API.
2. ~~Domain~~ Settled on 2026-10-27: `plotline.fit`.
3. ~~Demo slug~~ Settled on 2026-10-27: `claudex-courts`. Whether `demo.plotline.fit` also redirects to it is a Phase 2 detail.
6. **Holding venues' PayMongo keys** (Phase 4): what our terms say about how we store and use them, and what we do if one leaks (rotate, tell the venue, review the key-use log).
4. ~~**Walk-ins:** hide the form (kept for us and old data) or remove it?~~ Settled on 2026-10-26: hidden behind a code flag, off by default (M11, T11.2). Existing walk-in bookings on Claudex Courts stay as history. Still open: whether Phase 1 also refuses `create_walk_in` in the database, per venue. Note that a free blackout could still be used to hold a court for an offline customer; we accept that, as it hides the slot from players and costs the venue bookings.
5. **Tax treatment of the fee:** the venue collects the ₱10 and passes it on to us. Ask an accountant how the venue and Plotline should each record and receipt it, before the first real invoice.

## 5. Billing rules

**What's billable (₱10 booking fee per transaction, paid by the player, snapshotted on each booking):**

Every charge is collected on the venue's monthly invoice.

| Event | Billable | When it's charged |
| --- | --- | --- |
| Online booking paid through PayMongo | ₱10 | When it's confirmed (webhook) |
| Online booking paid by manual proof | ₱10 | When staff approve the proof |
| Confirmed, then cancelled by the player or refunded | Still ₱10 (the fee is non-refundable) | Already charged |
| Confirmed, then cancelled by the venue | Not billable; the player gets the fee back | An adjustment cancels the charge, on a later invoice if it was already invoiced |
| Rescheduled, or a `moved` continuation | Nothing new: still one transaction | |
| Proof rejected, hold expired, never confirmed | Not billable | |
| Late PayMongo payment for an expired hold (refund due) | Not billable | |
| Walk-ins (while they exist), open play, blackouts | Not billable | |

**Notes:**
- **One fee everywhere removes the incentive to steer players.** PayMongo and manual proofs carry the same ₱10, so the venue gains nothing by pushing players to GCash instead.
- **The fee is a fixed amount, never computed on the client.** `create_booking` snapshots it from `platform_pricing`, and the amount due is court price + fee. Changing the fee later doesn't touch existing bookings.
- **Loopholes we accept:**
  - Taking offline customers without recording them, which brings back double bookings.
  - Holding a court for an offline customer with a blackout, which hides the slot from players.
  - Rejecting a proof after collecting the money, which reopens the slot.
  - Cancelling "as the venue" to skip the fee, which shows on the booking and in the venue's statement, so we can spot a pattern.
- **PayMongo's fees and refunds are between the venue and PayMongo.** PayMongo's percentage applies to the whole total, fee included, and the venue absorbs it.

**Data:**
- **`bookings.confirmed_at`:** set the first time a booking becomes `confirmed`. Backfill it from the approved payment.
- **`bookings.booking_fee`:** the fee snapshotted when the booking is created (₱0 for walk-ins and `moved` continuations). The amount due, the PayMongo checkout and the manual proof all use court price + fee.
- **`billing_charges` ledger, one row per billable event:**
  - `venue_id`, `booking_id`, `kind` (`booking_fee` | `adjustment`), `amount`, `charged_at`, `billing_month`.
  - `invoice_id`, set when the charge goes on an invoice.
  - Written by a trigger inside the same transaction that confirms the booking. A venue cancellation of a confirmed booking writes a negative `adjustment`.
  - Charges are never deleted. A correction is a new adjustment row.
- **`platform_pricing`:** the booking fee and the grace days, stored as data.
- **`venues`:** `paymongo_status` (`none` | `connected` | `active`), and `billing_note`. The venue's PayMongo secrets live apart from it (Phase 4).

**Invoices and statements:**
- **Draft invoice.** A pg_cron job on the 1st creates a draft per venue with every charge of the previous month. We review it, send it, and mark it paid by hand (method and reference).
- **Statement in the venue's admin area.** This month so far: transactions by payment method, venue cancellations credited, and the running total. Past invoices. Each line links to its booking, so disputes are easy.
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
  - `GoogleButton` builds `redirectTo` from `window.location.origin`, which works with subdomains once Supabase allows `https://*.plotline.fit/**`.
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

### 7b. Before Phase 1: Plotline brand and venue upgrades (M11)
Also on the single-venue app (approved 2026-10-26; breakdown in TASKS.md M11). Phase 1 becomes M12, and the later phases follow:
- the whole site restyled to the Plotline brand, and venue color presets (`venue_settings.theme`, which Phase 1 makes per venue like the rest of `venue_settings`);
- location from a pasted Google Maps link, shown as the address with a pin icon (no embedded map);
- payment accounts with QR codes for manual payments;
- **the ₱10 booking fee** (amount due, checkout, PayMongo line item, emails, CSV) and the dashboard's total revenue, owner earnings and Plotline fees;
- walk-ins behind a code flag, hidden by default.

**Built (done 2026-10-30), and what Phase 1 inherits:**
- `platform_pricing.booking_fee` (₱10, set on production after the merge into `master`) is copied onto each online booking as `bookings.booking_fee`; `amount_due` is the price plus the fee. `get_earnings.split` gives total revenue, Plotline fees and owner earnings. Phase 1 adds the per-venue override question and the billing ledger on top.
- `venue_settings.theme` (five presets), `maps_url`, `waiver_text`, `online_payments_enabled` (only Plotline can change it) and `venue_payment_accounts` with the `payment-qr` bucket are single-venue today; Phase 1 makes each per venue like the rest of `venue_settings`.
- Walk-ins stay behind `VITE_FEATURE_WALK_INS` (a build flag, so not per venue).
- Email runs through Resend from `mail.plotline.fit`, and guests get fresh private links (`guest_link_tokens`, `issue_guest_link`) in the re-upload email.
- T11.15 (the contract migration) is done: `maps_query`, `move_court` and `move_info_section` are dropped, so Phase 1 starts without them.

### Phase 0: Accounts and groundwork (no code)
- [ ] Buy `plotline.fit`. Move its nameservers to Cloudflare.
- [ ] Create the Supabase production project in Singapore. Keep the current project as staging.
- [ ] Set up the email sender on the domain (SPF, DKIM, DMARC). Set it as custom SMTP on both projects.
- [ ] Turn on Cloudflare Turnstile for the contact form.
- [ ] Before the first real invoice: DTI business name, BIR registration, and a business GCash or bank account.

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
  - Backfill everything to Claudex Courts, which becomes venue `claudex-courts` on staging and on production.
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
- [ ] **Billing data.** `bookings.booking_fee` and `platform_pricing` come from M11 (T11.12). Phase 1 adds `bookings.confirmed_at` (with backfill), the `billing_charges` ledger and its trigger, and `invoices`, and checks whether `platform_pricing` needs a per-venue override. pgTAP covers every row of the table in §5.
- [ ] **Booking fee in the UI.** Built in M11 (T11.13, T11.14) for one venue; Phase 1 only checks it under several venues.
- [ ] **Walk-ins.** Hidden by a code flag since M11 (T11.2). Phase 1 decides whether `create_walk_in` is also refused in the database (§4 question 4). Rescheduling keeps its own slot rules.
- [ ] **Isolation tests (pgTAP).**
  - Use a second venue in the fixtures.
  - For every table, RPC and bucket, venue A's staff can't read or change venue B.
  - The coverage test fails if a table with `venue_id` lacks venue-scoped policies.
- [ ] **Existing tests.** Update about 690 of them to run under a venue (most of the effort).
- [ ] **SPEC.md.** Update roles, data model, RLS summary and the decisions log.

### Phase 2: Subdomains and Cloudflare hosting
- [ ] **`getVenueSlug()`.**
  - Production: the subdomain of `*.plotline.fit`, ignoring the reserved names.
  - Locally: `smash-arena.localhost:5173` (Chrome resolves `*.localhost`).
  - Staging and previews: a `?venue=` override, saved for the session.
- [ ] **`VenueProvider`.**
  - Resolves the venue once.
  - Shows "venue not found" and "not taking bookings" pages.
  - Every `api.ts` function takes `venueId`, and every query key includes it.
- [ ] **Host modes.**
  - `app.plotline.fit` loads the platform console (lazy-loaded, like admin today).
  - The apex and `www` never reach this build.
- [ ] **Admin access.** `AdminGuard` checks `venue_members` for this venue. Owners with several venues get a switcher that links to the other subdomains.
- [ ] **Auth.**
  - Add `https://*.plotline.fit/**` to the Supabase redirect URLs.
  - Login is per subdomain: localStorage is per origin, so a player logs in again at another venue.
  - My bookings shows only the current venue.
- [ ] **Edge Functions.** The PayMongo return-URL and CORS checks accept `https://<slug>.plotline.fit` for an existing venue slug, instead of an exact list. Email links use the venue's subdomain.
- [ ] **Cloudflare deploy.**
  - A `wrangler` config with SPA fallback replaces `vercel.json`.
  - The route is `*.plotline.fit/*`, plus a proxied wildcard DNS record.
  - Preview deployments point to staging.
- [ ] **Redirects.** The old Vercel demo URL redirects to `claudex-courts.plotline.fit`.
- [ ] **e2e.** Run under a venue subdomain, and add a two-venue isolation flow.

### Phase 3: Platform console (`app.plotline.fit`, us only)
- [ ] **Leads.** Contact form submissions from the marketing site, with a status (`new` → `talking` → `won` / `lost`) and notes.
- [ ] **Create a venue from a lead.**
  - Set the slug, name, timezone, and how the venue collects payments (PayMongo or manual).
  - The venue starts as `draft`.
  - Owners are invited by email (Supabase invite through a service-role Edge Function). The invite lands on `<slug>.plotline.fit/admin`.
- [ ] **Set up together.**
  - We, or the owner, add courts, rates, hours, payment details and photos.
  - A setup checklist in the venue dashboard.
  - "Publish" sets the venue to `active`.
- [ ] **Venues list.** Status, PayMongo status, this month's transactions and running total, open invoices. Suspend or reactivate.
- [ ] **Invoices.** Review the monthly drafts, mark them sent and paid. A printable invoice page. Overdue invoices past the grace period are flagged for suspension.
- [ ] **Demo venue.** A nightly job resets `claudex-courts` to its seed data.
- [ ] **Venue showcase.** A public, opt-in list of active venues (name, city, logo, link) that the marketing site's venue slider reads, instead of hard-coded placeholders.

### Phase 4: PayMongo per venue and emails
- [ ] **Research.** §4 question 1, and how to store and use per-venue secrets safely, recorded in RESEARCH.md.
- [ ] **Connecting a venue's account.**
  - The venue signs up with PayMongo and passes its KYC on its own. We point owners to it during setup.
  - In the venue's admin area, the owner enters the secret key. An Edge Function checks it against PayMongo, creates our webhook on the venue's account (pointing at our endpoint with the venue id) and stores the returned webhook secret.
  - Secrets are stored encrypted (Supabase Vault or an equivalent), keyed by `venue_id`, and read only by Edge Functions. They're never sent back to the browser: the admin sees "connected", the key's last 4 characters, and buttons to replace or disconnect.
  - Test-mode keys are refused in production, and live keys in staging.
  - **Key safety.** The code uses a venue's key only to create checkouts, register our webhook and refund late payments. Every use is logged (`paymongo_key_uses`: venue, action, booking, when, outcome; never the key). Only the owner role can replace or disconnect it, and doing so is logged too. Our terms say how keys are stored and used.
- [ ] **Checkout.** `create-paymongo-checkout` loads the booking's venue and uses that venue's key, so the player pays the venue directly, booking fee included. Only venues with `paymongo_status = active` show "Pay online."
- [ ] **Webhook.**
  - One function. It takes the venue from the URL, verifies the signature with that venue's webhook secret, and checks that the booking belongs to that venue.
  - Billing needs nothing extra: confirming the booking writes its `billing_charges` row, as for any other method.
  - Refunds for late payments use the venue's key. Other refunds the venue does in its own PayMongo dashboard.
- [ ] **Health check.** A daily job checks each connected venue: the key still authenticates and our webhook still exists and is enabled. On failure, `paymongo_status` drops to `connected` (not `active`), "Pay online" disappears (manual proofs keep working), and the owner and we get an alert. Reconnecting runs the same checks.
- [ ] **Onboarding test payment.** Before a venue goes live with PayMongo, we make one small live payment through its booking page and refund it from its dashboard. Recorded in the runbook.
- [ ] **Live mode.** Accept live signatures, and test GCash, Maya and card for real.
- [ ] **Emails on in production.**
  - The sender name is the venue's name; replies go to the venue's email.
  - Owner alerts for new bookings and proofs, which the landing page promises.

### Phase 5: Marketing site changes
- [ ] **Contact form.**
  - Replace the owner sign-up and trial with a lead form: name, phone, email, venue, location, courts, message. No auth account.
  - A Turnstile check, then an insert into `leads` in the production project. We get an email alert.
- [ ] **Move the backend to this repo** (drafts prepared and tested on 2026-10-27 in `docs/drafts/phase5-site-backend/`; PLATFORM.md §5):
  - a migration for `leads` (status and notes, admin-only) and `reviews` (anon reads approved rows; admins approve);
  - the Edge Functions `site-contact` (Turnstile, honeypot, timing check) and `site-review`, with `SITE_ORIGINS` for CORS;
  - `_shared/siteForms.ts` with Vitest, and pgTAP for both tables.
  - Then plotline-site uses a copy of `siteForms.ts`, calls the new functions, generates types from the shared project, and deletes its own `supabase/migrations`, `functions` and `tests`. Its local-only project is dropped.
- [ ] **Copy.** Remove the free-trial wording. Explain the pricing: free for venues, a ₱10 booking fee per online booking paid by the player. Match the feature list to what ships, or schedule the gaps:
  - open play slots, waitlist and skill levels
  - reminders
  - pay at the venue
  - a venue logo
- [ ] **Links and deploy.** Real links (support email, Messenger, demo at `claudex-courts.plotline.fit`), a real Terms page, and a Privacy page covering the Data Privacy Act. Deploy on Cloudflare.

### Phase 6: Launch readiness
- [ ] Nightly backups of production, with one restore tested on staging.
- [ ] Sentry free tier, for both sites and the Edge Functions.
- [ ] Uptime check on `claudex-courts.plotline.fit` and the Supabase API.
- [ ] Supabase Pro when the first venue pays.
- [ ] A runbook: onboarding a venue (manual and PayMongo, including the test payment), monthly invoicing and reconciliation, suspending a venue, restoring a backup, a leaked or broken PayMongo key.

## 8. Later, only when needed

- Custom domains for venues (`book.smasharena.ph`) through Cloudflare for SaaS.
- Logging in once across all venue subdomains: a shared auth host, or cookie storage on `.plotline.fit`.
- A dedicated database as a premium plan.
- Automated invoice payments.
- Finding courts across venues for players.

## 9. Order

Phase 0 → **Phase 1** (about half the work) → Phase 2 → Phase 3 (with invoicing) → Phase 5 → first pilot venue on manual proofs and invoices → Phase 6 → Phase 4 when the first venue wants online payments.

The invoice is the only way we collect, so it ships first and covers every venue. Phase 4 only adds online payments into venues' own PayMongo accounts; billing doesn't change.
