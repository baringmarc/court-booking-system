import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { GoogleButton } from './GoogleButton'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setPending(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate(from, { replace: true })
  }

  return (
    <section className="page narrow">
      <h1>Log in</h1>
      <p className="muted">Log in to see your bookings and check out faster.</p>

      <div className="card stack">
        <GoogleButton redirectPath={from} />
        <div className="divider"><span>or</span></div>

        <form className="stack" onSubmit={handleSubmit}>
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
      </div>

      <p className="muted center">
        No account? <Link to="/signup" state={location.state}>Sign up</Link>
        {' · '}
        <Link to="/book">Book as a guest</Link>
      </p>
    </section>
  )
}
