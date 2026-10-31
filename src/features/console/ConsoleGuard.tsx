import { useState, type FormEvent, type ReactNode } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { signInWithPassword } from '../auth/api'
import { useAuth } from '../auth/useAuth'
import { useIsPlatformAdmin } from './hooks'

function ConsoleSignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await signInWithPassword(email, password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="page narrow">
      <h1>Platform console</h1>
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
        <button type="submit" className="btn btn-block" disabled={pending}>Sign in</button>
      </form>
    </section>
  )
}

/** Platform admins only; RLS (`platform_admins`) is the real check. */
export function ConsoleGuard({ children }: { children: ReactNode }) {
  const { user, loading, signOut } = useAuth()
  const { isPlatformAdmin, isPending, error, refetch } = useIsPlatformAdmin(user?.id)

  if (loading) return <PageLoader />
  if (!user) return <ConsoleSignIn />
  if (isPending) return <PageLoader />
  if (error) {
    return (
      <section className="page narrow">
        <ErrorMessage error={error} onRetry={() => void refetch()} />
      </section>
    )
  }
  if (!isPlatformAdmin) {
    return (
      <section className="page narrow">
        <h1>Platform admins only</h1>
        <p className="muted">You're signed in as {user.email}, which isn't a platform admin account.</p>
        <div className="form-actions">
          <button type="button" className="btn" onClick={() => void signOut()}>Log out</button>
        </div>
      </section>
    )
  }
  return children
}
