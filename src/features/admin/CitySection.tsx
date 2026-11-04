import { useState, type FormEvent } from 'react'
import { SaveStatus } from '../../components/SaveStatus'
import type { VenueSettings } from '../catalog/api'
import { useUpdateVenueSettings } from '../catalog/hooks'
import { useSettingsDirty } from './settingsDraft'

export function CitySection({ settings }: { settings: Pick<VenueSettings, 'city'> }) {
  const save = useUpdateVenueSettings()
  const setDirty = useSettingsDirty('city')
  const [city, setCity] = useState(settings.city)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate({ city: city.trim() }, { onSuccess: () => setDirty(false) })
  }

  return <section className="card stack">
    <h2>City</h2>
    <form className="stack" onSubmit={handleSubmit}>
      <label className="field">
        <span>City</span>
        <input type="text" maxLength={80} value={city} placeholder="e.g. Makati" disabled={save.isPending}
          onChange={(event) => { setCity(event.target.value); setDirty(true); save.reset() }} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save city'}</button>
        <SaveStatus isSuccess={save.isSuccess} error={save.error} />
      </div>
    </form>
  </section>
}
