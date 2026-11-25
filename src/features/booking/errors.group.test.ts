// T33.3: the group checkout's error texts (SPEC §6 create_booking_group).
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { bookingErrorCode, bookingErrorMessage, groupBookingErrorMessage, isSlotGone } from './errors'
import { TOO_MANY_RUNS_MESSAGE } from './selection'

const rpcError = (hint: string, message = 'Readable message.') => new ApiError(message, 'P0001', hint)

describe('too_many_courts', () => {
  it('is a known code', () => {
    expect(bookingErrorCode(rpcError('too_many_courts'))).toBe('too_many_courts')
  })

  it('shows the page wording, not the RPC message that says "courts"', () => {
    expect(bookingErrorMessage(rpcError('too_many_courts', 'You can book up to 6 courts in one checkout.'))).toBe(TOO_MANY_RUNS_MESSAGE)
    expect(TOO_MANY_RUNS_MESSAGE).toBe('You can book up to 6 separate times in one checkout.')
  })

  it('is not a "pick another slot" error', () => {
    expect(isSlotGone(rpcError('too_many_courts'))).toBe(false)
  })
})

describe('groupBookingErrorMessage', () => {
  it('invalid_input says the times cannot be booked together', () => {
    expect(groupBookingErrorMessage(rpcError('invalid_input', 'Choose the courts and times again.'))).toBe(
      "Those times can't be booked together. Please choose them again.",
    )
  })

  it('a slot_unavailable error keeps the RPC message, which starts with the court name', () => {
    const message = 'Badminton 2: Sorry, that time was just booked. Please pick another slot.'
    expect(groupBookingErrorMessage(rpcError('slot_unavailable', message))).toBe(message)
    expect(isSlotGone(rpcError('slot_unavailable', message))).toBe(true)
  })

  it('every other error reads as bookingErrorMessage does', () => {
    expect(groupBookingErrorMessage(rpcError('invalid_guest', 'Please enter a valid email address.'))).toBe('Please enter a valid email address.')
    expect(groupBookingErrorMessage(rpcError('waiver_required'))).toBe('Please read and accept the waiver to book.')
    expect(groupBookingErrorMessage(rpcError('too_many_courts', 'x'))).toBe(TOO_MANY_RUNS_MESSAGE)
    expect(groupBookingErrorMessage(new TypeError('Failed to fetch'))).toMatch(/Something went wrong/)
  })
})
