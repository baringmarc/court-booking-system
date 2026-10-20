import { useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { useAuth } from '../auth/useAuth'

/** Shown to a signed-in account that isn't an admin. Admin access itself is enforced by RLS (`private.is_admin()`). */
export function AdminsOnly() {
  const { user, signOut } = useAuth()
  return (
    <section className="page narrow">
      <h1>Admins only</h1>
      <p className="muted">
        You're signed in as {user?.email}, which isn't an admin account.
      </p>
      <div className="form-actions">
        <button type="button" className="btn" onClick={signOut}>Log out</button>
        <Link to="/" className="btn btn-ghost">Back to site</Link>
      </div>
    </section>
  )
}

/** The account's role couldn't be loaded: don't claim it isn't an admin, offer a retry. */
export function AccountLoadError() {
  const { profileError, refreshProfile, signOut } = useAuth()
  const [retrying, setRetrying] = useState(false)
  async function retry() {
    setRetrying(true)
    try {
      await refreshProfile()
    } finally {
      setRetrying(false)
    }
  }
  if (retrying) return <PageLoader />
  return (
    <section className="page narrow">
      <h1>Couldn't load your account</h1>
      <ErrorMessage error={profileError} onRetry={retry} />
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={signOut}>Log out</button>
      </div>
    </section>
  )
}

/** Layout route for every admin page except /admin/login. */
export function AdminGuard() {
  const { user, isAdmin, loading, profileError } = useAuth()
  const location = useLocation()

  if (loading) return <PageLoader />
  if (!user) {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname + location.search }} />
  }
  if (profileError) return <AccountLoadError />
  if (!isAdmin) return <AdminsOnly />
  return <Outlet />
}
