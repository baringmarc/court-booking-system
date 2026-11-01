import { useAuth } from '../auth/useAuth'
import { InvoicesList } from './InvoicesList'
import { LeadsInbox } from './LeadsInbox'
import { ReviewsInbox } from './ReviewsInbox'
import { VenuesList } from './VenuesList'

/** The platform console shell (docs/SAAS-PLAN.md Phase 3). More sections join the nav as they are built. */
export function ConsolePage() {
  const { user, signOut } = useAuth()
  return (
    <section className="page narrow">
      <h1>Platform console</h1>
      <p className="muted">Signed in as {user?.email}.</p>
      <nav aria-label="Console">
        <ul className="list">
          <li><span aria-current="page">Leads</span></li>
          <li><a href="#venues-heading">Venues</a></li>
          <li><a href="#invoices-heading">Invoices</a></li>
          <li><a href="#reviews-heading">Reviews</a></li>
        </ul>
      </nav>
      <LeadsInbox />
      <VenuesList />
      <InvoicesList />
      <ReviewsInbox />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>Log out</button>
      </div>
    </section>
  )
}
