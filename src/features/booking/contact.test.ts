import { describe, expect, it } from 'vitest'
import { PHONE_ERROR } from '../../lib/phone'
import { validateContact } from './contact'

const ok = { name: 'Gina Guest', email: 'gina@example.com', phone: '0917 222 2222' }

describe('validateContact', () => {
  it('accepts a complete guest contact', () => {
    expect(validateContact(ok, { isGuest: true })).toEqual({})
  })

  it('requires name and email from guests, but not a phone number', () => {
    expect(validateContact({ name: ' ', email: '', phone: '' }, { isGuest: true })).toEqual({
      name: 'Please enter your name.',
      email: 'Please enter your email.',
    })
    expect(validateContact({ name: 'Gina', email: 'gina@example.com', phone: '   ' }, { isGuest: true })).toEqual({})
  })

  it('checks email format like the server does', () => {
    expect(validateContact({ ...ok, email: 'gina@example' }, { isGuest: true }).email).toMatch(/valid email/)
  })

  it('accepts any format of a Philippine mobile number', () => {
    for (const phone of ['09171234567', '+63 917 123 4567', '917-123-4567', '(0917) 123 4567']) {
      expect(validateContact({ ...ok, phone }, { isGuest: true })).toEqual({})
    }
  })

  it('gives the PHONE_ERROR for a number that is not a mobile number, for guests and players', () => {
    for (const phone of ['12-34', '028123456', '0917123456', '+1 917 123 4567']) {
      expect(validateContact({ ...ok, phone }, { isGuest: true }).phone).toBe(PHONE_ERROR)
      expect(validateContact({ name: 'Pat', email: '', phone }, { isGuest: false }).phone).toBe(PHONE_ERROR)
    }
  })

  it('lets logged-in players skip email and phone', () => {
    expect(validateContact({ name: 'Pat', email: '', phone: '' }, { isGuest: false })).toEqual({})
  })
})
