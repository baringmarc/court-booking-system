import { useState, type FormEvent } from 'react'
import { PageLoader } from '../../components/PageLoader'
import { ErrorMessage } from '../../components/ErrorMessage'
import { SaveStatus } from '../../components/SaveStatus'
import { useUpdateVenueSettings, useVenueSettings } from '../catalog/hooks'
import type { VenueSettings } from '../catalog/api'
import { BannerSection } from './BannerSection'

export function SettingsPage() {
  const settings = useVenueSettings()

  return (
    <section className="page">
      <h1>Venue settings</h1>
      {settings.isPending ? (
        <PageLoader />
      ) : settings.isError ? (
        <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <>
          <SettingsForm initial={settings.data} />
          <BannerSection settings={settings.data} />
        </>
      )}
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

function SettingsForm({ initial }: { initial: VenueSettings }) {
  const save = useUpdateVenueSettings()
  const [name, setName] = useState(initial.name)
  const [instructions, setInstructions] = useState(initial.payment_instructions)
  const [numbers, setNumbers] = useState<Record<NumberKey, string>>(() =>
    Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, String(initial[f.key])])) as Record<NumberKey, string>,
  )

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    save.mutate({
      name: name.trim(),
      payment_instructions: instructions,
      ...Object.fromEntries(NUMBER_FIELDS.map((f) => [f.key, Number(numbers[f.key])])),
    })
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <section className="card stack">
        <h2>General</h2>
        <label className="field">
          <span>Venue name</span>
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <dl className="facts">
          <div><dt>Timezone</dt><dd>{initial.timezone}</dd></div>
          <div><dt>Currency</dt><dd>{initial.currency}</dd></div>
          <div><dt>Slot length</dt><dd>{initial.slot_minutes} min</dd></div>
        </dl>
      </section>

      <section className="card stack">
        <h2>Booking rules</h2>
        <div className="form-grid">
          {NUMBER_FIELDS.map((f) => (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <input
                type="number"
                required
                min={f.min}
                max={f.max}
                step={1}
                value={numbers[f.key]}
                onChange={(e) => setNumbers((n) => ({ ...n, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2>Payment instructions</h2>
        <label className="field">
          <span className="muted small">Shown to players after they book. Include account names and numbers.</span>
          <textarea rows={7} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
      </section>

      <div className="form-actions">
        <button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save settings'}</button>
        <SaveStatus isSuccess={save.isSuccess} error={save.error} />
      </div>
    </form>
  )
}
