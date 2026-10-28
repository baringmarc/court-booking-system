/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** 'true' shows walk-in bookings on the admin dashboard (T11.2); off otherwise. */
  readonly VITE_FEATURE_WALK_INS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
