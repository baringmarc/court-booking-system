# CLAUDE.md

Court booking web app for a single venue (portfolio project). **Read [SPEC.md](SPEC.md) for product requirements, the data model and the booking lifecycle.** Update SPEC.md whenever behavior changes.

## Stack
- Vite 8, React 19, TypeScript 6 (strict), React Router 7
- Supabase: Postgres, Auth, Storage, Edge Functions, through `@supabase/supabase-js`
- TanStack Query for server state (caching, invalidation after admin edits)
- ESLint (flat config). No test runner yet. Add Vitest when the first logic module lands.

## Commands
```bash
npm run dev       # start dev server
npm run build     # type-check (tsc -b) + production build
npm run lint      # eslint
npm run db:push   # apply supabase/migrations to the linked project
npm run db:types  # regenerate src/lib/database.types.ts from the linked project
npx supabase db query --linked -f supabase/seed.sql   # (re)apply demo data, idempotent
```
Supabase CLI is a pinned dev dependency: use `npx supabase <cmd>` (`npx supabase migration new <name>` for new migrations).
Before saying a task is done, run `npm run build` and `npm run lint`.

## Environment
- `.env` (gitignored) holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Keep `.env.example` in sync when you add vars.
- Only publishable/anon keys go in client code. **Never** put the service-role key in `VITE_*` vars or anywhere under `src/`.

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
- See the installed skills in `.agents/skills/supabase` and `.agents/skills/supabase-postgres-best-practices` before writing SQL, RLS or Edge Functions.

## Code conventions
- Function components and hooks only. Data access pattern: plain async functions in `features/<area>/api.ts` (using `unwrap()` from `lib/queryClient.ts`), wrapped by React Query hooks in `features/<area>/hooks.ts`. No Supabase calls inline in JSX.
- Forms that edit fetched data: render the form only once data has loaded, seed `useState` from props, and remount with `key` to reset. Don't sync props into state with effects (the react-hooks lint rules reject it).
- Admin routes are lazy-loaded (`lazy:` in `src/routes/router.tsx`). Keep admin-only code out of the public bundle.
- Timezone conversions go through `src/lib/time.ts`. Formatting helpers live in `src/lib/format.ts`.
- Use the generated `Database` types for all Supabase calls. Avoid `any`.
- Money is `numeric` in the DB. Format it with `Intl.NumberFormat` using the venue currency. Never compute prices on the client for submission.
- The UI is mobile-first. Every async view handles loading, empty and error states.
- Keep components small. Co-locate feature-specific code under `src/features/<area>/`.
