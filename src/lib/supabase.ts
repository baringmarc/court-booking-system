import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { isInviteCallback } from './inviteLink'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !publishableKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env and fill them in.',
  )
}

export const supabase = createClient<Database>(url, publishableKey, {
  auth: {
    flowType: 'pkce',
    // The client's default (any access_token or error in the URL), minus invite links: those are implicit-flow, which a
    // PKCE client rejects. main.tsx signs the invitee in with `consumeInviteLink` instead (T14.5c).
    detectSessionInUrl: (_url, params) =>
      !isInviteCallback(params) && Boolean(params.access_token || params.error || params.error_description || params.error_code),
    persistSession: true,
    autoRefreshToken: true,
  },
})
