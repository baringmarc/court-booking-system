// H20: tells a broken pgTAP file from a red one. `npm run test:db` mixes the two (pg_prove reports both as failures),
// so a test-writer could hand over a file that can never pass. A file is broken when it has no plan, runs a different
// number of tests than it plans (helper selects that print `ok` rows, a file that stops early), or raises an SQL
// error. `not ok` assertions alone are red, not broken.

const PLAN = /^1\.\.(\d+)\s*$/
const TEST = /^(not )?ok \d+(?: - (.*))?$/

/**
 * @param {{ stdout: string, stderr: string }} run psql's two streams for one file
 */
export function parseTapRun({ stdout, stderr }) {
  let planned = null
  let ran = 0
  let failed = 0
  const failedNames = []
  const stray = []
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const plan = PLAN.exec(line)
    if (plan) {
      if (planned === null) planned = Number(plan[1])
      continue
    }
    const test = TEST.exec(line)
    if (test) {
      ran += 1
      if (test[1]) {
        failed += 1
        if (test[2]) failedNames.push(test[2])
      }
      continue
    }
    stray.push(line)
  }
  const errors = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ERROR:') || line.startsWith('FATAL:'))

  const reasons = []
  if (planned === null) reasons.push('no_plan')
  else if (ran !== planned) reasons.push('plan_mismatch')
  if (errors.length) reasons.push('sql_error')
  // Stray lines are kept for the report but never break a file: pg_prove ignores them, and every
  // `select set_config('request.jwt.claims', …)` role switch prints one. A helper select that prints `ok` rows is
  // caught above as plan_mismatch.

  return { planned, ran, failed, failedNames, errors, stray, broken: reasons.length > 0, reasons }
}

const SHOWN = 3

/** One file's block of the report: the counts line, the first failing names, and why it's broken. */
export function formatFileReport(file, result) {
  const lines = [`${file}: planned ${result.planned ?? 'none'}, ran ${result.ran}, failed ${result.failed}`]
  for (const name of result.failedNames.slice(0, SHOWN)) lines.push(`  not ok: ${name}`)
  if (result.failedNames.length > SHOWN) lines.push(`  … and ${result.failedNames.length - SHOWN} more`)
  if (result.broken) {
    lines.push(`  BROKEN: ${result.reasons.join(', ')}`)
    for (const error of result.errors.slice(0, SHOWN)) lines.push(`  ${error}`)
  }
  return lines.join('\n')
}

/** 1 when any file is broken; red files alone exit 0. */
export function exitCodeFor(results) {
  return results.some((r) => r.broken) ? 1 : 0
}
