import { supabase } from '../../lib/supabase'

/** Email + password sign-in. Throws the Supabase AuthError (its message is readable). */
export async function signInWithPassword(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}
