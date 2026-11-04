#!/usr/bin/env node
// Appends an event to .claude/retro/failures.jsonl, the log /retro learns from.
// The log is protected from direct edits, so this script is the only way Claude writes to it.
//
//   node .claude/hooks/log-event.mjs reviewer '{"severity":"blocker","category":"rls","file":"supabase/migrations/x.sql","summary":"…"}'
//   node .claude/hooks/log-event.mjs escalation '{"summary":"…"}'
//   node .claude/hooks/log-event.mjs dispute '{"file":"…","summary":"…","outcome":"test fixed|code fixed"}'
//   node .claude/hooks/log-event.mjs retro '{"milestone":"M11","summary":"…"}'
//
// The gate and the guard log their own events; don't log those by hand.

import { logEvent } from './lib/harness.mjs'

export const CATEGORIES = [
  'spec-mismatch', // behavior differs from SPEC or the task
  'acceptance-unmet', // a criterion has no evidence
  'scope-creep', // built something from a later task
  'rls', // missing/wrong RLS, grants, security definer
  'migration', // migration problems other than RLS
  'db-invariant', // a rule enforced only in the UI, not the database
  'timezone', // UTC vs venue-local mistakes
  'missing-test', // no test for a rule or criterion
  'weakened-test', // tests skipped, deleted or loosened
  'error-state', // missing loading/empty/error state
  'types', // any, hand-edited generated types
  'secrets', // keys or secrets in the wrong place
  'data-access', // Supabase calls outside api.ts, client-side prices
  'docs-drift', // SPEC/TASKS/CLAUDE.md out of date or contradicting
  'mobile-a11y', // 360px layout, accessibility
  'other',
]

const SOURCES = ['reviewer', 'escalation', 'dispute', 'retro']

const [source, json = '{}'] = process.argv.slice(2)
if (!SOURCES.includes(source)) {
  console.error(`Usage: log-event.mjs <${SOURCES.join('|')}> '<json>'`)
  process.exit(1)
}

let data
try {
  data = JSON.parse(json)
} catch (e) {
  console.error(`Invalid JSON: ${e.message}`)
  process.exit(1)
}

if (source === 'reviewer' && !CATEGORIES.includes(data.category)) {
  console.error(`Unknown category "${data.category}". Use one of: ${CATEGORIES.join(', ')}`)
  process.exit(1)
}

logEvent({ source, ...data })
console.log('logged')
