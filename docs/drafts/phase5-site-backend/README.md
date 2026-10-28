# Draft: marketing site backend (SAAS-PLAN Phase 5)

**Not active.** These files are parked here so nothing runs them yet: migrations, pgTAP, Vitest, the type check and function deploys only look in `supabase/` and `src/`. They move into place when Phase 5 starts, through the normal `/implement` flow (with its plan gate). Background: [docs/PLATFORM.md](../../PLATFORM.md) §4–5.

Prepared and checked on 2026-10-27, outside this repo:
- the migration on a throwaway Postgres 16 with Supabase stand-ins plus `20261016154902_profiles_and_roles.sql`: pgTAP 17/17, and `00_rls_coverage` still 2/2;
- `siteForms.test.ts` 24/24 under Vitest;
- `deno check` on both functions;
- a live run of `site-contact` (bots, validation, CORS, Turnstile, 503 when its secret is missing on a hosted project).

The full local stack and `npm run verify` haven't been run with them; do that when they move in.

## Moving them into place

| Draft | Goes to |
| --- | --- |
| `supabase/migrations/YYYYMMDDHHMMSS_site_leads_and_reviews.sql` | Run `npx supabase migration new site_leads_and_reviews`, then paste this content into the new file |
| `supabase/tests/database/NN_site_leads_reviews.test.sql` | `supabase/tests/database/`, with `NN` set to the next free number |
| `supabase/functions/_shared/siteForms.ts`, `siteForms.test.ts`, `siteHttp.ts` | `supabase/functions/_shared/` |
| `supabase/functions/site-contact/`, `site-review/` | `supabase/functions/` |
| `supabase/config.toml.snippet` | Paste its two blocks into `supabase/config.toml` |

Then:
- **Secrets on each hosted project:** `SITE_ORIGINS` (`https://plotline.fit,https://www.plotline.fit`, plus `http://localhost:5173` on staging) and `TURNSTILE_SECRET_KEY`.
- **Checks and deploy:** `npm run verify`, `db:push` (staging first), `db:types`, then deploy `site-contact` and `site-review`.
- **plotline-site's side:** its `docs/drafts/phase5/`.
- **Clean up:** delete this folder.
