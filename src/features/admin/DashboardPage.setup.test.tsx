// T14.7: the dashboard shows the setup checklist for a draft venue only.
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  status: 'draft' as string,
  courts: [] as unknown[],
  availability: vi.fn<(date: string, options?: { enabled?: boolean }) => unknown>(),
}))
const query = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: h.status }) }))
vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => query({ timezone: 'Asia/Manila', currency: 'PHP' }),
  useCourts: () => query(h.courts),
  useStaffSchedule: () => query([]),
}))
vi.mock('./hooks', () => ({
  useAdminBookings: () => query({ bookings: [] }),
  useProofQueueCount: () => query(0),
  useRefundsOwedCount: () => query(0),
  useSetupStatus: () => query({ items: [], ready: false }),
  usePublishVenue: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null }),
}))
vi.mock('../booking/hooks', () => ({ useAvailability: (date: string, options?: { enabled?: boolean }) => h.availability(date, options) }))
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
  beforeEach(() => {
    h.status = 'draft'
    h.courts = []
    h.availability.mockReset()
    h.availability.mockImplementation(() => query([]))
  })

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

// T35.1: a draft venue can't be read through the public availability RPC, so the card explains instead of failing.
const DRAFT_NOTE = 'Players can book once you publish your venue. Your courts and their free times show here then.'
const court = { id: 'court-1', name: 'Court 1', sport: 'tennis', venue_id: 'venue-a' }
const todaysCourts = () => screen.getByRole('heading', { name: "Today's courts" }).closest('section')!

describe("DashboardPage Today's courts on a draft venue (T35.1)", () => {
  beforeEach(() => {
    h.status = 'draft'
    h.courts = [court]
    h.availability.mockReset()
    h.availability.mockImplementation(() => query([]))
  })

  it('draft with a court: shows the publish note, no error, no Try again, no Post open slots', async () => {
    await renderDashboard()
    const card = within(todaysCourts())
    expect(card.getByText(DRAFT_NOTE)).toBeInTheDocument()
    expect(card.queryByText('This venue is not taking bookings right now.')).not.toBeInTheDocument()
    expect(card.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Post open slots' })).not.toBeInTheDocument()
  })

  it('draft with a court: availability is not fetched (enabled false)', async () => {
    await renderDashboard()
    expect(h.availability).toHaveBeenCalled()
    for (const call of h.availability.mock.calls) expect(call[1]).toEqual({ enabled: false })
  })

  it('draft: even when the availability query errors, the note shows and the error does not', async () => {
    h.availability.mockImplementation(() => ({ data: undefined, isPending: false, isError: true, error: new Error('This venue is not taking bookings right now.'), refetch: vi.fn() }))
    await renderDashboard()
    const card = within(todaysCourts())
    expect(card.getByText(DRAFT_NOTE)).toBeInTheDocument()
    expect(card.queryByText('This venue is not taking bookings right now.')).not.toBeInTheDocument()
    expect(card.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('draft: a disabled (pending) availability query still shows the note', async () => {
    h.availability.mockImplementation(() => ({ data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() }))
    await renderDashboard()
    expect(within(todaysCourts()).getByText(DRAFT_NOTE)).toBeInTheDocument()
  })

  it('draft with no courts keeps No courts yet and Add court, without the note', async () => {
    h.courts = []
    await renderDashboard()
    const card = within(todaysCourts())
    expect(card.getByText('No courts yet.')).toBeInTheDocument()
    expect(card.getByRole('link', { name: 'Add court' })).toBeInTheDocument()
    expect(card.queryByText(DRAFT_NOTE)).not.toBeInTheDocument()
  })

  it('active with a court: availability is fetched and the note is absent', async () => {
    h.status = 'active'
    await renderDashboard()
    expect(within(todaysCourts()).queryByText(DRAFT_NOTE)).not.toBeInTheDocument()
    expect(h.availability).toHaveBeenCalled()
    for (const call of h.availability.mock.calls) expect(call[1]?.enabled ?? true).toBe(true)
  })
})
