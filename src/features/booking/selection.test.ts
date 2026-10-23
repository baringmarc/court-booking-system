import { describe, expect, it } from 'vitest'
import { reconcileSelection, summarizeSelection, toggleSlot, type Selection, type Slot, type SlotStatus } from './selection'

const H = (h: number) => `2030-01-07T${String(h - 8).padStart(2, '0')}:00:00.000Z` // Manila hour → UTC ISO

function court(id: string, statuses: Record<number, SlotStatus> = {}, from = 10, to = 16): Slot[] {
  return Array.from({ length: to - from }, (_, i) => {
    const h = from + i
    return { court_id: id, slot_start: H(h), slot_end: H(h + 1), price: h >= 14 ? 450 : 350, status: statuses[h] ?? 'free', booker_first_name: null, open_play_session_id: null }
  })
}

const A = court('A', { 13: 'booked' })
const B = court('B')
const at = (slots: Slot[], h: number) => slots.find((s) => s.slot_start === H(h))!
const sel = (courtId: string, ...hours: number[]): Selection => ({ courtId, starts: hours.map(H) })

describe('toggleSlot', () => {
  it('starts a selection on a free slot', () => {
    expect(toggleSlot(null, at(A, 10), A)).toEqual(sel('A', 10))
  })

  it('ignores busy, blackout and past slots', () => {
    expect(toggleSlot(null, at(A, 13), A)).toBeNull()
    expect(toggleSlot(sel('A', 11), at(A, 13), A)).toEqual(sel('A', 11))
    const past = court('P', { 10: 'past' })
    expect(toggleSlot(null, at(past, 10), past)).toBeNull()
  })

  it('extends with adjacent slots in either direction', () => {
    expect(toggleSlot(sel('A', 11), at(A, 12), A)).toEqual(sel('A', 11, 12))
    expect(toggleSlot(sel('A', 11), at(A, 10), A)).toEqual(sel('A', 10, 11))
  })

  it('fills the gap when every slot in between is free', () => {
    expect(toggleSlot(sel('B', 10), at(B, 13), B)).toEqual(sel('B', 10, 11, 12, 13))
  })

  it('starts over instead of jumping across a busy slot', () => {
    expect(toggleSlot(sel('A', 11, 12), at(A, 14), A)).toEqual(sel('A', 14))
  })

  it('removes the first or last slot when it is tapped again', () => {
    expect(toggleSlot(sel('B', 10, 11, 12), at(B, 10), B)).toEqual(sel('B', 11, 12))
    expect(toggleSlot(sel('B', 10, 11, 12), at(B, 12), B)).toEqual(sel('B', 10, 11))
    expect(toggleSlot(sel('B', 10), at(B, 10), B)).toBeNull()
  })

  it('starts over at a slot tapped in the middle, so a selection never has a hole', () => {
    expect(toggleSlot(sel('B', 10, 11, 12), at(B, 11), B)).toEqual(sel('B', 11))
  })

  it('switching courts starts a new selection', () => {
    expect(toggleSlot(sel('A', 10, 11), at(B, 11), B)).toEqual(sel('B', 11))
  })
})

describe('reconcileSelection', () => {
  it('keeps a selection whose slots are all still free', () => {
    expect(reconcileSelection(sel('B', 10, 11), B)).toEqual(sel('B', 10, 11))
  })

  it('drops a selection when one of its slots got booked or disappeared', () => {
    expect(reconcileSelection(sel('A', 12, 13), A)).toBeNull()
    expect(reconcileSelection(sel('B', 20), B)).toBeNull()
  })
})

describe('summarizeSelection', () => {
  it('reports start, end, count and the display total', () => {
    expect(summarizeSelection(sel('B', 13, 14, 15), B)).toEqual({
      courtId: 'B',
      start: H(13),
      end: H(16),
      slots: 3,
      total: 350 + 450 + 450,
    })
  })

  it('returns null without a selection', () => {
    expect(summarizeSelection(null, B)).toBeNull()
  })
})
