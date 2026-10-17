import { Outlet, createBrowserRouter } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ComingSoon } from '../components/ComingSoon'
import { PageLoader } from '../components/PageLoader'
import { LoginPage } from '../features/auth/LoginPage'
import { SignupPage } from '../features/auth/SignupPage'
import { RedirectIfAuthed, RequireAdmin, RequireAuth } from '../features/auth/RouteGuards'
import { HomePage } from './HomePage'
import { NotFoundPage } from './NotFoundPage'

// Routes follow SPEC.md §7. Placeholders are replaced milestone by milestone.
// Admin pages are lazy-loaded so players never download them.
export const router = createBrowserRouter([
  {
    element: <Layout />,
    hydrateFallbackElement: <PageLoader />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/book', element: <ComingSoon title="Book a court" milestone={3} /> },
      { path: '/book/checkout', element: <ComingSoon title="Checkout" milestone={3} /> },
      { path: '/booking/:ref', element: <ComingSoon title="Your booking" milestone={3} /> },
      { path: '/login', element: <RedirectIfAuthed><LoginPage /></RedirectIfAuthed> },
      { path: '/signup', element: <RedirectIfAuthed><SignupPage /></RedirectIfAuthed> },
      {
        path: '/me/bookings',
        element: <RequireAuth><ComingSoon title="My bookings" milestone={5} /></RequireAuth>,
      },
      {
        path: '/admin',
        element: <RequireAuth><RequireAdmin><Outlet /></RequireAdmin></RequireAuth>,
        children: [
          {
            lazy: () => import('../features/admin/AdminLayout').then((m) => ({ Component: m.AdminLayout })),
            children: [
              { index: true, element: <ComingSoon title="Admin dashboard" milestone={4} /> },
              { path: 'bookings', element: <ComingSoon title="Bookings" milestone={4} /> },
              {
                path: 'courts',
                lazy: () => import('../features/admin/CourtsPage').then((m) => ({ Component: m.CourtsPage })),
              },
              {
                path: 'courts/:id',
                lazy: () => import('../features/admin/CourtEditPage').then((m) => ({ Component: m.CourtEditPage })),
              },
              {
                path: 'schedule',
                lazy: () => import('../features/admin/SchedulePage').then((m) => ({ Component: m.SchedulePage })),
              },
              {
                path: 'settings',
                lazy: () => import('../features/admin/SettingsPage').then((m) => ({ Component: m.SettingsPage })),
              },
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
