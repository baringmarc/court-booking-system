// T30.6: the update_refund hints show the server's message (SPEC §6 update_refund).
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { bookingErrorCode, bookingErrorMessage } from './errors'

describe('update_refund error hints (T30.6)', () => {
  it.each([
    ['invalid_amount', 'Enter an amount above 0 and no more than what was paid.'],
    ['missing_method', 'Choose how the refund was made.'],
    ['missing_reason', 'Give a reason so the player knows why.'],
  ])('%s shows its message', (hint, message) => {
    const error = new ApiError(message, 'P0001', hint)
    expect(bookingErrorCode(error)).toBe(hint)
    expect(bookingErrorMessage(error)).toBe(message)
  })

  it('invalid_input from a future refund date shows its message too', () => {
    expect(bookingErrorMessage(new ApiError('Choose the date the refund was made, today or earlier.', 'P0001', 'invalid_input')))
      .toBe('Choose the date the refund was made, today or earlier.')
  })

  it('still hides the text of an unknown hint', () => {
    expect(bookingErrorMessage(new ApiError('internal detail', 'P0001', 'refund_secret'))).toBe('Something went wrong. Please check your connection and try again.')
  })
})
