import { useState } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { errorMessage } from '../../lib/errors'
import { useNow } from '../booking/useNow'
import { useCourts, useVenueSettings } from '../catalog/hooks'
import type { OpenPlaySession } from '../openPlay/api'
import { useUpcomingOpenPlay } from '../openPlay/hooks'
import { useDeleteOpenPlay, useSaveOpenPlay } from './hooks'
import { sessionTimeLabel } from '../openPlay/session'
import { OpenPlayForm } from './OpenPlayForm'

/** One-off open play sessions (T9.11d): add, edit before they start, delete any time. */
export function OpenPlayPage() {
  const sessions = useUpcomingOpenPlay()
  // Archived courts too: a session may still name one (its name lists, and an edit can untick it).
  const courts = useCourts({ includeInactive: true })
  const settings = useVenueSettings()
  const save = useSaveOpenPlay()
  const remove = useDeleteOpenPlay()
  const now = useNow(60_000)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Bumped after a save, so the form remounts empty (or leaves edit mode).
  const [formKey, setFormKey] = useState(0)

  const editing = editingId ? sessions.data?.find((s) => s.id === editingId) ?? null : null
  const courtName = (id: string) => courts.data?.find((c) => c.id === id)?.name

  function startEdit(id: string | null) {
    save.reset()
    setEditingId(id)
  }

  function handleDelete(session: OpenPlaySession) {
    if (window.confirm(`Delete "${session.title}"? Its slots become bookable again.`)) {
      remove.mutate(session.id, { onSuccess: () => { if (editingId === session.id) startEdit(null) } })
    }
  }

  return (
    <section className="page">
      <h1>Open play</h1>
      <p className="muted">
        One-off sessions that block courts. Players see them as "Open play" on the booking page, with your details and
        links, and can't book those times. Times with bookings can't be used.
      </p>

      <section className="card stack" aria-labelledby="open-play-form-heading">
        <h2 id="open-play-form-heading">{editing ? `Edit ${editing.title}` : 'New session'}</h2>
        {courts.isPending || settings.isPending ? (
          <PageLoader />
        ) : courts.isError ? (
          <ErrorMessage error={courts.error} onRetry={() => courts.refetch()} />
        ) : settings.isError ? (
          <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
        ) : !courts.data.some((c) => c.is_active) ? (
          <p className="muted">Add a court first.</p>
        ) : (
          <OpenPlayForm
            key={`${editing?.id ?? 'new'}-${formKey}`}
            initial={editing}
            courts={courts.data.filter((c) => c.is_active || editing?.court_ids.includes(c.id))}
            timeZone={settings.data.timezone}
            saving={save.isPending}
            error={save.error}
            onCancel={editing ? () => startEdit(null) : undefined}
            onSave={(input) =>
              save.mutate({ id: editing?.id ?? null, input }, {
                onSuccess: () => { setEditingId(null); setFormKey((k) => k + 1) },
              })}
          />
        )}
      </section>

      <section className="card stack" aria-labelledby="open-play-list-heading">
        <h2 id="open-play-list-heading">Upcoming sessions</h2>
        {sessions.isPending || settings.isPending ? (
          <PageLoader />
        ) : sessions.isError ? (
          <ErrorMessage error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : settings.isError ? (
          <ErrorMessage error={settings.error} onRetry={() => settings.refetch()} />
        ) : sessions.data.length === 0 ? (
          <p className="muted">No upcoming open play sessions.</p>
        ) : (
          <ul className="list">
            {sessions.data.map((s) => {
              const started = Date.parse(s.starts_at) <= now.getTime()
              const names = s.court_ids.map(courtName).filter(Boolean)
              return (
                <li key={s.id} className="list-row">
                  <span>
                    <strong>{s.title}</strong>
                    {started && <>{' '}<span className="badge">In progress</span></>}
                    <span className="block small">{sessionTimeLabel(s.starts_at, s.ends_at, settings.data.timezone)}</span>
                    {/* A deleted court leaves its sessions (T9.11c follow-up); they still list. */}
                    <span className="block small muted">{names.length ? names.join(', ') : 'No courts left'}</span>
                  </span>
                  <span className="list-row-end">
                    {!started && (
                      <button type="button" className="btn btn-small btn-outline" aria-label={`Edit ${s.title}`}
                        onClick={() => startEdit(s.id)}>
                        Edit
                      </button>
                    )}
                    <button type="button" className="btn btn-small btn-ghost" aria-label={`Delete ${s.title}`}
                      disabled={remove.isPending} onClick={() => handleDelete(s)}>
                      Delete
                    </button>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        {remove.error && <p className="form-error" role="alert">{errorMessage(remove.error)}</p>}
      </section>
    </section>
  )
}
