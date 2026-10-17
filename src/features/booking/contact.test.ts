import { describe, expect, it } from 'vitest'
import { validateContact } from './contact'

const ok = { name: 'Gina Guest', email: 'gina@example.com', phone: '0917 222 2222' }

describe('validateContact', () => {
  it('accepts a complete guest contact', () => {
    expect(validateContact(ok, { isGuest: true })).toEqual({})
  })

  it('requires name, email and phone from guests', () => {
    expect(validateContact({ name: ' ', email: '', phone: '' }, { isGuest: true })).toEqual({
      name: 'Please enter your name.',
      email: 'Please enter your email.',
      phone: 'Please enter your phone number.',
    })
  })

  it('checks email and phone format like the server does', () => {
    expect(validateContact({ ...ok, email: 'gina@example' }, { isGuest: true }).email).toMatch(/valid email/)
    expect(validateContact({ ...ok, phone: '12-34' }, { isGuest: true }).phone).toMatch(/valid phone/)
  })

  it('lets logged-in players skip email and phone, but checks a phone they do enter', () => {
    expect(validateContact({ name: 'Pat', email: '', phone: '' }, { isGuest: false })).toEqual({})
    expect(validateContact({ name: 'Pat', email: '', phone: '123' }, { isGuest: false }).phone).toMatch(/valid phone/)
  })
})
