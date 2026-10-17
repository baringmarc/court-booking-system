#!/usr/bin/env node
// Stop hook: Claude can't finish a turn while the checks fail.
//
// Stage 1, `npm run verify`: runs when code changed since the last passing verify. The fingerprint
//   covers tracked and untracked changes, excluding *.md and .claude/, so Q&A and doc-only turns end instantly.
// Stage 2, `npm run test:e2e`: runs after verify passes, and only when UI-facing files differ from HEAD
//   (src/, e2e/, playwright.config.ts, supabase/functions/) and have changed since the last passing e2e run.
//   Playwright needs the full local stack; if it isn't running, the stop is blocked with instructions to start it.
// Failures block the stop and feed the output back to Claude. After MAX_ATTEMPTS consecutive blocks in one
// turn it lets Claude stop, which must then report the failure. That state isn't retried until the code changes.
//
// State lives in .claude/.verify-state.json (gitignored).

import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_ATTEMPTS = 3
const EXCLUDES = [':(exclude)*.md', ':(exclude).claude/**']
const UI_PATHS = ['src', 'e2e', 'playwright.config.ts', 'supabase/functions']

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()
const statePath = join(root, '.claude', '.verify-state.json')

const input = JSON.parse(readFileSync(0, 'utf8') || '{}')

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** Hash of the working-tree changes vs HEAD for the given pathspecs (tracked diff + untracked file contents). */
function fingerprint(pathspecs) {
  const diff = git(['diff', 'HEAD', '--', ...pathspecs])
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...pathspecs]).trim()
  const blobs = untracked
    ? execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: root, input: untracked, encoding: 'utf8' })
    : ''
  return { hash: createHash('sha256').update(diff).update(untracked).update(blobs).digest('hex'), empty: !diff && !untracked }
}

function loadState() {
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'))
  } catch {
    return {}
  }
}

function saveState(state) {
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n')
}

function respond(obj) {
  if (obj) process.stdout.write(JSON.stringify(obj))
  process.exit(0)
}

function run(script) {
  const result = spawnSync('npm', ['run', script, '--silent'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  return { ok: result.status === 0, tail: output.split('\n').slice(-60).join('\n') }
}

/** The full local stack (API gateway, Storage, Edge runtime) is what Playwright talks to. */
function localStackRunning() {
  const result = spawnSync('sh', ['scripts/with-docker.sh', 'npx', 'supabase', 'status', '-o', 'env'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
  return result.status === 0 && /^API_URL="?http:\/\/127\.0\.0\.1/m.test(result.stdout ?? '')
}

if (!existsSync(join(root, '.git')) || !existsSync(join(root, 'node_modules'))) respond()

const state = loadState()
const code = fingerprint(['.', ...EXCLUDES])
const ui = fingerprint(UI_PATHS)
const needsVerify = code.hash !== state.passed
const needsE2e = !ui.empty && ui.hash !== state.e2ePassed
if (!needsVerify && !needsE2e) respond()

const combined = `${code.hash}:${ui.hash}`
if (combined === state.gaveUp) {
  respond({ systemMessage: 'verify-gate: checks are still failing for the current changes (gave up earlier). Not re-running until code changes.' })
}

// A new user turn resets the attempt counter; a continuation after our own block keeps counting.
const attempts = input.stop_hook_active ? (state.attempts ?? 0) : 0

function block(what, details) {
  if (attempts + 1 >= MAX_ATTEMPTS) {
    saveState({ ...state, attempts: 0, gaveUp: combined })
    respond({ systemMessage: `verify-gate: ${what} still failing after ${MAX_ATTEMPTS} attempts; allowing stop.` })
  }
  saveState({ ...state, attempts: attempts + 1 })
  respond({
    decision: 'block',
    reason:
      `${what} failed (attempt ${attempts + 1}/${MAX_ATTEMPTS}). The task is not done. ` +
      `Fix the failures below, then finish again. Do not weaken tests or lint rules to make it pass.` +
      (attempts + 2 >= MAX_ATTEMPTS
        ? ' This is the last attempt: if it still fails, stop and tell the user exactly what fails, and record it under Blockers in the TASKS.md Handoff section. Do not say the task is done.'
        : '') +
      `\n\n${details}`,
  })
}

const messages = []

if (needsVerify) {
  const verify = run('verify')
  if (!verify.ok) block('npm run verify', verify.tail)
  state.passed = code.hash
  messages.push('npm run verify passed')
}

if (needsE2e) {
  if (!localStackRunning()) {
    block(
      'npm run test:e2e (UI files changed)',
      'The full local Supabase stack is not running, so the Playwright flows could not run.\n' +
        'Start it with `npx supabase start` (Docker Desktop must be running), then finish again. ' +
        'If you cannot start it, tell the user that e2e was not run.',
    )
  }
  const e2e = run('test:e2e')
  if (!e2e.ok) block('npm run test:e2e', e2e.tail)
  state.e2ePassed = ui.hash
  messages.push('npm run test:e2e passed')
}

saveState({ passed: state.passed, e2ePassed: state.e2ePassed })
respond({ systemMessage: `verify-gate: ${messages.join('; ')}.` })
