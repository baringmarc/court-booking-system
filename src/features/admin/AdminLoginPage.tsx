import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { PageLoader } from '../../components/PageLoader'
import { signInWithPassword } from '../auth/api'
import { useAuth } from '../auth/useAuth'
import { AdminsOnly } from './AdminGuard'

/** Staff sign-in: email + password only. There is no admin sign-up; admins are promoted in the database (SPEC §2). */
export function AdminLoginPage() {
  const { user, isAdmin, loading } = useAuth()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/admin'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      // On success the auth state changes and the checks below redirect or refuse.
      await signInWithPassword(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in. Please try again.')
    } finally {
      setPending(false)
    }
  }

  if (loading) return <PageLoader />
  if (user && isAdmin) return <Navigate to={from} replace />
  if (user) return <AdminsOnly />

  return (
    <section className="page narrow">
      <h1>Admin log in</h1>
      <p className="muted">For Claudex Courts staff.</p>

      <form className="card stack" onSubmit={handleSubmit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-block" disabled={pending}>
          {pending ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </section>
  )
}
