/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** 'true' shows walk-in bookings on the admin dashboard (T11.2); off otherwise. */
  readonly VITE_FEATURE_WALK_INS?: string
  /** The venue slug for a host with none (previews, local IPs, the Vercel URL until T13.8). */
  readonly VITE_DEFAULT_VENUE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
