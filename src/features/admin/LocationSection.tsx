import { useState, type FormEvent } from 'react'
import { SaveStatus } from '../../components/SaveStatus'
import type { VenueSettings } from '../catalog/api'
import { useUpdateVenueSettings } from '../catalog/hooks'
import { MAPS_EMBED_KEY, mapEmbedUrl, mapQueryOf } from '../venue/map'

const MAX = 300

/** The venue's address and what its map searches, with a map preview (T9.11h). */
export function LocationSection({ settings }: { settings: Pick<VenueSettings, 'address' | 'maps_query'> }) {
  const save = useUpdateVenueSettings()
  const [address, setAddress] = useState(settings.address)
  const [query, setQuery] = useState(settings.maps_query)
  // The preview follows a field when the admin leaves it, not on every keystroke.
  const [preview, setPreview] = useState(mapQueryOf(settings))
  const refreshPreview = () => setPreview(mapQueryOf({ address, maps_query: query }))

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    refreshPreview()
    save.mutate({ address: address.trim(), maps_query: query.trim() })
  }

  return (
    <section className="card stack" aria-labelledby="location-heading">
      <h2 id="location-heading">Location</h2>
      <form className="stack" aria-label="Location" onSubmit={handleSubmit}>
        <label className="field">
          <span>Address</span>
          <textarea rows={2} maxLength={MAX} value={address} placeholder="e.g. 123 Rizal Ave, Makati City"
            onChange={(e) => setAddress(e.target.value)} onBlur={refreshPreview} />
        </label>
        <label className="field">
          <span>Map search <span className="muted small">(optional: the place name as Google Maps knows it; the address is used otherwise)</span></span>
          <input maxLength={MAX} value={query} placeholder="e.g. Claudex Courts Makati" onChange={(e) => setQuery(e.target.value)}
            onBlur={refreshPreview} />
        </label>
        {preview ? (
          <iframe className="map-frame" title={`Map preview: ${preview}`} src={mapEmbedUrl(preview, MAPS_EMBED_KEY)} loading="lazy" />
        ) : (
          <p className="muted small">Add an address to see the map players will get.</p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save location'}</button>
          <SaveStatus isSuccess={save.isSuccess} error={save.error} />
        </div>
      </form>
    </section>
  )
}
