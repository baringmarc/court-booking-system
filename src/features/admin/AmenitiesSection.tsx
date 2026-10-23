import { useState, type FormEvent } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { errorMessage } from '../../lib/errors'
import { AMENITIES, CUSTOM_AMENITY_ICON, type AmenityKey } from '../venue/amenities'
import { useAmenities } from '../venue/hooks'
import { useAddCustomAmenity, useRemoveAmenity, useSetBuiltinAmenity } from './hooks'

const NAME_MAX = 40

/** Built-in amenities switched on and off, plus custom ones by name (T9.11h). Changes save right away. */
export function AmenitiesSection() {
  const amenities = useAmenities()
  const toggle = useSetBuiltinAmenity()
  const add = useAddCustomAmenity()
  const remove = useRemoveAmenity()
  const [name, setName] = useState('')
  // Choices still saving: shown at once, dropped when the save settles (the cache has it, or it failed).
  const [pending, setPending] = useState<Partial<Record<AmenityKey, boolean>>>({})

  function handleToggle(key: AmenityKey, on: boolean) {
    setPending((p) => ({ ...p, [key]: on }))
    toggle.mutate({ key, on }, {
      onSettled: () => setPending((p) => {
        const rest = { ...p }
        delete rest[key]
        return rest
      }),
    })
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    add.mutate(name.trim(), { onSuccess: () => setName('') })
  }

  const custom = (amenities.data ?? [])
    .filter((a) => a.custom_name)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)) // as shownAmenities
  const Generic = CUSTOM_AMENITY_ICON
  const error = toggle.error ?? remove.error

  return (
    <section className="card stack" aria-labelledby="amenities-heading">
      <h2 id="amenities-heading">Amenities</h2>
      <p className="muted small">Shown to players as a row of icons. Changes save right away.</p>
      {amenities.isPending ? (
        <PageLoader />
      ) : amenities.isError ? (
        <ErrorMessage error={amenities.error} onRetry={() => amenities.refetch()} />
      ) : (
        <>
          <fieldset className="field">
            <legend>Built-in</legend>
            <div className="amenity-grid">
              {AMENITIES.map(({ key, label, icon: Icon }) => (
                <label key={key} className="check amenity-check">
                  <input type="checkbox" checked={pending[key] ?? amenities.data.some((a) => a.builtin_key === key)}
                    disabled={pending[key] !== undefined} onChange={(e) => handleToggle(key, e.target.checked)} />
                  <Icon className="amenity-icon" aria-hidden="true" />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {error && <p className="form-error" role="alert">{errorMessage(error)}</p>}

          <div className="stack">
            <h3>Custom</h3>
            {custom.length === 0 ? (
              <p className="muted small">No custom amenities.</p>
            ) : (
              <ul className="list">
                {custom.map((a) => (
                  <li key={a.id} className="list-row">
                    <span className="amenity-check"><Generic className="amenity-icon" aria-hidden="true" />{a.custom_name}</span>
                    <button type="button" className="btn btn-small btn-ghost" aria-label={`Remove ${a.custom_name}`}
                      disabled={remove.isPending} onClick={() => remove.mutate(a.id)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <form className="form-actions" aria-label="Add a custom amenity" onSubmit={handleAdd}>
              <label className="field grow">
                <span>Custom amenity</span>
                <input required maxLength={NAME_MAX} value={name} placeholder="e.g. Massage chairs" onChange={(e) => setName(e.target.value)} />
              </label>
              <button type="submit" className="btn" disabled={add.isPending}>{add.isPending ? 'Adding…' : 'Add'}</button>
              {add.error && <span className="form-error" role="alert">{errorMessage(add.error)}</span>}
            </form>
          </div>
        </>
      )}
    </section>
  )
}
