// T12.10: admin rights come from venue_members (AuthState.venueIds); profiles.role is gone since T12.11.
import { act, render, screen, waitFor } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAdminVenueIds, fetchProfile } from './api'
import type { Profile } from './AuthContext'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './useAuth'

vi.mock('./api', () => ({ fetchProfile: vi.fn(), fetchAdminVenueIds: vi.fn() }))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u1', email: 'ada@example.com' } } } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  },
}))

const profile: Profile = {
  id: 'u1', full_name: 'Ada', phone: null, created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z',
}

let auth: ReturnType<typeof useAuth> | null = null
function Probe() {
  const value = useAuth()
  useLayoutEffect(() => {
    auth = value
  })
  return <p>{value.loading ? 'loading' : value.profileError ? 'error' : value.isAdmin ? 'admin' : 'not admin'}</p>
}

beforeEach(() => {
  auth = null
  vi.mocked(fetchProfile).mockReset()
  vi.mocked(fetchAdminVenueIds).mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('AuthProvider venue memberships (T12.10)', () => {
  it('a member of a venue is an admin, and venueIds lists the venues', async () => {
    vi.mocked(fetchProfile).mockResolvedValue(profile)
    vi.mocked(fetchAdminVenueIds).mockResolvedValue(['venue-a', 'venue-b'])
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(await screen.findByText('admin')).toBeInTheDocument()
    expect(auth!.venueIds).toEqual(['venue-a', 'venue-b'])
    expect(auth!.isAdmin).toBe(true)
    expect(fetchAdminVenueIds).toHaveBeenCalledWith('u1')
  })

  it('a signed-in user without any membership is not an admin', async () => {
    vi.mocked(fetchProfile).mockResolvedValue(profile)
    vi.mocked(fetchAdminVenueIds).mockResolvedValue([])
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(await screen.findByText('not admin')).toBeInTheDocument()
    expect(auth!.venueIds).toEqual([])
    expect(auth!.isAdmin).toBe(false)
  })

  it('a failed membership load shows the profile error (not "not an admin") and recovers on retry', async () => {
    vi.mocked(fetchProfile).mockResolvedValue(profile)
    vi.mocked(fetchAdminVenueIds).mockRejectedValueOnce(new Error('Failed to fetch')).mockResolvedValueOnce(['venue-a'])
    render(<AuthProvider><Probe /></AuthProvider>)
    expect(await screen.findByText('error')).toBeInTheDocument()
    expect(auth!.isAdmin).toBe(false)
    expect(auth!.loading).toBe(false)
    expect(auth!.profileError?.message).toMatch(/couldn't load your account/i)

    await act(() => auth!.refreshProfile())
    await waitFor(() => expect(screen.getByText('admin')).toBeInTheDocument())
    expect(auth!.profileError).toBeNull()
    expect(auth!.venueIds).toEqual(['venue-a'])
  })

  it('stays loading until both the profile and the memberships have arrived', async () => {
    let release: (ids: string[]) => void = () => {}
    vi.mocked(fetchProfile).mockResolvedValue(profile)
    vi.mocked(fetchAdminVenueIds).mockReturnValue(new Promise<string[]>((resolve) => { release = resolve }))
    render(<AuthProvider><Probe /></AuthProvider>)
    await waitFor(() => expect(fetchAdminVenueIds).toHaveBeenCalled())
    expect(screen.getByText('loading')).toBeInTheDocument()
    await act(async () => release(['venue-a']))
    expect(await screen.findByText('admin')).toBeInTheDocument()
  })
})
