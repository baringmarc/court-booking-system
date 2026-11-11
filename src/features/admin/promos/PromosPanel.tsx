import { useId, useRef, useState, type FormEvent } from 'react'
import { DatePicker } from '../../../components/DatePicker'
import { ErrorMessage } from '../../../components/ErrorMessage'
import { PageLoader } from '../../../components/PageLoader'
import { DAY_NAMES, DAY_SHORT, DISPLAY_DAY_ORDER, formatHour, formatMoney } from '../../../lib/format'
import { formatDateLabel, todayInZone } from '../../../lib/time'
import { bookingErrorCode, bookingErrorMessage } from '../../booking/errors'
import { useNow } from '../../booking/useNow'
import { useCourts, useVenueSettings } from '../../catalog/hooks'
import { errorMessage } from '../../../lib/errors'
import { ConfirmDialog } from '../ConfirmDialog'
import type { Promo, PromoInput } from './api'
import { useDeletePromo, usePromos, useSavePromo } from './hooks'
import { promoStatus, type PromoStatus } from './status'

const STATUS_TEXT: Record<PromoStatus, string> = { active: 'Active', upcoming: 'Upcoming', ended: 'Ended', paused: 'Paused' }
const FROM_HOURS = Array.from({ length: 24 }, (_, i) => i)
const UNTIL_HOURS = Array.from({ length: 24 }, (_, i) => i + 1)

type Court = { id: string; name: string; is_active: boolean }

const daysText = (days: number[]) => DISPLAY_DAY_ORDER.filter((d) => days.includes(d)).map((d) => DAY_SHORT[d]).join(', ')

/**
 * The Promos tab (T19.2): limited-time fixed hourly prices. Each promo saves on its own (not part of the hours draft);
 * the server applies it in slot_price and refuses overlapping promos (`promo_overlap`).
 */
export function PromosPanel() {
  const promos = usePromos()
  const courts = useCourts({ includeInactive: true })
  const settings = useVenueSettings()
  const remove = useDeletePromo()
  const now = useNow(60_000)
  const timeZone = settings.data?.timezone ?? 'Asia/Manila'
  const currency = settings.data?.currency ?? 'PHP'
  const today = todayInZone(timeZone, now)
  /** null: no form; 'new': adding; otherwise the id of the promo being edited. */
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<{ promo: Promo; opener: HTMLElement } | null>(null)
  const listTitle = useRef<HTMLHeadingElement>(null)

  const courtName = (id: string) => courts.data?.find((c) => c.id === id)?.name ?? 'Unknown court'
  const edited = editing && editing !== 'new' ? promos.data?.find((p) => p.id === editing) : undefined
  const formReady = courts.data && settings.data && (editing === 'new' || edited)

  function keep() {
    removing?.opener.focus()
    setRemoving(null)
  }
  function confirmRemove() {
    if (!removing) return
    if (editing === removing.promo.id) setEditing(null)
    remove.mutate(removing.promo.id)
    setRemoving(null)
    listTitle.current?.focus()
  }

  return (
    <section className="card stack">
      <div>
        <h2>Promos</h2>
        <p className="muted small">
          A promo sets one hourly price for the courts, days and hours you choose, between two dates. It replaces the
          court's usual price for those hours. Bookings already made keep their price. Times are in {timeZone}.
        </p>
      </div>

      {editing === null ? (
        promos.isSuccess && (
          <div><button type="button" className="btn" onClick={() => setEditing('new')}>Add promo</button></div>
        )
      ) : formReady ? (
        <PromoForm key={editing} promo={edited} courts={courts.data} today={today} timeZone={timeZone}
          onDone={() => setEditing(null)} />
      ) : courts.isError ? (
        <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
      ) : (
        <PageLoader />
      )}

      <h3 ref={listTitle} tabIndex={-1} className="promo-list-title">Your promos</h3>
      {promos.isPending ? (
        <PageLoader />
      ) : promos.isError ? (
        <ErrorMessage error={promos.error} onRetry={() => promos.refetch()} />
      ) : promos.data.length === 0 ? (
        <p className="muted">No promos yet.</p>
      ) : (
        <ul className="list">
          {promos.data.map((p) => {
            const status = promoStatus(p, today)
            return (
              <li key={p.id} className="list-row">
                <span>
                  <strong>{p.label}</strong>{' '}
                  <span className={`badge${status === 'active' ? ' status-confirmed' : ''}`}>{STATUS_TEXT[status]}</span>
                  <span className="block small">{formatMoney(p.price, currency)}/hr · {formatHour(p.start_hour)} – {formatHour(p.end_hour)} · {daysText(p.days_of_week)}</span>
                  <span className="block small">{formatDateLabel(p.starts_on, timeZone)} – {formatDateLabel(p.ends_on, timeZone)}</span>
                  <span className="block small muted">{p.court_ids.map(courtName).join(', ')}</span>
                </span>
                <span className="row-actions">
                  <button type="button" className="btn btn-small btn-outline" aria-label={`Edit promo: ${p.label}`}
                    onClick={() => setEditing(p.id)}>Edit</button>
                  <button type="button" className="btn btn-small btn-ghost" aria-label={`Delete promo: ${p.label}`}
                    disabled={remove.isPending} onClick={(e) => setRemoving({ promo: p, opener: e.currentTarget })}>Delete</button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {remove.error && <p className="form-error" role="alert">{errorMessage(remove.error)}</p>}

      {removing && (
        <ConfirmDialog id="delete-promo" title="Delete this promo?" body="Its hours go back to the court's usual price. Bookings already made keep their price."
          stay="Keep promo" confirm="Delete promo" onStay={keep} onConfirm={confirmRemove} />
      )}
    </section>
  )
}

function PromoForm({ promo, courts, today, timeZone, onDone }: {
  /** The promo being edited; undefined when adding. */
  promo: Promo | undefined
  courts: Court[]
  today: string
  timeZone: string
  onDone: () => void
}) {
  const save = useSavePromo()
  const id = useId()
  const [label, setLabel] = useState(promo?.label ?? '')
  const [startsOn, setStartsOn] = useState(promo?.starts_on ?? today)
  const [pickedEnd, setPickedEnd] = useState(promo?.ends_on ?? today)
  const [days, setDays] = useState<number[]>(promo?.days_of_week ?? [])
  const [courtIds, setCourtIds] = useState<string[]>(promo?.court_ids ?? [])
  const [from, setFrom] = useState(promo?.start_hour ?? 18)
  const [until, setUntil] = useState(promo?.end_hour ?? 21)
  const [price, setPrice] = useState(promo ? String(promo.price) : '')
  const [active, setActive] = useState(promo?.is_active ?? true)
  const [problem, setProblem] = useState<string | null>(null)

  // An edited promo may have started already, so its own start stays pickable. The end is never before the start.
  const minStart = promo && promo.starts_on < today ? promo.starts_on : today
  const endsOn = pickedEnd < startsOn ? startsOn : pickedEnd

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const amount = Number(price)
    const issue = !label.trim() ? 'Give the promo a name.'
      : days.length === 0 ? 'Tick at least one day.'
      : courtIds.length === 0 ? 'Tick at least one court.'
      : until <= from ? 'Until must be after From.'
      : price.trim() === '' || !Number.isFinite(amount) || amount <= 0 ? 'Enter a price above zero.'
      : null
    setProblem(issue)
    if (issue) return
    const input: PromoInput = {
      id: promo?.id ?? null, label: label.trim(), starts_on: startsOn, ends_on: endsOn, court_ids: courtIds, days,
      start_hour: from, end_hour: until, price: amount, is_active: active,
    }
    try {
      await save.mutateAsync(input)
    } catch {
      return // shown under the buttons
    }
    onDone()
  }

  const saveError = save.error && (bookingErrorCode(save.error) ? bookingErrorMessage(save.error) : errorMessage(save.error))

  return (
    <form className="stack" aria-label="Promo" noValidate onSubmit={(e) => void handleSubmit(e)}>
      <h3>{promo ? `Edit ${promo.label}` : 'New promo'}</h3>
      <label className="field">
        <span>Promo name</span>
        <input value={label} maxLength={60} placeholder="e.g. Weekday morning promo" onChange={(e) => setLabel(e.target.value)} />
      </label>

      <div className="form-grid">
        <DatePicker label="Starts on" value={startsOn} onChange={setStartsOn} today={today} min={minStart} timeZone={timeZone} calendarIcon />
        <DatePicker label="Ends on" value={endsOn} onChange={setPickedEnd} today={today} min={startsOn} timeZone={timeZone} calendarIcon />
      </div>

      <fieldset className="field">
        <legend>Days</legend>
        <div className="check-list">
        {DISPLAY_DAY_ORDER.map((d) => (
          <label key={d} className="check">
            <input type="checkbox" checked={days.includes(d)} onChange={() => setDays(toggle(days, d))} />
            {DAY_NAMES[d]}
          </label>
        ))}
        </div>
      </fieldset>

      <fieldset className="field">
        <legend>Courts</legend>
        <div className="check-list">
        {courts.map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={courtIds.includes(c.id)} onChange={() => setCourtIds(toggle(courtIds, c.id))} />
            {c.name}{!c.is_active && ' (archived)'}
          </label>
        ))}
        </div>
      </fieldset>

      <div className="form-grid">
        {/* A separate label, not a wrapping one: Chromium adds a wrapped select's chosen option to its name. */}
        <div className="field">
          <label htmlFor={`${id}-from`}>From</label>
          <select id={`${id}-from`} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {FROM_HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-until`}>Until</label>
          <select id={`${id}-until`} value={until} onChange={(e) => setUntil(Number(e.target.value))}>
            {UNTIL_HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
        <label className="field">
          <span>Price per hour</span>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
      </div>

      <label className="check">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>
      <p className="muted small">Untick Active to pause a promo without deleting it.</p>

      <div className="form-actions">
        <button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save promo'}</button>
        <button type="button" className="btn btn-outline" onClick={onDone}>Cancel</button>
        {(problem || saveError) && <span className="form-error" role="alert">{problem ?? saveError}</span>}
      </div>
    </form>
  )
}
