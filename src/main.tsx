import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { GuestBookingClaimer } from './features/account/GuestBookingClaimer'
import { AuthProvider } from './features/auth/AuthProvider'
import { ThemeSync } from './features/catalog/ThemeSync'
import { VenueProvider } from './features/venue/VenueProvider'
import { queryClient } from './lib/queryClient'
import { router } from './routes/router'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <VenueProvider>
        <ThemeSync />
        <AuthProvider>
          <GuestBookingClaimer />
          <RouterProvider router={router} />
        </AuthProvider>
      </VenueProvider>
    </QueryClientProvider>
  </StrictMode>,
)
