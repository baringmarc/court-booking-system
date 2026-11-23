// T31.1b: the "Post open slots" button sits in the dashboard's Today's courts card header and opens the dialog.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  courts: [] as unknown[],
  periods: [] as unknown[],
  availabilityPending: false,
  dialogProps: [] as { today: string; courts: unknown[] }[],
}))
const query = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: 'active' }) }))
vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => query({ timezone: 'Asia/Manila', currency: 'PHP' }),
  useCourts: () => query(h.courts),
  useStaffSchedule: (date: string) => query(date === '2030-01-07' ? h.periods : []),
}))
vi.mock('./hooks', () => ({
  useAdminBookings: () => query({ bookings: [] }),
  useProofQueueCount: () => query(0),
  useRefundsOwedCount: () => query(0),
}))
vi.mock('../booking/hooks', () => ({
  useAvailability: () => (h.availabilityPending
    ? { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() }
    : query([])),
}))
vi.mock('../openPlay/hooks', () => ({ useUpcomingOpenPlay: () => query([]) }))
vi.mock('../booking/useNow', () => ({ useNow: () => new Date('2030-01-07T02:30:00.000Z') }))
vi.mock('./EarningsSection', () => ({ EarningsSection: () => null }))
vi.mock('./DayView', () => ({ DayView: () => <p>day view</p> }))
vi.mock('./PostOpenSlotsDialog', () => ({
  PostOpenSlotsDialog: (props: { today: string; courts: unknown[]; onClose: () => void }) => {
    h.dialogProps.push({ today: props.today, courts: props.courts })
    return (
      <div role="dialog" aria-label="Post your open courts">
        <button type="button" onClick={props.onClose}>stub close</button>
      </div>
    )
  },
}))

const at = (hour: number) => new Date(Date.UTC(2030, 0, 7, hour - 8)).toISOString()
const court = { id: 'c1', name: 'Court A', sport: 'tennis', is_active: true }
const dayPeriod = { court_id: 'c1', operating_date: '2030-01-07', period_start: at(6), period_end: at(22) }

async function renderDashboard() {
  const { DashboardPage } = await import('./DashboardPage')
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Proofs to review' })
}

describe('DashboardPage post open slots (T31.1b)', () => {
  beforeEach(() => {
    h.courts = [court]
    h.periods = [dayPeriod]
    h.availabilityPending = false
    h.dialogProps = []
  })

  it("the Post open slots button is in the Today's courts card header", async () => {
    await renderDashboard()
    const card = screen.getByRole('heading', { name: "Today's courts" }).closest('section')!
    expect(within(card).getByRole('button', { name: 'Post open slots' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Slots image' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Download image' })).not.toBeInTheDocument()
  })

  it('clicking it opens the dialog with today and the courts, and onClose removes it', async () => {
    await renderDashboard()
    expect(screen.queryByRole('dialog', { name: 'Post your open courts' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Post open slots' }))
    expect(screen.getByRole('dialog', { name: 'Post your open courts' })).toBeInTheDocument()
    expect(h.dialogProps.at(-1)!.today).toBe('2030-01-07')
    expect(h.dialogProps.at(-1)!.courts).toEqual([court])
    await userEvent.click(screen.getByRole('button', { name: 'stub close' }))
    expect(screen.queryByRole('dialog', { name: 'Post your open courts' })).not.toBeInTheDocument()
  })

  it('has no button when there are no courts', async () => {
    h.courts = []
    await renderDashboard()
    expect(screen.queryByRole('button', { name: 'Post open slots' })).not.toBeInTheDocument()
  })

  it('has no button while availability is still loading', async () => {
    h.availabilityPending = true
    await renderDashboard()
    expect(screen.queryByRole('button', { name: 'Post open slots' })).not.toBeInTheDocument()
  })
})
