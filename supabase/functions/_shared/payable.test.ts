import { describe, expect, it } from 'vitest'
import { callerUserId, normalizeReference, rpcError } from './payable.ts'

describe('callerUserId', () => {
  it('trusts only a verified user session', () => {
    expect(callerUserId({ authMode: 'user', userClaims: { id: 'u1' } })).toBe('u1')
    expect(callerUserId({ authMode: 'user', jwtClaims: { sub: 'u2' } })).toBe('u2')
    expect(callerUserId({ authMode: 'publishable', userClaims: { id: 'u1' } })).toBeNull()
    expect(callerUserId({})).toBeNull()
  })
})

describe('rpcError', () => {
  it('passes our P0001 messages through with an HTTP status', () => {
    expect(rpcError({ message: 'This hold has expired.', hint: 'hold_expired' })).toMatchObject({ code: 'hold_expired', status: 409, message: 'This hold has expired.' })
    expect(rpcError({ message: 'Booking not found.', hint: 'not_found' })).toMatchObject({ status: 404 })
    expect(rpcError({ message: 'Not waiting for payment.', hint: 'invalid_state' })).toMatchObject({ status: 409 })
  })

  it('hides anything else behind a generic message', () => {
    expect(rpcError({ message: 'permission denied for function x', hint: null })).toMatchObject({
      code: 'server_error', status: 500, message: 'Something went wrong. Please try again.',
    })
  })
})

describe('normalizeReference', () => {
  it('accepts and upper-cases booking references', () => {
    expect(normalizeReference(' cb-abc234 ')).toBe('CB-ABC234')
  })

  it('treats anything else as not found', () => {
    expect(() => normalizeReference('CB-0O1I00')).toThrow('Booking not found')
    expect(() => normalizeReference(undefined)).toThrow('Booking not found')
  })
})
