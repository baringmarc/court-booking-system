import { useState, type FormEvent } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { errorMessage } from '../../lib/errors'
import type { InfoSection } from '../venue/api'
import { useInfoSections } from '../venue/hooks'
import { useDeleteInfoSection, useMoveInfoSection, useSaveInfoSection } from './hooks'
import { MoveButtons } from './MoveButtons'

const TITLE_MAX = 80
const BODY_MAX = 5000

/** Admin-defined info sections (T9.11h): add, edit, delete and reorder. Players see them on the home page. */
export function InfoSectionsSection() {
  const sections = useInfoSections()
  const save = useSaveInfoSection()
  const add = useSaveInfoSection() // its own, so an open edit form never shows the add form's state
  const remove = useDeleteInfoSection()
  const move = useMoveInfoSection()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addKey, setAddKey] = useState(0) // bumped after adding, so the add form empties

  function startEdit(id: string | null) {
    save.reset()
    setEditingId(id)
  }

  function handleDelete(section: InfoSection) {
    if (window.confirm(`Delete "${section.title}"? Players will no longer see it.`)) remove.mutate(section.id)
  }

  return (
    <section className="card stack" aria-labelledby="info-sections-heading">
      <h2 id="info-sections-heading">Info sections</h2>
      <p className="muted small">
        Waivers, policies and house rules, shown to players in this order. Use a blank line between paragraphs and
        **double asterisks** for bold.
      </p>
      {sections.isPending ? (
        <PageLoader />
      ) : sections.isError ? (
        <ErrorMessage error={sections.error} onRetry={() => sections.refetch()} />
      ) : (
        <>
          {sections.data.length === 0 ? (
            <p className="muted">No info sections yet.</p>
          ) : (
            <ol className="list order-list">
              {sections.data.map((s, i) => (
                <li key={s.id} className="order-row info-section-row">
                  {editingId === s.id ? (
                    <SectionForm key={s.id} initial={s} label={`Edit ${s.title}`} saving={save.isPending} error={save.error}
                      onCancel={() => startEdit(null)}
                      onSave={(input) => save.mutate({ id: s.id, input }, { onSuccess: () => setEditingId(null) })} />
                  ) : (
                    <>
                      <span className="list-row">
                        <strong>{s.title}</strong>
                        <span className="list-row-end">
                          <button type="button" className="btn btn-small btn-outline" aria-label={`Edit ${s.title}`}
                            onClick={() => startEdit(s.id)}>Edit</button>
                          <button type="button" className="btn btn-small btn-ghost" aria-label={`Delete ${s.title}`}
                            disabled={remove.isPending} onClick={() => handleDelete(s)}>Delete</button>
                        </span>
                      </span>
                      <MoveButtons label={s.title} position={i} canMoveUp={i > 0} canMoveDown={i < sections.data.length - 1}
                        disabled={move.isPending} onMove={(direction) => move.mutate({ id: s.id, direction })} />
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
          {(remove.error || move.error) && <p className="form-error" role="alert">{errorMessage(remove.error ?? move.error)}</p>}
          <h3>Add a section</h3>
          <SectionForm key={addKey} initial={null} label="New info section" saving={add.isPending} error={add.error}
            onSave={(input) => add.mutate({ id: null, input }, { onSuccess: () => { add.reset(); setAddKey((k) => k + 1) } })} />
        </>
      )}
    </section>
  )
}

function SectionForm({ initial, label, saving, error, onSave, onCancel }: {
  initial: InfoSection | null
  label: string
  saving: boolean
  error: Error | null
  onSave: (input: { title: string; body: string }) => void
  onCancel?: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    onSave({ title: title.trim(), body: body.trim() })
  }

  return (
    <form className="stack info-section-form" aria-label={label} onSubmit={handleSubmit}>
      <label className="field">
        <span>Title</span>
        <input required maxLength={TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Text</span>
        <textarea rows={5} maxLength={BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save section' : 'Add section'}</button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
        {error && <span className="form-error" role="alert">{errorMessage(error)}</span>}
      </div>
    </form>
  )
}
