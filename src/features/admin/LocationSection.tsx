import { useState, type FormEvent } from 'react'
import { SaveStatus } from '../../components/SaveStatus'
import type { VenueSettings } from '../catalog/api'
import { useUpdateVenueSettings } from '../catalog/hooks'
import { MAPS_URL_MAX, mapsUrlProblem, placeNameFromMapsUrl } from '../venue/map'

const MAX = 300

/** The venue's address and its pasted Google Maps link (T11.9). Players see the address, linked to the map. */
export function LocationSection({ settings }: { settings: Pick<VenueSettings, 'address' | 'maps_url'> }) {
  const save = useUpdateVenueSettings()
  const [address, setAddress] = useState(settings.address)
  const [link, setLink] = useState(settings.maps_url)
  const [linkError, setLinkError] = useState<string | null>(null)

  function changeLink(value: string) {
    setLink(value)
    setLinkError(null)
    // A long link names the place; a short maps.app.goo.gl link can't be expanded in the browser (no CORS).
    if (!address.trim()) {
      const name = placeNameFromMapsUrl(value.trim())
      if (name) setAddress(name)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const url = link.trim()
    const problem = mapsUrlProblem(url)
    setLinkError(problem)
    if (problem) return
    save.mutate({ address: address.trim(), maps_url: url })
  }

  return (
    <section className="card stack" aria-labelledby="location-heading">
      <h2 id="location-heading">Location</h2>
      <form className="stack" aria-label="Location" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>Address</span>
          <textarea rows={2} maxLength={MAX} value={address} placeholder="e.g. 123 Rizal Ave, Makati City"
            onChange={(e) => setAddress(e.target.value)} />
        </label>
        <label className="field">
          <span>Google Maps link <span className="muted small">(optional: in Google Maps, tap Share and copy the link)</span></span>
          <input type="url" inputMode="url" maxLength={MAPS_URL_MAX} value={link} placeholder="https://maps.app.goo.gl/…"
            aria-invalid={linkError ? true : undefined} aria-describedby={linkError ? 'maps-link-error' : undefined}
            onChange={(e) => changeLink(e.target.value)} />
        </label>
        {linkError && <p id="maps-link-error" className="form-error" role="alert">{linkError}</p>}
        <p className="muted small">Players see the address with a pin. With a link, tapping it opens Google Maps.</p>
        <div className="form-actions">
          <button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save location'}</button>
          <SaveStatus isSuccess={save.isSuccess} error={save.error} />
        </div>
      </form>
    </section>
  )
}
