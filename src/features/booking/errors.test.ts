import { describe, expect, it } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { bookingErrorCode, bookingErrorMessage, isSlotGone } from './errors'

const rpcError = (hint: string, message = 'Readable message.') => new ApiError(message, 'P0001', hint)

describe('booking errors', () => {
  it('reads the stable code from the hint', () => {
    expect(bookingErrorCode(rpcError('slot_unavailable'))).toBe('slot_unavailable')
    expect(bookingErrorCode(rpcError('open_play'))).toBe('open_play')
    expect(bookingErrorCode(rpcError('something_else'))).toBeNull()
    expect(bookingErrorCode(new Error('x'))).toBeNull()
  })

  it('treats taken, started, blacked-out, open play and archived slots as "pick again"', () => {
    for (const code of ['slot_unavailable', 'slot_started', 'blackout', 'open_play', 'court_inactive']) {
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

  it('knows walk_ins_off (T18.3) and shows its readable message', () => {
    expect(bookingErrorCode(rpcError('walk_ins_off'))).toBe('walk_ins_off')
    expect(bookingErrorMessage(rpcError('walk_ins_off', 'Walk-ins are not enabled for this venue.'))).toMatch(/Walk-ins/)
  })

  it('knows promo_overlap and court_not_found (T19.2) and shows the server message', () => {
    const overlap = 'This promo overlaps "Happy hour" on the same court, day and hour.'
    expect(bookingErrorCode(rpcError('promo_overlap'))).toBe('promo_overlap')
    expect(bookingErrorMessage(rpcError('promo_overlap', overlap))).toBe(overlap)
    expect(bookingErrorCode(rpcError('court_not_found'))).toBe('court_not_found')
    expect(bookingErrorMessage(rpcError('court_not_found', 'That court was not found.'))).toBe('That court was not found.')
    expect(isSlotGone(rpcError('promo_overlap'))).toBe(false)
  })
})
