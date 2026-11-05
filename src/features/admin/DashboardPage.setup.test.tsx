// T14.7: the dashboard shows the setup checklist for a draft venue only.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ status: 'draft' as string }))
const query = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: h.status }) }))
vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => query({ timezone: 'Asia/Manila', currency: 'PHP' }),
  useCourts: () => query([]),
  useOperatingHours: () => query([]),
  useStaffSchedule: () => query([]),
}))
vi.mock('./hooks', () => ({
  useAdminBookings: () => query({ bookings: [] }),
  useProofQueueCount: () => query(0),
  useSetupStatus: () => query({ items: [], ready: false }),
  usePublishVenue: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
}))
vi.mock('../booking/hooks', () => ({ useAvailability: () => query([]) }))
vi.mock('../openPlay/hooks', () => ({ useUpcomingOpenPlay: () => query([]) }))
vi.mock('../booking/useNow', () => ({ useNow: () => new Date('2030-01-07T02:30:00.000Z') }))
vi.mock('./EarningsSection', () => ({ EarningsSection: () => null }))
vi.mock('./DayView', () => ({ DayView: () => null }))
vi.mock('./SetupChecklist', () => ({ SetupChecklist: () => <h2>Set up your venue</h2> }))

async function renderDashboard() {
  const { DashboardPage } = await import('./DashboardPage')
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Proofs to review' })
}

describe('DashboardPage setup checklist', () => {
  beforeEach(() => { h.status = 'draft' })

  it('shows the checklist for a draft venue', async () => {
    await renderDashboard()
    expect(screen.getByRole('heading', { name: 'Set up your venue' })).toBeInTheDocument()
  })

  it('does not show the checklist for an active venue', async () => {
    h.status = 'active'
    await renderDashboard()
    expect(screen.queryByRole('heading', { name: 'Set up your venue' })).not.toBeInTheDocument()
  })

  it('does not show the checklist for a suspended venue', async () => {
    h.status = 'suspended'
    await renderDashboard()
    expect(screen.queryByRole('heading', { name: 'Set up your venue' })).not.toBeInTheDocument()
  })
})
