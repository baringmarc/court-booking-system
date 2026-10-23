import type { Court } from '../catalog/api'
import { formatHour, formatMoney } from '../../lib/format'
import { hourInZone } from '../../lib/time'
import { isAfterMidnight } from '../catalog/hours'
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

/** Times down the side, courts across the top. Free slots select; open play slots open their details; the rest are disabled. */
export function SlotGrid({ courts, times, slotsByCourt, selection, onToggle, onOpenPlay, timeZone, currency, date }: Props) {
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
            {times.map((time) => {
              const rowSlots = courts.map((court) => slotsByCourt.get(court.id)?.find((s) => s.slot_start === time))
              // Rows show their range, ending where the row's slots end (T9.11b).
              const end = rowSlots.find((s) => s)?.slot_end
              const range = `${formatHour(hourInZone(time, timeZone))}${end ? ` – ${formatHour(hourInZone(end, timeZone))}` : ''}`
              const nextDay = !!date && isAfterMidnight(time, date, timeZone)
              const hourLabel = `${range}${nextDay ? ' (next day)' : ''}`
              return (
                <tr key={time}>
                  <th scope="row">
                    {range}
                    {nextDay && <>{' '}<span className="slot-next-day">(next day)</span></>}
                  </th>
                  {courts.map((court, i) => {
                    const slot = rowSlots[i]
                    if (!slot) return <td key={court.id} className="slot-none">—</td>
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
                      <td key={court.id}>
                        <button
                          type="button"
                          className={`slot slot-${look}`}
                          disabled={!free && !sessionId}
                          aria-pressed={free ? selected : undefined}
                          aria-haspopup={sessionId ? 'dialog' : undefined}
                          aria-label={`${court.name}, ${hourLabel}, ${label}`}
                          onClick={() => (sessionId ? onOpenPlay?.(sessionId) : onToggle(slot))}
                        >
                          {selected && <span aria-hidden="true">✓ </span>}
                          {booker ? (
                            <>Booked<span className="slot-name">{booker}</span></>
                          ) : (
                            VISIBLE_LABEL[look] ?? label
                          )}
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
