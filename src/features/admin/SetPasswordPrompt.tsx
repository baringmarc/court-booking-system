import { useState, type FormEvent } from 'react'
import { setPassword } from '../auth/api'

/** Lets an invited owner choose a password so `/admin/login` works later (T14.5b). */
export function SetPasswordPrompt({ onDone }: { onDone: () => void }) {
  const [password, setPasswordValue] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 8) {
      setError('Use at least 8 characters')
      return
    }
    setPending(true)
    try {
      await setPassword(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set the password. Please try again.')
      setPending(false)
      return
    }
    onDone()
  }

  return (
    <section className="page narrow">
      <h1>Set your password</h1>
      <p className="muted">Choose a password so you can log in at /admin/login next time.</p>
      <form className="card stack" onSubmit={handleSubmit}>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPasswordValue(e.target.value)} />
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input type="password" autoComplete="new-password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="btn" disabled={pending}>{pending ? 'Saving…' : 'Set password'}</button>
          <button type="button" className="btn btn-ghost" onClick={onDone}>Skip for now</button>
        </div>
      </form>
    </section>
  )
}
