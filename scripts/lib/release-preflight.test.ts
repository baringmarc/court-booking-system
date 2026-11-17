import { describe, it, expect } from 'vitest'
import {
  parseMigrationList,
  parseFunctionList,
  localMigrationVersions,
  localFunctionNames,
  comparePreflight,
  formatReport,
} from './release-preflight.mjs'

const REF = 'jmichyttnqygwdcksbpg'

const sorted = (xs: string[]) => xs.slice().sort()

describe('parseMigrationList', () => {
  it('reads remote versions from the JSON shape and skips entries not applied remotely', () => {
    const text = JSON.stringify({
      migrations: [
        { local: '20261016154902', remote: '20261016154902', time: '2026-10-16 15:49:02' },
        { local: '20261113045318', remote: '', time: '2026-11-13 04:53:18' },
        { local: '20261114010101', time: '2026-11-14 01:01:01' },
        { local: '20261114020202', remote: null, time: '2026-11-14 02:02:02' },
        { remote: '20260901000000', time: '2026-09-01 00:00:00' },
      ],
    })
    expect(sorted(parseMigrationList(text))).toEqual(['20260901000000', '20261016154902'])
  })

  it('reads the text table and treats a row with an empty Remote cell as not applied', () => {
    const text = [
      '   Local            | Remote           | Time (UTC)',
      '  ------------------|------------------|---------------------',
      '   20261016154902 | 20261016154902 | 2026-10-16 15:49:02',
      '   20261113045318 |                | 2026-11-13 04:53:18',
    ].join('\n')
    expect(parseMigrationList(text)).toEqual(['20261016154902'])
  })

  it('counts a row with a remote version but empty local as applied', () => {
    const text = [
      '   Local            | Remote           | Time (UTC)',
      '  ------------------|------------------|---------------------',
      '                  | 20260901000000 | 2026-09-01 00:00:00',
      '   20261016154902 | 20261016154902 | 2026-10-16 15:49:02',
    ].join('\n')
    expect(sorted(parseMigrationList(text))).toEqual(['20260901000000', '20261016154902'])
  })

  it('strips backticks around versions', () => {
    const text = [
      '   Local            | Remote           | Time (UTC)',
      '  ------------------|------------------|---------------------',
      '   `20261016154902 | `20261016154902 | 2026-10-16 15:49:02',
    ].join('\n')
    expect(parseMigrationList(text)).toEqual(['20261016154902'])
  })

  it('returns an empty list for an empty migrations array', () => {
    expect(parseMigrationList('{"migrations":[]}')).toEqual([])
  })
})

describe('parseFunctionList', () => {
  const entry = {
    id: '4dc3',
    slug: 'create-paymongo-checkout',
    name: 'create-paymongo-checkout',
    status: 'ACTIVE',
    version: 6,
    verify_jwt: false,
  }

  it('reads a bare JSON array', () => {
    const text = JSON.stringify([entry, { slug: 'site-contact', name: 'site-contact' }])
    expect(sorted(parseFunctionList(text))).toEqual(['create-paymongo-checkout', 'site-contact'])
  })

  it('falls back to name when slug is missing', () => {
    expect(parseFunctionList(JSON.stringify([{ name: 'site-review' }]))).toEqual(['site-review'])
  })

  it('reads the {"functions": [...]} shape', () => {
    expect(parseFunctionList(JSON.stringify({ functions: [entry] }))).toEqual(['create-paymongo-checkout'])
  })

  it('ignores noise lines before a bare array', () => {
    const text =
      'A new version of Supabase CLI is available: v2.99.0 (currently installed v2.90.0)\n' +
      'We recommend updating regularly for new features and bug fixes.\n' +
      JSON.stringify([entry])
    expect(parseFunctionList(text)).toEqual(['create-paymongo-checkout'])
  })

  it('ignores noise lines before a {"functions"} object', () => {
    const text = 'A new version of Supabase CLI is available.\n' + JSON.stringify({ functions: [entry] })
    expect(parseFunctionList(text)).toEqual(['create-paymongo-checkout'])
  })

  it('returns an empty list for an empty array', () => {
    expect(parseFunctionList('[]')).toEqual([])
  })
})

describe('localMigrationVersions', () => {
  it('takes the 14-digit prefix of .sql files and ignores other files', () => {
    expect(
      sorted(
        localMigrationVersions([
          '20261016154902_init.sql',
          '20261113045318_t26_3_platform_billing.sql',
          'README.md',
          '.gitkeep',
          'notes.txt',
        ]),
      ),
    ).toEqual(['20261016154902', '20261113045318'])
  })

  it('returns an empty list when there are no migrations', () => {
    expect(localMigrationVersions([])).toEqual([])
  })
})

describe('localFunctionNames', () => {
  it('drops _shared and any name starting with _ or .', () => {
    expect(
      sorted(
        localFunctionNames(['_shared', '.env', '.DS_Store', '_internal', 'create-paymongo-checkout', 'site-contact']),
      ),
    ).toEqual(['create-paymongo-checkout', 'site-contact'])
  })
})

describe('comparePreflight', () => {
  const base = {
    localMigrations: ['20261016154902', '20261113045318'],
    remoteMigrations: ['20261016154902', '20261113045318'],
    localFunctions: ['create-paymongo-checkout', 'site-contact'],
    remoteFunctions: ['create-paymongo-checkout', 'site-contact'],
  }

  it('is ok when everything is present', () => {
    expect(comparePreflight(base)).toEqual({ ok: true, missingMigrations: [], missingFunctions: [] })
  })

  it('reports one missing migration', () => {
    const r = comparePreflight({ ...base, remoteMigrations: ['20261016154902'] })
    expect(r).toEqual({ ok: false, missingMigrations: ['20261113045318'], missingFunctions: [] })
  })

  it('sorts several missing migrations ascending', () => {
    const r = comparePreflight({
      ...base,
      localMigrations: ['20261120000000', '20261016154902', '20261113045318', '20261105000000'],
      remoteMigrations: ['20261016154902'],
    })
    expect(r.ok).toBe(false)
    expect(r.missingMigrations).toEqual(['20261105000000', '20261113045318', '20261120000000'])
  })

  it('reports one missing function', () => {
    const r = comparePreflight({ ...base, remoteFunctions: ['site-contact'] })
    expect(r).toEqual({ ok: false, missingMigrations: [], missingFunctions: ['create-paymongo-checkout'] })
  })

  it('sorts missing functions ascending', () => {
    const r = comparePreflight({ ...base, localFunctions: ['site-contact', 'create-paymongo-checkout'], remoteFunctions: [] })
    expect(r.missingFunctions).toEqual(['create-paymongo-checkout', 'site-contact'])
  })

  it('does not report _shared as missing once local names are filtered', () => {
    const r = comparePreflight({
      ...base,
      localFunctions: localFunctionNames(['_shared', 'create-paymongo-checkout', 'site-contact']),
    })
    expect(r.ok).toBe(true)
    expect(r.missingFunctions).toEqual([])
  })

  it('reports both kinds missing at once', () => {
    const r = comparePreflight({ ...base, remoteMigrations: [], remoteFunctions: ['site-contact'] })
    expect(r.ok).toBe(false)
    expect(r.missingMigrations).toEqual(['20261016154902', '20261113045318'])
    expect(r.missingFunctions).toEqual(['create-paymongo-checkout'])
  })

  it('does not fail on remote-only extras', () => {
    const r = comparePreflight({
      ...base,
      remoteMigrations: [...base.remoteMigrations, '20260901000000'],
      remoteFunctions: [...base.remoteFunctions, 'old-function'],
    })
    expect(r).toEqual({ ok: true, missingMigrations: [], missingFunctions: [] })
  })
})

describe('formatReport', () => {
  it('prints the ref and PASSED (never FAILED) when ok', () => {
    const out = formatReport({ ref: REF, result: { ok: true, missingMigrations: [], missingFunctions: [] } })
    expect(out).toContain(REF)
    expect(out).toContain('PASSED')
    expect(out).not.toContain('FAILED')
  })

  it('prints the ref, FAILED and each missing item on its own line', () => {
    const out = formatReport({
      ref: REF,
      result: {
        ok: false,
        missingMigrations: ['20261105000000', '20261113045318'],
        missingFunctions: ['create-paymongo-checkout'],
      },
    })
    expect(out).toContain(REF)
    expect(out).toContain('FAILED')
    expect(out).not.toContain('PASSED')
    const lines = out.split('\n')
    const migLine = lines.find((l: string) => l.includes('20261105000000'))
    expect(migLine).toBeDefined()
    expect(migLine).not.toContain('20261113045318')
    expect(lines.some((l: string) => l.includes('20261113045318'))).toBe(true)
    expect(lines.some((l: string) => l.includes('create-paymongo-checkout'))).toBe(true)
  })
})
