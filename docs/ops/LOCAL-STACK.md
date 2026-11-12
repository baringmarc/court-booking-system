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

## Reading a failed gate

A failed e2e run now logs `first failing: [project] › file:line:col › test title` to `.claude/retro/failures.jsonl`. If the summary instead shows a container exit or a connection error, check `docker ps -a --filter status=exited` for a 137 first.
