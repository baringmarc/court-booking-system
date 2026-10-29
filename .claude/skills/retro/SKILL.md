---
name: retro
description: Learn from the mistakes logged during a milestone. Reads .claude/retro/failures.jsonl (gate failures, guard blocks, reviewer findings, escalations, test disputes), finds repeating patterns, and proposes Learned rules for CLAUDE.md, promotions of rules that didn't work into hard checks, and pruning. Changes nothing until the user approves. Runs automatically at the end of /implement milestone mode; the user can also run /retro by hand.
argument-hint: "[M11 | since 2026-10-20]"
---

# /retro

Arguments: `$ARGUMENTS`: a milestone (`M11`), a date (`since 2026-10-20`), or empty for everything since the last retro.

The goal is a harness that gets stronger from its own mistakes, without bloating CLAUDE.md. A one-off is noise; a pattern is a lesson. Every mistake can be handled at one of three levels, and a lesson that keeps failing moves down the list:

1. **Learned rule** in CLAUDE.md: cheap, but can be ignored.
2. **Check** (a test, the drift check, a reviewer checklist line): catches it after the fact.
3. **Block** (a guard rule): makes it impossible.

**Propose, don't apply.** Nothing changes until the user approves it.

## 1. Gather

- Read `.claude/retro/failures.jsonl`. Each line is one event: `ts`, `task`, `source` (`gate`, `guard`, `reviewer`, `escalation`, `dispute`, `retro`), `category`, and details (`summary`, `file`/`path`, `severity`, `tier`).
- The window: events after the last `"source":"retro"` line, or what the argument says. If the file is missing or the window is empty, say "nothing logged since the last retro", log the retro marker (step 6) and stop.
- Read the **Learned rules** section of CLAUDE.md. Each rule lists the categories it covers and the date it was added.
- Skim the TASKS.md Handoff and the milestone's task notes for context (escalations, follow-ups). Don't go further than that.

## 2. Find patterns

Group the window's events by `source` + `category`, and count **distinct tasks** (the same failure retried within one task counts once).

- **Pattern:** the same category in **2 or more tasks**, or any `escalation`, or any `dispute` with `"outcome":"test fixed"` (the test-writer misread SPEC).
- **Noise:** a single occurrence of anything else. Mention it in one line at most.
- How to read each source:
  - `reviewer` blockers and majors are the best signal: a mistake that got past the builder and the gate.
  - `gate` failures (`typecheck`, `lint`, `test`, `test:db`, `build`, `check:drift`, `test:e2e`) are mistakes the builder made and then fixed. Repeats mean it keeps making them; look at the `summary` lines for the common cause (a recurring type error, the same lint rule, the same flaky test).
  - `guard` blocks mean the mistake was **prevented**, so no rule is needed for the mistake itself. A repeat means some instruction keeps leading the builder into it: propose clearer wording where that instruction lives (a skill, CLAUDE.md), not another rule.
  - A flaky test (it fails then passes with no code change, or the Handoff calls it flaky) is a bug to fix, not a rule: propose a task.

## 3. Draft proposals

For each pattern, draft **one** proposal of one of these kinds:

- **New learned rule:** for a pattern with no matching rule yet. One or two lines, concrete and checkable (for example: "'Today' and day-of-week logic go through `src/lib/time.ts` in the venue timezone, never the UTC date"), not vague ("be careful with timezones"). Prefer adding to an existing rule over a new one.
- **Promote:** the category **recurred after a learned rule for it was added**, so the rule isn't working. Propose the stronger level: a test, a drift-check pattern, a reviewer checklist line, or a guard rule. Promotions change protected files or need real code, so the proposal is a **new task** in TASKS.md (Depends / Do / Acceptance, the usual format) placed before the next milestone's tasks, not a direct edit.
- **Prune:** a rule now enforced by a guard rule or a test (the text is redundant), or a rule whose categories haven't appeared in the last two retros. Propose removing it.
- **Fix:** a flaky test or a recurring tool problem. Propose a task.

Keep it to **at most 5 proposals**, most valuable first. CLAUDE.md is read every session, so every line has a cost: if the Learned rules section would pass about 15 rules, propose pruning or promoting before adding.

## 4. Ask

Send one short message:
- The window (dates, tasks) and the counts: events by source, top categories.
- Each proposal, numbered: kind, the exact text to add or remove (or the task to create), and the evidence (tasks and one example `summary` each).

Then ask with **one** AskUserQuestion call, `multiSelect: true`, one option per proposal (up to 4 per question; a second question for the 5th), labeled by kind and topic, for example "Rule: venue-day boundaries". The user can also type changes. **Wait for the answer.** If the session is unattended (no answer possible), apply nothing: write the proposals under **Blockers / notes** in the Handoff as "Retro proposals awaiting approval" and stop.

## 5. Apply what was approved

- **Rules** go in the `## Learned rules` section at the end of CLAUDE.md, in this format:
  `- **L<n>** <the rule>. _Why:_ <the mistake, briefly>. _(categories: timezone; added <date> from /retro <milestone>)_`
  Number rules in order and never reuse a number. Edit an existing rule in place when extending it.
- **Prunes:** delete the rule line.
- **Promotions and fixes:** add the task(s) to TASKS.md and mention them in the Handoff.
- Change nothing that wasn't approved. Commit the CLAUDE.md and TASKS.md edits on their own, with a message like `chore(harness): retro M11 lessons` plus the attribution line. Never push.

## 6. Log and report

- Log the retro marker, so the next retro starts after it:
  `node .claude/hooks/log-event.mjs retro '{"milestone":"<M11>","summary":"<n> proposals, <k> approved: L7, L8; T12.0 promotion"}'`
- Report in two or three lines: what was added, removed or scheduled, and the commit hash.
