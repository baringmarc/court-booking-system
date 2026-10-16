# CLAUDE.md

Court booking web app for a single venue (portfolio project). **Read [SPEC.md](SPEC.md) for product requirements, the data model and the booking lifecycle.** Update SPEC.md whenever behavior changes.

## Stack
- Vite 8, React 19, TypeScript 6 (strict), React Router 7
- Supabase: Postgres, Auth, Storage, Edge Functions, through `@supabase/supabase-js`
- ESLint (flat config). No test runner yet. Add Vitest when the first logic module lands.

## Commands
```bash
npm run dev       # start dev server
npm run build     # type-check (tsc -b) + production build
npm run lint      # eslint
```
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
- **RLS is enabled on every table**, and every table gets explicit policies. Admin is checked through `profiles.role = 'admin'` (wrap it in a `security definer` helper such as `is_admin()`).
- Booking invariants (no overlaps, operating hours, price) live **in the database and RPCs**, not just in the UI. Bookings are only written through RPCs (`create_booking`, `cancel_booking`, `review_payment`).
- Store times as `timestamptz` and booking ranges as `tstzrange`. Convert to the venue timezone only for display.
- After schema changes, regenerate types: `npx supabase gen types typescript --linked > src/lib/database.types.ts`.
- See the installed skills in `.agents/skills/supabase` and `.agents/skills/supabase-postgres-best-practices` before writing SQL, RLS or Edge Functions.

## Code conventions
- Function components and hooks only. Keep data fetching in feature hooks (`useAvailability`, `useBooking`), not inline in JSX.
- Use the generated `Database` types for all Supabase calls. Avoid `any`.
- Money is `numeric` in the DB. Format it with `Intl.NumberFormat` using the venue currency. Never compute prices on the client for submission.
- The UI is mobile-first. Every async view handles loading, empty and error states.
- Keep components small. Co-locate feature-specific code under `src/features/<area>/`.
