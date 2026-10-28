---
name: propose
description: Take a new feature or adjustment idea, check it's feasible against the code, SPEC and SaaS plan, research it lightly, discuss the open choices with the user, and only then record it in SPEC.md and TASKS.md. Never writes code.
argument-hint: "<the feature or adjustment, in your words; screenshots welcome>"
disable-model-invocation: true
---

# /propose

Arguments: the idea (one or several). Handle each idea in turn, but ask all the questions together.

This skill **plans, it doesn't build**: no code, migrations or deploys. Building happens later with `/implement`.

Keep it cheap: work in this session, no subagents. Read only what the idea touches. Use web search only for a fact the code and docs can't answer (an external API's limits, a platform rule), and cite it.

## 1. Understand

- Restate each idea in one line, as you understood it. If an image was shared, say what you take from it (layout, content) and what you won't copy (its colors, branding).
- If the idea is too vague to check at all, ask for the missing piece first and stop.

## 2. Check feasibility (light)

For each idea, look at:
- **The code it touches:** grep for the components, tables, RPCs or Edge Functions involved, and read just those parts.
- **SPEC.md:** the §5 rules, §6 data model and §7 pages it affects, and the §10 decisions it could contradict.
- **TASKS.md:** the Handoff and any open task that already covers it, overlaps it or conflicts with it (say which).
- **docs/SAAS-PLAN.md:** how it works with many venues. A per-venue setting usually lives in `venue_settings`, which Phase 1 makes per venue.
- **Live production:** whether the change must be expand → deploy → contract, and what existing data needs (a backfill, a default).
- **Risk:** whether it needs a migration, RLS, a grant, a trigger, a storage policy, an Edge Function or an auth change. Those tasks stop at `/implement`'s plan gate.

## 3. Report and ask

Send one short message per idea:
- **Feasible?** Yes, yes with a caveat, or not as asked (and what would work instead).
- **How:** two to four lines on the approach, naming the real tables, components or functions.
- **Knock-on effects:** other screens, tasks, emails, tests or later SaaS phases it touches.

Then ask every open choice in **one** AskUserQuestion call (up to 4 questions; a second call only if more remain). Put the recommended option first, marked "(Recommended)", with its trade-off. Use `preview` for layout choices. Don't ask what the code, SPEC or an earlier decision already answers. Say what you're assuming instead.

**Wait for the answers.** Record nothing before them. If an answer opens a new question that matters, ask it.

## 4. Record

Once every choice is settled:

- **SPEC.md**
  - §9: add a bullet under the current milestone's scope, dated.
  - §10: add one row, dated, with the user's calls and the reasons ("the user's call" where they chose).
  - Don't rewrite §5–§7 yet. `/implement` updates them when it builds the change.
- **TASKS.md**
  - Add tasks to the **current milestone, before its close-out task**. Renumber the close-out, and fix every reference to its old number (Depends lines, follow-ups, the Handoff).
  - Keep the database and the UI apart: a "Migration: …" task (risky, with a plan gate) and a "… in the UI" task that depends on it. Pure UI work is one task.
  - Each task gets **Depends**, **Do** (with the decisions inline, "the user's calls, <date>") and **Acceptance**, in the style of the tasks around it. Acceptance means pgTAP for DB rules, Vitest or component tests for logic and UI, an e2e for a changed journey, axe clean, 360px.
  - Update the Handoff: mention the new tasks next to **Next task** (don't change the next task itself unless the user says so).
- If a recorded choice reverses an older decision, mark the old SPEC §10 row or task as replaced, saying by what.

## 5. Report

One short message: what was recorded (task IDs and titles, the SPEC rows), any assumption you made, and the next step (usually "run `/implement` when it's that task's turn").

Don't commit or push. The next `/implement` commit includes these edits.
