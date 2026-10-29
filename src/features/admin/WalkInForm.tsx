import { useState, type FormEvent } from 'react'
import { formatHour, formatMoney } from '../../lib/format'
import { normalizePhMobile, PHONE_ERROR } from '../../lib/phone'
import { hourInZone } from '../../lib/time'
import { isAfterMidnight } from '../catalog/hours'
import { bookingErrorMessage } from '../booking/errors'
import { METHOD_LABELS } from '../booking/proofInput'
import type { Slot } from '../booking/selection'
import type { Court } from '../catalog/api'
import type { WalkInInput } from './api'
import { isWalkInStartable, maxWalkInSlots } from './dashboard'

const METHODS = ['cash', 'gcash', 'maya', 'bank_transfer'] as const

type Props = {
  courts: Court[]
  /** Today's availability, per court, sorted by start. */
  slotsByCourt: Map<string, Slot[]>
  now: Date
  timeZone: string
  /** The operating date the form books on; after-midnight start times are marked (T9.10). */
  date?: string
  currency: string
  pending: boolean
  error: unknown
  onSubmit: (input: WalkInInput) => void
}

/** Counter walk-ins for today (SPEC §5.8). The server re-checks every rule and computes the booking total. */
export function WalkInForm({ courts, slotsByCourt, now, timeZone, currency, pending, error, onSubmit, date }: Props) {
  const [courtId, setCourtId] = useState(courts[0]?.id ?? '')
  const [start, setStart] = useState('')
  const [slots, setSlots] = useState(1)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [method, setMethod] = useState<(typeof METHODS)[number]>('cash')
  const [amountOverride, setAmountOverride] = useState<string | null>(null)
  const [reference, setReference] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const courtSlots = slotsByCourt.get(courtId) ?? []
  const startable = courtSlots.filter((s) => isWalkInStartable(s, now))
  const startIndex = courtSlots.findIndex((s) => s.slot_start === start)
  const maxSlots = startIndex >= 0 ? maxWalkInSlots(courtSlots, startIndex, now) : 0
  const chosen = startIndex >= 0 ? courtSlots.slice(startIndex, startIndex + Math.min(slots, maxSlots)) : []
  const computed = chosen.reduce((sum, s) => sum + s.price, 0)
  // The amount follows the computed price until the admin types their own (e.g. a discount).
  const amount = amountOverride ?? (chosen.length ? String(computed) : '')

  function resetSelection() {
    setSlots(1)
    setAmountOverride(null)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const value = Number(amount)
    // chosen is empty if the picked slot ended while the form was open.
    if (!courtId || startIndex < 0 || chosen.length === 0) return setFormError('Choose a court and a start time.')
    if (!name.trim()) return setFormError('Enter the customer’s name.')
    const mobile = normalizePhMobile(phone)
    if (mobile === 'invalid') return setFormError(PHONE_ERROR)
    if (!amount.trim() || !Number.isFinite(value) || value < 0) return setFormError('Enter the amount received.')
    setFormError(null)
    onSubmit({ courtId, start, slots: chosen.length, name: name.trim(), phone: mobile ?? '', method, amount: value, referenceNumber: reference.trim() })
  }

  return (
    <form className="stack" onSubmit={handleSubmit} noValidate aria-label="Walk-in booking">
      <div className="form-grid">
        <div className="field">
          <label htmlFor="walkin-court">Court</label>
          <select id="walkin-court" value={courtId} onChange={(e) => { setCourtId(e.target.value); setStart(''); resetSelection() }}>
            {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="walkin-start">Start</label>
          <select id="walkin-start" value={start} onChange={(e) => { setStart(e.target.value); resetSelection() }}>
            <option value="">{startable.length ? 'Choose…' : 'No free times today'}</option>
            {startable.map((s) => (
              <option key={s.slot_start} value={s.slot_start}>
                {formatHour(hourInZone(s.slot_start, timeZone))}{date && isAfterMidnight(s.slot_start, date, timeZone) ? ' (next day)' : ''}{s.status === 'past' ? ' (now)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="walkin-slots">Hours</label>
          <select id="walkin-slots" value={Math.min(slots, Math.max(maxSlots, 1))} disabled={maxSlots === 0}
            onChange={(e) => { setSlots(Number(e.target.value)); setAmountOverride(null) }}>
            {Array.from({ length: Math.max(maxSlots, 1) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="walkin-name">Customer name</label>
          <input id="walkin-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="walkin-phone">Mobile number (optional)</label>
          <input id="walkin-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
        </div>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="walkin-method">Payment</label>
          <select id="walkin-method" value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}>
            {METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="walkin-amount">Amount received</label>
          <input id="walkin-amount" type="number" inputMode="decimal" min={0} step="0.01" value={amount}
            onChange={(e) => setAmountOverride(e.target.value)} />
          {chosen.length > 0 && <span className="muted small">Price: {formatMoney(computed, currency)}</span>}
        </div>
        <div className="field">
          <label htmlFor="walkin-reference">Reference (optional)</label>
          <input id="walkin-reference" value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" />
        </div>
      </div>
      {formError && <p className="form-error" role="alert">{formError}</p>}
      {error != null && <div className="alert alert-error" role="alert"><p>{bookingErrorMessage(error)}</p></div>}
      <button type="submit" className="btn" disabled={pending}>{pending ? 'Saving…' : 'Record walk-in'}</button>
    </form>
  )
}
