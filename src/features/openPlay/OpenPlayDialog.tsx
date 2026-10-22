import { useEffect, useId, useRef, useState } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import type { OpenPlaySession } from './api'
import { sessionTimeLabel } from './session'

type Props = {
  sessionId: string
  /** The upcoming sessions query: the dialog shows its loading and error states too. */
  sessions: { isPending: boolean; isError: boolean; error: unknown; data?: OpenPlaySession[]; refetch: () => unknown }
  courtName: (id: string) => string | undefined
  timeZone: string
  onClose: () => void
}

/**
 * An open play session's details (T9.11d), in a native modal <dialog>: the browser traps focus and closes it on
 * Escape. Focus goes back to whatever opened it (the grid slot). Players can't book or join here.
 */
export function OpenPlayDialog({ sessionId, sessions, courtName, timeZone, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // Whatever had focus before the first render (the slot), so a StrictMode re-run can't swap in the dialog's button.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null))

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => opener?.focus()
  }, [opener])

  const session = sessions.data?.find((s) => s.id === sessionId)
  const courts = session?.court_ids.map(courtName).filter((name): name is string => !!name) ?? []

  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onClose={onClose}>
      <div className="dialog-body stack">
        <h2 id={titleId}>{session?.title ?? 'Open play'}</h2>
        {sessions.isPending ? (
          <PageLoader />
        ) : sessions.isError ? (
          <ErrorMessage error={sessions.error} onRetry={() => sessions.refetch()} />
        ) : !session ? (
          <p className="muted">This open play session is no longer scheduled.</p>
        ) : (
          <>
            <dl className="facts">
              <dt>When</dt>
              <dd>{sessionTimeLabel(session.starts_at, session.ends_at, timeZone)}</dd>
              {courts.length > 0 && (
                <>
                  <dt>{courts.length === 1 ? 'Court' : 'Courts'}</dt>
                  <dd>{courts.join(', ')}</dd>
                </>
              )}
            </dl>
            {session.details && <p className="pre-line">{session.details}</p>}
            {session.links.length > 0 && (
              <ul className="link-list">
                {session.links.map((link) => (
                  <li key={link.url}>
                    <a href={link.url} target="_blank" rel="noopener noreferrer">
                      {link.label}{' '}
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">
              Open play can't be booked online.{session.links.length > 0 ? ' Use the links above to join.' : ''}
            </p>
          </>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={() => ref.current?.close()}>Close</button>
        </div>
      </div>
    </dialog>
  )
}
