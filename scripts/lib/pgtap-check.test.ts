import { describe, it, expect } from 'vitest'
import { parseTapRun, formatFileReport, exitCodeFor } from './pgtap-check.mjs'

const lines = (...xs: string[]) => xs.join('\n') + '\n'

const passing = {
  stdout: lines(
    '1..11',
    'ok 1 - a venue made by create_venue starts on schedule v2',
    '',
    'ok 2 - second',
    '',
    '',
    ...Array.from({ length: 9 }, (_, i) => `ok ${i + 3} - assertion ${i + 3}`),
  ),
  stderr: '',
}

const seededBroken = {
  stdout: lines('1..3', 'ok 1 - a', '1', 'not ok 2 - b', '# Failed test 2: "b"'),
  stderr: lines(
    'ERROR:  relation "nosuch" does not exist',
    'LINE 1: select * from nosuch;',
    '                      ^',
    'ERROR:  current transaction is aborted, commands ignored until end of transaction block',
    'ERROR:  current transaction is aborted, commands ignored until end of transaction block',
  ),
}

describe('parseTapRun', () => {
  it('a fully passing file is not broken', () => {
    const r = parseTapRun(passing)
    expect(r.planned).toBe(11)
    expect(r.ran).toBe(11)
    expect(r.failed).toBe(0)
    expect(r.failedNames).toEqual([])
    expect(r.errors).toEqual([])
    expect(r.stray).toEqual([])
    expect(r.reasons).toEqual([])
    expect(r.broken).toBe(false)
  })

  it('blank lines and # diagnostics are not stray', () => {
    const r = parseTapRun({
      stdout: lines('1..2', '', 'ok 1 - a', '   ', '# some diagnostic', 'ok 2'),
      stderr: '',
    })
    expect(r.stray).toEqual([])
    expect(r.ran).toBe(2)
    expect(r.broken).toBe(false)
  })

  it('counts ok lines with and without a name', () => {
    const r = parseTapRun({ stdout: lines('1..3', 'ok 1', 'ok 2 - named', 'not ok 3'), stderr: '' })
    expect(r.ran).toBe(3)
    expect(r.failed).toBe(1)
    expect(r.failedNames).toEqual([])
  })

  it('a file that is only red (not ok, ran === planned, no stderr) is not broken', () => {
    const r = parseTapRun({
      stdout: lines('1..3', 'ok 1 - a', 'not ok 2 - first bad', '# Failed test 2', 'not ok 3 - second bad'),
      stderr: '',
    })
    expect(r.planned).toBe(3)
    expect(r.ran).toBe(3)
    expect(r.failed).toBe(2)
    expect(r.failedNames).toEqual(['first bad', 'second bad'])
    expect(r.reasons).toEqual([])
    expect(r.broken).toBe(false)
  })

  it('no plan line is broken with no_plan', () => {
    const r = parseTapRun({ stdout: lines('ok 1 - a', 'ok 2 - b'), stderr: '' })
    expect(r.planned).toBeNull()
    expect(r.reasons).toEqual(['no_plan'])
    expect(r.broken).toBe(true)
  })

  it('helper rows that print extra ok lines make ran > planned: plan_mismatch, broken', () => {
    const r = parseTapRun({
      stdout: lines(
        '1..2',
        'ok 1 - a',
        'ok 2 - b',
        'ok 3 - helper printed this',
        '# Looks like you planned 2 tests but ran 3',
      ),
      stderr: '',
    })
    expect(r.planned).toBe(2)
    expect(r.ran).toBe(3)
    expect(r.stray).toEqual([])
    expect(r.reasons).toEqual(['plan_mismatch'])
    expect(r.broken).toBe(true)
  })

  it('fewer tests run than planned is a plan_mismatch', () => {
    const r = parseTapRun({ stdout: lines('1..5', 'ok 1', 'ok 2'), stderr: '' })
    expect(r.reasons).toEqual(['plan_mismatch'])
    expect(r.broken).toBe(true)
  })

  it('a stray bare helper line is collected in stray but does not break a matching plan', () => {
    const r = parseTapRun({ stdout: lines('1..1', '1', 'ok 1 - a'), stderr: '' })
    expect(r.stray).toEqual(['1'])
    expect(r.reasons).toEqual([])
    expect(r.broken).toBe(false)
  })

  it('a set_config output line like {"role": "anon"} is stray but not broken', () => {
    const r = parseTapRun({
      stdout: lines('1..1', '{"role": "anon"}', 'ok 1 - a'),
      stderr: '',
    })
    expect(r.stray).toEqual(['{"role": "anon"}'])
    expect(r.reasons).toEqual([])
    expect(r.broken).toBe(false)
  })

  it('an ERROR on stderr is sql_error and broken, even when the plan matches', () => {
    const r = parseTapRun({
      stdout: lines('1..1', 'ok 1 - a'),
      stderr: lines('  ERROR:  syntax error at or near "selec"', 'LINE 1: selec 1;'),
    })
    expect(r.errors).toEqual(['ERROR:  syntax error at or near "selec"'])
    expect(r.reasons).toEqual(['sql_error'])
    expect(r.broken).toBe(true)
  })

  it('FATAL lines count as errors; other stderr lines do not', () => {
    const r = parseTapRun({
      stdout: lines('1..1', 'ok 1'),
      stderr: lines('NOTICE:  something', 'FATAL:  terminating connection', 'LINE 1: x'),
    })
    expect(r.errors).toEqual(['FATAL:  terminating connection'])
    expect(r.reasons).toEqual(['sql_error'])
  })

  it('the seeded broken file: planned 3, ran 2, failed 1, 3 errors, stray 1', () => {
    const r = parseTapRun(seededBroken)
    expect(r.planned).toBe(3)
    expect(r.ran).toBe(2)
    expect(r.failed).toBe(1)
    expect(r.failedNames).toEqual(['b'])
    expect(r.errors).toHaveLength(3)
    expect(r.errors[0]).toBe('ERROR:  relation "nosuch" does not exist')
    expect(r.stray).toEqual(['1'])
    expect(r.reasons).toEqual(['plan_mismatch', 'sql_error'])
    expect(r.broken).toBe(true)
  })

  it('the finish() diagnostic on a miscounted plan is a # line, not stray', () => {
    const r = parseTapRun({
      stdout: lines('1..157', ...Array.from({ length: 161 }, (_, i) => `ok ${i + 1}`), '# Looks like you planned 157 tests but ran 161'),
      stderr: '',
    })
    expect(r.planned).toBe(157)
    expect(r.ran).toBe(161)
    expect(r.stray).toEqual([])
    expect(r.reasons).toEqual(['plan_mismatch'])
  })

  it('uses the first 1..N line as the plan', () => {
    const r = parseTapRun({ stdout: lines('1..2', 'ok 1', 'ok 2', '1..9'), stderr: '' })
    expect(r.planned).toBe(2)
  })
})

describe('formatFileReport', () => {
  it('first line is "<file>: planned N, ran M, failed K" and a clean file has no BROKEN', () => {
    const out = formatFileReport('a.test.sql', parseTapRun(passing))
    expect(out.split('\n')[0]).toBe('a.test.sql: planned 11, ran 11, failed 0')
    expect(out).not.toContain('BROKEN')
  })

  it('says "planned none" when there is no plan, and BROKEN with the reason code', () => {
    const out = formatFileReport('b.test.sql', parseTapRun({ stdout: lines('ok 1'), stderr: '' }))
    expect(out.split('\n')[0]).toBe('b.test.sql: planned none, ran 1, failed 0')
    expect(out).toContain('BROKEN')
    expect(out).toContain('no_plan')
  })

  it('a red but not broken file shows the first failing name and no BROKEN', () => {
    const out = formatFileReport(
      'c.test.sql',
      parseTapRun({ stdout: lines('1..2', 'ok 1 - fine', 'not ok 2 - the bad one'), stderr: '' }),
    )
    expect(out.split('\n')[0]).toBe('c.test.sql: planned 2, ran 2, failed 1')
    expect(out).toContain('the bad one')
    expect(out).not.toContain('BROKEN')
  })

  it('a broken file lists every reason code', () => {
    const out = formatFileReport('d.test.sql', parseTapRun(seededBroken))
    expect(out.split('\n')[0]).toBe('d.test.sql: planned 3, ran 2, failed 1')
    expect(out).toContain('BROKEN')
    expect(out).toContain('plan_mismatch')
    expect(out).toContain('sql_error')
    expect(out).not.toContain('stray_output')
    expect(out).toContain('b')
  })
})

describe('exitCodeFor', () => {
  it('is 0 for an empty list', () => {
    expect(exitCodeFor([])).toBe(0)
  })

  it('is 0 when no result is broken (red files alone do not fail)', () => {
    const red = parseTapRun({ stdout: lines('1..1', 'not ok 1 - x'), stderr: '' })
    expect(exitCodeFor([parseTapRun(passing), red])).toBe(0)
  })

  it('is 1 when any result is broken', () => {
    expect(exitCodeFor([parseTapRun(passing), parseTapRun(seededBroken)])).toBe(1)
    expect(exitCodeFor([{ broken: true }])).toBe(1)
  })
})
