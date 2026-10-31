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
- **Hosting:** Cloudflare (Workers static assets, free plan, commercial use allowed). Today court-booking-system is still on Vercel (`court-booking-system-ashen.vercel.app`) and plotline-site isn't deployed.

## 3. Supabase projects

| Project | Region | Used by | Status |
| --- | --- | --- | --- |
| **Production** | Singapore (`ap-southeast-1`) | Both repos | *Target*: not created yet (SAAS-PLAN Phase 0). Free until the first paying venue, then Pro. |
| **Staging** | Singapore | Both repos, for previews and testing | Today's linked `court-booking-system` project. It also runs the current Vercel demo. |
| plotline-site's own local project | (local only, ports 553xx) | plotline-site | **Transitional.** Never deployed. Retired when its tables and functions move here (§5). |

**Rules:**
- **This repo owns the schema of every project.** Migrations, RLS, triggers, cron jobs, storage buckets and Edge Functions are created and changed **only here**. Two repos pushing migrations to one database break each other's migration history (`supabase db push` tracks applied versions), so plotline-site never runs `db push` or deploys functions to a shared project.
- plotline-site uses only the **publishable key** (in `VITE_*` vars), calls the Edge Functions in §4, and reads the public tables in §4. It generates its `database.types.ts` from the shared project (`supabase gen types --project-id <ref>`).
- Service-role keys and other secrets live only in Edge Function secrets of this repo.

## 4. The contract plotline-site depends on

Anything here is a **public API**: changing it can break the live marketing site. Follow §7.

### Edge Functions (*target*; moved from plotline-site in Phase 5)

Both are `POST`, called with `supabase.functions.invoke(name, { body })` and the publishable key (`verify_jwt = false`). Both answer `{ ok: true, … }` on success, and `{ ok: false, error }` with a readable message on 4xx/5xx. Bots (the honeypot filled, or the form sent within 3 seconds of first touch) get a fake success.

**`site-contact`**: a venue owner's contact form. Stores a lead; no account is created.

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

Replies: `200 { ok: true }`, `400 { ok: false, error }` for a validation error, `403` when Turnstile fails, `500` on a server error.

**`site-review`**: a review from a player or owner. Stored unapproved; shown once we approve it.

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

### Tables and views plotline-site reads

| Object | Access | Columns plotline-site uses |
| --- | --- | --- |
| `public.reviews` | anon `select`; RLS returns approved rows only | `id, name, venue, quote, role, rating, created_at` |
| `public.public_venues` (*target*, Phase 3) | anon `select`: active venues that opted in to be listed | `slug, name, city, logo_url` (link: `https://<slug>.plotline.fit`) |

plotline-site never writes to tables directly and never reads `leads`.

M12 (done 2026-10-31) made the schema multi-venue (`venues`, `venue_members`, `platform_admins`, `venue_id` everywhere) and dropped `profiles.role` and `venue_settings.id`. None of that is part of this contract, so plotline-site needed no change; its generated types lose only those columns.

### Environment

| Repo | Variable | Value |
| --- | --- | --- |
| plotline-site | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | The shared project's URL and publishable key (staging or production) |
| plotline-site | `VITE_TURNSTILE_SITE_KEY` | Cloudflare Turnstile site key (public) |
| this repo, Edge Function secrets | `SITE_ORIGINS` | Allowed origins for the site functions, comma-separated: `https://plotline.fit,https://www.plotline.fit` (plus `http://localhost:5173` on staging) |
| this repo, Edge Function secrets | `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret. Required on hosted projects; skipped locally when unset. |
| this repo, Edge Function secrets | `PUBLIC_ROOT_DOMAIN` | `plotline.fit` (T13.6). Booking return and email links go to `https://<venue slug>.plotline.fit`, built from the booking's own venue, never from a request value. Unset until the wildcard DNS is live (T13.8); `PUBLIC_SITE_URL` stays as the exact allow-list for localhost and the old Vercel URL. |
| Supabase Auth, URL configuration | Redirect URLs | Add `https://*.plotline.fit/**` (done by hand in the dashboard; T13.6). Keep the existing entries until T13.8. |

## 5. Moving plotline-site's backend here (Phase 5)

Today plotline-site has its own migration (`venue_signups`, `reviews`) and Edge Functions (`register`, `feedback`), and its sign-up creates auth accounts with a 7-day trial. Under the plan, owners don't sign up and there's no trial, so:

| Today (plotline-site) | Target (this repo) |
| --- | --- |
| `venue_signups` (auth user + trial) | `leads` (no account; status `new` → `talking` → `won` / `lost`, with notes) |
| `reviews` | `reviews` (same shape; admins can approve in-app) |
| `register` function | `site-contact` |
| `feedback` function | `site-review` |
| `_shared/validate.ts` | `_shared/siteForms.ts` (+ the copy in plotline-site) |

The prepared drafts are in [`docs/drafts/phase5-site-backend/`](drafts/phase5-site-backend/) (and plotline-site's side in its `docs/drafts/phase5/`). After the move: delete plotline-site's `supabase/migrations`, `supabase/functions` and `supabase/tests`, and keep only what it needs to generate types.

## 6. Shared values

- **Brand:** [`docs/BRAND.md`](BRAND.md) in this repo is the brand guide for both sites (palette, Fraunces and DM Sans, the logo). The logo files originally came from plotline-site; both repos keep their own copies of the assets.
- **Product name:** Plotline. Venues' public pages show the venue's name, with "Powered by Plotline" linking to `https://plotline.fit`.
- **Pricing (not final):** free for venues; a ₱10 booking fee per confirmed online booking, paid by the player. See SAAS-PLAN §1 and §5. The marketing copy must match.
- **Support contacts** (email, Messenger): set once in plotline-site's `src/config/site.ts`; this repo's emails and footer use the same values.

## 7. Changing something shared

1. **Update this file first:** the contract, the domains, or the shared values.
2. Record the decision in SPEC.md §10 (and SAAS-PLAN.md if it's a plan change).
3. **Build it here** with tests, and deploy it to staging, then production. Keep it backward compatible (expand → deploy → contract): the live marketing site must keep working until it's updated.
4. **Update plotline-site:** copy `siteForms.ts` if the rules changed, regenerate types, adjust the forms.
5. Remove anything old only after both are live.

For Claude Code: start in one repo and add the other with `claude --add-dir ../plotline-site` (or `../court-booking-system`), or `/add-dir` during a session.
