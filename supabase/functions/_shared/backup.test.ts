import { describe, expect, it } from 'vitest'
import { assertRestoreTarget, backupKey, diffRowCounts, expiredKeys } from './backup.ts'

const PROD_REF = 'sfssolhsthteonzgzfos'

describe('backupKey', () => {
  it('names the archive by UTC date', () => {
    expect(backupKey(new Date('2026-11-02T03:00:00Z'))).toBe('backups/plotline-2026-11-02.tar.age')
  })

  it('uses the UTC date at 23:59Z, not the next day', () => {
    expect(backupKey(new Date('2026-11-02T23:59:59Z'))).toBe('backups/plotline-2026-11-02.tar.age')
  })

  it('uses the previous UTC day for 7 AM Manila (+08:00)', () => {
    expect(backupKey(new Date('2026-11-02T07:00:00+08:00'))).toBe('backups/plotline-2026-11-01.tar.age')
  })

  it('uses the previous UTC day for 00:30 Manila on Jan 1 (year boundary)', () => {
    expect(backupKey(new Date('2027-01-01T00:30:00+08:00'))).toBe('backups/plotline-2026-12-31.tar.age')
  })

  it('zero-pads month and day', () => {
    expect(backupKey(new Date('2026-03-05T12:00:00Z'))).toBe('backups/plotline-2026-03-05.tar.age')
  })

  it('handles midnight UTC exactly', () => {
    expect(backupKey(new Date('2026-01-01T00:00:00Z'))).toBe('backups/plotline-2026-01-01.tar.age')
  })
})

describe('expiredKeys', () => {
  const now = new Date('2026-11-15T10:00:00Z')

  it('keeps exactly 14 days and expires older ones by default', () => {
    const keys = [
      'backups/plotline-2026-11-01.tar.age', // 14 days before: kept
      'backups/plotline-2026-10-31.tar.age', // 15 days: expired
      'backups/plotline-2026-11-15.tar.age', // today: kept
    ]
    expect(expiredKeys(keys, now)).toEqual(['backups/plotline-2026-10-31.tar.age'])
  })

  it('compares UTC dates, not instants (late UTC evening is still the same day)', () => {
    const late = new Date('2026-11-15T23:59:59Z')
    expect(expiredKeys(['backups/plotline-2026-11-01.tar.age'], late)).toEqual([])
    expect(expiredKeys(['backups/plotline-2026-10-31.tar.age'], late)).toEqual(['backups/plotline-2026-10-31.tar.age'])
  })

  it('uses the UTC date of now when given a +08:00 instant', () => {
    // 2026-11-16 07:00 Manila = 2026-11-15 23:00Z, so 11-01 is still exactly 14 days back
    const manila = new Date('2026-11-16T07:00:00+08:00')
    expect(expiredKeys(['backups/plotline-2026-11-01.tar.age'], manila)).toEqual([])
    expect(expiredKeys(['backups/plotline-2026-10-31.tar.age'], manila)).toEqual(['backups/plotline-2026-10-31.tar.age'])
  })

  it('never returns keys that do not match the naming pattern', () => {
    const keys = [
      'backups/plotline-2020-01-01.tar.age.bak',
      'backups/other-2020-01-01.tar.age',
      'plotline-2020-01-01.tar.age',
      'backups/plotline-2020-1-1.tar.age',
      'backups/readme.txt',
      '',
    ]
    expect(expiredKeys(keys, now)).toEqual([])
  })

  it('preserves input order', () => {
    const keys = [
      'backups/plotline-2026-10-02.tar.age',
      'backups/plotline-2026-11-15.tar.age',
      'backups/plotline-2026-09-01.tar.age',
      'junk',
      'backups/plotline-2026-10-20.tar.age',
    ]
    expect(expiredKeys(keys, now)).toEqual([
      'backups/plotline-2026-10-02.tar.age',
      'backups/plotline-2026-09-01.tar.age',
      'backups/plotline-2026-10-20.tar.age',
    ])
  })

  it('crosses month and year boundaries', () => {
    const jan = new Date('2027-01-05T00:00:00Z')
    const keys = [
      'backups/plotline-2026-12-22.tar.age', // 14 days: kept
      'backups/plotline-2026-12-21.tar.age', // 15 days: expired
    ]
    expect(expiredKeys(keys, jan)).toEqual(['backups/plotline-2026-12-21.tar.age'])
  })

  it('honours a custom keepDays of 7', () => {
    const keys = [
      'backups/plotline-2026-11-08.tar.age', // 7 days: kept
      'backups/plotline-2026-11-07.tar.age', // 8 days: expired
    ]
    expect(expiredKeys(keys, now, 7)).toEqual(['backups/plotline-2026-11-07.tar.age'])
  })

  it('with keepDays 0 keeps only today', () => {
    const keys = ['backups/plotline-2026-11-15.tar.age', 'backups/plotline-2026-11-14.tar.age']
    expect(expiredKeys(keys, now, 0)).toEqual(['backups/plotline-2026-11-14.tar.age'])
  })

  it('returns an empty array for no keys', () => {
    expect(expiredKeys([], now)).toEqual([])
  })

  it('does not expire future-dated keys', () => {
    expect(expiredKeys(['backups/plotline-2026-12-31.tar.age'], now)).toEqual([])
  })
})

describe('diffRowCounts', () => {
  it('returns nothing when counts match', () => {
    expect(diffRowCounts({ bookings: 3, courts: 2 }, { courts: 2, bookings: 3 })).toEqual([])
  })

  it('reports differing tables sorted by table name', () => {
    expect(diffRowCounts({ courts: 2, bookings: 5, venues: 1 }, { courts: 2, bookings: 3, venues: 4 })).toEqual([
      { table: 'bookings', source: 5, target: 3 },
      { table: 'venues', source: 1, target: 4 },
    ])
  })

  it('uses null for a table missing on either side', () => {
    expect(diffRowCounts({ zeta: 1, alpha: 2 }, { beta: 7, alpha: 2 })).toEqual([
      { table: 'beta', source: null, target: 7 },
      { table: 'zeta', source: 1, target: null },
    ])
  })

  it('distinguishes a zero count from a missing table', () => {
    expect(diffRowCounts({ a: 0 }, {})).toEqual([{ table: 'a', source: 0, target: null }])
    expect(diffRowCounts({}, { a: 0 })).toEqual([{ table: 'a', source: null, target: 0 }])
    expect(diffRowCounts({ a: 0 }, { a: 0 })).toEqual([])
  })

  it('handles empty inputs', () => {
    expect(diffRowCounts({}, {})).toEqual([])
    expect(diffRowCounts({}, { x: 1 })).toEqual([{ table: 'x', source: null, target: 1 }])
  })
})

describe('assertRestoreTarget', () => {
  it('refuses the production project, naming production in the message', () => {
    expect(() => assertRestoreTarget(`postgresql://postgres.${PROD_REF}:pw@aws-0-ap.pooler.supabase.com:5432/postgres`)).toThrow(/production/)
    expect(() => assertRestoreTarget(`postgresql://postgres:pw@db.${PROD_REF}.supabase.co:5432/postgres`)).toThrow(Error)
  })

  it('refuses the ref anywhere in the URL, even in the path or query', () => {
    expect(() => assertRestoreTarget(`postgresql://localhost:5432/postgres?options=${PROD_REF}`)).toThrow(/production/)
    expect(() => assertRestoreTarget(`postgresql://localhost:5432/${PROD_REF}`)).toThrow(/production/)
  })

  it('throws on an empty string', () => {
    expect(() => assertRestoreTarget('')).toThrow(Error)
  })

  it('allows a local database and returns undefined', () => {
    expect(assertRestoreTarget('postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toBeUndefined()
  })

  it('allows another hosted project ref', () => {
    expect(assertRestoreTarget('postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres')).toBeUndefined()
  })

  it('honours a custom productionRef', () => {
    const url = 'postgresql://postgres:pw@db.customref123.supabase.co:5432/postgres'
    expect(() => assertRestoreTarget(url, 'customref123')).toThrow(/production/)
    expect(assertRestoreTarget(url)).toBeUndefined()
    // the default ref is no longer special when a custom one is given
    expect(assertRestoreTarget(`postgresql://db.${PROD_REF}.supabase.co/postgres`, 'customref123')).toBeUndefined()
  })
})
