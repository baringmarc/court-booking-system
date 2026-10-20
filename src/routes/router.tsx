import { createBrowserRouter } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { PageLoader } from '../components/PageLoader'
import { MyBookingsPage } from '../features/account/MyBookingsPage'
import { LoginPage } from '../features/auth/LoginPage'
import { SignupPage } from '../features/auth/SignupPage'
import { RedirectIfAuthed, RequireAuth } from '../features/auth/RouteGuards'
import { BookPage } from '../features/booking/BookPage'
import { BookingPage } from '../features/booking/BookingPage'
import { CheckoutPage } from '../features/booking/CheckoutPage'
import { HomePage } from './HomePage'
import { NotFoundPage } from './NotFoundPage'

// Routes follow SPEC.md §7.
// Admin pages are lazy-loaded so players never download them.
export const router = createBrowserRouter([
  // Dev-only palette preview (T9.1). import.meta.env.DEV is false in builds, so the import is dropped there.
  ...(import.meta.env.DEV
    ? [{
        path: '/dev/palettes',
        lazy: () => import('../dev/PalettePreview').then((m) => ({ Component: m.PalettePreview })),
      }]
    : []),
  {
    element: <Layout />,
    hydrateFallbackElement: <PageLoader />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/book', element: <BookPage /> },
      { path: '/book/checkout', element: <CheckoutPage /> },
      { path: '/booking/:ref', element: <BookingPage /> },
      { path: '/login', element: <RedirectIfAuthed><LoginPage /></RedirectIfAuthed> },
      { path: '/signup', element: <RedirectIfAuthed><SignupPage /></RedirectIfAuthed> },
      { path: '/me/bookings', element: <RequireAuth><MyBookingsPage /></RequireAuth> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  {
    // The admin area has its own shell (SPEC §7), outside the public Layout.
    path: '/admin',
    hydrateFallbackElement: <PageLoader />,
    lazy: () => import('../features/admin/AdminLayout').then((m) => ({ Component: m.AdminLayout })),
    children: [
      {
        path: 'login',
        lazy: () => import('../features/admin/AdminLoginPage').then((m) => ({ Component: m.AdminLoginPage })),
      },
      {
        lazy: () => import('../features/admin/AdminGuard').then((m) => ({ Component: m.AdminGuard })),
        children: [
          {
            index: true,
            lazy: () => import('../features/admin/DashboardPage').then((m) => ({ Component: m.DashboardPage })),
          },
          {
            path: 'bookings',
            lazy: () => import('../features/admin/AdminBookingsPage').then((m) => ({ Component: m.AdminBookingsPage })),
          },
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
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
