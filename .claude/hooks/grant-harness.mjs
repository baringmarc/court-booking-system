#!/usr/bin/env node
// Grants Claude a short window to edit specific protected harness files, for changes the user approved in /retro.
//
//   node .claude/hooks/grant-harness.mjs '{"files":["eslint.config.js"],"minutes":15,"approved":"retro M14: H10 lint rule"}'
//   node .claude/hooks/grant-harness.mjs --revoke
//
// The grant covers only the listed files, for at most 30 minutes. It never covers the USER_ONLY files (the guard,
// this script, lib/, settings, state and logs). The guard only lets the main session call this, and /retro asks the
// user before it does. Every grant is logged (source "grant") so /retro can see what was unlocked and why.

import { unlinkSync } from 'node:fs'
import { USER_ONLY, config, logEvent, matchesAny, paths, writeJson } from './lib/harness.mjs'

const MAX_MINUTES = 30
const [arg = ''] = process.argv.slice(2)

if (arg === '--revoke') {
  try {
    unlinkSync(paths.grant)
  } catch {
    // Nothing granted: nothing to revoke.
  }
  logEvent({ source: 'grant', category: 'protected-file', summary: 'grant revoked' })
  console.log('Grant revoked.')
  process.exit(0)
}

let req
try {
  req = JSON.parse(arg || '{}')
} catch {
  console.error('Grant refused: the argument must be a JSON object, or --revoke.')
  process.exit(1)
}

const files = Array.isArray(req.files) ? req.files.map((f) => String(f).replace(/^\.\//, '')) : []
const minutes = typeof req.minutes === 'number' ? req.minutes : 15
const approved = typeof req.approved === 'string' ? req.approved.trim() : ''

const problems = []
if (files.length === 0) problems.push('name at least one file (files)')
if (!(minutes >= 1 && minutes <= MAX_MINUTES)) problems.push(`minutes must be between 1 and ${MAX_MINUTES}`)
if (!approved) problems.push('say what the user approved (approved)')
for (const f of files) {
  if (!matchesAny(f, config.protected)) problems.push(`${f} is not a protected harness file`)
  else if (matchesAny(f, USER_ONLY)) problems.push(`${f} is user-only and can't be granted`)
}
if (problems.length) {
  console.error(`Grant refused: ${problems.join('; ')}.`)
  process.exit(1)
}

writeJson(paths.grant, { files, until: Date.now() + minutes * 60_000, approved, granted: new Date().toISOString() })
logEvent({
  source: 'grant',
  category: 'protected-file',
  summary: `granted ${files.join(', ')} for ${minutes} min: ${approved}`,
  files,
  minutes,
})
console.log(`Granted ${files.join(', ')} for ${minutes} minutes.`)
