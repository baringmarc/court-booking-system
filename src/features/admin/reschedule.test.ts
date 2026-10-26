import { describe, expect, it } from 'vitest'
import type { Slot, SlotStatus } from '../booking/selection'
import { adminCanReschedule, endAfter, hasStarted, isSplit, moveFromOptions, movedHours, validStarts } from './reschedule'

const at = (hour: number) => new Date(Date.UTC(2030, 0, 7, hour)).toISOString()
// A 3-hour booking from 10:00 to 13:00 (UTC, the zone doesn't matter for hour maths).
const booking = { status: 'confirmed' as const, slot_start: at(10), slot_end: at(13) }
const slot = (hour: number, status: SlotStatus = 'free'): Slot => ({
  court_id: 'c', slot_start: at(hour), slot_end: at(hour + 1), price: 100, status,
  booker_first_name: null, open_play_session_id: null, block_key: null,
})

describe('adminCanReschedule', () => {
  it('allows a confirmed booking until it ends', () => {
    expect(adminCanReschedule(booking, new Date(at(9)))).toBe(true)
    expect(adminCanReschedule(booking, new Date(at(12)))).toBe(true)
    expect(adminCanReschedule(booking, new Date(at(13)))).toBe(false)
  })

  it('needs a confirmed booking', () => {
    for (const status of ['pending_payment', 'payment_submitted', 'cancelled', 'expired', 'rejected'] as const) {
      expect(adminCanReschedule({ ...booking, status }, new Date(at(9)))).toBe(false)
    }
  })
})

describe('moveFromOptions', () => {
  it('is empty before the start: the whole booking moves', () => {
    expect(hasStarted(booking, new Date(at(9)))).toBe(false)
    expect(moveFromOptions(booking, new Date(at(9)))).toEqual([])
  })

  it('starts at the hour in progress and offers the later hours', () => {
    expect(moveFromOptions(booking, new Date(at(10)))).toEqual([at(10), at(11), at(12)])
    expect(moveFromOptions(booking, new Date(Date.UTC(2030, 0, 7, 11, 30)))).toEqual([at(11), at(12)])
    expect(moveFromOptions(booking, new Date(at(12)))).toEqual([at(12)])
  })

  it('offers nothing once it has ended', () => {
    expect(moveFromOptions(booking, new Date(at(13)))).toEqual([])
  })
})

describe('movedHours and isSplit', () => {
  it('counts from the chosen hour to the end', () => {
    expect(movedHours(booking, at(10))).toBe(3)
    expect(movedHours(booking, at(12))).toBe(1)
  })

  it('splits only when the move starts after the first hour', () => {
    expect(isSplit(booking, at(10))).toBe(false)
    expect(isSplit(booking, at(11))).toBe(true)
  })
})

describe('validStarts', () => {
  const now = new Date(at(8))

  it('keeps starts with enough back-to-back free hours', () => {
    const day = [slot(9), slot(10), slot(11, 'booked'), slot(12), slot(13), slot(14)]
    expect(validStarts(day, 2, now).map((s) => s.slot_start)).toEqual([at(9), at(12), at(13)])
    expect(validStarts(day, 1, now).map((s) => s.slot_start)).toEqual([at(9), at(10), at(12), at(13), at(14)])
  })

  it('treats the hour in progress as free (walk-in rules) but not an hour that is over', () => {
    const during = new Date(Date.UTC(2030, 0, 7, 10, 30))
    // 9 AM is over ('past', ended), 10 AM is in progress and free ('past', not ended).
    const day = [slot(9, 'past'), slot(10, 'past'), slot(11), slot(12)]
    expect(validStarts(day, 2, during).map((s) => s.slot_start)).toEqual([at(10), at(11)])
  })

  it('does not join hours across a gap, a blackout or open play', () => {
    expect(validStarts([slot(9), slot(11)], 2, now)).toEqual([])
    expect(validStarts([slot(9), slot(10, 'blackout'), slot(11)], 2, now)).toEqual([])
    expect(validStarts([slot(9), slot(10, 'open_play'), slot(11)], 2, now)).toEqual([])
  })

  it('is empty when the court has no slots that day', () => {
    expect(validStarts([], 1, now)).toEqual([])
  })
})

describe('endAfter', () => {
  it('adds whole hours', () => {
    expect(endAfter(at(12), 2)).toBe(at(14))
  })
})
