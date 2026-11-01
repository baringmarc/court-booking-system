import { useState, type FormEvent } from 'react'
import { SaveStatus } from '../../components/SaveStatus'
import type { VenueSettings } from '../catalog/api'
import { useUpdateVenueSettings } from '../catalog/hooks'

const CITY_MAX = 80

/** Opt in to be listed on the Plotline website (T14.13). Only the name, city and a photo are shown. */
export function ShowcaseSection({ settings }: { settings: Pick<VenueSettings, 'city' | 'showcase_opt_in'> }) {
  const save = useUpdateVenueSettings()
  const [city, setCity] = useState(settings.city)
  const [optIn, setOptIn] = useState(settings.showcase_opt_in)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    save.mutate({ city: city.trim(), showcase_opt_in: optIn })
  }

  return (
    <section className="card stack" aria-labelledby="showcase-heading">
      <h2 id="showcase-heading">Showcase</h2>
      <form className="stack" aria-label="Showcase" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>City</span>
          <input type="text" maxLength={CITY_MAX} value={city} placeholder="e.g. Makati"
            onChange={(e) => setCity(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} />
          <span>List this venue on the Plotline website</span>
        </label>
        <p className="muted small">
          The listing shows your venue's name, city and banner (or first court photo) with a link to your booking page.
          It only appears once your venue is published.
        </p>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save showcase'}</button>
          <SaveStatus isSuccess={save.isSuccess} error={save.error} />
        </div>
      </form>
    </section>
  )
}
