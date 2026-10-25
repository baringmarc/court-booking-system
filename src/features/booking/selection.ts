// Pure slot-selection logic for the booking grid. A selection is one court and a run of
// consecutive free slots. The total here is for display only: the server prices the booking.

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
}

/** `starts` are slot_start values, sorted and consecutive. */
export type Selection = { courtId: string; starts: string[] } | null

const single = (slot: Slot): Selection => ({ courtId: slot.court_id, starts: [slot.slot_start] })

function isRunOfFreeSlots(run: Slot[]) {
  return run.every((s, i) => s.status === 'free' && (i === 0 || run[i - 1].slot_end === s.slot_start))
}

/**
 * Applies a tap on `slot`. `courtSlots` are that court's slots sorted by start.
 * - Unavailable slots are ignored.
 * - Another court, or no selection yet: start a new selection.
 * - Tapping the first or last selected slot removes it; tapping one in the middle starts over there.
 * - Tapping outside the selection extends it when every slot in between is free,
 *   otherwise starts a new selection at the tapped slot.
 */
export function toggleSlot(selection: Selection, slot: Slot, courtSlots: Slot[]): Selection {
  if (slot.status !== 'free') return selection
  const idx = courtSlots.findIndex((s) => s.slot_start === slot.slot_start)
  if (idx < 0) return selection
  if (!selection || selection.courtId !== slot.court_id) return single(slot)

  const first = courtSlots.findIndex((s) => s.slot_start === selection.starts[0])
  const last = courtSlots.findIndex((s) => s.slot_start === selection.starts.at(-1))
  if (first < 0 || last < 0) return single(slot)

  if (idx >= first && idx <= last) {
    if (first === last) return null
    if (idx === first) return { courtId: selection.courtId, starts: selection.starts.slice(1) }
    if (idx === last) return { courtId: selection.courtId, starts: selection.starts.slice(0, -1) }
    return single(slot)
  }

  const run = courtSlots.slice(Math.min(first, idx), Math.max(last, idx) + 1)
  return isRunOfFreeSlots(run) ? { courtId: selection.courtId, starts: run.map((s) => s.slot_start) } : single(slot)
}

/** Drops the selection if any of its slots is no longer free (e.g. after a refetch). */
export function reconcileSelection(selection: Selection, courtSlots: Slot[]): Selection {
  if (!selection) return null
  const run = selection.starts.map((start) => courtSlots.find((s) => s.slot_start === start))
  return run.every((s) => s !== undefined) && isRunOfFreeSlots(run as Slot[]) ? selection : null
}

export type SelectionSummary = { courtId: string; start: string; end: string; slots: number; total: number }

export function summarizeSelection(selection: Selection, courtSlots: Slot[]): SelectionSummary | null {
  if (!selection || selection.starts.length === 0) return null
  const run = selection.starts.map((start) => courtSlots.find((s) => s.slot_start === start))
  if (run.some((s) => s === undefined)) return null
  const slots = run as Slot[]
  return {
    courtId: selection.courtId,
    start: slots[0].slot_start,
    end: slots.at(-1)!.slot_end,
    slots: slots.length,
    total: slots.reduce((sum, s) => sum + s.price, 0),
  }
}
