import { Link } from 'react-router-dom'
import type { BookingDetail } from './api'
import { describeChange, describeContinuation } from './moves'

type Props = { booking: BookingDetail; timeZone: string }

/**
 * What staff moved (T10.10): where this booking came from, each reschedule with its reason, and the booking's moved
 * parts. A moved part has its own reference; the link keeps a guest's private token, since it's the same hash.
 */
export function MoveHistory({ booking, timeZone }: Props) {
  const { parent_reference_code: parent, continuations, changes } = booking
  if (!parent && continuations.length === 0 && changes.length === 0) return null
  // Guests reach a moved part through the same private link, so the fragment (#token=…) is carried over.
  const hash = typeof window === 'undefined' ? '' : window.location.hash
  const partLink = (ref: string) => ({ pathname: `/booking/${ref}`, hash })
  return (
    <section className="card stack" aria-labelledby="moves-heading">
      <h2 id="moves-heading">Schedule changes</h2>
      {parent && (
        <p className="small">
          This is the moved part of <Link to={partLink(parent)}>{parent}</Link>. It's covered by that booking's payment.
        </p>
      )}
      {changes.length > 0 && (
        <ul className="list" aria-label="Changes">
          {changes.map((c) => (
            <li key={`${c.changed_at}-${c.new_start}`} className="list-row">
              <span>
                {describeChange(c, timeZone)}
                <span className="muted small block">Reason: {c.reason}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {continuations.length > 0 && (
        <ul className="list" aria-label="Moved parts">
          {continuations.map((m) => (
            <li key={m.reference_code} className="list-row">
              <span>
                {describeContinuation(m, timeZone)}
                <span className="muted small block">
                  <Link to={partLink(m.reference_code)}>{m.reference_code}</Link>
                  {m.status === 'cancelled' ? ' · Cancelled' : ''}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
