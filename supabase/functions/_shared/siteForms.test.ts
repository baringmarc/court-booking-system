import { describe, expect, it } from 'vitest'
import {
  isLikelyBot,
  MIN_FILL_MS,
  normalizePhone,
  validateContact,
  validateReview,
  type ContactPayload,
  type ReviewPayload,
} from './siteForms.ts'

const NOW = 1_800_000_000_000

const contact: ContactPayload = {
  firstName: 'Ana',
  lastName: 'Reyes',
  email: ' Ana@Example.com ',
  phone: '0917 123 4567',
  venueName: 'Sample Pickle Park',
  location: 'Pasig',
  courts: 3,
  facebook: '',
  message: '',
  consent: true,
  website: '',
  started: NOW - 60_000,
  turnstileToken: 'token',
}

const review: ReviewPayload = {
  name: 'Ben',
  venue: '',
  quote: 'Booking took me one minute.',
  role: 'player',
  rating: 5,
  consent: true,
  website: '',
  started: NOW - 60_000,
}

describe('validateContact', () => {
  it('accepts a complete form and normalizes email and phone', () => {
    expect(validateContact(contact)).toEqual({
      ok: true,
      value: {
        firstName: 'Ana',
        lastName: 'Reyes',
        email: 'ana@example.com',
        phone: '09171234567',
        venueName: 'Sample Pickle Park',
        location: 'Pasig',
        courts: 3,
        facebook: '',
        message: '',
      },
    })
  })

  it('accepts +63 numbers', () => {
    expect(validateContact({ ...contact, phone: '+63 917-123-4567' }).ok).toBe(true)
  })

  it.each([
    ['a missing first name', { firstName: ' ' }],
    ['a bad email', { email: 'ana@' }],
    ['a landline', { phone: '02 8123 4567' }],
    ['a one-letter venue', { venueName: 'A' }],
    ['zero courts', { courts: 0 }],
    ['too many courts', { courts: 51 }],
    ['fractional courts', { courts: 2.5 }],
    ['a long message', { message: 'x'.repeat(1001) }],
    ['no consent', { consent: false }],
  ])('refuses %s', (_label, patch) => {
    const r = validateContact({ ...contact, ...patch })
    expect(r.ok).toBe(false)
  })

  it('refuses anything that is not an object', () => {
    expect(validateContact(null)).toEqual({ ok: false, error: 'Invalid request.' })
    expect(validateContact([contact])).toEqual({ ok: false, error: 'Invalid request.' })
  })

  it('does not return the consent, honeypot, timing or Turnstile fields', () => {
    const r = validateContact(contact)
    expect(r.ok && Object.keys(r.value)).not.toContain('turnstileToken')
    expect(r.ok && Object.keys(r.value)).not.toContain('consent')
  })
})

describe('validateReview', () => {
  it('accepts a complete review', () => {
    expect(validateReview(review)).toEqual({
      ok: true,
      value: { name: 'Ben', venue: '', quote: 'Booking took me one minute.', role: 'player', rating: 5 },
    })
  })

  it.each([
    ['no rating', { rating: 0 }],
    ['a rating of 6', { rating: 6 }],
    ['an unknown role', { role: 'coach' }],
    ['a short quote', { quote: 'Nice' }],
    ['a long quote', { quote: 'x'.repeat(401) }],
    ['no consent', { consent: false }],
  ])('refuses %s', (_label, patch) => {
    expect(validateReview({ ...review, ...patch }).ok).toBe(false)
  })
})

describe('isLikelyBot', () => {
  it('passes a person who took their time', () => {
    expect(isLikelyBot(contact, NOW)).toBe(false)
  })

  it('catches a filled honeypot', () => {
    expect(isLikelyBot({ ...contact, website: 'http://spam.example' }, NOW)).toBe(true)
  })

  it('catches a form sent too fast, or with no start time', () => {
    expect(isLikelyBot({ ...contact, started: NOW - (MIN_FILL_MS - 1) }, NOW)).toBe(true)
    expect(isLikelyBot({ ...contact, started: undefined }, NOW)).toBe(true)
    expect(isLikelyBot(null, NOW)).toBe(true)
  })
})

describe('normalizePhone', () => {
  it('drops spaces and dashes only', () => {
    expect(normalizePhone('+63 917-123 4567')).toBe('+639171234567')
  })
})
