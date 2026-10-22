/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** Optional Maps Embed API browser key (T9.11g); without it the venue map uses the keyless embed. */
  readonly VITE_GOOGLE_MAPS_EMBED_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
