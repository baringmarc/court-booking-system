import { describe, expect, it } from 'vitest'
import { formatRemaining } from './countdown'

describe('formatRemaining', () => {
  it('formats minutes and seconds under an hour', () => {
    expect(formatRemaining(59 * 60_000 + 7_000)).toBe('59:07')
    expect(formatRemaining(5_000)).toBe('0:05')
  })

  it('adds hours when needed', () => {
    expect(formatRemaining(3_723_000)).toBe('1:02:03')
  })

  it('never goes negative', () => {
    expect(formatRemaining(-10_000)).toBe('0:00')
  })
})
