// T32.2: the dashboard's "today" comes only from the staff schedule (get_staff_schedule), never from the legacy
// operating_hours table, and the legacy hours helpers and hooks are gone.
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffSchedulePeriod } from '../catalog/api'

type Result = { data: StaffSchedulePeriod[] | undefined; isPending: boolean; isError: boolean; error: Error | null; refetch: () => void }

const state = vi.hoisted(() => ({
  now: new Date('2030-01-07T04:00:00.000Z'),
  byDate: {} as Record<string, unknown>,
  scheduleCalls: [] as string[],
}))
const adminBookings = vi.hoisted(() => vi.fn())

const query = (data: unknown) => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

vi.mock('../catalog/hooks', () => ({
  useVenueSettings: () => query({ timezone: 'Asia/Manila', currency: 'PHP', walk_ins_enabled: false }),
  useCourts: () => query([]),
  useStaffSchedule: (date: string) => {
    state.scheduleCalls.push(date)
    return state.byDate[date] ?? query([])
  },
}))
vi.mock('./hooks', () => ({
  useAdminBookings: (...args: unknown[]) => adminBookings(...args),
  useProofQueueCount: () => query(0),
  useRefundsOwedCount: () => query(0),
}))
vi.mock('../booking/hooks', () => ({ useAvailability: () => query([]) }))
vi.mock('../openPlay/hooks', () => ({ useUpcomingOpenPlay: () => query([]) }))
vi.mock('../booking/useNow', () => ({ useNow: () => state.now }))
vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: 'active' }) }))
vi.mock('./EarningsSection', () => ({ EarningsSection: () => null }))
vi.mock('./DayView', () => ({ DayView: () => null }))
vi.mock('./WalkInSection', () => ({ WalkInSection: () => null }))

const period = (operating_date: string, period_start: string, period_end: string): StaffSchedulePeriod =>
  ({ court_id: 'court-1', operating_date, period_start, period_end })
const ok = (data: StaffSchedulePeriod[]): Result => ({ data, isPending: false, isError: false, error: null, refetch: vi.fn() })

async function renderDashboard() {
  const { DashboardPage } = await import('./DashboardPage')
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}
const dates = () => adminBookings.mock.calls.map((c) => (c[0] as { date: string }).date)

beforeEach(() => {
  adminBookings.mockReset()
  adminBookings.mockImplementation(() => query({ bookings: [] }))
  state.byDate = {}
  state.scheduleCalls = []
})

describe('T32.2 DashboardPage today from the staff schedule', () => {
  it('case A: at 01:00 with yesterday running past midnight, today is yesterday and the next date is also fetched with the timezone', async () => {
    state.now = new Date('2030-01-06T17:00:00.000Z') // 01:00 on 2030-01-07 in Manila
    const overnight = period('2030-01-06', '2030-01-05T22:00:00.000Z', '2030-01-06T18:00:00.000Z') // 06:00 -> 02:00 next day
    state.byDate = { '2030-01-06': ok([overnight]), '2030-01-07': ok([]) }
    await renderDashboard()
    await screen.findByRole('heading', { name: 'Proofs to review' })
    const today = adminBookings.mock.calls.find((c) => (c[0] as { date: string }).date === '2030-01-06')
    expect(today).toBeDefined()
    const next = adminBookings.mock.calls.find((c) => (c[0] as { date: string }).date === '2030-01-07' && c[1] === 'Asia/Manila')
    expect(next).toBeDefined()
    expect(state.scheduleCalls).toContain('2030-01-06')
    expect(state.scheduleCalls).toContain('2030-01-07')
  })

  it('case B: at 01:00 with yesterday ended earlier (or no periods), today is the local date', async () => {
    state.now = new Date('2030-01-06T17:00:00.000Z')
    const ended = period('2030-01-06', '2030-01-06T00:00:00.000Z', '2030-01-06T14:00:00.000Z') // 08:00 -> 22:00 Manila
    state.byDate = { '2030-01-06': ok([ended]), '2030-01-07': ok([period('2030-01-07', '2030-01-06T22:00:00.000Z', '2030-01-07T14:00:00.000Z')]) }
    await renderDashboard()
    await screen.findByRole('heading', { name: 'Proofs to review' })
    expect(new Set(dates())).toEqual(new Set(['2030-01-07', '2030-01-08']))
    // no schedule at all yesterday: same answer
    adminBookings.mockClear()
    state.byDate = { '2030-01-06': ok([]), '2030-01-07': ok([]) }
    await renderDashboard()
    await waitFor(() => expect(adminBookings).toHaveBeenCalled())
    expect(dates()).not.toContain('2030-01-06')
    expect(dates()).toContain('2030-01-07')
  })

  it('case C: mid-day, today is the local date and the next date is not fetched with a timezone', async () => {
    state.now = new Date('2030-01-07T04:00:00.000Z') // 12:00 Manila
    state.byDate = {
      '2030-01-06': ok([]),
      '2030-01-07': ok([period('2030-01-07', '2030-01-06T22:00:00.000Z', '2030-01-07T14:00:00.000Z')]), // 06:00 -> 22:00
    }
    await renderDashboard()
    await screen.findByRole('heading', { name: 'Proofs to review' })
    const todayCall = adminBookings.mock.calls.find((c) => (c[0] as { date: string }).date === '2030-01-07')
    expect(todayCall?.[1]).toBe('Asia/Manila')
    const nextCall = adminBookings.mock.calls.find((c) => (c[0] as { date: string }).date === '2030-01-08')
    expect(nextCall).toBeDefined()
    expect(nextCall?.[1]).toBeUndefined()
    expect(dates()).not.toContain('2030-01-06')
  })

  it('shows the loader while the schedule is pending and never needs the legacy hours hook', async () => {
    state.now = new Date('2030-01-07T04:00:00.000Z')
    state.byDate = { '2030-01-06': { data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() } }
    await renderDashboard()
    await screen.findByRole('heading', { name: 'Proofs to review' })
    expect((await screen.findAllByText('Loading…')).length).toBeGreaterThan(0)
    expect(screen.queryByText('0')).not.toBeInTheDocument() // no "0 bookings today" while the schedule is unknown
  })

  it('shows an error with a retry that refetches the schedule when it fails', async () => {
    state.now = new Date('2030-01-07T04:00:00.000Z')
    const refetch = vi.fn()
    state.byDate = { '2030-01-06': { data: undefined, isPending: false, isError: true, error: new Error('schedule boom'), refetch } }
    await renderDashboard()
    await screen.findByRole('heading', { name: 'Proofs to review' })
    const retry = (await screen.findAllByRole('button', { name: 'Try again' }))[0]
    fireEvent.click(retry)
    expect(refetch).toHaveBeenCalled()
  })
})

describe('T32.2 legacy operating hours removed', () => {
  it('catalog/hours no longer exports operatingToday, operatingDayRange or summarizeHours', async () => {
    const mod = (await vi.importActual('../catalog/hours')) as Record<string, unknown>
    expect(mod).not.toHaveProperty('operatingToday')
    expect(mod).not.toHaveProperty('operatingDayRange')
    expect(mod).not.toHaveProperty('summarizeHours')
  })

  it('catalog/hooks no longer exports useOperatingHours or useSaveOperatingHours', async () => {
    const mod = (await vi.importActual('../catalog/hooks')) as Record<string, unknown>
    expect(mod).not.toHaveProperty('useOperatingHours')
    expect(mod).not.toHaveProperty('useSaveOperatingHours')
  })
})
