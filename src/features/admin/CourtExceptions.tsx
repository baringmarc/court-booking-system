import { useRef, useState } from 'react'
import { DAY_NAMES, DISPLAY_DAY_ORDER } from '../../lib/format'
import type { CourtWithPhotos } from '../catalog/api'
import type { SchedulePeriod } from './api'
import { ConfirmDialog } from './ConfirmDialog'
import { changedDays, dayText, periodsOfDay } from './weeklySchedule'

type CourtDraft = { mode: 'inherit' | 'custom'; periods: SchedulePeriod[] }

/**
 * Courts with different hours (T17.32), under the venue's opening hours table: each court with its own hours and the days
 * that differ, with Edit hours, Use opening hours (confirmed first) and a way to give another court its own hours.
 */
export function CourtExceptions({ courts, venue, draftOf, onEdit, onInherit, onGive }: {
  courts: CourtWithPhotos[]
  venue: SchedulePeriod[]
  draftOf: (id: string) => CourtDraft
  onEdit: (id: string) => void
  onInherit: (id: string) => void
  onGive: (id: string) => void
}) {
  const [confirming, setConfirming] = useState<CourtWithPhotos | null>(null)
  const [chosen, setChosen] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  if (courts.length === 0) return null
  const own = courts.filter((c) => draftOf(c.id).mode === 'custom')
  const following = courts.filter((c) => draftOf(c.id).mode !== 'custom')
  const pick = following.find((c) => c.id === chosen) ?? following[0]
  const differs = (c: CourtWithPhotos) => {
    const mine = draftOf(c.id).periods
    const days = DISPLAY_DAY_ORDER.filter((d) => changedDays(mine, venue).includes(d))
    return days.length === 0
      ? 'Same as the opening hours'
      : days.map((d) => `${DAY_NAMES[d]}: ${dayText(periodsOfDay(mine, d))}`).join(' · ')
  }

  return (
    <section className="court-exceptions stack" aria-labelledby="court-exceptions-title">
      <h3 id="court-exceptions-title" ref={heading} tabIndex={-1}>Courts with different hours</h3>
      {own.length === 0
        ? <p className="muted small">Every court follows the opening hours above.</p>
        : (
          <ul className="list">
            {own.map((c) => (
              <li key={c.id} className="court-exception">
                <div>
                  <strong>{c.name}</strong>
                  <p className="muted small">{differs(c)}</p>
                </div>
                <div className="form-actions">
                  <button type="button" id={`edit-hours-${c.id}`} className="btn btn-small btn-outline"
                    aria-label={`Edit hours for ${c.name}`} onClick={() => onEdit(c.id)}>
                    Edit hours
                  </button>
                  <button type="button" id={`use-opening-${c.id}`} className="btn btn-small btn-ghost"
                    aria-label={`Use opening hours for ${c.name}`} onClick={() => setConfirming(c)}>
                    Use opening hours
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      {pick && (
        <div className="form-grid court-exception-add">
          <label className="field">
            <span>Choose a court</span>
            <select value={pick.id} onChange={(e) => setChosen(e.target.value)}>
              {following.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div className="form-actions">
            <button type="button" className="btn btn-small btn-outline" onClick={() => onGive(pick.id)}>Give this court different hours</button>
          </div>
        </div>
      )}
      {confirming && (
        <ConfirmDialog
          id="use-opening-hours" title={`Use opening hours for ${confirming.name}`}
          body={`${confirming.name} will follow the opening hours above again. Its own hours are dropped when you save. Its prices stay.`}
          stay="Keep different hours" confirm="Use opening hours"
          onStay={() => {
            setConfirming(null)
            document.getElementById(`use-opening-${confirming.id}`)?.focus()
          }}
          onConfirm={() => {
            setConfirming(null)
            onInherit(confirming.id)
            heading.current?.focus()
          }}
        />
      )}
    </section>
  )
}
