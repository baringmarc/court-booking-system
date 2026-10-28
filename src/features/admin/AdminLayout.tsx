import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { PlotlineLogo } from '../../components/PlotlineLogo'
import { useMainFocus } from '../../components/useMainFocus'
import { useAuth } from '../auth/useAuth'

const LINKS = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/bookings', label: 'Bookings' },
  { to: '/admin/courts', label: 'Courts & rates' },
  { to: '/admin/schedule', label: 'Schedule' },
  { to: '/admin/open-play', label: 'Open play' },
  { to: '/admin/settings', label: 'Settings' },
]

/** The admin shell (SPEC §7): its own header and nav, separate from the public Layout. */
export function AdminLayout() {
  const { user, profile, isAdmin, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const displayName = profile?.full_name || user?.email
  const { mainRef, skipToMain } = useMainFocus()

  async function handleSignOut() {
    await signOut()
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className="app admin">
      <a href="#main" className="skip-link" onClick={skipToMain}>Skip to main content</a>
      <header className="site-header admin-header">
        <div className="container header-inner">
          {/* Plotline's own logo heads the admin area (RESEARCH M11); the public site shows the venue's name instead. */}
          <Link to="/admin" className="brand admin-brand">
            <PlotlineLogo size={30} /><span className="badge">Admin</span>
          </Link>

          {isAdmin && (
            <nav className="nav" aria-label="Admin">
              {LINKS.map((l) => (
                <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>
              ))}
            </nav>
          )}

          <div className="auth-area">
            <Link to="/" className="btn btn-small btn-ghost">View site</Link>
            {!loading && user && (
              <>
                <span className="user-name" title={user.email}>{displayName}</span>
                <button type="button" className="btn btn-small btn-ghost" onClick={handleSignOut}>
                  Log out
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="container main" tabIndex={-1} ref={mainRef}>
        <Outlet />
      </main>
    </div>
  )
}
