import { init, setTag } from '@sentry/react'
import { scrubEvent } from './sentryScrub.ts'

/**
 * Error reporting for the player app and the console (T16.3). Off unless VITE_SENTRY_DSN is set,
 * so local runs, tests and previews send nothing. Every event goes through scrubEvent first.
 */
export function initSentry(surface: 'app' | 'console', env: { VITE_SENTRY_DSN?: string } = import.meta.env): boolean {
  const dsn = env.VITE_SENTRY_DSN?.trim()
  if (!dsn) return false
  init({ dsn, sendDefaultPii: false, beforeSend: (event) => scrubEvent(event) })
  setTag('surface', surface)
  return true
}
