// T18.4: the walk-in card shows only when the venue's walk_ins_enabled setting is true (no build flag).
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }))
const query = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => query({ timezone: 'Asia/Manila', currency: 'PHP', ...settings.value }),
  useCourts: () => query([]),
  useOperatingHours: () => query([]),
  useStaffSchedule: () => query([]),
}))
vi.mock('./hooks', () => ({
  useAdminBookings: () => query({ bookings: [] }),
  useProofQueueCount: () => query(0),
}))
vi.mock('../booking/hooks', () => ({ useAvailability: () => query([]) }))
vi.mock('../openPlay/hooks', () => ({ useUpcomingOpenPlay: () => query([]) }))
vi.mock('../booking/useNow', () => ({ useNow: () => new Date('2030-01-07T02:30:00.000Z') }))
vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: 'active' }) }))
vi.mock('./EarningsSection', () => ({ EarningsSection: () => null }))
vi.mock('./DayView', () => ({ DayView: () => null }))
vi.mock('./WalkInSection', () => ({ WalkInSection: () => <button type="button">+ Walk-in</button> }))

async function renderDashboard(value: Record<string, unknown>, oldEnv = '') {
  vi.resetModules()
  vi.stubEnv('VITE_FEATURE_WALK_INS', oldEnv)
  settings.value = value
  const { DashboardPage } = await import('./DashboardPage')
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

describe('T18.4 DashboardPage walk-ins setting', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('has no walk-in action when walk_ins_enabled is false', async () => {
    await renderDashboard({ walk_ins_enabled: false })
    expect(await screen.findByRole('heading', { name: 'Proofs to review' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument()) // a lazy chunk would have resolved
    expect(screen.queryByRole('button', { name: '+ Walk-in' })).not.toBeInTheDocument()
  })

  it('shows the walk-in action when walk_ins_enabled is true', async () => {
    await renderDashboard({ walk_ins_enabled: true })
    expect(await screen.findByRole('button', { name: '+ Walk-in' })).toBeInTheDocument()
  })

  it('does not show the action just because the old env var is true', async () => {
    await renderDashboard({ walk_ins_enabled: false }, 'true')
    expect(await screen.findByRole('heading', { name: 'Proofs to review' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument()) // a lazy chunk would have resolved
    expect(screen.queryByRole('button', { name: '+ Walk-in' })).not.toBeInTheDocument()
  })
})
