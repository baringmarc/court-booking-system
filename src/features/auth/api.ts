import { unwrap } from '../../lib/queryClient'
import { supabase } from '../../lib/supabase'
import type { Profile } from './AuthContext'

/** Email + password sign-in. Throws the Supabase AuthError (its message is readable). */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

/** The signed-in user's profile (role included). Throws if it can't be loaded. */
export async function fetchProfile(id: string): Promise<Profile | null> {
  return unwrap(await supabase.from('profiles').select('*').eq('id', id).maybeSingle())
}

/** The venues the user is staff or owner of (their own venue_members rows). Admin rights come from these (T12.10). */
export async function fetchAdminVenueIds(userId: string): Promise<string[]> {
  const rows = unwrap(await supabase.from('venue_members').select('venue_id').eq('user_id', userId).order('venue_id'))
  return rows.map((r) => r.venue_id)
}
