import type { Court } from '../catalog/api'
import { formatHour, formatMoney } from '../../lib/format'
import { hourInZone } from '../../lib/time'
import { isAfterMidnight } from '../catalog/hours'
import { groupBlocks, joinNames } from './blocks'
import type { Selection, Slot, SlotStatus } from './selection'

/** What a slot looks like: its availability, or `selected` for a free slot in the current pick. */
export type SlotLook = SlotStatus | 'selected'

/** Each look has its own class and words, so colour is never the only signal (SPEC §7). */
const SLOT_LOOK_LABEL: Record<SlotLook, string> = {
  free: 'Available',
  selected: 'Selected',
  booked: 'Booked',
  blackout: 'Closed',
  open_play: 'Open play',
  past: 'Past',
}
const LEGEND: SlotLook[] = ['free', 'selected', 'booked', 'blackout', 'open_play', 'past']
const VISIBLE_LABEL: Partial<Record<SlotLook, string>> = { past: '—' }

type Props = {
  courts: Court[]
  times: string[]
  slotsByCourt: Map<string, Slot[]>
  selection: Selection
  onToggle: (slot: Slot) => void
  /** Open play slots can't be booked; pressing one shows its session's details (T9.11d). */
  onOpenPlay?: (sessionId: string) => void
  timeZone: string
  /** The operating date shown; slots on the next calendar day (after midnight) are marked (T9.10). */
  date?: string
  currency: string
}

/**
 * Times down the side, courts across the top. Free slots select; open play slots open their details; the rest are
 * disabled. The hours of one booking, open play session or blackout are one cell (T10.5), spanning neighbouring
 * courts when they share it exactly; free slots stay one per hour.
 */
export function SlotGrid({ courts, times, slotsByCourt, selection, onToggle, onOpenPlay, timeZone, currency, date }: Props) {
  const slotAt = (row: number, col: number) => slotsByCourt.get(courts[col].id)?.find((s) => s.slot_start === times[row])
  const grid = groupBlocks(times.length, courts.length, (row, col) => slotAt(row, col)?.block_key ?? null)
  const hour = (iso: string) => formatHour(hourInZone(iso, timeZone))
  const nextDayOf = (iso: string) => !!date && isAfterMidnight(iso, date, timeZone)

  return (
    <div>
      <ul className="slot-legend" aria-label="Slot key">
        {LEGEND.map((look) => (
          <li key={look}>
            <span className={`slot-swatch slot-${look}`} aria-hidden="true">{look === 'selected' ? '✓' : null}</span>
            {SLOT_LOOK_LABEL[look]}
          </li>
        ))}
      </ul>
      <div className="table-scroll">
        <table className="slot-grid">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Time</span></th>
              {courts.map((c) => <th key={c.id} scope="col">{c.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {times.map((time, row) => {
              const rowSlots = courts.map((_, col) => slotAt(row, col))
              // Rows show their range, ending where the row's slots end (T9.11b).
              const end = rowSlots.find((s) => s)?.slot_end
              const range = `${hour(time)}${end ? ` – ${hour(end)}` : ''}`
              const nextDay = nextDayOf(time)
              return (
                <tr key={time}>
                  <th scope="row">
                    {range}
                    {nextDay && <>{' '}<span className="slot-next-day">(next day)</span></>}
                  </th>
                  {courts.map((court, col) => {
                    const cell = grid[row][col]
                    if (cell.kind === 'covered') return null
                    const slot = rowSlots[col]
                    if (!slot) return <td key={court.id} className="slot-none">—</td>
                    // A block runs from this row to its last row's end, across its courts.
                    const lastEnd = slotAt(cell.lastRow, col)?.slot_end ?? slot.slot_end
                    const spans = cell.rowSpan > 1 || cell.colSpan > 1
                    const blockRange = `${hour(slot.slot_start)} – ${hour(lastEnd)}`
                    const where = joinNames(cell.columns.map((c) => courts[c].name))
                    const when = `${blockRange}${nextDayOf(times[cell.lastRow]) ? ' (next day)' : ''}`
                    const free = slot.status === 'free'
                    const selected = free && selection?.courtId === court.id && selection.starts.includes(time)
                    const look: SlotLook = selected ? 'selected' : slot.status
                    const sessionId = slot.status === 'open_play' && onOpenPlay ? slot.open_play_session_id : null
                    // Booked slots name the booker by first name only (T9.8; the server never sends more).
                    const booker = slot.status === 'booked' ? slot.booker_first_name : null
                    const label = free
                      ? formatMoney(slot.price, currency)
                      : booker ? `Booked by ${booker}` : SLOT_LOOK_LABEL[slot.status]
                    return (
                      <td key={court.id} rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                        colSpan={cell.colSpan > 1 ? cell.colSpan : undefined} className={spans ? 'slot-span' : undefined}>
                        <button
                          type="button"
                          className={`slot slot-${look}`}
                          disabled={!free && !sessionId}
                          aria-pressed={free ? selected : undefined}
                          aria-haspopup={sessionId ? 'dialog' : undefined}
                          aria-label={`${where}, ${when}, ${label}`}
                          onClick={() => (sessionId ? onOpenPlay?.(sessionId) : onToggle(slot))}
                        >
                          {selected && <span aria-hidden="true">✓ </span>}
                          {booker ? (
                            <>Booked<span className="slot-name">{booker}</span></>
                          ) : (
                            VISIBLE_LABEL[look] ?? label
                          )}
                          {cell.rowSpan > 1 && <span className="slot-range">{blockRange}</span>}
                        </button>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
