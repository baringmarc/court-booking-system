// T11.2: the walk-in card only exists when the build sets VITE_FEATURE_WALK_INS=true.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

const query = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => query({ timezone: 'Asia/Manila', currency: 'PHP' }),
  useCourts: () => query([]),
  useOperatingHours: () => query([]),
}))
vi.mock('./hooks', () => ({
  useAdminBookings: () => query({ bookings: [] }),
  useProofQueueCount: () => query(0),
}))
vi.mock('../booking/hooks', () => ({ useAvailability: () => query([]) }))
vi.mock('../openPlay/hooks', () => ({ useUpcomingOpenPlay: () => query([]) }))
vi.mock('../booking/useNow', () => ({ useNow: () => new Date('2030-01-07T02:30:00.000Z') }))
vi.mock('./EarningsSection', () => ({ EarningsSection: () => null }))
vi.mock('./DayView', () => ({ DayView: () => null }))
vi.mock('./WalkInSection', () => ({ WalkInSection: () => <button type="button">+ Walk-in</button> }))

async function renderDashboard(walkInsEnabled: boolean) {
  vi.resetModules()
  vi.stubEnv('VITE_FEATURE_WALK_INS', walkInsEnabled ? 'true' : '')
  const { DashboardPage } = await import('./DashboardPage')
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

describe('DashboardPage walk-in flag', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('has no walk-in action when the flag is off', async () => {
    await renderDashboard(false)
    expect(await screen.findByRole('heading', { name: 'Proofs to review' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Walk-in' })).not.toBeInTheDocument()
  })

  it('shows the walk-in action when the flag is on', async () => {
    await renderDashboard(true)
    expect(await screen.findByRole('button', { name: '+ Walk-in' })).toBeInTheDocument()
  })
})
