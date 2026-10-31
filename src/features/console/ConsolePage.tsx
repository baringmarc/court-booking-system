import { useAuth } from '../auth/useAuth'
import { LeadsInbox } from './LeadsInbox'

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
        </ul>
      </nav>
      <LeadsInbox />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>Log out</button>
      </div>
    </section>
  )
}
