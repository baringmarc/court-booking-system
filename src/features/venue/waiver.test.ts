// T11.20: the default waiver matches the SPEC §10 2026-10-28 text (and the DB column default); the cap is 2000.
import { describe, expect, it } from 'vitest'
import { DEFAULT_WAIVER_TEXT, WAIVER_MAX } from './waiver'

describe('waiver constants', () => {
  it('has the SPEC default text', () => {
    expect(DEFAULT_WAIVER_TEXT).toBe(
      "By booking and playing at the venue, you accept that sports carry a risk of injury. You play at your own risk and are responsible for your own belongings. Players under 18 need a parent or guardian's consent.",
    )
  })
  it('caps the text at 2000 characters', () => {
    expect(WAIVER_MAX).toBe(2000)
    expect(DEFAULT_WAIVER_TEXT.length).toBeLessThanOrEqual(WAIVER_MAX)
  })
})
