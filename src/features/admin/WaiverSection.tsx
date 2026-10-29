import { useState, type FormEvent } from 'react'
import { SaveStatus } from '../../components/SaveStatus'
import type { VenueSettings } from '../catalog/api'
import { useUpdateVenueSettings } from '../catalog/hooks'
import { DEFAULT_WAIVER_TEXT, WAIVER_MAX } from '../venue/waiver'

/** The venue's waiver (T11.20). Players accept it at checkout; blank turns it off. */
export function WaiverSection({ settings }: { settings: Pick<VenueSettings, 'waiver_text'> }) {
  const save = useUpdateVenueSettings()
  const [text, setText] = useState(settings.waiver_text)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    save.mutate({ waiver_text: text.trim() })
  }

  return (
    <section className="card stack" aria-labelledby="waiver-heading">
      <h2 id="waiver-heading">Waiver</h2>
      <form className="stack" aria-label="Waiver" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>Waiver</span>
          <textarea rows={5} maxLength={WAIVER_MAX} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="muted small">
          Players must accept this before they book online. It's your venue's own text, so it's worth having it checked.
          Leave it blank to turn the waiver off.
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={() => setText(DEFAULT_WAIVER_TEXT)}>Reset to default</button>
          <button type="submit" className="btn" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save waiver'}</button>
          <SaveStatus isSuccess={save.isSuccess} error={save.error} />
        </div>
      </form>
    </section>
  )
}
