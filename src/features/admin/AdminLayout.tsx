import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  House,
  Menu,
  Settings,
  Building,
  Users,
  X,
} from "lucide-react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { PlotlineLogo } from "../../components/PlotlineLogo";
import { useMainFocus } from "../../components/useMainFocus";
import { useAuth } from "../auth/useAuth";
import { useIsVenueAdmin } from "../auth/useIsVenueAdmin";
import { useVenueSettings } from "../catalog/hooks";
import { VenueSwitcher } from "./VenueSwitcher";
import { useBookingAlerts } from "./useBookingAlerts";

const GROUPS = [
  {
    label: "Operations",
    links: [
      { to: "/admin", label: "Dashboard", icon: House, end: true },
      { to: "/admin/bookings", label: "Bookings", icon: ClipboardList },
      { to: "/admin/schedule", label: "Schedule", icon: CalendarDays },
      { to: "/admin/open-play", label: "Open Play", icon: Users },
    ],
  },
  {
    label: "Management",
    links: [
      { to: "/admin/courts", label: "Courts", icon: Building },
      { to: "/admin/reports", label: "Reports", icon: ChartNoAxesCombined },
      { to: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function AdminLayout() {
  const { user } = useAuth();
  const isAdmin = useIsVenueAdmin();
  const { mainRef, skipToMain } = useMainFocus();
  const skipLink = (
    <a href="#main" className="skip-link" onClick={skipToMain}>
      Skip to main content
    </a>
  );
  const content = (
    <main id="main" className="container main" tabIndex={-1} ref={mainRef}>
      <Outlet />
    </main>
  );
  // The alert owner exists only for a signed-in member of this venue, and survives page/drawer changes.
  if (isAdmin && user)
    return (
      <AdminWorkspace key={user.id} skipLink={skipLink}>
        {content}
      </AdminWorkspace>
    );
  return (
    <div className="app admin">
      {skipLink}
      <header className="site-header admin-header">
        <div className="container header-inner">
          <AdminBrand />
          <div className="auth-area">
            <Link to="/" className="btn btn-small btn-ghost">
              View public site
            </Link>
            <AccountActions />
          </div>
        </div>
      </header>
      {content}
    </div>
  );
}

function AdminBrand() {
  return (
    <Link to="/admin" className="brand admin-brand">
      <PlotlineLogo size={30} />
      <span className="badge">Admin</span>
    </Link>
  );
}

function AccountActions() {
  const { user, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  if (loading || !user) return null;
  async function logout() {
    await signOut();
    navigate("/admin/login", { replace: true });
  }
  return (
    <div
      className="admin-account"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="btn btn-small btn-ghost"
        aria-expanded={open}
        aria-controls="admin-account-actions"
        onClick={() => setOpen(!open)}
      >
        Account
      </button>
      {open && (
        <div id="admin-account-actions" className="admin-account-panel">
          <span className="user-name" title={user.email}>
            {profile?.full_name || user.email}
          </span>
          <button
            type="button"
            className="btn btn-small btn-ghost"
            onClick={() => {
              void logout();
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function AdminWorkspace({
  children,
  skipLink,
}: {
  children: ReactNode;
  skipLink: ReactNode;
}) {
  const { navCount } = useBookingAlerts();
  const { data: settings } = useVenueSettings();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);

  function closeDrawer() {
    dialog.current?.close();
    setDrawerOpen(false);
  }
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    if (dialog.current?.open) {
      dialog.current.close();
      // Route changes focus the new content, rather than the drawer trigger.
      document.getElementById("main")?.focus({ preventScroll: true });
    }
  }, [pathname]);
  useEffect(() => {
    const media = window.matchMedia?.("(min-width: 900px)");
    function resize() {
      if (media?.matches) {
        dialog.current?.close();
        setDrawerOpen(false);
      }
    }
    media?.addEventListener("change", resize);
    return () => media?.removeEventListener("change", resize);
  }, []);
  useEffect(() => {
    if (!drawerOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = oldOverflow;
    };
  }, [drawerOpen]);

  function navigation(inDrawer: boolean) {
    return (
      <nav className="admin-navigation" aria-label="Admin">
        {GROUPS.map((group) => (
          <div className="admin-nav-group" key={group.label}>
            <span className="admin-nav-group-label">{group.label}</span>
            {group.links.map((link) => {
              const count = link.to === "/admin/bookings" ? navCount : 0;
              const Icon = link.icon;
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={"end" in link ? link.end : undefined}
                  title={link.label}
                  aria-label={
                    count ? `${link.label}, ${count} new` : link.label
                  }
                  className={({ isActive }) =>
                    isActive ||
                    (link.to === "/admin/reports" &&
                      pathname === "/admin/statement")
                      ? "active"
                      : undefined
                  }
                  aria-current={
                    link.to === "/admin/reports" &&
                    pathname === "/admin/statement"
                      ? "page"
                      : undefined
                  }
                  onClick={() => {
                    if (inDrawer) closeDrawer();
                  }}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span className="admin-nav-label">{link.label}</span>
                  {count > 0 && (
                    <span className="nav-count" aria-hidden="true">
                      {count}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
    );
  }
  return (
    <div
      className={`app admin admin-workspace${collapsed ? " sidebar-collapsed" : ""}`}
    >
      {skipLink}
      {!drawerOpen && (
        <aside className="admin-sidebar">
          <AdminBrand />
          {navigation(false)}
          <button
            type="button"
            className="btn btn-small btn-ghost sidebar-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? (
              <ChevronRight aria-hidden="true" size={20} />
            ) : (
              <ChevronLeft aria-hidden="true" size={20} />
            )}
            <span className="admin-nav-label">Collapse sidebar</span>
          </button>
        </aside>
      )}
      <header className="site-header admin-topbar">
        <button
          ref={trigger}
          type="button"
          className="btn btn-small btn-ghost admin-menu-trigger"
          aria-label="Open navigation"
          aria-haspopup="dialog"
          aria-controls="admin-drawer"
          aria-expanded={drawerOpen}
          onClick={() => {
            setDrawerOpen(true);
            dialog.current?.showModal();
          }}
        >
          <Menu size={22} aria-hidden="true" />
        </button>
        <span className="admin-venue-name">
          {settings?.name || "Venue admin"}
        </span>
        <div className="auth-area">
          <VenueSwitcher />
          <Link
            to="/admin/bookings"
            className="btn btn-small btn-ghost admin-alert-link"
            aria-label={`Booking alerts, ${navCount} new`}
          >
            <Bell size={18} aria-hidden="true" />
            <span aria-hidden="true">{navCount}</span>
          </Link>
          <Link to="/" className="btn btn-small btn-ghost">
            View public site
          </Link>
          <AccountActions />
        </div>
      </header>
      <dialog
        id="admin-drawer"
        className="admin-drawer"
        ref={dialog}
        aria-label="Admin navigation"
        onClose={() => {
          setDrawerOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const items = dialog.current?.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          );
          if (!items?.length) return;
          const first = items[0];
          const last = items[items.length - 1];
          const active = document.activeElement;
          if (
            event.shiftKey &&
            (active === first || !dialog.current?.contains(active))
          ) {
            event.preventDefault();
            last.focus();
          } else if (
            !event.shiftKey &&
            (active === last || !dialog.current?.contains(active))
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeDrawer();
            trigger.current?.focus();
          }
        }}
      >
        <div className="admin-drawer-content">
          <div className="admin-drawer-heading">
            <AdminBrand />
            <button
              type="button"
              className="btn btn-small btn-ghost"
              aria-label="Close navigation"
              onClick={() => {
                closeDrawer();
                trigger.current?.focus();
              }}
            >
              <X aria-hidden="true" size={22} />
            </button>
          </div>
          {drawerOpen && navigation(true)}
        </div>
      </dialog>
      {children}
    </div>
  );
}
