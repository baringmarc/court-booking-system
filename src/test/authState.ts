import type { Session, User } from '@supabase/supabase-js'
import { vi } from 'vitest'
import type { AuthState, Profile } from '../features/auth/AuthContext'

type Who = 'anon' | 'player' | 'admin'

/** A fake AuthContext value for component tests (wrap with <AuthContext.Provider value={…}>). */
export function authState(who: Who, overrides: Partial<AuthState> = {}): AuthState {
  const user = who === 'anon' ? null : ({ id: `${who}-id`, email: `${who}@example.com` } as User)
  const profile: Profile | null = user && {
    id: user.id, full_name: who === 'admin' ? 'Ada Admin' : 'Pat Player', phone: null,
    role: who === 'admin' ? 'admin' : 'player', created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z',
  }
  return {
    session: user ? ({ user } as Session) : null,
    user,
    profile,
    isAdmin: who === 'admin',
    loading: false,
    signOut: vi.fn(async () => {}),
    refreshProfile: vi.fn(async () => {}),
    ...overrides,
  }
}
