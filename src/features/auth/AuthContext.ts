import { createContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { Tables } from '../../lib/database.types'

export type Profile = Tables<'profiles'>

export type AuthState = {
  session: Session | null
  user: User | null
  profile: Profile | null
  isAdmin: boolean
  /** true until the initial session (and profile, if signed in) has loaded */
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)
