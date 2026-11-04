import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { SaveStatus } from '../../components/SaveStatus'
import { useUpdateVenueSettings } from '../catalog/hooks'
import type { VenueSettings } from '../catalog/api'
import { useSettingsDirty } from './settingsDraft'

export function SettingsPage() {
  return (
    <section className="page">
      <h1>Venue settings</h1>
      <p>Choose a category to manage the details for this venue.</p>
      <div className="settings-category-grid">
        {[
          ['venue', 'Venue Profile', 'Name, location, contact details and city.'],
          ['payments', 'Payment Setup', 'Payment accounts, instructions and payment status.'],
          ['booking', 'Booking Rules', 'Booking window, payment hold and cancellation rules.'],
          ['appearance', 'Website Appearance', 'Colors, banner, amenities and page content.'],
          ['policies', 'Policies & Waivers', 'The waiver players review before booking.'],
        ].map(([path, title, description]) => <Link className="card settings-category-card" key={path} to={`/admin/settings/${path}`}>
          <h2>{title}</h2><p>{description}</p><span className="btn btn-small btn-ghost">Manage {title}</span>
        </Link>)}
      </div>
    </section>
  )
}

const NUMBER_FIELDS = [
  { key: 'booking_window_days', label: 'Booking window (days ahead)', min: 1, max: 365 },
  { key: 'payment_hold_minutes', label: 'Payment hold (minutes)', min: 5, max: 1440 },
  { key: 'cancel_cutoff_hours', label: 'Cancellation cutoff (hours before start)', min: 0, max: 168 },
  { key: 'max_rejections', label: 'Max proof rejections', min: 1, max: 10 },
] as const

type NumberKey = (typeof NUMBER_FIELDS)[number]['key']

export function VenueProfileForm({ initial }: { initial: VenueSettings }) {
  const save = useUpdateVenueSettings()
  const setDirty = useSettingsDirty('venue-name')
  const [name, setName] = useState(initial.name)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    save.mutate({ name: name.trim() }, { onSuccess: () => setDirty(false) })
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <section className="card stack">
        <h2>Venue details</h2>
        <label className="field">
          <span>Venue name</span>
          <input required value={name} onChange={(e) => { setName(e.target.value); setDirty(true) }} />
        </label>
        <dl className="facts">
          <div><dt>Timezone</dt><dd>{initial.timezone}</dd></div>
          <div><dt>Currency</dt><dd>{initial.currency}</dd></div>
          <div><dt>Slot length</dt><dd>{initial.slot_minutes} min</dd></div>
        </dl>
      </section>

      <div className="form-actions">
        <button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save venue profile'}</button>
        <SaveStatus isSuccess={save.isSuccess} error={save.error} />
      </div>
    </form>
  )
}

export function BookingRulesForm({ initial }: { initial: VenueSettings }) {
  const save = useUpdateVenueSettings()
  const setDirty = useSettingsDirty('booking-rules')
  const [numbers, setNumbers] = useState<Record<NumberKey, string>>(() =>
    Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, String(initial[f.key])])) as Record<NumberKey, string>,
  )
  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate(Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, Number(numbers[f.key])])) as Pick<VenueSettings, NumberKey>, { onSuccess: () => setDirty(false) })
  }
  return <form className="stack" aria-label="Booking rules" onSubmit={handleSubmit}>
    <section className="card stack"><h2>Booking rules</h2><div className="form-grid">
      {NUMBER_FIELDS.map((field) => <label key={field.key} className="field"><span>{field.label}</span>
        <input type="number" required min={field.min} max={field.max} step={1} value={numbers[field.key]}
          onChange={(event) => { setNumbers((current) => ({ ...current, [field.key]: event.target.value })); setDirty(true) }} />
      </label>)}
    </div></section>
    <div className="form-actions"><button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save booking rules'}</button><SaveStatus isSuccess={save.isSuccess} error={save.error} /></div>
  </form>
}

export function PaymentInstructionsForm({ initial }: { initial: VenueSettings }) {
  const save = useUpdateVenueSettings()
  const setDirty = useSettingsDirty('payment-instructions')
  const [instructions, setInstructions] = useState(initial.payment_instructions)
  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate({ payment_instructions: instructions }, { onSuccess: () => setDirty(false) })
  }
  return <section className="card stack"><h2>Payment instructions</h2>
    <form className="stack" aria-label="Payment instructions" onSubmit={handleSubmit}>
      <label className="field"><span className="muted small">Shown to players after they book. Include account names and numbers.</span>
        <textarea rows={7} value={instructions} onChange={(event) => { setInstructions(event.target.value); setDirty(true) }} />
      </label>
      <div className="form-actions"><button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save instructions'}</button><SaveStatus isSuccess={save.isSuccess} error={save.error} /></div>
    </form>
  </section>
}
