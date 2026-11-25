import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import type { VenueSettings } from '../catalog/api'
import { CancellationPolicyLink } from '../venue/VenueInfo'
import { CheckoutForm } from './CheckoutForm'
import type { Contact } from './contact'

/** The "Your details" card of a checkout, one court or several (T33.3). */
export function CheckoutDetails({ settings, pending, onSubmit }: {
  settings: VenueSettings
  pending: boolean
  /** The contact as the RPC takes it: a guest's in full, a signed-in player's name and phone only. */
  onSubmit: (contact: Contact | { name: string; phone?: string }, waiverAccepted: boolean) => void
}) {
  const location = useLocation()
  const { user, profile } = useAuth()
  const isGuest = !user
  const initial: Contact = isGuest
    ? { name: '', email: '', phone: '' }
    : { name: profile?.full_name ?? '', email: user.email ?? '', phone: profile?.phone ?? '' }

  return (
    <section className="card stack">
      <h2 className="card-head">Your details</h2>
      {isGuest && (
        <p className="muted small">
          Booking as a guest.{' '}
          <Link to="/login" state={{ from: location.pathname + location.search }}>Log in</Link> to fill this in and keep the booking in your account.
        </p>
      )}
      <CheckoutForm key={user?.id ?? 'guest'} initial={initial} isGuest={isGuest} pending={pending}
        waiverText={settings.waiver_text} cancelCutoffHours={settings.cancel_cutoff_hours}
        onSubmit={(contact, waiverAccepted) => onSubmit(isGuest ? contact : { name: contact.name, phone: contact.phone || undefined }, waiverAccepted)} />
      <CancellationPolicyLink />
    </section>
  )
}
