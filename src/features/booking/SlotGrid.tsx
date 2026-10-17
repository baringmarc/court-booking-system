import type { Court } from '../catalog/api'
import { formatHour, formatMoney } from '../../lib/format'
import { hourInZone } from '../../lib/time'
import type { Selection, Slot, SlotStatus } from './selection'

const UNAVAILABLE_LABEL: Record<Exclude<SlotStatus, 'free'>, string> = {
  booked: 'Booked',
  blackout: 'Closed',
  past: 'Past',
}
const VISIBLE_LABEL: Partial<Record<SlotStatus, string>> = { past: '—' }

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
                  const label = slot.status === 'free' ? formatMoney(slot.price, currency) : UNAVAILABLE_LABEL[slot.status]
                  return (
                    <td key={court.id}>
                      <button
                        type="button"
                        className={`slot slot-${slot.status}${selected ? ' slot-selected' : ''}`}
                        disabled={!free}
                        aria-pressed={free ? selected : undefined}
                        aria-label={`${court.name}, ${hourLabel}, ${label}`}
                        onClick={() => onToggle(slot)}
                      >
                        {VISIBLE_LABEL[slot.status] ?? label}
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
  )
}
