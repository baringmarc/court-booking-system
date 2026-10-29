// Shared helpers for the harness hooks (guard.mjs, verify-gate.mjs, log-event.mjs).
// Per-repo settings live in .claude/harness.json, so these files are identical in both repos.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, isAbsolute } from 'node:path'

export const root = process.env.CLAUDE_PROJECT_DIR || process.cwd()

export const config = JSON.parse(readFileSync(join(root, '.claude', 'harness.json'), 'utf8'))

export const paths = {
  verifyState: join(root, '.claude', '.verify-state.json'), // gitignored
  stateDir: join(root, '.claude', 'state'), // gitignored: locks, locked tests, unlock flag
  lockedTests: join(root, '.claude', 'state', 'locked-tests.json'),
  unlockFlag: join(root, '.claude', 'state', 'unlock-harness'),
  failureLog: join(root, '.claude', 'retro', 'failures.jsonl'), // committed: /retro reads it
}

export function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts })
}

/** Repo-relative path with forward slashes, or null if it is outside the repo. */
export function rel(p) {
  if (!p) return null
  const r = relative(root, isAbsolute(p) ? p : join(root, p)).split('\\').join('/')
  return r.startsWith('..') ? null : r
}

export function existsInHead(relPath) {
  try {
    git(['cat-file', '-e', `HEAD:${relPath}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export function matchesAny(relPath, patterns = []) {
  return patterns.some((re) => new RegExp(re).test(relPath))
}

/** Hash of the working-tree changes vs HEAD for the given pathspecs (tracked diff + untracked file contents). */
export function fingerprint(pathspecs) {
  const diff = git(['diff', 'HEAD', '--', ...pathspecs])
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...pathspecs]).trim()
  const blobs = untracked
    ? execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: root, input: untracked, encoding: 'utf8' })
    : ''
  return {
    hash: createHash('sha256').update(diff).update(untracked).update(blobs).digest('hex'),
    empty: !diff && !untracked,
  }
}

export const CODE_PATHSPECS = ['.', ':(exclude)*.md', ':(exclude).claude/**']

export function codeFingerprint() {
  return fingerprint(CODE_PATHSPECS)
}

export function uiFingerprint() {
  return config.e2e ? fingerprint(config.e2e.uiPaths) : { hash: '', empty: true }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
}

/** The task in progress: "**Next task:** T11.12 …" in the TASKS.md Handoff section, or "adhoc". */
export function currentTask() {
  try {
    const tasks = readFileSync(join(root, 'TASKS.md'), 'utf8')
    const m = tasks.match(/\*\*Next task:\*\*\s*(T\d+(?:\.\d+)?[a-z]?)/)
    return m ? m[1] : 'adhoc'
  } catch {
    return 'adhoc'
  }
}

/**
 * Append one event to .claude/retro/failures.jsonl. /retro groups these by source and category.
 * source: "gate" | "guard" | "reviewer" | "escalation" | "retro"
 */
export function logEvent(event) {
  try {
    mkdirSync(dirname(paths.failureLog), { recursive: true })
    const line = { ts: new Date().toISOString(), task: currentTask(), ...event }
    appendFileSync(paths.failureLog, JSON.stringify(line) + '\n')
  } catch {
    // Logging must never break a hook.
  }
}

/** True while the user has unlocked harness edits: they created .claude/state/unlock-harness in the last 2 hours. */
export function harnessUnlocked() {
  try {
    return Date.now() - statSync(paths.unlockFlag).mtimeMs < 2 * 60 * 60 * 1000
  } catch {
    return false
  }
}

export { existsSync }
