import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../features/auth/useAuth'

export function Layout() {
  const { user, profile, loading, signOut } = useAuth()
  const displayName = profile?.full_name || user?.email

  return (
    <div className="app">
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">◆</span> Claudex Courts
          </Link>

          <nav className="nav" aria-label="Main">
            <NavLink to="/book">Book</NavLink>
            {user && <NavLink to="/me/bookings">My bookings</NavLink>}
          </nav>

          <div className="auth-area">
            {loading ? null : user ? (
              <>
                <span className="user-name" title={user.email}>{displayName}</span>
                <button type="button" className="btn btn-small btn-ghost" onClick={signOut}>
                  Log out
                </button>
              </>
            ) : (
              <Link to="/login" className="btn btn-small">Log in</Link>
            )}
          </div>
        </div>
      </header>

      <main className="container main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="container muted">© {new Date().getFullYear()} Claudex Courts · Portfolio project</div>
      </footer>
    </div>
  )
}
