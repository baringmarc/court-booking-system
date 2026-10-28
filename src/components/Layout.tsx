import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../features/auth/useAuth";
import { useMainFocus } from "./useMainFocus";
import { StayConnected } from "../features/venue/VenueInfo";
import { useVenueSettings } from "../features/catalog/hooks";
import { PlotlineTile } from "./PlotlineLogo";

export function Layout() {
  const { user, profile, loading, signOut } = useAuth();
  // The venue's own name heads its site (Plotline shows only in the footer, RESEARCH M11). The settings query is
  // shared with the pages, so this is no extra request on most of them.
  const venueName = useVenueSettings().data?.name ?? "";
  const displayName = profile?.full_name || user?.email;
  const { mainRef, skipToMain } = useMainFocus();

  return (
    <div className="app">
      <a href="#main" className="skip-link" onClick={skipToMain}>
        Skip to main content
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand venue-name">
            {/* Until the name loads (or if it can't), the link still needs a name. */}
            {venueName || <span className="sr-only">Home</span>}
          </Link>

          <nav className="nav" aria-label="Main">
            <NavLink to="/book">Book</NavLink>
            {user && <NavLink to="/me/bookings">My bookings</NavLink>}
          </nav>

          <div className="auth-area">
            {loading ? null : user ? (
              <>
                <span className="user-name" title={user.email}>
                  {displayName}
                </span>
                <button
                  type="button"
                  className="btn btn-small btn-ghost"
                  onClick={signOut}
                >
                  Log out
                </button>
              </>
            ) : (
              <Link to="/login" className="btn btn-small">
                Log in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main id="main" className="container main" tabIndex={-1} ref={mainRef}>
        <Outlet />
      </main>

      <footer className="site-footer">
        <div className="container">
          <StayConnected />
          <div className="footer-row">
            <span>© {new Date().getFullYear()}{venueName && ` ${venueName}`}</span>
            <span className="powered-by">
              Powered by <PlotlineTile size={20} /><span className="plotline-wordmark">plotline</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
