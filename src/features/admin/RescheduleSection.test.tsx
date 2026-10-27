import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { addDays, todayInZone, zonedLocalToISO } from '../../lib/time'
import { fetchAvailability } from '../booking/api'
import type { Slot } from '../booking/selection'
import { fetchCourts, fetchOperatingHours, fetchVenueSettings, type OperatingHours, type VenueSettings } from '../catalog/api'
import { rescheduleBooking, type AdminBooking } from './api'
import { RescheduleSection } from './RescheduleSection'

vi.mock('../booking/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchAvailability: vi.fn() }))
vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()), fetchCourts: vi.fn(), fetchOperatingHours: vi.fn(), fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), rescheduleBooking: vi.fn() }))

const TZ = 'Asia/Manila'
// The section reads the real clock, so everything is placed relative to it: the booking is tomorrow afternoon.
const manila = (date: string, hour: number) => zonedLocalToISO(`${date}T${String(hour).padStart(2, '0')}:00`, TZ)
const TOMORROW = addDays(todayInZone(TZ), 1)

const venue = { timezone: TZ, currency: 'PHP', booking_window_days: 14 } as VenueSettings
const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '06:00:00', close_time: '22:00:00', is_closed: false })) as OperatingHours[]
const courts = [
  { id: 'A', name: 'Badminton 1', sport: 'badminton', is_active: true, court_photos: [] },
  { id: 'B', name: 'Badminton 2', sport: 'badminton', is_active: true, court_photos: [] },
]
const slots = (date: string): Slot[] =>
  courts.flatMap((c) => Array.from({ length: 12 }, (_, i) => ({
    court_id: c.id, slot_start: manila(date, 8 + i), slot_end: manila(date, 9 + i), price: 300, status: 'free' as const,
    booker_first_name: null, open_play_session_id: null, block_key: null,
  })))

const booking = (overrides: Partial<AdminBooking> = {}): AdminBooking => ({
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'A', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: manila(TOMORROW, 14), slot_end: manila(TOMORROW, 16), status: 'confirmed', source: 'online', total_amount: 900,
  expires_at: null, rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com', guest_phone: null,
  created_at: '2030-01-01T00:00:00.000Z', payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false,
  parent_booking_id: null, ...overrides,
})

function renderSection(b: AdminBooking, onMoved = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><RescheduleSection booking={b} onMoved={onMoved} /></QueryClientProvider>)
  return onMoved
}

beforeEach(() => {
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue(venue)
  vi.mocked(fetchCourts).mockReset().mockResolvedValue(courts as never)
  vi.mocked(fetchOperatingHours).mockReset().mockResolvedValue(hours)
  vi.mocked(fetchAvailability).mockReset().mockImplementation(async (d) => slots(d))
  vi.mocked(rescheduleBooking).mockReset()
})

describe('RescheduleSection', () => {
  it('only offers Reschedule for a confirmed booking that has not ended', () => {
    renderSection(booking({ status: 'payment_submitted' }))
    expect(screen.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument()
  })

  it('offers nothing for a booking that already ended', () => {
    renderSection(booking({ slot_start: manila('2020-01-01', 10), slot_end: manila('2020-01-01', 12) }))
    expect(screen.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument()
  })

  it('opens the form, saves the move and reports it', async () => {
    vi.mocked(rescheduleBooking).mockResolvedValue({ continuationReference: null })
    const onMoved = renderSection(booking())
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    const form = await screen.findByRole('form', { name: 'Reschedule booking' })
    await userEvent.click(within(form).getByRole('button', { name: 'Tomorrow' }))
    await userEvent.selectOptions(await within(form).findByLabelText('New court'), 'B')
    await userEvent.click(await within(form).findByRole('radio', { name: '9 AM' }))
    await userEvent.type(within(form).getByLabelText('Reason for moving'), 'Rain')
    await userEvent.click(within(form).getByRole('button', { name: 'Move booking' }))

    expect(rescheduleBooking).toHaveBeenCalledWith({
      bookingId: 'b1', fromStart: manila(TOMORROW, 14), courtId: 'B', start: manila(TOMORROW, 9), reason: 'Rain',
    })
    await vi.waitFor(() => expect(onMoved).toHaveBeenCalledOnce())
    expect(onMoved.mock.calls[0][0]).toMatch(/^CB-7KQ2XD moved to Badminton 2, .*9 AM–11 AM\.$/)
    // The form closes after a save.
    expect(screen.queryByRole('form', { name: 'Reschedule booking' })).not.toBeInTheDocument()
  })

  it('still reports the move when the booking leaves the list and this panel unmounts first', async () => {
    let finish: (value: { continuationReference: string | null }) => void = () => {}
    vi.mocked(rescheduleBooking).mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const onMoved = vi.fn()
    const { unmount } = render(<QueryClientProvider client={client}><RescheduleSection booking={booking()} onMoved={onMoved} /></QueryClientProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    const form = await screen.findByRole('form', { name: 'Reschedule booking' })
    await userEvent.click(within(form).getByRole('button', { name: 'Tomorrow' }))
    await userEvent.click(await within(form).findByRole('radio', { name: '9 AM' }))
    await userEvent.type(within(form).getByLabelText('Reason for moving'), 'Rain')
    await userEvent.click(within(form).getByRole('button', { name: 'Move booking' }))
    unmount() // the list refetched without the booking, so the panel is gone
    finish({ continuationReference: null })
    await vi.waitFor(() => expect(onMoved).toHaveBeenCalledOnce())
  })

  it('names the moved hours after a split', async () => {
    vi.mocked(rescheduleBooking).mockResolvedValue({ continuationReference: 'CB-MOVEDA' })
    const onMoved = renderSection(booking())
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    const form = await screen.findByRole('form', { name: 'Reschedule booking' })
    await userEvent.click(within(form).getByRole('button', { name: 'Tomorrow' }))
    await userEvent.click(await within(form).findByRole('radio', { name: '9 AM' }))
    await userEvent.type(within(form).getByLabelText('Reason for moving'), 'Rain')
    await userEvent.click(within(form).getByRole('button', { name: 'Move booking' }))
    await vi.waitFor(() => expect(onMoved).toHaveBeenCalledOnce())
    expect(onMoved.mock.calls[0][0]).toContain('The moved hours are CB-MOVEDA.')
  })

  it("keeps the form open and shows the server's reason when the move is refused", async () => {
    vi.mocked(rescheduleBooking).mockRejectedValue(new ApiError('That court is already booked for part of this time.', 'P0001', 'slot_unavailable'))
    const onMoved = renderSection(booking())
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    const form = await screen.findByRole('form', { name: 'Reschedule booking' })
    await userEvent.click(within(form).getByRole('button', { name: 'Tomorrow' }))
    await userEvent.click(await within(form).findByRole('radio', { name: '9 AM' }))
    await userEvent.type(within(form).getByLabelText('Reason for moving'), 'Rain')
    await userEvent.click(within(form).getByRole('button', { name: 'Move booking' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('That court is already booked for part of this time.')
    expect(onMoved).not.toHaveBeenCalled()
    // Closing clears the error for next time.
    await userEvent.click(within(form).getByRole('button', { name: 'Close' }))
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    expect(within(await screen.findByRole('form', { name: 'Reschedule booking' })).queryByText(/already booked/)).not.toBeInTheDocument()
  })

  it('shows an error if the courts cannot be loaded', async () => {
    vi.mocked(fetchCourts).mockRejectedValue(new Error('Failed to fetch'))
    renderSection(booking())
    await userEvent.click(screen.getByRole('button', { name: 'Reschedule' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/reach the server/i)
  })
})
