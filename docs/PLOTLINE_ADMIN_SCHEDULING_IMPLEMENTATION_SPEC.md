# Plotline — Admin UX and Scheduling Improvements

**Status:** Proposed implementation specification — approved product decisions, technical plan pending Claude research/plan gate  
**Prepared:** 2026-11-03  
**Target repositories:** [`baringmarc/court-booking-system`](https://github.com/baringmarc/court-booking-system) (platform/booking/admin/database) and [`baringmarc/plotline-site`](https://github.com/baringmarc/plotline-site) (marketing frontend)  
**Document purpose:** Hand off to the existing Claude workflow with minimal disruption to the established architecture. This document is **not** a replacement for `SPEC.md`, `TASKS.md`, `RESEARCH.md`, or `docs/PLATFORM.md`. Review with the current branch first; incorporate accepted behavior into those canonical files using the normal plan gate. No repository changes were made while preparing this draft.

## 0. Executive summary

Improve venue-admin usability and multi-venue branding, add flexible per-court weekly opening periods and weekly recurring hourly rates in **one UI** while retaining separate availability/pricing logic, and move marketing Showcase control to the **platform admin**. Preserve every existing booked/active reservation and avoid introducing staff overrides outside operating hours.

**Non-goals:** Complete admin rewrite; new React/Supabase stack; holiday/date-specific special prices; admin bookings outside opening hours; self-serve venue registration; changing the existing hourly slot size; changing payment provider rules; silent cancellation of bookings; replacing the existing midnight/operating-day convention.

### Confirmed product decisions

1. Main venue-admin navigation is a **collapsible left sidebar**; mobile uses a drawer. Seven primary destinations: Dashboard, Bookings, Schedule, Open Play, Courts, Reports, Settings. Retain booking-alert counts and useful site/account actions.
2. **Settings remains a single sidebar destination.** Its landing page contains five clickable category cards; each leads to a focused settings page: Venue Profile, Payment Setup, Booking Rules, Website Appearance, Policies & Waivers. No permanent second settings sidebar.
3. **Payment instructions remain mandatory to publish.** Payment method/account and instructions are distinct checklist requirements; provide hint, example, and optional “Use example instructions” action. Required payment account must still have the details required by the current backend (including account number unless explicitly changed through another approved decision).
4. **Venue name from Settings** is the browser tab title for each venue, with optional context on subpages. `app.plotline.fit` uses **Plotline Admin**. Before venue resolution show neutral Plotline loading, never Claudex branding.
5. **Showcase** is a platform-admin-only control, not a venue-admin setting. Only active, approved/featured venues are presented on the marketing site. The platform console gets the editing interface; permission enforced in DB, not just UI.
6. The schedule has **venue-wide default hours**. Courts inherit those by default, or have independent custom hours. Enabling custom hours **copies the current venue defaults as a snapshot**; custom hours don't track later default edits. Returning to inherited hours discards/archives custom hours only after explicit confirmation.
7. Support **multiple open periods per weekday** for venue defaults and custom courts. All unlisted periods are closed. Per-court **default hourly rate** remains, with **weekly recurring per-hour overrides only**. Time and pricing appear in one UI but remain separate underneath.
8. Keep the current operating-day/midnight convention: an ordinary day can end at **12 AM (the 11 PM–12 AM slot)**; existing supported after-midnight hours continue to belong to the preceding operating day and are visibly labeled “next day.” Don't redesign overnight handling merely to ship split shifts.
9. Copy one day's hours to selected days, with independent checkbox to copy hourly rates. Support copying between courts with explicit overwrite warnings, respecting inherit/custom mode.
10. Staff and players **cannot create new bookings outside configured open periods**. Blackouts only remove availability and never open closed hours. Private events outside Plotline can be handled manually.
11. Schedule edits preserve **all currently active reservations**, including confirmed, payment-submitted, and unexpired pending-payment holds. Respect their usual deadlines and state transitions. Show a pre-save warning listing affected bookings, without silently changing price, status, time, or payment amount. Expired holds retain existing expiration semantics.
12. The Scheduling page has **Weekly Hours & Rates** and **Temporary Closures**. Full server-side validation, multi-venue isolation, accessibility and mobile usability are required.

## 1. What the current code already does (verified from GitHub)

| Existing asset | Current behavior / constraint | Reuse plan |
|---|---|---|
| `src/features/admin/AdminLayout.tsx` | Header with 7 navigation links, venue switcher, site link, user name, logout; `AdminNav` owns `useBookingAlerts` subscription | Refactor **shell only**; preserve the single Realtime subscription, route permissions, focus/skip link |
| `src/routes/router.tsx` | Lazy-loaded admin pages, `/admin/settings`, `/admin/schedule`, `/admin/courts/:id`, `/admin/statement` | Extend routes; keep old entry URLs working |
| `src/features/admin/SettingsPage.tsx` | One long `page-sections` list; `SettingsForm` groups venue name, numeric booking rules, payment instructions under one Save | Extract existing sections into category routes with focused state and save behavior |
| `src/features/admin/PaymentAccountsSection.tsx` | Add, reorder, edit and delete payment accounts; QR upload support | Reuse intact in Payment Setup page |
| `src/features/admin/SetupChecklist.tsx` | Displays server-supplied items; `FIX_LINKS` currently sends `hours` and `payment` to `/admin/settings` | Make links accurate and deep-link to precise form section |
| `supabase/migrations/20261101031821_venue_setup_publish.sql` | `venue_setup_status` checks active court, rate > 0, an open day, **payment account with nonempty account number**; it does **not currently validate payment instructions**. `publish_venue` uses the status function. | Add new migration extending server readiness and publication verification atomically; do not rely only on UI |
| `src/features/admin/SchedulePage.tsx` | A single open/close span per weekday; `BlackoutsSection` is separate | Keep blackouts; replace only recurring schedule editor after backend is ready |
| `src/features/catalog/hours.ts` | `daySpan`, `operatingDayRange`, `operatingDateOf` assume one range per day | Introduce a new multi-interval helper and migrate consumers carefully; don't silently widen old helper semantics |
| `src/features/admin/CourtRatesSection.tsx` | Existing per-court weekly per-hour rate grid, including after-midnight mapping | Reuse pricing model and as much grid/FillTool behavior as possible in combined editor |
| `src/features/catalog/api.ts`, `hooks.ts` | Venue-scoped React Query keys; `saveOperatingHours` calls `set_operating_hours`; court rate mutations exist | Add new versioned schedule API/hooks, retain venue id in every key |
| `supabase/migrations/20261021001821_overnight_hours.sql` and later venue-aware migrations | Operating day ownership and DB-side validation, price calculations, booking and walk-in RPCs | Update all database entrypoints consistently, preserve their guarantees |
| `src/features/venue/VenueProvider.tsx` | Resolves venue before rendering venue descendants | Show neutral title/loading until venue is fetched; do not expose previous/demo venue |
| `index.html` | `<title>Claudex Courts</title>` hardcoded | Change to neutral `Plotline` |
| `src/main.tsx` | `app` hostname branches into platform console; venue pages use `VenueProvider` | Set console title immediately; apply venue title on resolution |
| `src/features/admin/ShowcaseSection.tsx` | Venue admin can update `showcase_opt_in` and `city` | Remove switch from venue-admin settings; keep `city` in Venue Profile |
| `supabase/migrations/20261101082858_venue_showcase.sql` | `public_venues` view includes active + opted-in venues | Keep public view contract compatible; restrict who may change feature flag |
| `src/features/console/ConsolePage.tsx`, `VenuesList.tsx` | Platform console exists with venue controls | Add per-venue Showcase control there |
| `plotline-site/src/config/site.ts` | Current Venues list is static demo data | Replace with live `public_venues` read, with safe fallback and correct image URL mapping |

**Important caveat:** This code review is based on the repository state accessible on 2026-11-03; re-read the checked-out branch and current migration state before implementation. `SPEC.md` has some older single-venue prose; don't treat old prose as overriding newer migrations.

## 2. UX specification — admin shell and navigation

### Layout

- **Desktop:** fixed-width collapsible left sidebar (expanded labels; collapsed icons with accessible labels/tooltips); content area with compact top bar. Use existing design tokens and CSS rather than introducing a new UI framework.
- **Tablet/mobile:** sidebar becomes a keyboard-accessible dismissible drawer; no obscured page actions. Return focus to the trigger on close; trap focus while drawer is open; close on Escape and on navigation.
- **Top bar:** current venue selector, visible booking/proof alert count, “View public site,” account menu. Put logout inside account menu. Avoid maintaining two alert subscriptions.
- **Navigation:** Operations — Dashboard, Bookings, Schedule, Open Play. Management — Courts, Reports, Settings. `Reports` points to existing Statement initially; keep `/admin/statement` as an alias/redirect. `Courts` replaces “Courts & rates”; the weekly override editor moves to Schedule, but each court retains editable default rate in Courts.
- **Existing URL compatibility:** `/admin/settings` becomes category landing; direct old URL renders the landing rather than error. `/admin/schedule` redirects to or defaults to Weekly Hours & Rates. Preserve deep links where feasible.
- **Auth:** AdminGuard continues to enforce venue role. Platform console remains separate; no platform-only controls in venue shell.

### Acceptance criteria

- Every old primary admin function is reachable in at most two navigation selections; no feature disappears.
- Desktop and 360px mobile Playwright smoke flows pass. Focus, active route indicators, nav badge aria-labels and skip-to-content work.
- Header has no overlapping controls at supported widths. Venue-switcher navigation still isolates query caches/venue data.

## 3. UX specification — Settings

`/admin/settings` shows five cards. Select a card to reach a dedicated route, with `← Back to Settings`. No second fixed settings sidebar.

| Route (proposed) | Contents | Existing components / notes |
|---|---|---|
| `/admin/settings/venue` | Venue name, city, physical location/address, contact/social details as appropriate, timezone/currency/slot length (read-only if immutable) | Existing `SettingsForm` general part, `LocationSection`, `SocialLinksSection`; keep city here when Showcase moves |
| `/admin/settings/payments` | Accounts, account number/name, QR, mandatory payment instructions, payment options/status | `PaymentAccountsSection`, `OnlinePaymentsStatus`, existing instructions field |
| `/admin/settings/booking` | Booking window, payment hold, cancellation cutoff, max proof rejections | Move numeric fields from `SettingsForm`; explain ranges in plain language |
| `/admin/settings/appearance` | Theme, banner, amenities, information sections; sports ordering ideally next to Courts but maintain link during transition | `ThemePicker`, `BannerSection`, `AmenitiesSection`, `InfoSectionsSection`, `SportOrderSection` |
| `/admin/settings/policies` | Waiver and existing minor-consent language when actually represented in code; don't invent new legal fields | `WaiverSection` |

**Form behavior:** one clear Save action per group; visible dirty, saving, success and error states; warn on accidental navigation with unsaved edits when practical; errors adjacent to fields; accessible field labels; no changing persistence semantics unintentionally. Keep form state keyed/remounted after data updates according to `CLAUDE.md` (no prop-to-state syncing effects).

### Payment instructions (required to publish)

- Keep account and instructions **separate checklist items**: (a) valid payment account, (b) nonempty, trimmed payment instructions.
- Provide prompt text, e.g. “Scan the QR code or send payment to the account shown above. After payment, upload a screenshot of the receipt for verification.” Avoid hardcoded private phone numbers; account details are already visible in checkout.
- Offer editable **Use example instructions** text; don't auto-save it and don't imply that placeholder alone fulfills the requirement.
- Retain the existing account-number readiness condition unless separately approved to change it. A QR-only account with no number will still fail that existing rule; explain this clearly instead of silently relaxing it.
- Extend `venue_setup_status` in a new migration with a separate `payment_instructions` item; ensure `ready` and `publish_venue` enforce it. Guard already-published venues from accidental unpublishing: readiness is a draft-publish gate, not a retroactive shutdown unless explicitly designed.
- Update `SetupChecklist` `FIX_LINKS`: `hours → /admin/schedule`, `payment → /admin/settings/payments`, `payment_instructions → /admin/settings/payments#instructions`, etc. Add an explanatory reason under unfinished checklist items.

### Settings acceptance criteria

- A venue with an account and QR but blank instructions sees **account Done / instructions To do**, and cannot publish.
- Saving valid instructions updates the checklist without a hard reload (invalidate/refetch setup query after settings mutation).
- Missing account number is labeled clearly when the payment account requirement fails.
- Existing venue fields and saved values remain intact after moving components.

## 4. Scheduling — user experience and semantics

### Primary screen `/admin/schedule`

Top-level tabs/sections: **Weekly Hours & Rates** and **Temporary Closures**. The latter reuses current blackouts behavior.

Weekly Hours & Rates:

1. Select `Venue defaults` or a specific court.
2. Venue defaults show *opening periods only*, **no venue-wide pricing**. Courts show their default rate and weekly override rates.
3. Courts display **Use venue hours** or **Custom hours**. On initial switch to custom, copy all seven days of current venue defaults to a local draft; save to persist. Explicitly confirm switching custom back to inherited mode.
4. Select a weekday. Show clear open periods plus closed gaps; allow add/remove/edit an interval using whole-hour controls. `00:00` at end means midnight; beyond-midnight options, if supported by current constraints, are explicitly labeled `(next day)`.
5. Display applicable default/override rate in the same editor, with bulk fill across chosen time ranges. Rate override left empty = court default. Closed intervals have no bookable rate. Do **not** automatically alter price rules when moving hours.
6. Copy schedule to selected weekdays. Option checkbox **Also copy hourly rates**; copying venue defaults involves hours only. Copy to another court asks confirmation and makes the target custom *only with explicit agreement*.
7. Show pending edits before Save, show errors in context, and warn if active bookings now fall outside open periods. Saving still preserves those bookings.
8. Existing `CourtEditPage` keeps the court's **default hourly rate**. Remove the duplicated weekly override editor from CourtEditPage only after combined scheduling is available, replacing it with a direct link to Schedule.

### Example

Venue default: Monday 06:00–24:00. Court 2 enables custom (copies 06:00–24:00), then edits Monday to 06:00–10:00 and 16:00–24:00. Court 2 has default ₱200/hour and override Monday 18:00–24:00 at ₱350/hour. Monday 10:00–16:00 is not bookable for Court 2, while courts inheriting venue hours are unaffected.

### Price calculations

- Existing `court_rates(day_of_week, start_hour, price)` is the preferred retained model for weekly overrides. Preserve `courts.default_hourly_rate` as fallback.
- Price calculation is **authoritative in Postgres** at booking creation, not user-submitted client calculations. One hour has one price; a multi-hour booking sums the applicable slots. Existing booking amounts remain immutable when later prices change.
- For after-midnight slots, preserve the old **operating-day rate key** convention (`day_of_week` from the operating day; local hour modulo 24), rather than interpreting a post-midnight hour as the next day's pricing by accident.
- No date-specific overrides in this release.

### Overnight and period boundaries

- Preserve **hourly slots and the existing operating-day model**; a normal 23:00–00:00 slot finishes at midnight, not 23:00. Do not accidentally represent `00:00–00:00` as an empty span when the existing system uses a designated 24-hour convention.
- Where the current system supports hours after midnight, display them as the *previous day's* interval until next-day closing time and preserve existing validator limits.
- Reject any overlap **within the same day and across adjacent operating days**, including Sunday→Monday, and distinguish touching endpoints (allowed) from true overlaps (rejected).
- Reject bookings that cross a closed gap, even if the start and end lie in different open periods. A booking is valid only when its full slot range is contained in **one contiguous open period** (unless a future approved design explicitly defines adjacency merging).
- Blackouts can close otherwise bookable time only. Neither players nor staff can book closed hours; private events outside hours remain outside Plotline.

### Existing booking protection

Treat these as protected for schedule edits: `confirmed`, `payment_submitted`, and `pending_payment` **only while its hold remains unexpired**; any other active status in current schema must be explicitly audited. Bookings continue with normal payment/expiry/rejection behavior. **No mass cancellation, repricing or rescheduling on schedule save.**

- Before Save, present a warning listing/counting reservations that would sit outside the new effective hours, including affected courts and dates within a useful horizon.
- The warning is informative, not a blocker. The backend is the authority for what is protected; a UI query can become stale.
- New booking creation and new staff walk-ins must always use **current** effective availability rules.
- Audit payment-proof submission, payment review/confirmation, PayMongo webhook finalization, and booking rescheduling paths: they should not retroactively invalidate an already legitimate reservation solely because the hours changed. New reschedule destinations must satisfy current opening periods. Preserve existing overlap and payment protections.
- If open-play sessions occupy affected periods, specify the same preservation-vs-blocking policy during the technical plan gate; do **not** quietly treat them as booked or delete them.

## 5. Database evolution plan (migration-friendly, design proposal)

**Risk: High.** Current `operating_hours` is one row per weekday and current `private.operating_day_range()` returns one range. A naïve UI-only enhancement would permit a booking across the closed gap, which is unacceptable. Use a researched, staged DB change; exact SQL/table names below are **proposed**, not validated against the full schema and are subject to the required Claude plan gate.

### Proposed canonical model

1. **Retain legacy `operating_hours` during migration** (never edit an applied migration). New `venue_open_periods` table: `id`, `venue_id`, `day_of_week`, `start_hour`, `end_hour` (hour offsets from local operating-day midnight; end may exceed 24 when supported), optional `sort_order`, timestamps. A weekday with zero rows is closed.
2. **Court inheritance mode:** a `court_schedule_modes` record keyed by `court_id` or an equivalent `courts.schedule_mode` column, values `inherit` / `custom`, default `inherit`.
3. **Custom intervals:** `court_open_periods` table: `court_id`, `venue_id` (if needed for explicit RLS/isolation), `day_of_week`, `start_hour`, `end_hour`; only considered when mode is `custom`.
4. **Existing `court_rates` remains the hourly override source**; avoid a second rate table unless research shows a contractual limitation.
5. Add an atomic, venue-scoped **save schedule RPC** (or narrowly scoped RPCs that preserve atomicity): validates all seven days, complete interval set, non-overlap, bounds and authorization; commits the intended schedule/mode together. Switching to custom snapshots defaults server-side or validates a snapshot against concurrent venue changes.
6. Add canonical private **effective open periods** helper (`venue` and optional `court` input). Refactor `get_availability`, `private.validate_booking_slot`, `create_booking`, `create_walk_in`, `reschedule_booking`, pricing/operating-day helpers, availability summaries, scheduling filters and open-play validation to consume effective periods. Audit all callsites of `operating_day_range` and `operating_day_of` before replacement.
7. RLS: explicit venue admin / platform admin write checks, correct `venue_id` isolation, no client-supplied cross-venue court references, no public leakage of private venue data. Tests for unauthorized writes, cross-venue reads and RPC authorization.
8. Keep required indexes/unique or exclusion constraints. Enforce overlap **at DB level**; don't rely only on React validation.

### Safe rollout

**Prefer expand → backfill → switch → contract** with a controlled activation boundary:

- **Step A (expand):** new tables/functions + RLS + pgTAP, no change to public booking behavior. Backfill each of the seven legacy rows into zero/one new period. Preserve exact midnight/overnight semantics. Verify counts, periods and availability parity.
- **Step B (compatibility):** introduce new read/write RPCs and new frontend behind a controlled feature flag / coordinated deployment; legacy availability remains authoritative until cutover. Avoid two independently editable sources of truth: when new schedules are enabled, old `set_operating_hours` must be gated, mapped safely, or retired for that venue. Do not let an old browser silently overwrite multi-period schedules.
- **Step C (switch):** move all **booking-time** DB validators and availability/pricing consumers to the new canonical model **together**. Do not expose split hours in UI before the production booking RPCs enforce their gaps. Keep a well-defined rollback to a deployment without newly created split periods, or a reversible representation strategy; test rollout on local stack first.
- **Step D (contract later):** only remove obsolete tables/functions once old clients and all references are proven gone, with documented compatibility checks.

**Migration caveat:** Some existing code queries `operating_hours` directly, including the dashboard and public site. Replacing its meaning must be part of the complete audit. A single range cannot represent two periods; do not silently return an enclosing `06:00–24:00` range as if the midday gap were open.

### Deterministic precedence

For `(venue, court, time)`:

1. Effective opening periods = court custom periods if custom, otherwise venue periods.
2. Closed gaps = unavailable.
3. Blackout overlaps = unavailable.
4. Existing active booking/open-play occupancy = unavailable for **new** bookings.
5. Otherwise available; per-slot price = rate override for court + operating-day/hour when present, else court default.

Overlap exclusion constraints still prevent double-booking irrespective of UI state. Booking save/confirmation should maintain immutable booked amount.

## 6. Showcase as platform-admin-only

**Current:** `venue_settings.showcase_opt_in` can be updated through existing venue-admin settings policy. `public_venues` filters by active status and `showcase_opt_in`. `plotline-site` still uses static demo entries.

**Implement in the platform repository:**

- Remove `ShowcaseSection` from venue admin. Keep `city` as regular venue info.
- Introduce a platform-admin-only RPC to toggle venue feature status after checking `private.is_platform_admin()` and audit input/target venue. Crucially, **revoke/limit direct `venue_settings.showcase_opt_in` writes by venue admins**; hiding the checkbox alone is not security. Because Postgres RLS is row-level (not per-column), research use of column privileges, dedicated platform-owned table, or a controlled trigger/RPC. Avoid blocking regular venue settings updates.
- Recommended clean approach: migrate opt-in/approval state to a dedicated `venue_showcase` or equivalent platform-owned table, preserve default=false and copy existing opted-in statuses subject to review. Update `public_venues` **with the same columns/types** (`slug`, `name`, `city`, `logo_url`) to avoid breaking marketing consumers. Use feature naming that makes it clear this is approval, not venue consent.
- Provide platform console toggle in Venues list/detail; status indicator and clear semantics (active + featured → appears).

**Then, in marketing repository:**

- Fetch `public_venues` from the shared Supabase public client, following `docs/PLATFORM.md` contract; surface loading/empty/error gracefully, using existing static demo fallback if desired without exposing unpublished venues.
- Verify the `logo_url` currently represents a storage path and convert it with the correct storage bucket/public URL helper; do not blindly treat it as an absolute URL.
- Cache briefly (e.g., TanStack Query if already used, or a simple fetch with documented refetch behavior); no site redeploy required on flag changes.
- Update `docs/PLATFORM.md` **before** contract updates; deploy platform backward-compatibly before switching marketing frontend.

## 7. Browser title and neutral first paint

- Replace hardcoded `index.html` title **Claudex Courts** with **Plotline**.
- On `app.plotline.fit` branch in `src/main.tsx` or `mountConsole`, set `document.title = 'Plotline Admin'` immediately, before console lazy import completes.
- For a venue, leave title `Plotline` while fetching the venue; after `VenueProvider` resolves, set title from `venue.name` / the authoritative settings name (confirm current source mapping), optionally prefix route context (`Bookings | <Venue Name>`). On settings name changes invalidate/refetch the title source; revert to neutral on venue-not-found or failed load.
- If document-title effects are introduced, avoid mutating title during render; prefer one small dedicated title component/hook at venue/console boundary with cleanup semantics.
- Inspect **actual page flash** separately: current `VenueProvider` gates children while loading; the observed flash may be only the HTML title. Inspect `PageLoader`, logo, metadata, default venue fallback, persisted theme and Cloudflare cache behavior before editing extra code. Don't strip safe theme-first-paint logic unnecessarily.
- Tests: cold load of Forty Degrees never displays Claudex title; title correct on venue name edit, admin pages and unknown venue; console title correct immediately; no cross-venue cached text shown. Remember static SPA HTML cannot know dynamic name at first paint without edge-side rendering; neutral initial title is the approved solution.

## 8. Acceptance tests and regression matrix

### Unit/component

- Sidebar state/collapse, links/active styles, mobile drawer, keyboard focus and booking badge behavior.
- Settings categories and deep links; each field retains values; separate save states; unsaved warning; checklist messages and navigation.
- Payment instructions whitespace-only invalid; example action editable; QR-only account missing required number still appropriately flagged.
- Court mode inherit↔custom; snapshot copying; weekday copy includes/excludes rates as chosen; unsaved edit and confirmation handling.
- Multi-period validation: adjacent allowed, overlapping refused, full-day and midnight consistent, Sunday-to-Monday overlaps refused, no open periods means closed.
- Venue-specific page title and initial neutral loading; Console title.

### Database pgTAP / integration

- Venue default backfill parity for all 7 weekdays, including closed, all-day and overnight.
- Effective open periods per court: inherited vs custom, changed venue defaults, copied snapshot not live-updated.
- No booking through closed gaps, blackout, inactive court, or another venue; walk-in cannot bypass strict hours.
- Valid booking inside period, multi-slot contiguous inside one period, no double booking, correct weekly override pricing on both sides of midnight.
- Save change with confirmed / payment-submitted / unexpired pending-payment booking does not alter those rows; expired hold not counted as active.
- Concurrent save/booking scenarios: no transient inconsistent validation; defensive constraints and transaction boundaries.
- `publish_venue` requires valid account and nonblank payment instructions, not just UI status; tests for ordinary venue admin, unauthorized staff, cross-venue, platform admin.
- Venue admin cannot toggle Showcase by `UPDATE`, RPC or REST; platform admin can; public view includes only active approved venues.

### E2E

- New venue setup → add court/rate/hours/payment account/mandatory instructions → publish.
- Admin navigation at desktop and 360px mobile; settings editing; payment link; public site unaffected.
- Editing Court 2 custom Monday split periods changes **only Court 2** availability; new 12 PM booking denied; 7 PM slot accepted at expected override rate.
- Changing venue defaults updates Court 1 inherited hours but not Court 2 custom hours.
- Active booking protected across schedule changes, normal payment confirmation flow still completes.
- Platform Showcase toggle changes marketing list without redeploy; other venue admins cannot edit it.
- Cold loading one venue and console never flashes Claudex brand/title.

Full test gate: `node .claude/hooks/verify-gate.mjs --full` (includes TS, ESLint, Vitest, pgTAP, and Playwright for UI changes), plus `npm run check:drift` as appropriate. Test only the local Supabase instance; do not modify live/linked DB without explicit approval.

## 9. Incremental implementation task plan (proposed, not assigned milestone numbers)

**Respect current Handoff:** `TASKS.md` currently points to M16 / T16.3. Do not overwrite this workstream or assign conflicting T-number IDs. Propose a future milestone/approved task block only after researching constraints and getting plan approval. Each unit below becomes one or more Claude `/implement` tasks with failing tests, full verify, reviewer, and a commit (no push without approval).

| Work package | Risk | Depends on | Deliverable |
|---|---|---|---|
| P0 — Research / technical plan gate | Medium | None | Confirm current schema/RPC contracts, SQL callsites, all venue UI routes, marketing consumer; list data backfill/incompatibility risks; add accepted decisions to SPEC §10 |
| P1 — Neutral titles/first loading | Low | None | Dynamic venue title, `Plotline Admin` console, no demo flash; e2e |
| P2 — Venue admin shell | Medium | None | Sidebar, mobile drawer, top bar, preserved alerts/permissions |
| P3 — Settings split | Medium | P2 ideally | Five category routes/cards, existing component reuse, focused forms/save states |
| P4 — Publish/payment clarity | Medium (DB) | P3 useful but not mandatory | Mandatory instructions enforced in RPC, checklist granular, account hints, setup query refresh |
| P5 — Showcase platform permissions | High (auth/DB) | P0 | Migrate control authority securely, platform console UI; keep `public_venues` compatible |
| P6 — Showcase marketing integration | Medium | P5 | `plotline-site` live venue feed, correct media rendering, empty/error states |
| P7 — Scheduling schema and parity layer | **High** | P0 | Additive migrations, RLS, backfill, pgTAP and compatibility plan; no UI switch yet |
| P8 — Effective availability / booking DB | **High** | P7 | All SQL booking validators and availability functions support periods, strict staff hours; protections and tests |
| P9 — New schedule React query/hooks + editor | High | P8 | Combined hours/rates UI, inherit/custom mode, copy, warnings and mobile behavior |
| P10 — Cutover and cleanup | High | P9 | Activate new schedule as one canonical source, replace duplicate old editors, cross-venue e2e, rollback documentation |
| P11 — Final admin UX polish | Low–Medium | P2–P4 | Dashboard clarity, court list scanability, empty states, accessibility pass |

**Suggested sequence:** P0 → (P1, P2, P3, P4) → (P5 then P6) → P7 → P8 → P9 → P10 → P11. DB security and schedule cutover require explicit user-approved plan gates and controlled deployment order. Marketing integration can be independent of scheduling.

## 10. Change map for Claude agents

**Likely platform frontend files:**

- `src/features/admin/AdminLayout.tsx`, `SettingsPage.tsx`, `SetupChecklist.tsx`, `SchedulePage.tsx`, `CourtRatesSection.tsx`, `CourtEditPage.tsx`, `CourtsPage.tsx`, `DashboardPage.tsx`, `ShowcaseSection.tsx` (remove from admin after secure migration), `PaymentAccountsSection.tsx`.
- `src/features/console/VenuesList.tsx`, `ConsolePage.tsx`, `api.ts`, `hooks.ts`.
- `src/features/catalog/api.ts`, `hooks.ts`, `hours.ts`; `src/features/venue/VenueProvider.tsx`, `src/main.tsx`, `src/routes/router.tsx`, `index.html`.
- Add focused components/hooks/tests; avoid concentrating all new UX logic into `SchedulePage.tsx`.

**Likely backend migration/function targets:**

- Existing `operating_hours`, `court_rates`, `courts`, `blackouts`, `bookings`, `venue_settings`, `venue_payment_accounts`; new periods/mode tables subject to research.
- RPCs/functions to audit: `venue_setup_status`, `publish_venue`, `set_operating_hours`, `get_availability`, `private.operating_day_range`, `private.operating_day_of`, `private.validate_booking_slot`, `private.slot_price`, `private.range_price`, `create_booking`, `create_walk_in`, `reschedule_booking`, review/payment completion and open-play creation, plus all venue-aware variants.
- **Only new** `supabase/migrations/<timestamp>_*.sql`; regenerate `src/lib/database.types.ts` after approval and migration application, never edit generated types directly.

**Likely marketing targets:**

- `plotline-site/src/config/site.ts` current static `venues`; actual venue-rendering component to locate; shared Supabase reader, tests, and docs.

## 11. Questions for technical verification (not unresolved product choices)

These are implementation checks for `/research` or the plan gate, not questions the user must answer now:

1. Precisely which current SQL RPCs and read paths use one-range `operating_day_range` assumptions, including refunds, PayMongo, open play, dashboard, and availability?
2. What are the actual constraints for end time after 24:00 and pricing row `start_hour`? Preserve existing behavior without unintentionally expanding allowable overnight windows.
3. Is `get_availability` grouped per operating day with one continuous range, and what frontend contract changes are necessary to return multiple periods safely?
4. How are sessions/open play represented during a schedule change? If occupied periods fall outside hours, do we preserve them and show warnings analogously to active reservations, or require a separate approved choice?
5. Which `venue_settings` columns are currently editable under RLS? How can Showcase be made platform-only without breaking normal admin settings updates?
6. What is the correct publicly readable media URL for `public_venues.logo_url`, and is `public_venues` already consumed by any shipped marketing code?
7. What is the precise existing time model for recurring 24-hour schedules and after-midnight rate ownership? Add parity fixtures before switching logic.
8. What is the current release/branch and feature flag convention? Stage migrations and deploy sequencing to avoid old JS clients corrupting split schedules.

## 12. Handoff prompt for Claude (copyable)

> Read `CLAUDE.md`, the current `TASKS.md` **Handoff**, `SPEC.md`, `RESEARCH.md`, and `docs/PLATFORM.md`. Then read `PLOTLINE_ADMIN_SCHEDULING_IMPLEMENTATION_SPEC.md` as a **proposal**, not as permission to change code or bypass the plan gate. Start with **P0 research and a risk/compatibility review**, especially the one-range operating-hour assumptions, venue-aware SQL RPCs, overnight and rate semantics, and Showcase authorization. Verify all filenames/types against the checked-out branch and generated database types (CLAUDE.md L3). Propose how to incorporate accepted behavior into SPEC §10 and a future, non-conflicting TASKS milestone. Do **not** implement schema changes, deploy, push, or modify the harness until the user approves the risky plan. Then follow the repo's `/implement` process: failing tests, small increments, full gate, reviewer, documented handoff, commit but no push. Keep `plotline-site` DB changes out of that repo and follow PLATFORM.md's backward-compatibility sequence.

---

**Definition of done for the overall initiative:** Users can configure split weekly opening periods per court with inherited venue defaults and weekly hourly rates through a clean admin sidebar and organized settings; invalid bookings through gaps are impossible at DB level; valid active reservations are preserved; payment instructions gate publishing clearly; Showcase is platform-admin-only and reflected on marketing site; venue branding is correct from initial load; the existing suite and newly added security/scheduling tests pass. No production deployment occurs without a separate explicit approval.
