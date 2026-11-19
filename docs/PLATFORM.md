# Plotline platform map

> The single source of truth for how Plotline's two repositories fit together. **This file lives only in `court-booking-system`.** `plotline-site` links here instead of keeping its own copy. Update this file first whenever something shared changes (§7).
>
> Status: written 2026-10-27. Some of this is the **target** (marked *target*), reached in the SaaS phases of [SAAS-PLAN.md](SAAS-PLAN.md). The rest is how things are today.

## 1. The two repositories

| Repo | What it is | Owns | Deploys to (*target*) |
| --- | --- | --- | --- |
| [`court-booking-system`](https://github.com/baringmarc/court-booking-system) (this repo) | **The platform and product.** The booking app every venue runs on, the venue admin area, our platform console, the database and all Edge Functions. | All Supabase schema and migrations, RLS, Edge Functions, the SaaS plan, the decisions log, the brand guide. | `*.plotline.fit` (one wildcard deployment): each venue at `<slug>.plotline.fit`, our console at `app.plotline.fit`. |
| [`plotline-site`](https://github.com/baringmarc/plotline-site) | **The marketing site.** Where venue owners learn about Plotline, see the demo and reviews, and send the contact form. | Its own frontend only: pages, copy (`src/config/site.ts`), styles. | `plotline.fit` and `www.plotline.fit`. |

Locally both repos sit side by side: `~/Documents/Projects/court-booking-system` and `~/Documents/Projects/plotline-site`. Code in one never imports files from the other; they meet only through the contract in §4.

## 2. Domains and hosts (*target*)

| Host | Served by | Notes |
| --- | --- | --- |
| `plotline.fit`, `www.plotline.fit` | plotline-site | Marketing. `www` redirects to the apex. |
| `<slug>.plotline.fit` | court-booking-system | One venue's booking site; `/admin` is its staff area. The app reads the subdomain to pick the venue. |
| `app.plotline.fit` | court-booking-system | Our platform console (leads, venues, invoices). Same build; the hostname selects console mode. |
| `claudex-courts.plotline.fit` | court-booking-system | Venue #1, Claudex Courts: the demo venue, reset nightly. The marketing site's "See a live demo" links here. |

- **Reserved subdomains** (never a venue slug): `www`, `app`, `api`, `admin`, `demo`, `staging`, `mail`, `help`, `blog`, `status`, `support`, `plotline`.
- **DNS and TLS:** one Cloudflare zone for `plotline.fit`. The apex points at plotline-site; a proxied wildcard record `*.plotline.fit` routes to court-booking-system. Cloudflare's free certificate covers the apex and `*.plotline.fit`.
- **Email:** `mail.plotline.fit` is in use (since 2026-10-30, T11.26): the verified Resend sending domain (SPF, DKIM and the bounce MX in the Cloudflare zone). Booking emails go from `bookings@mail.plotline.fit` with the venue's name, Supabase Auth emails from `no-reply@mail.plotline.fit` (T11.26).
- **Hosting:** Cloudflare (Workers static assets, free plan, commercial use allowed). Both repos deploy automatically on every push to `master` through Cloudflare Workers Builds (each Worker → Settings → Builds is connected to its GitHub repo; build `npm run build`, deploy `npx wrangler deploy`). Workers Builds doesn't run `npm run verify`, so it must pass before merging. The old Vercel URL (`court-booking-system-ashen.vercel.app`) only redirects (step 5 below), and staging still deploys to Vercel.
- **Deploying court-booking-system to Cloudflare (T13.8):** `wrangler.jsonc` serves `dist/` as static assets with SPA fallback (no Worker script) on the route `*.plotline.fit/*`.
  1. Once: `npx wrangler login`; in the Cloudflare dashboard add a **proxied** DNS record `*` (type `AAAA`, `100::`) in the `plotline.fit` zone. The apex and `www` keep pointing at plotline-site.
  2. Build with the production `.env` values (`npm run build`), then `npm run cf:deploy`. The Worker is named `court-booking-system` (it already held the route); the route is created from `wrangler.jsonc`.
  3. Check `https://claudex-courts.plotline.fit/` and a deep link (`/book`, `/admin/login`).
  4. Then set the secret `PUBLIC_ROOT_DOMAIN=plotline.fit` (`npx supabase secrets set`) and deploy the three functions (T13.6).
  5. Last, the old Vercel URL redirects to `claudex-courts.plotline.fit` (`vercel.json`, temporary 307, path kept, `assets/` excluded so already-open or cached old pages still load their scripts instead of failing on CORS; browsers keep `#token=` fragments). It takes effect when `develop` is merged into `master`, so do steps 3–4 first: until `PUBLIC_ROOT_DOMAIN` is set, emails and PayMongo returns still point at the Vercel URL.
  - Previews: `npm run cf:preview` uploads a version with its own preview URL. It has no venue subdomain, so open it with `?venue=<slug>`, and build it against staging.
  - Local check: `npm run build && npm run cf:dev` serves deep links on http://localhost:8788.

## 3. Supabase projects

| Project | Region | Used by | Status |
| --- | --- | --- | --- |
| **Production** | Singapore (`ap-southeast-1`) | Both repos | `jmichyttnqygwdcksbpg`, since the region move on 2026-11-17 (`docs/ops/REGION-MOVE.md`). The first production project, `sfssolhsthteonzgzfos` (created 2026-11-01), was in Ireland (`eu-west-1`); it's frozen as a safety net, paused at day 14 and deleted at day 30. The CLI stays linked to staging; deploy here deliberately with `--project-ref jmichyttnqygwdcksbpg` where the command takes it, otherwise `npx supabase link --project-ref jmichyttnqygwdcksbpg`, then link back. Free until the first paying venue, then Pro. |
| **Staging** | Singapore | Both repos, for previews and testing | Today's linked `court-booking-system` project. It also runs the current Vercel demo. |
| plotline-site's own local project | (local only, ports 553xx) | plotline-site | **Transitional.** Never deployed. Retired when its tables and functions move here (§5). |

**Rules:**
- **This repo owns the schema of every project.** Migrations, RLS, triggers, cron jobs, storage buckets and Edge Functions are created and changed **only here**. Two repos pushing migrations to one database break each other's migration history (`supabase db push` tracks applied versions), so plotline-site never runs `db push` or deploys functions to a shared project.
- plotline-site uses only the **publishable key** (in `VITE_*` vars), calls the Edge Functions in §4, and reads the public tables in §4. It generates its `database.types.ts` from the shared project (`supabase gen types --project-id <ref>`).
- Service-role keys and other secrets live only in Edge Function secrets of this repo.

## 4. The contract plotline-site depends on

Anything here is a **public API**: changing it can break the live marketing site. Follow §7.

### Edge Functions (live on the linked project since 2026-11-01: `site-contact` (T15.2) and `site-review` (T15.4))

Both are `POST`, called with `supabase.functions.invoke(name, { body })` and the publishable key (`verify_jwt = false`). Both answer `{ ok: true, … }` on success, and `{ ok: false, error }` with a readable message on 4xx/5xx. Bots (the honeypot filled, or the form sent within 3 seconds of first touch) get a fake success.

**`site-contact`**: a venue owner's contact form. Stores a lead and emails `LEAD_ALERT_TO` (best-effort: a failed alert never fails the save); no account is created. Only platform admins read leads (RLS); nothing in the marketing site reads them. Platform admins may delete a lead (`delete_lead`, T17.26); that never affects a venue or account and the same person can submit again.

| Field | Type | Rule |
| --- | --- | --- |
| `firstName`, `lastName` | string | 1–60 characters |
| `email` | string | valid email, ≤ 254; stored lowercase |
| `phone` | string | PH mobile (`09XXXXXXXXX` or `+639XXXXXXXXX`; spaces and dashes allowed) |
| `venueName` | string | 2–80 |
| `location` | string | city or town, 2–120 |
| `courts` | integer | 1–50 |
| `facebook` | string | optional, ≤ 200 |
| `message` | string | optional, ≤ 1000 |
| `consent` | boolean | must be `true` (agrees to be contacted and to the privacy notice) |
| `website` | string | honeypot: must be empty |
| `started` | number | ms timestamp of the first touch on the form |
| `turnstileToken` | string | Cloudflare Turnstile token (required in production) |

Replies: `200 { ok: true }`, `400 { ok: false, error }` for a validation error, `403` when Turnstile fails, `503` when the project has no `TURNSTILE_SECRET_KEY` (the form is unavailable; show "message us instead"), `500` on a server error. `SITE_ORIGINS` is enforced by CORS: a browser on another origin gets no `Access-Control-Allow-Origin` header and cannot read the reply (a non-browser client can still post; Turnstile is what stops it).

**`site-review`**: a review from a player or owner. Stored hidden (`approved = false`); shown once a platform admin approves it in the console's Reviews section. Only the honeypot and the 3-second timing check guard it (no Turnstile).

| Field | Type | Rule |
| --- | --- | --- |
| `name` | string | 1–60 |
| `venue` | string | optional, ≤ 80 |
| `quote` | string | 10–400 |
| `role` | `'player'` \| `'owner'` | |
| `rating` | integer | 1–5 |
| `consent` | boolean | must be `true` (allows us to show it) |
| `website`, `started` | | as above |

Reply: `200 { ok: true, message }`.

**Validation lives in `supabase/functions/_shared/siteForms.ts`** in this repo; the server's check is the one that counts. plotline-site keeps an **identical copy** at `src/lib/siteForms.ts` for instant form feedback. When the rules change, change them here first, then copy the file over unchanged.

### Live stacks (M29: contract written 2026-11-19, built here in T29.3–T29.7 and in plotline-site's Milestone 6 (T29.8); on staging and production since 2026-11-19)

Players open an organizer's Paddle Stack on their own phones from a link or QR and see it update live. **View-only: no player accounts; only the organizer's device changes anything.** Nothing here changes `public_venues`. Rationale and the user's calls: SPEC §10 2026-11-18; the spike and limits: RESEARCH "Milestone 29". Every name below is final once deployed; changes follow §7.

**`stack-live`** (Edge Function, `POST`, `verify_jwt = false`, CORS from `SITE_ORIGINS` exactly like `site-contact`): an organizer at plotline.fit goes live without signing in. It checks the body, verifies Turnstile, then creates a stack with no venue (through the service-role-only RPC `create_site_live_stack`, which plotline-site never calls).

| Field | Type | Rule |
| --- | --- | --- |
| `turnstileToken` | string | Cloudflare Turnstile token, a fresh one for every "Go live" (a token is single use and valid for 300 s; reset the widget after use). Required in production. |
| `courts` | integer | 1–12 |
| `title` | string | optional, ≤ 60 characters (trimmed; empty means no title) |

Replies: `200 { ok: true, code, secret }`; `400 { ok: false, error: 'invalid_input' }`; `403 { ok: false, error: 'bot_check_failed' }`; `409 { ok: false, error: 'busy' }` (300 live stacks already; "try again later"); `503 { ok: false, error: 'unavailable' }` when a hosted project has no `TURNSTILE_SECRET_KEY` (Go live is unavailable; the organizer can still run the board without sharing it; on a local stack the check is skipped when the secret is unset, as for `site-contact`, so e2e and smoke tests need no Cloudflare); `500 { ok: false, error: 'server_error' }`. Errors carry a stable `error` code, not prose; plotline-site words them. Logs hold no titles, names or snapshots.

- **`code`** identifies the stack and is public (it is in the link): 128 random bits, URL-safe. Stacks can't be listed or enumerated; only a known code reads.
- **`secret`** lets one device publish. It is returned once, **only its hash is stored**, and it stays on the organizer's device (`localStorage`). It never goes in a query string or to a server other than `publish_live_stack`.

**RPCs** (called with the publishable key through `supabase.rpc`; the table `live_stacks` has no grants, so reads and writes happen only through these):

| RPC | Who | Returns / does |
| --- | --- | --- |
| `get_live_stack(p_code text)` | anyone | `{ title, courts, snapshot, version, ended, expires_at, venue }` where `venue` is `{ name, slug, logo_path }` for a venue's stack and `null` for a plotline.fit stack. `snapshot` is `null` until the first publish. `title` is `null` for an untitled stack (a blank title is stored as null). Hint `not_found` for an unknown or expired code (viewers show "This stack has ended"). `logo_path` is a path in the public `venue-media` bucket (`<supabase url>/storage/v1/object/public/venue-media/<logo_path>`); null when the venue has none. |
| `publish_live_stack(p_code text, p_secret text, p_version integer, p_snapshot jsonb, p_end boolean default false)` | anyone holding the secret | Stores the snapshot and broadcasts it. Returns `{ version, expires_at }`. |
| `create_venue_live_stack(p_open_play_session_id uuid)` | admins of the session's venue (signed in) | Returns `{ code, secret }`. Title and courts come from the session. Running it again for the same session returns the same `code` with a **new** secret: the newest device takes over and the old one's publishes get `forbidden`. Hints `forbidden`, `not_found`, `session_ended`, `busy`. Used only by this repo's `/admin/open-play`, not by plotline-site. |

`publish_live_stack` checks in this order and answers with the first failing **hint** (the error's `hint`, as the booking RPCs do): `not_found`, `forbidden` (wrong secret), `ended`, `stale_version` (`p_version` not above the stored one: re-read with `get_live_stack`, continue from its `version`), `too_fast` (under the minimum gap since the last publish: wait and retry with the latest snapshot), `too_large` (`p_snapshot` over 64 KB as text), `invalid_snapshot` (not a JSON object with an integer `v`), `limit_reached` (5,000 publishes for the stack). With `p_end = true` the stack is marked ended: it stays readable (final standings) and later publishes get `ended`.

**Snapshot.** A JSON object with an integer `v` (the snapshot format version), at most 64 KB. **Its other fields belong to plotline-site**, which documents them in its SPEC; the database checks only size, object-ness and `v`. `p_version` is the publish counter, not `v`: it starts at 1 and must rise on every publish.

**Realtime.** A successful publish broadcasts `{ version, snapshot, ended }` with event name `snapshot` on the **public** channel `live-stack:<code>`, from the database, inside the publishing transaction (a failed publish sends nothing). Viewers subscribe with the publishable key and no sign-in (`supabase.channel('live-stack:' + code)`, default public channel, `.on('broadcast', { event: 'snapshot' }, …)`); the payload arrives with an extra `id` field, which clients ignore. If the broadcast itself fails, the snapshot is still stored and `publish_live_stack` still succeeds.
- **Organizer:** join your own channel as soon as the stack exists and keep it for the session (it makes today's `realtime.messages` partition exist before the first publish). Publish at most **one snapshot every 2 seconds** (coalesce changes; the server minimum is 1 s) because each delivery to each phone counts toward the plan's 100 events a second.
- **Viewer fallback:** if the channel status is `CLOSED`, `CHANNEL_ERROR` or `TIMED_OUT` (also when the project is over its Realtime limits), call `get_live_stack` every **15 seconds** until it reconnects; ignore any snapshot whose `version` is not above the one shown. Show the time of the last update.

**Hand-off from a venue's `/admin/open-play`:** the page opens `https://plotline.fit/paddle-stack?live=<code>#key=<secret>` in a new tab. The secret is in the URL **fragment**, which browsers never send to a server; plotline-site reads it, moves it to `localStorage` and removes the fragment from the address bar. The player link is `https://plotline.fit/paddle-stack/live/<code>`.

**Life and limits** (assumed in SPEC §10 2026-11-18; confirmed at T29.4's plan gate): a stack lives until **24 hours after its last publish** (`expires_at`); an hourly job deletes expired stacks. At most 300 live stacks at once, 64 KB a snapshot, 5,000 publishes a stack. **Privacy:** player names in a snapshot are stored on Plotline's servers in Singapore until the stack is deleted, and each broadcast also stays in Supabase Realtime's message table for **up to 3 days**, so plotline-site's Privacy page says "up to 3 days after its last change". A venue stack disappears with its venue; ending the session does not delete it early.

**Environment:** `stack-live` shares the project's `TURNSTILE_SECRET_KEY` and `SITE_ORIGINS` (§4 Environment). Staging and production need the secret before `stack-live` works. plotline-site adds no new variables.

### Tables and views plotline-site reads

| Object | Access | Columns plotline-site uses |
| --- | --- | --- |
| `public.reviews` | anon `select`; RLS returns approved rows only | `id, name, venue, quote, role, rating, created_at` |
| `public.public_venues` (T14.13, T17.7) | anon `select`: active venues approved by a platform admin (`venues.showcase_approved`). Existing `venue_settings.showcase_opt_in` values are retained unchanged for review and do not publish a venue; platform admins change approval through `set_venue_showcase_approval`. | `slug, name, city, logo_url` (link: `https://<slug>.plotline.fit`). The columns and types remain unchanged. `logo_url` is a path inside the public `venue-media` bucket (the venue's banner, else its first court photo, else null): prefix it with `<supabase url>/storage/v1/object/public/venue-media/`. `city` may be empty. |

plotline-site never writes to tables directly and never reads `leads` or `live_stacks` (live stacks go through the RPCs above).

M12 (done 2026-10-31) made the schema multi-venue (`venues`, `venue_members`, `platform_admins`, `venue_id` everywhere) and dropped `profiles.role` and `venue_settings.id`. None of that is part of this contract, so plotline-site needed no change; its generated types lose only those columns.

### Environment

| Repo | Variable | Value |
| --- | --- | --- |
| plotline-site | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | The shared project's URL and publishable key (staging or production) |
| plotline-site | `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (public) |
| this repo, Edge Function secrets | `SITE_ORIGINS` | Allowed origins for the site functions, comma-separated: `https://plotline.fit,https://www.plotline.fit` (plus `http://localhost:5173` on staging) |
| this repo, Edge Function secrets | `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret. Required on hosted projects; skipped locally when unset. |
| this repo, Edge Function secrets | `LEAD_ALERT_TO` | Addresses (comma-separated) emailed when `site-contact` stores a lead. Unset: no alert. Uses the booking-email transport (`EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`). |
| this repo, Edge Function secrets | `SENTRY_DSN` | Sentry DSN for every Edge Function, including `site-contact` and `site-review` (T16.3). Unset: no error reporting. Events are scrubbed (SPEC §10 2026-11-08). |
| this repo, Edge Function secrets | `PUBLIC_ROOT_DOMAIN` | `plotline.fit` (T13.6). Booking return and email links go to `https://<venue slug>.plotline.fit`, built from the booking's own venue, never from a request value. Unset until the wildcard DNS is live (T13.8); `PUBLIC_SITE_URL` stays as the exact allow-list for localhost and the old Vercel URL. |
| Supabase Auth, URL configuration | Redirect URLs | Add `https://*.plotline.fit/**` (done by hand in the dashboard; T13.6). Keep the existing entries until T13.8. |

## 5. Moving plotline-site's backend here (Phase 5) ✅ built here (M14–M15)

Today plotline-site has its own migration (`venue_signups`, `reviews`) and Edge Functions (`register`, `feedback`), and its sign-up creates auth accounts with a 7-day trial. Under the plan, owners don't sign up and there's no trial, so:

| Today (plotline-site) | Target (this repo) |
| --- | --- |
| `venue_signups` (auth user + trial) | `leads` (no account; status `new` → `talking` → `won` / `lost`, with notes) |
| `reviews` | `reviews` (same shape; admins can approve in-app) |
| `register` function | `site-contact` |
| `feedback` function | `site-review` |
| `_shared/validate.ts` | `_shared/siteForms.ts` (+ the copy in plotline-site) |

The backend side is done and live on the linked project (`leads` T14.2, `reviews` T15.4, `site-contact` T15.2, `site-review` T15.4, the lead alert T15.3); the drafts folder is deleted. **What plotline-site does next** (its own tasks, in its repo):
1. **T1.8:** switch its forms to `site-contact` and `site-review` (already done in T1.7), then delete `features/signup`, `/welcome`, its `supabase/migrations`, `functions` and `tests`, and the old `db:*` scripts. Generate types from the shared project.
2. **T1.11b:** set `VITE_TURNSTILE_SITE_KEY` (production widget), `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the Cloudflare Workers deploy, then deploy the apex and `www`.
3. Keep `src/lib/siteForms.ts` byte-identical to `supabase/functions/_shared/siteForms.ts` (checked on 2026-11-01).

## 6. Shared values

- **Brand:** [`docs/BRAND.md`](BRAND.md) in this repo is the brand guide for both sites (palette, Fraunces and DM Sans, the logo). The logo files originally came from plotline-site; both repos keep their own copies of the assets.
- **Product name:** Plotline. Venues' public pages show the venue's name, with "Powered by Plotline" linking to `https://plotline.fit`.
- **Pricing (not final):** free for venues; a ₱10 booking fee per confirmed online booking, paid by the player. See SAAS-PLAN §1 and §5. The marketing copy must match.
- **Support contacts** (email, Messenger): set once in plotline-site's `src/config/site.ts`; this repo's emails and footer use the same values.

- **Admin tour assets (M21):** the pictures and demo video on plotline-site's landing page are made here and only displayed there. Source: `docs/admin-tour/` (ten PNGs, `admin-demo.mp4`, `admin-demo.webm`, `admin-demo-poster.jpg`, `admin-demo.vtt`; stable names, listed in its README). Commands: `npm run tour:shots` and `npm run tour:video` (local stack; the video needs ffmpeg). Each copies its files to `../plotline-site/public/admin-tour/` when that repo is checked out, and the two copies must stay byte-identical. This repo re-captures whenever an admin page in the tour changes, and before a plotline-site release that changes the tour; plotline-site never edits the files.

## 7. Changing something shared

1. **Update this file first:** the contract, the domains, or the shared values.
2. Record the decision in SPEC.md §10 (and SAAS-PLAN.md if it's a plan change).
3. **Build it here** with tests, and deploy it to staging, then production. Keep it backward compatible (expand → deploy → contract): the live marketing site must keep working until it's updated.
4. **Update plotline-site:** copy `siteForms.ts` if the rules changed, regenerate types, adjust the forms.
5. Remove anything old only after both are live.

**Release notes**

- **2026-11-19, M29 Live stacks:** migrations `20261119044143_t29_3_venue_logo`, `20261119051606_t29_4_live_stacks` and `20261119055437_t29_5_site_live_stack` reached staging, then production (`jmichyttnqygwdcksbpg`); `stack-live` v1 was then deployed to both (same bundle, `verify_jwt` false); both frontends followed the backend: plotline-site's Milestone 6 (Worker `1292fe10`, then `abb3134b`) and this repo's T29.6–T29.7 through `master` (PR #49). Checked at T29.9 (L6): `npm run preflight:release -- --project-ref jmichyttnqygwdcksbpg` passed (100 migrations, 11 functions) and `functions list` there shows `stack-live` v1 active.

For Claude Code: start in one repo and add the other with `claude --add-dir ../plotline-site` (or `../court-booking-system`), or `/add-dir` during a session.

## Approved M17 transition (2026-11-03; released 2026-11-06)

The user approved platform-admin-only Showcase control and a live marketing feed, superseding venue-editable opt-in and plotline-site’s demo-only list decision. T17.7 introduces `venues.showcase_approved` (default false) and the authorized `set_venue_showcase_approval` RPC; the previous `venue_settings.showcase_opt_in` selections remain unchanged for review before activation, and direct writes to that legacy column are blocked. The public view keeps exactly `slug, name, city, logo_url` and their existing types; `logo_url` remains a path in `venue-media`. Only active approved venues appear. City stays venue-editable, and ordinary settings updates continue to work. Released to staging and production on 2026-11-06 with the user's approval; until a platform admin approves venues, production `public_venues` returns no rows.

Both projects now run the T17.7 implementation (the T14.13 opt-in no longer publishes a venue). Platform implementation precedes the marketing consumer. Marketing uses its existing public client/query cache, bounded refetch and loading/empty/error states. The separate demo CTA remains; the featured feed must not fall back to unapproved or unpublished venues. No siteForms or Edge Function contract change is planned.

plotline-site T3.1 (2026-11-07, commit `9f7f2cc` there, not deployed): the Venues section reads `public_venues` live (5-minute stale time, refetch on focus, at most 24 by name), filters out `claudex-courts` (the demo keeps its own link) and shows the demo card when the feed is empty or fails. No contract change. T17.30's `e2e/showcase-feed.spec.ts` runs that site against the local stack and proves the console approval → marketing page journey.

T17.17 (schedule cutover; migration released 2026-11-06, no venue activated): no contract change for plotline-site. `public_venues`, `site-contact` and `site-review` are untouched. Release and rollback: `docs/SCHEDULE-CUTOVER.md`.
