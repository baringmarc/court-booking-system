#!/usr/bin/env node
// Read-only check for "tests were weakened": prints, for every test file that changed, added skips (.skip, .only,
// .todo, fixme, pgTAP skip/todo), removed assertions and deleted test files. The reviewer runs it instead of grepping
// diffs by hand (H8).
//
//   node .claude/hooks/test-diff-check.mjs            changes in the working tree against HEAD (plus new test files)
//   node .claude/hooks/test-diff-check.mjs <base>     changes from <base> to the working tree
//
// Prints "OK" when nothing is suspicious, otherwise one line per finding. The exit code is 1 when there are findings.
// The patterns match the ones in guard.mjs; keep them in step. Assertions are compared by count (comments and strings
// count too, and swapping one assertion for another goes unseen), so it is a heuristic: read what it prints.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { config, git, matchesAny, root } from './lib/harness.mjs'

const SKIP_JS = /\.(skip|only|todo|fixme)\s*\(|\b(xit|xdescribe|xtest|fit|fdescribe)\s*\(/g
const SKIP_SQL = /\b(skip|todo|todo_start)\s*\(/gi
const ASSERT_JS = /\bexpect(\.soft)?\s*\(/g
const ASSERT_SQL =
  /\b(ok|is|isnt|is_empty|isnt_empty|results_eq|results_ne|set_eq|bag_eq|row_eq|cmp_ok|matches|throws_ok|throws_like|throws_matching|lives_ok|policies_are|policy_cmd_is|policy_roles_are|fk_ok|has_[a-z_]+|hasnt_[a-z_]+|col_[a-z_]+|function_returns|is_definer|isnt_definer)\s*\(/gi

const count = (text, re) => (text.match(re) ?? []).length
const isSql = (p) => p.endsWith('.sql')

const base = process.argv[2] ?? 'HEAD'
if (!/^[\w./~^][\w./~^-]*$/.test(base)) {
  console.error(`Not a git ref: ${base}`)
  process.exit(2)
}

const lines = (out) => out.split('\n').filter(Boolean)
const changed = lines(git(['diff', '--name-status', '--no-renames', base]))
  .map((l) => ({ status: l[0], path: l.slice(1).trim() }))
const untracked = lines(git(['ls-files', '--others', '--exclude-standard'])).map((path) => ({ status: 'A', path }))

const show = (ref, path) => {
  try {
    return git(['show', `${ref}:${path}`], { stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return ''
  }
}

const findings = []
for (const { status, path } of [...changed, ...untracked]) {
  if (!matchesAny(path, config.tests)) continue
  if (status === 'D') {
    findings.push(`${path}: test file deleted`)
    continue
  }
  let after = ''
  try {
    after = readFileSync(join(root, path), 'utf8')
  } catch {
    continue
  }
  const before = status === 'A' ? '' : show(base, path)
  const sql = isSql(path)
  const skips = sql ? SKIP_SQL : SKIP_JS
  const asserts = sql ? ASSERT_SQL : ASSERT_JS
  const addedSkips = count(after, skips) - count(before, skips)
  if (addedSkips > 0) findings.push(`${path}: ${addedSkips} skip/only/todo added`)
  const lost = count(before, asserts) - count(after, asserts)
  if (lost > 0) findings.push(`${path}: ${lost} assertion${lost === 1 ? '' : 's'} removed (${count(before, asserts)} -> ${count(after, asserts)})`)
}

if (findings.length === 0) {
  console.log('OK: no skipped, deleted or weakened tests.')
} else {
  console.log(findings.join('\n'))
  process.exit(1)
}
