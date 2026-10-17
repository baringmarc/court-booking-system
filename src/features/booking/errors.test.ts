import { describe, expect, it } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { bookingErrorCode, bookingErrorMessage, isSlotGone } from './errors'

const rpcError = (hint: string, message = 'Readable message.') => new ApiError(message, 'P0001', hint)

describe('booking errors', () => {
  it('reads the stable code from the hint', () => {
    expect(bookingErrorCode(rpcError('slot_unavailable'))).toBe('slot_unavailable')
    expect(bookingErrorCode(rpcError('something_else'))).toBeNull()
    expect(bookingErrorCode(new Error('x'))).toBeNull()
  })

  it('treats taken, started, blacked-out and archived slots as "pick again"', () => {
    for (const code of ['slot_unavailable', 'slot_started', 'blackout', 'court_inactive']) {
      expect(isSlotGone(rpcError(code))).toBe(true)
    }
    expect(isSlotGone(rpcError('invalid_guest'))).toBe(false)
  })

  it('shows RPC messages and hides unexpected errors behind a generic line', () => {
    expect(bookingErrorMessage(rpcError('invalid_guest', 'Please enter a valid email address.'))).toBe(
      'Please enter a valid email address.',
    )
    expect(bookingErrorMessage(new ApiError('relation "x" does not exist', '42P01'))).toMatch(/Something went wrong/)
    expect(bookingErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Something went wrong/)
  })
})
