import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { queryClient } from '../../lib/queryClient'
import { AuthProvider } from '../auth/AuthProvider'
import { ConsoleApp } from './ConsoleApp'

/** The platform console on `app.` hosts: no venue, no public router (T13.7). Its own router holds the section and list state (T17.19). */
export function mountConsole(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <ConsoleApp />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}
