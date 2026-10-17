---
name: implement
description: Implement the next task from TASKS.md (or a given task, or the whole current milestone) end to end. Orient, research, plan (pausing for approval on risky DB/security work), build, verify, get a reviewer verdict, then tick the task and update the handoff.
argument-hint: "[T3.4 | milestone]"
disable-model-invocation: true
---

# /implement

Arguments: `$ARGUMENTS`
- empty: the **Next task** from the TASKS.md Handoff section
- a task ID such as `T3.4`: that task
- `milestone`: do the next task, then keep going task by task until the current milestone is done or a stop condition below is hit

Follow these steps in order for each task. Don't skip any of them.

## 1. Orient
- Read the TASKS.md Handoff section and the target task (its Do, Depends, Files and Acceptance).
- Read the SPEC.md sections the task touches and any related RESEARCH.md entries.
- Run `git status --short` and note which files were already changed before you start. They're out of scope for this task's review.
- **Stop and tell the user** if any of these is true:
  - a dependency isn't `[x]`
  - the task is already `[x]`
  - the Handoff section lists a blocker that affects this task
  - the current milestone has no task breakdown yet. In that case, propose one in the TASKS.md format, researching first, and wait for approval.
- Mark the task `[~]` and set **Next task** in the Handoff section to this task.

## 2. Research
- If the task depends on RESEARCH.md entries that are still `Open`, fill them in first:
  - Check `.agents/skills/supabase` and `.agents/skills/supabase-postgres-best-practices` first, then the official docs.
  - Every finding needs a source, or the SQL or command you ran.
- Record choices that change behavior in SPEC §10.
- If research shows the task is wrong or too big, update or split it in TASKS.md (T3.4a, T3.4b, …), say so, and continue with the first part.

## 3. Plan gate
A task is **risky** if it does any of these:
- adds or changes a migration, RPC, RLS policy, grant, trigger, storage policy, Edge Function or auth flow
- runs `npm run db:push`
- deviates from SPEC

For a risky task, pause and show the user a short plan:
- the files you'll touch
- the approach, with a sketch of the key SQL (table/constraint/function signatures, `security definer` or not, grants)
- how you'll prove each acceptance criterion
- that `npm run db:push` will apply it to the **linked remote project**

Then ask for approval with AskUserQuestion and wait for the answer. Approving the plan also approves running `db:push` for that migration.

For a task that isn't risky, state your plan in two or three lines and continue.

## 4. Build
- Follow every rule in CLAUDE.md. Write the code the task needs and nothing from later tasks.
- Logic modules: write Vitest tests next to the module (`*.test.ts`) covering the edge cases named in the acceptance criteria.
- Components: add Testing Library tests where behavior matters (selection, validation, state handling). Mock the `features/<area>/api.ts` functions, never the network.
- Database changes:
  1. Create a new migration with `npx supabase migration new <name>`. Never edit a migration that already exists in `HEAD`.
  2. Run `npm run db:push`, then `npm run db:types`.
  3. Write pgTAP tests in `supabase/tests/database/NN_<area>.test.sql`, one per acceptance criterion or rule, following the existing files: a transaction, `plan(n)`, acting as anon, player and admin, then `rollback`. Run them with `npm run test:db`, which applies the migration to the local database first. Get the tests green locally before running `db:push` against the linked project.
- If behavior changed, update SPEC.md.

## 5. Verify
- Run `npm run verify` and fix any failures until it passes.
- Never weaken, skip or delete tests or lint rules to get it passing. The Stop hook re-runs verify anyway.

## 6. Review
- Launch the `reviewer` agent in the foreground, because you need its verdict before continuing. Give it:
  - the task ID
  - the list of files this task created or changed, and the files that were already dirty before you started (from step 1), so it can tell them apart
  - the pgTAP test files that prove the DB acceptance criteria
- On **BLOCK**: fix every blocker, re-run verify, then review again. After 3 review rounds that still end in BLOCK, stop and report.
- On **PASS**: fix majors that are cheap to fix now. Put the rest in a `Follow-ups` line under the task.

## 7. Close
- Tick the task `[x]` and add a short `Notes:` line under it with the key evidence (test files) and any follow-ups.
- Update the Handoff section:
  - **Next task**
  - **State** (one line)
  - **Blockers / notes**: anything the next session needs to know
- If this was the last task of the milestone, mark the milestone ✅ in SPEC §9. Breaking down the next milestone is its own step and needs approval (see step 1).
- **No git actions.** Don't stage, commit or push. Suggest a commit message instead, e.g. `feat(booking): T3.5 create_booking RPC`.

## 8. Report
Send a short message:
- task ID and title, with the result
- what changed: files grouped by area
- how it was proven: Vitest and pgTAP tests added, and the `npm run verify` result
- the reviewer verdict, plus any follow-ups left
- the suggested commit message
- what's next

## Milestone mode
After step 8, continue with the next task. Stop when any of these happens:
- a risky task reaches its plan gate (wait for approval)
- the reviewer still says BLOCK after 3 rounds
- verify can't be made to pass
- research changes the plan in a way that needs a decision from the user
- the milestone is complete

Whenever you stop, the Handoff section must say exactly where things stand.
