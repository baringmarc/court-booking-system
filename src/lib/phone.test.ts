import { describe, expect, it } from 'vitest'
import { normalizePhMobile, PHONE_ERROR } from './phone'

describe('normalizePhMobile (mirrors private.normalize_ph_mobile)', () => {
  it('exports the exact error message', () => {
    expect(PHONE_ERROR).toBe('Enter an 11-digit mobile number, like 09171234567.')
  })

  it.each(['', '   ', '\t'])('turns blank %j into null', (input) => {
    expect(normalizePhMobile(input)).toBeNull()
  })

  it.each([
    ['09171234567'],
    ['0917 123 4567'],
    ['0917.123.4567'],
    ['0917-123-4567'],
    ['(0917) 123-4567'],
    ['+63 917 123 4567'],
    ['+639171234567'],
    ['63 917 123 4567'],
    ['639171234567'],
    ['917 123 4567'],
    ['9171234567'],
    ['  0917 123 4567  '],
  ])('normalizes %j to 09171234567', (input) => {
    expect(normalizePhMobile(input)).toBe('09171234567')
  })

  it.each([
    ['028123456', 'a landline'],
    ['0917123456', 'too short'],
    ['091712345678', 'too long'],
    ['0917abc4567', 'letters'],
    ['+1 917 123 4567', 'another country code'],
    ['+63 817 123 4567', '+63 not followed by 9'],
    ['8171234567', 'a bare 10 digits not starting with 9'],
    ['12345', 'far too short'],
  ])('refuses %j (%s)', (input) => {
    expect(normalizePhMobile(input)).toBe('invalid')
  })
})
