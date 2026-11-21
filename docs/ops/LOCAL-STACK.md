# Local stack and Docker memory (H16, 2026-11-12)

Full-gate e2e runs failed twice with the local edge runtime container (`supabase_edge_runtime_court-booking-system`) exiting 137. Exit 137 is a SIGKILL, which Docker sends when the VM runs out of memory.

## What was measured (2026-11-12, idle, after a day of runs)

Docker Desktop's VM had 7.75 GiB. Largest containers:

| Container | Memory |
| --- | --- |
| `supabase_edge_runtime_court-booking-system` | 1.82 GiB (grows with every Edge Function call; no limit set) |
| `supabase_inbucket_court-booking-system` | 0.88 GiB (holds every email e2e and smoke runs sent) |
| `supabase_analytics_court-booking-system` | 0.68 GiB |
| the whole `plotline-site` stack | about 1.2 GiB, idle |

The edge runtime has no memory limit, so a long e2e run on top of the other containers and the second stack can push the VM over its ceiling.

## Before a full gate

1. Stop the other project's stack unless the run needs it: `cd ../plotline-site && npx supabase stop`.
2. Restart the edge runtime and clear the mailbox if they are large (`docker stats --no-stream`): `docker restart supabase_edge_runtime_court-booking-system`, and `curl -X DELETE http://127.0.0.1:54324/api/v1/messages` (Mailpit).
3. If it still dies, raise Docker Desktop's memory (Settings, Resources) to 10 GiB or more.

## Facts that cost a run (from /retro M29, 2026-11-19)

- `npm run test:db` applies only **pending** migrations. After editing a migration that is already applied locally (and not pushed anywhere), run `npm run db:reset:local` before `test:db`, or the run tests the old version (T29.4).
- The local edge runtime serves the function list fixed at `npx supabase start`. A **new** Edge Function needs `npx supabase stop` and `npx supabase start`; restarting only the edge runtime container still gives 404 (T29.5).
- Staging's `TURNSTILE_SECRET_KEY` is Cloudflare's always-pass dummy secret, so a release probe of `stack-live` (or any Turnstile-gated function) on staging with a fake token **succeeds and creates real data**: probe with an invalid body there, or delete what the probe created (T29.8 release).
- Realtime e2e: check the installed protocol before parsing websocket frames (`node_modules/@supabase/realtime-js`, `DEFAULT_VSN`; 2.0.0 sends arrays, not objects) (H18).

## Reading a failed gate

A failed e2e run now logs `first failing: [project] › file:line:col › test title` to `.claude/retro/failures.jsonl`. If the summary instead shows a container exit or a connection error, check `docker ps -a --filter status=exited` for a 137 first.
