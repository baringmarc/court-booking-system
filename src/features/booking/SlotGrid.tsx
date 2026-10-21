import type { Court } from '../catalog/api'
import { formatHour, formatMoney } from '../../lib/format'
import { hourInZone } from '../../lib/time'
import type { Selection, Slot, SlotStatus } from './selection'

/** What a slot looks like: its availability, or `selected` for a free slot in the current pick. */
export type SlotLook = SlotStatus | 'selected'

/** Each look has its own class and words, so colour is never the only signal (SPEC §7). */
const SLOT_LOOK_LABEL: Record<SlotLook, string> = {
  free: 'Available',
  selected: 'Selected',
  booked: 'Booked',
  blackout: 'Closed',
  past: 'Past',
}
const LEGEND: SlotLook[] = ['free', 'selected', 'booked', 'blackout', 'past']
const VISIBLE_LABEL: Partial<Record<SlotLook, string>> = { past: '—' }

type Props = {
  courts: Court[]
  times: string[]
  slotsByCourt: Map<string, Slot[]>
  selection: Selection
  onToggle: (slot: Slot) => void
  timeZone: string
  currency: string
}

/** Times down the side, courts across the top. Only free slots are buttons you can press. */
export function SlotGrid({ courts, times, slotsByCourt, selection, onToggle, timeZone, currency }: Props) {
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
              const hourLabel = formatHour(hourInZone(time, timeZone))
              return (
                <tr key={time}>
                  <th scope="row">{hourLabel}</th>
                  {courts.map((court) => {
                    const slot = slotsByCourt.get(court.id)?.find((s) => s.slot_start === time)
                    if (!slot) return <td key={court.id} className="slot-none">—</td>
                    const free = slot.status === 'free'
                    const selected = free && selection?.courtId === court.id && selection.starts.includes(time)
                    const look: SlotLook = selected ? 'selected' : slot.status
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
                          disabled={!free}
                          aria-pressed={free ? selected : undefined}
                          aria-label={`${court.name}, ${hourLabel}, ${label}`}
                          onClick={() => onToggle(slot)}
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
