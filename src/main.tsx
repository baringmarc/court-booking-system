import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { GuestBookingClaimer } from './features/account/GuestBookingClaimer'
import { AuthProvider } from './features/auth/AuthProvider'
import { ThemeSync } from './features/catalog/ThemeSync'
import { VenueProvider } from './features/venue/VenueProvider'
import { VenueTitleSync } from './features/venue/VenueTitleSync'
import { bootMode } from './bootMode'
import { consumeInviteLink } from './lib/inviteLink'
import { queryClient } from './lib/queryClient'
import { supabase } from './lib/supabase'
import { router } from './routes/router'
import './index.css'

const root = document.getElementById('root')!
const isConsole = bootMode(window.location.hostname, window.location.search, window.sessionStorage) === 'console'

// Error reporting is its own chunk, loaded only when a DSN is configured (T16.3).
if (import.meta.env.VITE_SENTRY_DSN?.trim()) {
  void import('./lib/sentry').then((m) => m.initSentry(isConsole ? 'console' : 'app'))
}

if (isConsole) {
  document.title = 'Plotline Admin'
  // The platform console (app. host) is its own lazy chunk: no venue is resolved for it.
  void import('./features/console/mountConsole').then((m) => m.mountConsole(root))
} else {
  // An invited owner arrives with a session in the URL hash: sign them in before anything reads the session (T14.5c).
  void consumeInviteLink(supabase).then(() =>
    createRoot(root).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <VenueProvider>
              <VenueTitleSync />
              <ThemeSync />
              <GuestBookingClaimer />
              <RouterProvider router={router} />
            </VenueProvider>
          </AuthProvider>
        </QueryClientProvider>
      </StrictMode>,
    ),
  )
}
