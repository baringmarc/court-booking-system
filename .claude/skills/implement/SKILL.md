---
name: implement
description: Implement the next task from TASKS.md (or a given task, or the whole current milestone) end to end. Orient, research, plan (pausing for approval on risky DB/security work), write the failing tests first (test-writer), build, verify, get a reviewer verdict, then tick the task and update the handoff. In milestone mode, finish with /retro.
argument-hint: "[T3.4 | milestone]"
disable-model-invocation: true
---

# /implement

Arguments: `$ARGUMENTS`

- empty: the **Next task** from the TASKS.md Handoff section
- a task ID such as `T3.4`: that task
- `milestone`: do the next task, then keep going task by task until the current milestone is done or a stop condition below is hit

Follow these steps in order for each task. Don't skip any of them.

Before you start, read the **Learned rules** section of CLAUDE.md: they come from mistakes made in earlier milestones.

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

For a task that isn't risky, state your plan in two or three lines, naming what the tests will need (functions, components, files), and continue.

## 4. Tests first (test-writer)

- Launch the `test-writer` agent in the foreground. Give it **only**:
  - the task ID
  - the approved plan's names and signatures: tables and columns, RPCs with their arguments and error messages, components, routes, file paths
- Don't send it code or describe how you'll implement anything beyond those names. It works from the task and SPEC, which is the point.
- Read its report. Use the names it lists. Its tests are now **locked for this task**: the guard won't let you edit them.
- Skip this step only when the task has no behavior to test (pure copy, styling or docs). Say so in the plan.

## 5. Build

- Follow every rule in CLAUDE.md. Write the code the task needs and nothing from later tasks.
- Make the test-writer's tests pass. You may **add** tests for edge cases you find while building (those are yours to edit), following the same conventions: Vitest next to the module, Testing Library mocking `features/<area>/api.ts`, pgTAP in `supabase/tests/database/`.
- **If a locked test looks wrong** (it contradicts SPEC or the task, not merely your approach): don't work around it. Add a line under the task in TASKS.md:
  `Test dispute: <file> "<test name>": <what it asserts> vs <what SPEC §x / the criterion says>`
  Carry on with the rest. The reviewer rules on it in step 7; if it agrees, re-launch the `test-writer` in dispute mode with that line, and it fixes the test.
- Database changes:
  1. Create a new migration with `npx supabase migration new <name>`. Never edit a migration that already exists in `HEAD` (the guard blocks it).
  2. Run `npm run test:db`, which applies the migration to the local database first, until the pgTAP tests are green locally.
  3. Only then run `npm run db:push` against the linked project, then `npm run db:types`.
- If behavior changed, update SPEC.md. If a business fact changed (pricing, fees, plans), update `docs/facts.json` first; that's a decision, so it needs the user.

## 6. Verify

- Run `node .claude/hooks/verify-gate.mjs --full` and fix failures until it passes. It runs the full checks (`npm run verify`, including the drift check) and then `npm run test:e2e` if UI-facing files changed. The full local stack must be up for e2e (`npx supabase start`).
- It records which changes passed. **The guard refuses `git commit` until a full run passed on exactly the current changes**, so re-run it after any later code edit.
- If the task changes a user journey (pages, forms, flows), the test-writer's e2e spec covers it; extend `e2e/` if you changed more.
- Test runs that share the local stack go through a lock (`scripts/with-lock.mjs`), so a second run waits for the first instead of colliding. You no longer need to check `pgrep` first.
- Never weaken, skip or delete tests or lint rules to get it passing. The guard blocks most of it, and the reviewer checks the rest.

## 7. Review

- Launch the `reviewer` agent in the foreground, because you need its verdict before continuing. Give it **only**:
  - the task ID
  - the list of files this task created or changed, and the files that were already dirty before you started (from step 1), so it can tell them apart
  - the test files that prove the acceptance criteria (the test-writer's and yours)
  - any `Test dispute:` lines, for it to rule on
- **Don't** summarize what you built, explain your reasoning, or say it's correct. The reviewer judges the code against SPEC with fresh eyes; your account of it would only bias that.
- After every verdict, log each **blocker** and **major** finding, one call each, using the category the reviewer gave it:
  `node .claude/hooks/log-event.mjs reviewer '{"severity":"blocker","category":"rls","file":"<file:line>","summary":"<one line>","round":1}'`
- On **BLOCK**: fix every blocker, re-run step 6, then review again (round 2, 3).
- On **PASS**: fix majors that are cheap to fix now. Put the rest in a `Follow-ups` line under the task.
- **Still BLOCK after 3 rounds: escalate.** Don't commit. Write this under **Blockers / notes** in the Handoff section, then stop and report it:
  ```
  - **Escalation <task id> (<date>):**
    - Still failing: <each unresolved blocker, file:line, in the reviewer's words>
    - Tried: round 1 <what you changed>; round 2 <…>; round 3 <…>
    - Blocked on: <the one decision or fact you need from the user, e.g. "SPEC §5 says X but the schema forces Y: which wins?">
  ```
  And log it: `node .claude/hooks/log-event.mjs escalation '{"summary":"<blocked on…>"}'`

## 8. Close

- Tick the task `[x]` and add a short `Notes:` line under it with the key evidence (test files) and any follow-ups.
- Update the Handoff section:
  - **Next task**
  - **State** (one line)
  - **Blockers / notes**: anything the next session needs to know
- If this was the last task of the milestone, mark the milestone ✅ in SPEC §9. Breaking down the next milestone is its own step and needs approval (see step 1).
- **Commit, never push** (authorized by the user on 2026-10-18). Once the full verify (step 6) passes and the reviewer has signed off:
  - Check `git status` and stage only the files this run created or changed, including its TASKS/SPEC/RESEARCH updates. Leave unrelated dirty files out.
  - Never stage `.env`, `supabase/functions/.env` or other secrets.
  - Commit on the current branch (never `master`) with a message like `feat(booking): T3.5 create_booking RPC` plus the attribution line.
  - Don't push, amend or rewrite history.
  - If verify fails or the reviewer still says BLOCK, don't commit; report instead.

## 9. Report

Send a short message:

- task ID and title, with the result
- what changed: files grouped by area
- how it was proven: the test-writer's tests and any you added, and the full verify result
- any test disputes and how they were settled
- the reviewer verdict, plus any follow-ups left
- the commit hash and message (or why nothing was committed)
- what's next

## Milestone mode

After step 9, continue with the next task. Stop when any of these happens:

- a risky task reaches its plan gate (wait for approval)
- the reviewer still says BLOCK after 3 rounds (escalate, step 7)
- verify can't be made to pass
- research changes the plan in a way that needs a decision from the user
- the milestone is complete

Whenever you stop, the Handoff section must say exactly where things stand.

**When the milestone is complete** (its close-out task is committed), run the retro before you stop: follow `.claude/skills/retro/SKILL.md` for that milestone. It proposes lessons and waits for the user's approval, so this is where milestone mode ends.
