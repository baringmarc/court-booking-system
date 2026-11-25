// Pure slot-selection logic for the booking grid (tap-to-pick, T33.3; SPEC §10 2026-11-25). A selection is any set of
// free slots on any courts of one date. Picks that touch on one court merge into one run, and each run is one booking.
// The totals here are for display only: the server prices every booking.

export type SlotStatus = 'free' | 'booked' | 'blackout' | 'open_play' | 'past'

export type Slot = {
  court_id: string
  slot_start: string
  slot_end: string
  price: number
  status: SlotStatus
  /** First name of whoever booked it, on booked slots only (T9.8). Never more personal data. */
  booker_first_name: string | null
  /** The open play session holding it, on open_play slots only (T9.11c). */
  open_play_session_id: string | null
  /** The booking, open play session or blackout this slot belongs to; slots of one block share it (T10.4). */
  block_key: string | null
  /** The promo pricing this slot, on promo slots only (T19.3); `price` already is the promo price. */
  promo_label?: string | null
  period_end?: string
}

/** One picked slot: its court and `slot_start`. */
export type PickedSlot = { courtId: string; start: string }

/** Every picked slot; empty when nothing is picked. Order is not significant. */
export type Selection = PickedSlot[]

/** Bookings per checkout (T33.1's `create_booking_group` cap), counted in runs. */
export const MAX_RUNS = 6
export const TOO_MANY_RUNS_MESSAGE = 'You can book up to 6 separate times in one checkout.'

/** Consecutive picked slots on one court: one booking. `starts` ascending. */
export type Run = { courtId: string; starts: string[] }

/** `next` follows `prev` without a gap and inside the same opening period (never across a break). */
function touches(prev: Slot, next: Slot) {
  return prev.slot_end === next.slot_start && (!prev.period_end || Date.parse(next.slot_start) < Date.parse(prev.period_end))
}

const samePick = (a: PickedSlot, b: PickedSlot) => a.courtId === b.courtId && a.start === b.start

/**
 * The picks as runs, sorted by first start, ties by court id. `slotsByCourt` maps a court id to that court's slots
 * sorted by start. Picks without a slot in the map are left out.
 */
export function selectionRuns(selection: Selection, slotsByCourt: Map<string, Slot[]>): Run[] {
  const runs: Run[] = []
  for (const courtId of [...new Set(selection.map((p) => p.courtId))]) {
    const picked = new Set(selection.filter((p) => p.courtId === courtId).map((p) => p.start))
    let current: Run | null = null
    let prev: Slot | null = null
    for (const slot of slotsByCourt.get(courtId) ?? []) {
      if (!picked.has(slot.slot_start)) {
        current = null
        prev = null
        continue
      }
      if (current && prev && touches(prev, slot)) current.starts.push(slot.slot_start)
      else {
        current = { courtId, starts: [slot.slot_start] }
        runs.push(current)
      }
      prev = slot
    }
  }
  return runs.sort((a, b) => Date.parse(a.starts[0]) - Date.parse(b.starts[0]) || a.courtId.localeCompare(b.courtId))
}

export type ToggleResult = { selection: Selection; refused: 'too_many_runs' | null }

/**
 * Applies a tap on `slot`: a free slot is added, or removed when already picked, on any court at any time.
 * Unavailable slots and slots missing from their court's list are ignored. A change that would leave more than
 * MAX_RUNS runs (a 7th separate time, or splitting a run at 6) is refused and the selection kept.
 */
export function toggleSlot(selection: Selection, slot: Slot, slotsByCourt: Map<string, Slot[]>): ToggleResult {
  if (slot.status !== 'free') return { selection, refused: null }
  if (!(slotsByCourt.get(slot.court_id) ?? []).some((s) => s.slot_start === slot.slot_start)) return { selection, refused: null }
  const pick: PickedSlot = { courtId: slot.court_id, start: slot.slot_start }
  const next = selection.some((p) => samePick(p, pick)) ? selection.filter((p) => !samePick(p, pick)) : [...selection, pick]
  if (selectionRuns(next, slotsByCourt).length > MAX_RUNS) return { selection, refused: 'too_many_runs' }
  return { selection: next, refused: null }
}

/** Drops every pick of `run`. */
export function removeRun(selection: Selection, run: Run): Selection {
  return selection.filter((p) => p.courtId !== run.courtId || !run.starts.includes(p.start))
}

/** Keeps the picks whose slot is still free (e.g. after a refetch) and lists the dropped ones, in input order. */
export function reconcileSelection(selection: Selection, slotsByCourt: Map<string, Slot[]>): { selection: Selection; dropped: PickedSlot[] } {
  const kept: PickedSlot[] = []
  const dropped: PickedSlot[] = []
  for (const pick of selection) {
    const slot = slotsByCourt.get(pick.courtId)?.find((s) => s.slot_start === pick.start)
    ;(slot?.status === 'free' ? kept : dropped).push(pick)
  }
  return { selection: kept, dropped }
}

/** One run, summarized for display. */
export type RunSummary = { courtId: string; start: string; end: string; slots: number; total: number; promoLabels: string[] }

export type SelectionSummary = { runs: RunSummary[]; courtCount: number; total: number; promoLabels: string[] }

/** The distinct promo labels of a run of slots, in slot order (T19.3). */
export function promoLabelsOf(slots: Slot[]): string[] {
  return [...new Set(slots.map((s) => s.promo_label).filter((l): l is string => !!l))]
}

export function summarizeSelection(selection: Selection, slotsByCourt: Map<string, Slot[]>): SelectionSummary | null {
  if (selection.length === 0) return null
  const slotOf = (courtId: string, start: string) => slotsByCourt.get(courtId)?.find((s) => s.slot_start === start)
  if (selection.some((p) => !slotOf(p.courtId, p.start))) return null
  const runs = selectionRuns(selection, slotsByCourt).map((run): RunSummary => {
    const slots = run.starts.map((start) => slotOf(run.courtId, start)!)
    return {
      courtId: run.courtId,
      start: slots[0].slot_start,
      end: slots.at(-1)!.slot_end,
      slots: slots.length,
      total: slots.reduce((sum, s) => sum + s.price, 0),
      promoLabels: promoLabelsOf(slots),
    }
  })
  return {
    runs,
    courtCount: new Set(runs.map((r) => r.courtId)).size,
    total: runs.reduce((sum, r) => sum + r.total, 0),
    promoLabels: [...new Set(runs.flatMap((r) => r.promoLabels))],
  }
}
