import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { AuthProvider } from '../auth/AuthProvider'
import { ConsoleApp } from './ConsoleApp'

/** The platform console on `app.` hosts: no venue, no public router (T13.7). */
export function mountConsole(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ConsoleApp />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}
