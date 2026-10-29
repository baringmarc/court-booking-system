import { describe, expect, it } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { bookingErrorMessage } from './errors'

describe('waiver_required (T11.20)', () => {
  it('maps the hint to a friendly message whatever the server text', () => {
    expect(bookingErrorMessage(new ApiError('Raw server text.', 'P0001', 'waiver_required'))).toBe(
      'Please read and accept the waiver to book.',
    )
  })
})
