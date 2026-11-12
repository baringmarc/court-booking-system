#!/usr/bin/env node
// The verify gate, in two tiers (checks are listed in .claude/harness.json):
//
// FAST, as the Stop hook: Claude can't finish a turn while the fast checks (typecheck, lint, unit tests) fail.
//   Runs only when code changed since the last passing run. The fingerprint covers tracked and untracked
//   changes, excluding *.md and .claude/, so Q&A and doc-only turns end instantly.
//   Skipped for a session that has not edited code itself (several sessions can share one working tree):
//   guard.mjs records edits per session_id; the record clears when the fast checks pass. No session_id = runs.
//   After MAX_ATTEMPTS consecutive blocks in one turn it lets Claude stop, which must then report the
//   failure. That state isn't retried until the code changes.
//
// FULL, run by hand or by /implement: `node .claude/hooks/verify-gate.mjs --full`
//   Runs the full checks (verify, plus the drift check), then e2e when UI-facing files differ from HEAD.
//   It records which changes passed. guard.mjs refuses `git commit` until a full run passed on exactly
//   the current changes, so nothing is committed on the fast tier alone.
//
// Database and e2e runs share the local stack, so those npm scripts go through scripts/with-lock.mjs:
// a second run waits for the first instead of colliding with it.
//
// A full run takes longer than a Bash call may (over 10 minutes with e2e), so it often finishes in the background
// after the turn ends. While it runs it holds .claude/state/full-gate.lock, and the Stop hook skips (without
// touching the state file) while that lock or the local-stack lock belongs to a live process (H13): its Vitest
// would otherwise run alongside the full run's and give false timeouts. Commits still need a passing full run.
//
// Every failure is logged to .claude/retro/failures.jsonl (once per check and set of changes) for /retro.
// State lives in .claude/.verify-state.json (gitignored).

import { spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { clearSessionEdit, codeFingerprint, config, existsSync, logEvent, paths, readJson, root, sessionEdited, uiFingerprint, writeJson } from './lib/harness.mjs'

const MAX_ATTEMPTS = 3
const FULL = process.argv.includes('--full')
const fullLockPath = join(root, '.claude', 'state', 'full-gate.lock')
const stackLockPath = join(root, '.claude', 'state', 'local-stack.lock')

if (!existsSync(join(root, '.git')) || !existsSync(join(root, 'node_modules'))) process.exit(0)

const scripts = readJson(join(root, 'package.json'), {}).scripts ?? {}
const state = readJson(paths.verifyState, {})
const code = codeFingerprint()

/** H16: the first failing test of a Playwright list-reporter run ("✘  12 [desktop] › e2e/x.spec.ts:47:1 › title (3.2s)"), or ''. */
function firstFailingTest(output) {
  const m = output.match(/^\s*[✘×]\s+\d+\s+(.+?)(?:\s+\(\d[\d.]*m?s\))?\s*$/m)
  return m ? m[1].trim() : ''
}

function run(script) {
  const result = spawnSync('npm', ['run', script, '--silent'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  const lines = output.split('\n')
  const failing = script === config.e2e?.script ? firstFailingTest(output) : ''
  const summary = failing ? `first failing: ${failing}`.slice(0, 240) : (lines.find((l) => /error|fail|✗|×|not ok|expected/i.test(l)) ?? lines.at(-1) ?? '').trim().slice(0, 240)
  return { ok: result.status === 0, tail: lines.slice(-60).join('\n'), summary }
}

/** Log a failure once per (check, set of changes), so Stop-hook retries don't inflate the counts. */
function logFailure(tier, check, summary) {
  const key = `${tier}:${check}:${code.hash}`
  if (state.lastLogged === key) return
  state.lastLogged = key
  logEvent({ source: 'gate', tier, category: check, summary })
}

/** Run checks in order; stop at the first failure. */
function runChecks(tier, list) {
  for (const check of list) {
    if (!scripts[check]) {
      if (FULL) console.log(`- skip ${check} (no such npm script)`)
      continue
    }
    if (FULL) console.log(`- ${check}…`)
    const r = run(check)
    if (!r.ok) {
      logFailure(tier, check, r.summary)
      return { ok: false, check, tail: r.tail }
    }
  }
  return { ok: true }
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

/** The lock's holder ({ pid, cmd, since }) when a live process holds it; null when free or stale. */
function liveHolder(lockPath) {
  try {
    const holder = JSON.parse(readFileSync(lockPath, 'utf8'))
    return Number.isInteger(holder.pid) && alive(holder.pid) ? holder : null
  } catch {
    return null
  }
}

function localStackRunning() {
  const [cmd, ...args] = config.e2e.stackCheck
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 30_000 })
  return result.status === 0 && /^API_URL="?http:\/\/127\.0\.0\.1/m.test(result.stdout ?? '')
}

// ---------- FULL (CLI) ----------

if (FULL) {
  const other = liveHolder(fullLockPath)
  if (other && other.pid !== process.pid) {
    console.log(`Another full run is in progress (pid ${other.pid}, since ${other.since}). Wait for it instead of starting a second one.`)
    process.exit(1)
  }
  mkdirSync(dirname(fullLockPath), { recursive: true }) // .claude/state/ is gitignored, so a fresh clone lacks it
  const fd = openSync(fullLockPath, 'w')
  writeSync(fd, JSON.stringify({ pid: process.pid, cmd: 'verify-gate --full', since: new Date().toISOString() }))
  closeSync(fd)
  const releaseLock = () => {
    if (liveHolder(fullLockPath)?.pid === process.pid) rmSync(fullLockPath, { force: true })
  }
  // A killed run leaves the file behind; its pid is then dead, so liveHolder treats it as free.
  process.on('exit', releaseLock)

  const finish = (exit, msg) => {
    writeJson(paths.verifyState, state)
    console.log(msg)
    process.exit(exit)
  }

  if (code.empty || state.fullPassed === code.hash) {
    console.log('Full checks already passed for these changes.')
  } else {
    // The Stop hook already ran the fast checks on exactly these changes: don't run them twice.
    const reuseFast = state.fastPassed === code.hash
    if (reuseFast) console.log(`- skip ${config.fastChecks.join(', ')} (the fast checks already passed for these changes)`)
    const r = runChecks('full', reuseFast ? config.fullChecks.filter((c) => !config.fastChecks.includes(c)) : config.fullChecks)
    if (!r.ok) finish(1, `\nFULL VERIFY FAILED at \`npm run ${r.check}\`:\n\n${r.tail}\n\nFix it and run --full again. Don't weaken tests or lint rules.`)
    state.fullPassed = code.hash
    state.fastPassed = code.hash
  }

  const ui = uiFingerprint()
  if (config.e2e && scripts[config.e2e.script] && !ui.empty && state.e2ePassed !== ui.hash) {
    if (!localStackRunning()) {
      logFailure('full', 'e2e-stack-down', 'local stack not running')
      finish(1, `\nUI files changed, so e2e must run, but the full local Supabase stack is not running. ${config.e2e.stackStartHint}`)
    }
    console.log(`- ${config.e2e.script}…`)
    const r = run(config.e2e.script)
    if (!r.ok) {
      logFailure('full', config.e2e.script, r.summary)
      finish(1, `\nE2E FAILED:\n\n${r.tail}`)
    }
    state.e2ePassed = ui.hash
  }

  finish(0, '\nFULL VERIFY PASSED. You may commit these changes.')
}

// ---------- FAST (Stop hook) ----------

const input = JSON.parse(readFileSync(0, 'utf8') || '{}')

// A full run, or a test:db/test:e2e run, is using the machine: skip without writing state, so the full run's
// result isn't overwritten and its tests don't time out under a second Vitest (H13).
const busy = liveHolder(fullLockPath) ?? liveHolder(stackLockPath)
if (busy) {
  process.stdout.write(JSON.stringify({
    systemMessage: `verify-gate: fast checks skipped while \`${busy.cmd}\` runs (pid ${busy.pid}, since ${busy.since}). Wait for its result; commits still need a passing full run.`,
  }))
  process.exit(0)
}

function respond(obj) {
  writeJson(paths.verifyState, state)
  if (obj) process.stdout.write(JSON.stringify(obj))
  process.exit(0)
}

if (code.empty || state.fastPassed === code.hash || state.fullPassed === code.hash) respond()

// Another session may have left the working tree dirty. This session only answers for code it edited itself
// (recorded by guard.mjs per session_id); a full run and the commit check still cover the whole tree.
if (!sessionEdited(input.session_id)) {
  respond({ systemMessage: 'verify-gate: this session has not edited code, so the fast checks were skipped (other changes in the tree belong to another session).' })
}

if (state.gaveUp === code.hash) {
  respond({ systemMessage: 'verify-gate: fast checks are still failing for the current changes (gave up earlier). Not re-running until code changes.' })
}

// A new user turn resets the attempt counter; a continuation after our own block keeps counting.
const attempts = input.stop_hook_active ? (state.attempts ?? 0) : 0

const r = runChecks('fast', config.fastChecks)
if (r.ok) {
  state.fastPassed = code.hash
  state.attempts = 0
  clearSessionEdit(input.session_id)
  respond({ systemMessage: `verify-gate: fast checks passed (${config.fastChecks.join(', ')}). Run --full before committing.` })
}

if (attempts + 1 >= MAX_ATTEMPTS) {
  Object.assign(state, { attempts: 0, gaveUp: code.hash })
  clearSessionEdit(input.session_id)
  respond({ systemMessage: `verify-gate: npm run ${r.check} still failing after ${MAX_ATTEMPTS} attempts; allowing stop.` })
}

state.attempts = attempts + 1
respond({
  decision: 'block',
  reason:
    `npm run ${r.check} failed (attempt ${attempts + 1}/${MAX_ATTEMPTS}). The task is not done. ` +
    'Fix the failures below, then finish again. Do not weaken tests or lint rules to make it pass.' +
    (attempts + 2 >= MAX_ATTEMPTS
      ? ' This is the last attempt: if it still fails, stop and tell the user exactly what fails, and record it under Blockers in the TASKS.md Handoff section. Do not say the task is done.'
      : '') +
    `\n\n${r.tail}`,
})
