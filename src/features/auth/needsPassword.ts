import type { User } from '@supabase/supabase-js'

/** An invited email user who hasn't chosen a password yet (T14.5b). Google-only accounts never need one. */
export function needsPassword(user: User | null): boolean {
  if (!user?.invited_at) return false
  if (user.user_metadata?.password_set === true) return false
  const providers = user.identities?.map((i) => i.provider) ?? (user.app_metadata?.providers as string[] | undefined) ?? []
  return providers.includes('email')
}
