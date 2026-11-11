/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** The venue slug for a host with none (previews, local IPs, the Vercel URL until T13.8). */
  readonly VITE_DEFAULT_VENUE?: string
  /** Sentry DSN for the app and console (T16.3); unset means no error reporting. */
  readonly VITE_SENTRY_DSN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
