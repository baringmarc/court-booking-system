import { act, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchProfile } from './api'
import type { Profile } from './AuthContext'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

vi.mock('./api', () => ({ fetchProfile: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1', email: 'ada@example.com' } } } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  },
}))

const admin: Profile = {
  id: 'u1', full_name: 'Ada Admin', phone: null, role: 'admin', created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z',
}

let auth: ReturnType<typeof useAuth> | null = null
const capture = (value: ReturnType<typeof useAuth>) => {
  auth = value
}
function Probe() {
  const value = useAuth()
  // Layout effect: it runs in the same commit as the DOM update, so when findByText sees the new text, `auth` is
  // already the matching value (a passive effect could still be pending under load, which made this test flaky).
  useLayoutEffect(() => capture(value))
  return <p>{value.loading ? 'loading' : value.profileError ? 'error' : value.isAdmin ? 'admin' : 'not admin'}</p>
}

beforeEach(() => {
  auth = null
  vi.mocked(fetchProfile).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('AuthProvider profile loading', () => {
  it('reports a failed profile load as an error, not as "not an admin", and recovers on retry', async () => {
    vi.mocked(fetchProfile).mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce(admin)
    render(<AuthProvider><Probe /></AuthProvider>)

    expect(await screen.findByText('error')).toBeInTheDocument()
    expect(auth!.isAdmin).toBe(false)
    expect(auth!.loading).toBe(false)
    expect(auth!.profileError?.message).toMatch(/couldn't load your account/i)

    await act(() => auth!.refreshProfile())
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument())
    expect(auth!.profileError).toBeNull()
    expect(auth!.profile?.role).toBe('admin')
  })

  it('loads the role normally', async () => {
    vi.mocked(fetchProfile).mockResolvedValue({ ...admin, role: 'player' })
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(await screen.findByText('not admin')).toBeInTheDocument()
    expect(auth!.profileError).toBeNull()
  })
})
