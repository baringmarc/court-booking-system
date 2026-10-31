import { useAuth } from '../auth/useAuth'

/** The platform console shell. Its content is Phase 3 (docs/SAAS-PLAN.md). */
export function ConsolePage() {
  const { user, signOut } = useAuth()
  return (
    <section className="page narrow">
      <h1>Platform console</h1>
      <p className="muted">Signed in as {user?.email}.</p>
      <p>Nothing here yet.</p>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>Log out</button>
      </div>
    </section>
  )
}
