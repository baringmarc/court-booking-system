# CLAUDE.md

Plotline's product: the court booking app that every Plotline venue runs on. Today it serves one venue (Claudex Courts, the demo); the SaaS milestones make it multi-venue (`docs/SAAS-PLAN.md`).

This repo is also **the platform repo**: it owns the database schema, all Edge Functions, the plan and the brand for both Plotline repositories. The marketing site lives in [`plotline-site`](https://github.com/baringmarc/plotline-site) (locally `../plotline-site`). **[docs/PLATFORM.md](docs/PLATFORM.md) maps how the two fit together.**

## Guide docs
- **[SPEC.md](SPEC.md)**: what the product does (requirements, data model, booking lifecycle, decisions log). Update it whenever behavior changes.
- **[TASKS.md](TASKS.md)**: what to build next. Read its **Handoff** section first and update it before you stop. A task is done only when its acceptance criteria hold, `npm run verify` passes and the `reviewer` agent has no blocking issues.
- **Workflow:** run `/implement` to work on the next task (`/implement T3.4` for a specific task, `/implement milestone` for the whole milestone). It goes orient → research → plan gate (risky DB or security work waits for approval) → build → verify → `reviewer` agent → tick the task and update the handoff → commit (never push) once verify passes and the reviewer signs off.
- **[RESEARCH.md](RESEARCH.md)**: technical findings, with sources, gathered before a milestone is built. Research first, then implement. Accepted recommendations go into SPEC §10.

## Platform (two repos, one database)
- **[docs/PLATFORM.md](docs/PLATFORM.md)** is the single source of truth for what's shared with `plotline-site`: domains, Supabase projects, and the contract the marketing site depends on (the `site-contact` and `site-review` functions, the `reviews` and `public_venues` reads). Read it before touching any of those.
- **All migrations and Edge Functions for every shared Supabase project are made here**, never in plotline-site. Two repos pushing migrations to one database break each other's migration history.
- **Contract changes are backward compatible:** update PLATFORM.md first, build and deploy here, then update plotline-site, then remove the old (PLATFORM.md §7). If `_shared/siteForms.ts` changes, plotline-site's copy (`src/lib/siteForms.ts`) must be updated to match.
- To work on both at once: `claude --add-dir ../plotline-site`.

## Stack
- Vite 8, React 19, TypeScript 6 (strict), React Router 7
- Supabase: Postgres, Auth, Storage, Edge Functions, through `@supabase/supabase-js`
- TanStack Query for server state (caching, invalidation after admin edits)
- ESLint (flat config). Vitest + Testing Library (jsdom) for logic and components. pgTAP for database tests, run against the local Supabase Postgres in Docker. Playwright for e2e flows (Chromium, desktop + 360px phone) against the full local stack.

## Commands
```bash
npm run dev       # start dev server
npm run build     # type-check (tsc -b) + production build
npm run lint      # eslint
npm run test      # vitest run (test:watch for watch mode)
npm run test:db   # pgTAP tests in supabase/tests against the LOCAL db (auto-starts it, applies pending migrations)
npm run verify    # typecheck + lint + test + test:db + build: the gate for "done"
npm run test:e2e  # Playwright flows against the LOCAL stack (needs `npx supabase start`); not in verify, but the Stop hook runs it when UI files change
npm run smoke:proof  # Edge Function smoke test against the local stack
npm run db:start / db:stop / db:reset:local   # local Supabase Postgres (Docker Desktop must be running)
npm run db:push   # apply supabase/migrations to the linked project
npm run db:types  # regenerate src/lib/database.types.ts from the linked project
npx supabase db query --linked -f supabase/seed.sql   # (re)apply demo data, idempotent
```
Supabase CLI is a pinned dev dependency: use `npx supabase <cmd>` (`npx supabase migration new <name>` for new migrations).
Before saying a task is done, run `npm run verify` and make sure it passes. A Stop hook (`.claude/hooks/verify-gate.mjs`) enforces this: it re-runs verify whenever code changed, and also runs `npm run test:e2e` when UI-facing files (`src/`, `e2e/`, `playwright.config.ts`, `supabase/functions/`) changed since the last passing e2e run. It blocks finishing while either fails, or while the full local stack needed for e2e isn't running. Never weaken tests or lint rules to get past it.

## Environment
- `.env` (gitignored) holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Keep `.env.example` in sync when you add vars.
- Only publishable/anon keys go in client code. **Never** put the service-role key in `VITE_*` vars or anywhere under `src/`.
- PayMongo is **test mode only**. `PAYMONGO_SECRET_KEY` and the webhook signing secret are Edge Function secrets only (`supabase/functions/.env` locally, `npx supabase secrets set` for the linked project), never `VITE_*` or `src/`.

## Project layout (target)
```
src/
  lib/supabase.ts        # single Supabase client
  lib/database.types.ts  # generated, do not edit by hand
  features/<area>/       # booking, admin, auth, courts — components + hooks per feature
  components/            # shared UI
  routes/                # route components / router config
supabase/
  migrations/            # all schema changes, timestamped SQL
  functions/             # Edge Functions (Deno)
  seed.sql
```

## Supabase rules
- Every schema change is a new migration file in `supabase/migrations/`. Never edit applied migrations.
- **RLS is enabled on every table**, and every table gets explicit policies. Admin is checked with `private.is_admin()`. Internal helpers and triggers live in the non-exposed `private` schema.
- Booking invariants (no overlaps, operating hours, price) live **in the database and RPCs**, not just in the UI. Bookings are only written through RPCs (`create_booking`, `cancel_booking`, `review_payment`).
- Store times as `timestamptz` and booking ranges as `tstzrange`. Convert to the venue timezone only for display.
- After schema changes, run `npm run db:push` then `npm run db:types`.
- Every migration ships with pgTAP tests in `supabase/tests/database/NN_<area>.test.sql`: one transaction ending in `rollback`, act as users via `set local role` and `request.jwt.claims`. Cover RLS (anon/player/admin), constraints and each RPC rule. Tests run only against the local database, never the linked project.
- Docker commands go through `scripts/with-docker.sh` (fixes PATH and socket for non-login shells).
- See the installed skills in `.agents/skills/supabase` and `.agents/skills/supabase-postgres-best-practices` before writing SQL, RLS or Edge Functions.

## Code conventions
- Function components and hooks only. Data access pattern: plain async functions in `features/<area>/api.ts` (using `unwrap()` from `lib/queryClient.ts`), wrapped by React Query hooks in `features/<area>/hooks.ts`. No Supabase calls inline in JSX.
- Forms that edit fetched data: render the form only once data has loaded, seed `useState` from props, and remount with `key` to reset. Don't sync props into state with effects (the react-hooks lint rules reject it).
- E2E tests live in `e2e/`: accessible selectors (role/label), data tagged `E2E…` / `e2e-…@example.com` so global teardown removes it, local stack only. Add or extend a flow when a task changes a user journey.
- Admin routes are lazy-loaded (`lazy:` in `src/routes/router.tsx`). Keep admin-only code out of the public bundle.
- Timezone conversions go through `src/lib/time.ts`. Formatting helpers live in `src/lib/format.ts`.
- Use the generated `Database` types for all Supabase calls. Avoid `any`.
- Money is `numeric` in the DB. Format it with `Intl.NumberFormat` using the venue currency. Never compute prices on the client for submission.
- The UI is mobile-first. Every async view handles loading, empty and error states.
- Keep components small. Co-locate feature-specific code under `src/features/<area>/`.
