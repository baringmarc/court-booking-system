import { useEffect, useRef, useState } from 'react'
import { Building2, FileText, Inbox, Menu, MessageSquareQuote, X } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { PlotlineLogo } from '../../components/PlotlineLogo'
import { useMainFocus } from '../../components/useMainFocus'
import { useAuth } from '../auth/useAuth'

const SECTIONS = [
  { to: '/leads', label: 'Leads', icon: Inbox },
  { to: '/venues', label: 'Venues', icon: Building2 },
  { to: '/invoices', label: 'Invoices', icon: FileText },
  { to: '/reviews', label: 'Reviews', icon: MessageSquareQuote },
]

function Brand() {
  return <span className="brand admin-brand"><PlotlineLogo size={30} /><span className="badge">Console</span></span>
}

function Account({ inDrawer = false }: { inDrawer?: boolean }) {
  const { user, signOut } = useAuth()
  return (
    <div className={inDrawer ? 'stack console-account' : 'console-account auth-area'}>
      <p className="muted small">Signed in as {user?.email}</p>
      <div><button type="button" className="btn btn-ghost btn-small" onClick={() => void signOut()}>Log out</button></div>
    </div>
  )
}

/**
 * The platform console shell (T17.19): a sidebar on desktop and a modal drawer on phones hold the same section links;
 * the top bar (and the drawer) show who is signed in, with Log out, around a wide workspace for the section page.
 */
export function ConsoleLayout() {
  // useMainFocus moves focus to <main> after a section change, so the new page is read from the top.
  const { mainRef, skipToMain } = useMainFocus()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  function closeDrawer() {
    dialog.current?.close()
    setDrawerOpen(false)
  }
  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 900px)')
    function resize() { if (media?.matches) { dialog.current?.close(); setDrawerOpen(false) } }
    media?.addEventListener('change', resize)
    return () => media?.removeEventListener('change', resize)
  }, [])
  useEffect(() => {
    if (!drawerOpen) return
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = oldOverflow }
  }, [drawerOpen])

  function navigation(inDrawer: boolean) {
    return (
      <nav className="admin-navigation" aria-label="Console">
        <div className="admin-nav-group">
          {SECTIONS.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : undefined)} onClick={() => { if (inDrawer) closeDrawer() }}>
              <Icon size={20} aria-hidden="true" /><span className="admin-nav-label">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    )
  }

  return (
    <div className="app admin admin-workspace console-workspace">
      <a href="#main" className="skip-link" onClick={skipToMain}>Skip to main content</a>
      {!drawerOpen && (
        <aside className="admin-sidebar">
          <Brand />{navigation(false)}
        </aside>
      )}
      <header className="site-header admin-topbar console-topbar">
        <button ref={trigger} type="button" className="btn btn-small btn-ghost admin-menu-trigger" aria-haspopup="dialog" aria-controls="console-drawer"
          aria-expanded={drawerOpen} onClick={() => { setDrawerOpen(true); dialog.current?.showModal() }}>
          <Menu size={22} aria-hidden="true" /><span>Menu</span>
        </button>
        <span className="admin-venue-name">Platform console</span>
        <Account />
      </header>
      <dialog id="console-drawer" className="admin-drawer" ref={dialog} aria-label="Console navigation" onClose={() => setDrawerOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            closeDrawer()
            trigger.current?.focus()
            return
          }
          if (event.key !== 'Tab') return
          const items = dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
          if (!items?.length) return
          const first = items[0]
          const last = items[items.length - 1]
          const active = document.activeElement
          if (event.shiftKey && (active === first || !dialog.current?.contains(active))) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && (active === last || !dialog.current?.contains(active))) { event.preventDefault(); first.focus() }
        }}
        onClick={(event) => { if (event.target === event.currentTarget) { closeDrawer(); trigger.current?.focus() } }}>
        <div className="admin-drawer-content">
          <div className="admin-drawer-heading">
            <Brand />
            <button type="button" className="btn btn-small btn-ghost" aria-label="Close navigation" onClick={() => { closeDrawer(); trigger.current?.focus() }}>
              <X aria-hidden="true" size={22} />
            </button>
          </div>
          {drawerOpen && <div className="stack">{navigation(true)}<Account inDrawer /></div>}
        </div>
      </dialog>
      <main id="main" className="console-main" tabIndex={-1} ref={mainRef}><Outlet /></main>
    </div>
  )
}
