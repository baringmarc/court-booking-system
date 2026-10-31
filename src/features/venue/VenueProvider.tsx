import { useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { setCurrentVenue } from '../../lib/currentVenue'
import { resolveHost } from '../../lib/venueHost'
import { signInWithPassword } from '../auth/api'
import { useAuth } from '../auth/useAuth'
import { fetchVenueBySlug } from './api'
import { VenueContext } from './VenueContext'
import { useVenue } from './useVenue'

/**
 * The venue's slug from the page's host. A host without one (a preview, a local IP, today's Vercel URL) falls back to
 * VITE_DEFAULT_VENUE, which T13.8 retires with Vercel.
 */
function pageSlug(): string | null {
  const host = resolveHost(window.location.hostname, window.location.search, window.sessionStorage)
  if (host.mode === 'venue') return host.slug
  return host.mode === 'none' ? import.meta.env.VITE_DEFAULT_VENUE || null : null
}

function VenueNotFound() {
  return (
    <section className="page narrow">
      <h1>Venue not found</h1>
      <p className="muted">We couldn't find a venue at this address. Check the link you were given.</p>
    </section>
  )
}

/**
 * A draft venue is invisible to anon, so its staff can't reach /admin/login before they sign in. This form signs them
 * in; the venue is read again once they have (the query key carries the user), and shows if they are members.
 */
function StaffSignIn() {
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
      <h1>Staff sign in</h1>
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

/**
 * Resolves the page's venue once, before anything below it renders, and makes it the current venue for the api
 * layer (`currentVenueId()`). A venue can't change without a page load: another venue is another subdomain.
 */
export function VenueProvider({ children }: { children: ReactNode }) {
  const slug = pageSlug()
  const { user } = useAuth()
  const { data: venue, error, isPending, refetch } = useQuery({
    queryKey: ['venue', slug, user?.id ?? null],
    queryFn: () => fetchVenueBySlug(slug!),
    enabled: !!slug,
    staleTime: 5 * 60_000,
  })

  if (!slug) return <VenueNotFound />
  if (error) {
    return (
      <section className="page narrow">
        <ErrorMessage error={error} onRetry={() => void refetch()} />
      </section>
    )
  }
  if (isPending) return <PageLoader />
  if (!venue) {
    return !user && window.location.pathname.startsWith('/admin') ? <StaffSignIn /> : <VenueNotFound />
  }

  setCurrentVenue(venue)
  return <VenueContext.Provider value={venue}>{children}</VenueContext.Provider>
}

/** Public pages only: a draft, suspended or closed venue takes no bookings. (Its staff still reach /admin.) */
export function VenueOpenGate({ children }: { children: ReactNode }) {
  const { status } = useVenue()
  if (status === 'active') return children
  return (
    <section className="page narrow">
      <h1>Not taking bookings</h1>
      <p className="muted">This venue isn't taking bookings right now. Please check back later.</p>
    </section>
  )
}
