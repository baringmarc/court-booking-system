import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { GoogleButton } from './GoogleButton'

const MIN_PASSWORD_LENGTH = 8

export function SignupPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: window.location.origin + from,
      },
    })
    setPending(false)
    if (error) {
      setError(error.message)
      return
    }
    // With email confirmation on, there is no session until the link is clicked.
    if (data.session) navigate(from, { replace: true })
    else setConfirmationSentTo(email)
  }

  if (confirmationSentTo) {
    return (
      <section className="page narrow">
        <h1>Check your email</h1>
        <p>
          We sent a confirmation link to <strong>{confirmationSentTo}</strong>. Open it to finish
          creating your account.
        </p>
        <Link to="/" className="btn">Back to home</Link>
      </section>
    )
  }

  return (
    <section className="page narrow">
      <h1>Create an account</h1>
      <p className="muted">Keep track of your bookings at Claudex Courts.</p>
      {/* Hosted emails are off for now (SPEC §8, T8.6), so an email + password sign-up can't be confirmed. */}
      <div className="alert alert-info" role="note">
        <p>
          We can't send confirmation emails yet, so email sign-up won't finish. Use <strong>Continue with Google</strong>,
          or <Link to="/book">book as a guest</Link> with no account.
        </p>
      </div>

      <div className="card stack">
        <GoogleButton redirectPath={from} />
        <div className="divider"><span>or</span></div>

        <form className="stack" onSubmit={handleSubmit}>
          <label className="field">
            <span>Full name</span>
            <input autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </label>
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <small className="muted">At least {MIN_PASSWORD_LENGTH} characters.</small>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn-block" disabled={pending}>
            {pending ? 'Creating account…' : 'Sign up'}
          </button>
        </form>
      </div>

      <p className="muted center">
        Already have an account? <Link to="/login" state={location.state}>Log in</Link>
      </p>
    </section>
  )
}
