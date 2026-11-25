// T33.3: a selection is any set of free slots on any courts. Slots that touch on one court merge into one run; a
// checkout holds at most MAX_RUNS runs. (Replaces the single-court "fill the gap / start over" rules, SPEC §10 2026-11-25.)
import { describe, expect, it } from 'vitest'
import {
  MAX_RUNS, TOO_MANY_RUNS_MESSAGE, promoLabelsOf, reconcileSelection, removeRun, selectionRuns, summarizeSelection, toggleSlot,
  type PickedSlot, type Selection, type Slot, type SlotStatus,
} from './selection'

const H = (h: number) => `2030-01-07T${String(h - 8).padStart(2, '0')}:00:00.000Z` // Manila hour → UTC ISO

function court(id: string, statuses: Record<number, SlotStatus> = {}, from = 10, to = 16): Slot[] {
  return Array.from({ length: to - from }, (_, i) => {
    const h = from + i
    return { court_id: id, slot_start: H(h), slot_end: H(h + 1), price: h >= 14 ? 450 : 350, status: statuses[h] ?? 'free', booker_first_name: null, open_play_session_id: null, block_key: null }
  })
}

const byCourt = (...courts: Slot[][]) => new Map<string, Slot[]>(courts.map((slots) => [slots[0].court_id, slots]))
const at = (slots: Slot[], h: number) => slots.find((s) => s.slot_start === H(h))!
const picks = (courtId: string, ...hours: number[]): Selection => hours.map((h) => ({ courtId, start: H(h) }))
/** Order isn't significant in a selection, so compare it sorted. */
const sorted = (selection: Selection): PickedSlot[] => [...selection].sort((a, b) => a.courtId.localeCompare(b.courtId) || a.start.localeCompare(b.start))

const A = court('A', { 13: 'booked' })
const B = court('B')
const MAP = byCourt(A, B)

describe('constants', () => {
  it('allows 6 runs per checkout and has the exact refusal message', () => {
    expect(MAX_RUNS).toBe(6)
    expect(TOO_MANY_RUNS_MESSAGE).toBe('You can book up to 6 separate times in one checkout.')
  })
})

describe('toggleSlot', () => {
  it('adds a free slot to an empty selection', () => {
    const result = toggleSlot([], at(A, 10), MAP)
    expect(result.refused).toBeNull()
    expect(sorted(result.selection)).toEqual(picks('A', 10))
  })

  it('ignores busy, blackout, open play and past slots: selection unchanged, nothing refused', () => {
    const start = picks('A', 11)
    for (const status of ['booked', 'blackout', 'open_play', 'past'] as const) {
      const busy = court('X', { 10: status })
      const result = toggleSlot(start, at(busy, 10), byCourt(A, busy))
      expect(result, status).toEqual({ selection: start, refused: null })
    }
    expect(toggleSlot([], at(A, 13), MAP)).toEqual({ selection: [], refused: null })
  })

  it('ignores a slot that is not in its court list', () => {
    const stranger = { ...at(B, 10), court_id: 'Z' }
    expect(toggleSlot(picks('A', 11), stranger, MAP)).toEqual({ selection: picks('A', 11), refused: null })
    const late = { ...at(A, 10), slot_start: H(20), slot_end: H(21) }
    expect(toggleSlot(picks('A', 11), late, MAP)).toEqual({ selection: picks('A', 11), refused: null })
  })

  it('a second tap on the same court no longer fills the gap: two separate picks, two runs', () => {
    const { selection, refused } = toggleSlot(picks('B', 10), at(B, 13), MAP)
    expect(refused).toBeNull()
    expect(sorted(selection)).toEqual(picks('B', 10, 13))
    expect(selectionRuns(selection, MAP)).toEqual([
      { courtId: 'B', starts: [H(10)] },
      { courtId: 'B', starts: [H(13)] },
    ])
  })

  it('a tap across a busy slot keeps the earlier picks (no start-over)', () => {
    const { selection } = toggleSlot(picks('A', 11, 12), at(A, 14), MAP)
    expect(sorted(selection)).toEqual(picks('A', 11, 12, 14))
    expect(selectionRuns(selection, MAP)).toEqual([
      { courtId: 'A', starts: [H(11), H(12)] },
      { courtId: 'A', starts: [H(14)] },
    ])
  })

  it('a tap on another court adds to the selection instead of replacing it', () => {
    const { selection, refused } = toggleSlot(picks('A', 10, 11), at(B, 11), MAP)
    expect(refused).toBeNull()
    expect(sorted(selection)).toEqual([...picks('A', 10, 11), ...picks('B', 11)])
    expect(selectionRuns(selection, MAP)).toEqual([
      { courtId: 'A', starts: [H(10), H(11)] },
      { courtId: 'B', starts: [H(11)] },
    ])
  })

  it('a free slot already picked is removed', () => {
    const { selection, refused } = toggleSlot(picks('B', 10, 11, 12), at(B, 10), MAP)
    expect(refused).toBeNull()
    expect(sorted(selection)).toEqual(picks('B', 11, 12))
    expect(toggleSlot(picks('B', 10), at(B, 10), MAP)).toEqual({ selection: [], refused: null })
    expect(sorted(toggleSlot(picks('B', 10, 11, 12), at(B, 12), MAP).selection)).toEqual(picks('B', 10, 11))
  })

  it('removing a slot in the middle splits its run in two', () => {
    const { selection, refused } = toggleSlot(picks('B', 10, 11, 12), at(B, 11), MAP)
    expect(refused).toBeNull()
    expect(sorted(selection)).toEqual(picks('B', 10, 12))
    expect(selectionRuns(selection, MAP)).toEqual([
      { courtId: 'B', starts: [H(10)] },
      { courtId: 'B', starts: [H(12)] },
    ])
  })

  it('a tap between two picks joins them into one run', () => {
    const { selection } = toggleSlot(picks('B', 10, 12), at(B, 11), MAP)
    expect(selectionRuns(selection, MAP)).toEqual([{ courtId: 'B', starts: [H(10), H(11), H(12)] }])
  })
})

describe('selectionRuns', () => {
  it('is empty for no picks', () => {
    expect(selectionRuns([], MAP)).toEqual([])
  })

  it('merges touching picks on one court, whatever the order they were picked in', () => {
    expect(selectionRuns(picks('B', 12, 10, 11), MAP)).toEqual([{ courtId: 'B', starts: [H(10), H(11), H(12)] }])
  })

  it('does not merge picks with a busy slot between them', () => {
    expect(selectionRuns(picks('A', 12, 14), MAP)).toEqual([
      { courtId: 'A', starts: [H(12)] },
      { courtId: 'A', starts: [H(14)] },
    ])
  })

  it('never crosses a break: touching slots in different opening periods are two runs', () => {
    const slots = court('P', {}, 10, 13).map((slot, i) => ({ ...slot, period_end: H(i === 0 ? 11 : 13) }))
    const map = byCourt(slots)
    expect(selectionRuns(picks('P', 10, 11), map)).toEqual([
      { courtId: 'P', starts: [H(10)] },
      { courtId: 'P', starts: [H(11)] },
    ])
    // Inside one period they still merge.
    expect(selectionRuns(picks('P', 11, 12), map)).toEqual([{ courtId: 'P', starts: [H(11), H(12)] }])
  })

  it('sorts runs by their first start, ties by court id, with starts ascending', () => {
    const map = byCourt(A, B)
    expect(selectionRuns([...picks('B', 10), ...picks('A', 15, 14), ...picks('A', 10)], map)).toEqual([
      { courtId: 'A', starts: [H(10)] },
      { courtId: 'B', starts: [H(10)] },
      { courtId: 'A', starts: [H(14), H(15)] },
    ])
  })
})

describe('the run cap', () => {
  const long = court('L', {}, 8, 22)
  const LONG = byCourt(long)
  // Six separate single-hour runs: 8, 10, 12, 14, 16, 18.
  const six = picks('L', 8, 10, 12, 14, 16, 18)

  it('six separate runs are within the cap', () => {
    expect(selectionRuns(six, LONG)).toHaveLength(MAX_RUNS)
  })

  it('refuses a 7th separate run: selection unchanged, refused too_many_runs', () => {
    expect(toggleSlot(six, at(long, 20), LONG)).toEqual({ selection: six, refused: 'too_many_runs' })
  })

  it('allows a tap that extends an existing run at 6 runs', () => {
    const result = toggleSlot(six, at(long, 19), LONG)
    expect(result.refused).toBeNull()
    expect(sorted(result.selection)).toEqual(sorted([...six, ...picks('L', 19)]))
  })

  it('allows a tap that joins two runs at 6 runs', () => {
    const result = toggleSlot(six, at(long, 9), LONG)
    expect(result.refused).toBeNull()
    expect(selectionRuns(result.selection, LONG)).toHaveLength(5)
  })

  it('refuses a removal that would split a run into a 7th', () => {
    const picked = picks('L', 8, 10, 11, 12, 14, 16, 18, 20)
    expect(selectionRuns(picked, LONG)).toHaveLength(6)
    expect(toggleSlot(picked, at(long, 11), LONG)).toEqual({ selection: picked, refused: 'too_many_runs' })
  })

  it('allows removals that keep the count: the end of a run, or a whole single-slot run', () => {
    const picked = picks('L', 8, 10, 11, 12, 14, 16, 18)
    expect(toggleSlot(picked, at(long, 12), LONG).refused).toBeNull()
    const gone = toggleSlot(six, at(long, 8), LONG)
    expect(gone.refused).toBeNull()
    expect(sorted(gone.selection)).toEqual(picks('L', 10, 12, 14, 16, 18))
  })

  it('counts runs, not slots: many touching slots are one run', () => {
    const many = picks('L', 8, 9, 10, 11, 12, 13, 14, 15)
    const result = toggleSlot(many, at(long, 17), LONG)
    expect(result.refused).toBeNull()
    expect(selectionRuns(result.selection, LONG)).toHaveLength(2)
  })

  it('counts runs on different courts together: a 7th court is refused', () => {
    const courts = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map((id) => court(id, {}, 10, 12))
    const map = byCourt(...courts)
    let selection: Selection = []
    for (const c of courts.slice(0, 6)) {
      const result = toggleSlot(selection, at(c, 10), map)
      expect(result.refused).toBeNull()
      selection = result.selection
    }
    expect(toggleSlot(selection, at(courts[6], 10), map)).toEqual({ selection, refused: 'too_many_runs' })
  })
})

describe('removeRun', () => {
  it('drops every pick of that run and nothing else', () => {
    const selection = [...picks('A', 10, 11, 14), ...picks('B', 10)]
    const result = removeRun(selection, { courtId: 'A', starts: [H(10), H(11)] })
    expect(sorted(result)).toEqual([...picks('A', 14), ...picks('B', 10)])
  })
})

describe('reconcileSelection', () => {
  it('keeps every pick whose slot is still free and reports nothing dropped', () => {
    expect(reconcileSelection(picks('B', 10, 11), MAP)).toEqual({ selection: picks('B', 10, 11), dropped: [] })
  })

  it('drops only the picks that got booked, past or vanished, listing them in input order', () => {
    const past = court('P', { 10: 'past' })
    const input = [...picks('A', 12, 13), ...picks('B', 10), ...picks('P', 10), ...picks('Z', 11), ...picks('B', 20)]
    const result = reconcileSelection(input, byCourt(A, B, past))
    expect(result.selection).toEqual([...picks('A', 12), ...picks('B', 10)])
    expect(result.dropped).toEqual([...picks('A', 13), ...picks('P', 10), ...picks('Z', 11), ...picks('B', 20)])
  })

  it('never drops a pick just because its neighbour is gone', () => {
    const result = reconcileSelection(picks('A', 10, 11, 12, 13), MAP)
    expect(result.selection).toEqual(picks('A', 10, 11, 12))
    expect(result.dropped).toEqual(picks('A', 13))
  })

  it('keeps touching picks across a period boundary (they just stay two runs)', () => {
    const slots = court('B', {}, 10, 12).map((slot, i) => ({ ...slot, period_end: H(i === 0 ? 11 : 12) }))
    expect(reconcileSelection(picks('B', 10, 11), byCourt(slots))).toEqual({ selection: picks('B', 10, 11), dropped: [] })
  })

  it('an empty selection stays empty', () => {
    expect(reconcileSelection([], MAP)).toEqual({ selection: [], dropped: [] })
  })
})

describe('summarizeSelection', () => {
  it('one run: start, end, count and the display total', () => {
    expect(summarizeSelection(picks('B', 13, 14, 15), MAP)).toEqual({
      runs: [{ courtId: 'B', start: H(13), end: H(16), slots: 3, total: 350 + 450 + 450, promoLabels: [] }],
      courtCount: 1,
      total: 1250,
      promoLabels: [],
    })
  })

  it('two courts: one summary per run in run order, two courts, summed total', () => {
    expect(summarizeSelection([...picks('B', 14, 15), ...picks('A', 10, 11)], MAP)).toEqual({
      runs: [
        { courtId: 'A', start: H(10), end: H(12), slots: 2, total: 700, promoLabels: [] },
        { courtId: 'B', start: H(14), end: H(16), slots: 2, total: 900, promoLabels: [] },
      ],
      courtCount: 2,
      total: 1600,
      promoLabels: [],
    })
  })

  it('two runs on one court: two runs, one court', () => {
    const summary = summarizeSelection(picks('B', 10, 14), MAP)
    expect(summary?.runs.map((r) => [r.courtId, r.start, r.end, r.slots, r.total])).toEqual([
      ['B', H(10), H(11), 1, 350],
      ['B', H(14), H(15), 1, 450],
    ])
    expect(summary?.courtCount).toBe(1)
    expect(summary?.total).toBe(800)
  })

  it('T19.3: lists the distinct non-empty promo labels in slot order, per run and across runs', () => {
    const slots = court('P').map((s) => (
      s.slot_start === H(10) ? { ...s, promo_label: 'Happy hour' }
        : s.slot_start === H(11) ? { ...s, promo_label: 'Early bird' }
        : s.slot_start === H(12) ? { ...s, promo_label: 'Happy hour' }
        : s.slot_start === H(13) ? { ...s, promo_label: null }
        : s.slot_start === H(14) ? { ...s, promo_label: '' } : s
    ))
    const map = byCourt(slots)
    expect(summarizeSelection(picks('P', 10, 11, 12), map)?.runs[0].promoLabels).toEqual(['Happy hour', 'Early bird'])
    expect(summarizeSelection(picks('P', 12, 13, 14, 15), map)?.runs[0].promoLabels).toEqual(['Happy hour'])
    expect(summarizeSelection(picks('P', 13, 14), map)?.promoLabels).toEqual([])
    expect(summarizeSelection(picks('P', 15), map)?.promoLabels).toEqual([])
    // Across runs: distinct labels, in run order (Q's 10 AM run comes first, then P's 11 AM run, then P's 3 PM run).
    const q = court('Q').map((s) => (s.slot_start === H(10) ? { ...s, promo_label: 'Happy hour' } : s))
    const both = byCourt(slots, q)
    const across = summarizeSelection([...picks('P', 10, 11), ...picks('Q', 10), ...picks('P', 15)], both)
    expect(across?.runs.map((r) => r.promoLabels)).toEqual([['Happy hour', 'Early bird'], ['Happy hour'], []])
    expect(across?.promoLabels).toEqual(['Happy hour', 'Early bird'])
    const ordered = summarizeSelection([...picks('P', 11), ...picks('Q', 10)], both)
    expect(ordered?.runs.map((r) => r.courtId)).toEqual(['Q', 'P'])
    expect(ordered?.promoLabels).toEqual(['Happy hour', 'Early bird'])
  })

  it('returns null without a selection or when a pick has no slot', () => {
    expect(summarizeSelection([], MAP)).toBeNull()
    expect(summarizeSelection([...picks('A', 10), ...picks('Z', 10)], MAP)).toBeNull()
    expect(summarizeSelection(picks('B', 20), MAP)).toBeNull()
  })
})

describe('promoLabelsOf', () => {
  it('lists distinct non-empty labels in slot order', () => {
    const slots = court('P', {}, 10, 14).map((s, i) => ({ ...s, promo_label: ['Happy hour', 'Early bird', 'Happy hour', ''][i] }))
    expect(promoLabelsOf(slots)).toEqual(['Happy hour', 'Early bird'])
  })
})
