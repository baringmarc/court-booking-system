import type { ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import { PageLoader } from '../../components/PageLoader'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <PageLoader />
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return children
}

export function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAuth()

  if (loading) return <PageLoader />
  if (!isAdmin) {
    return (
      <section className="page narrow">
        <h1>Admins only</h1>
        <p className="muted">Your account doesn't have access to this page.</p>
        <Link to="/" className="btn">Back to home</Link>
      </section>
    )
  }
  return children
}

/** Sends signed-in users away from /login and /signup. */
export function RedirectIfAuthed({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  if (loading) return <PageLoader />
  if (user) return <Navigate to={from} replace />
  return children
}
