import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { zonedLocalToISO } from '../../lib/time'
import { fetchAvailability } from '../booking/api'
import type { Slot, SlotStatus } from '../booking/selection'
import type { Court, OperatingHours } from '../catalog/api'
import type { AdminBooking } from './api'
import { RescheduleForm } from './RescheduleForm'

vi.mock('../booking/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchAvailability: vi.fn() }))

const TZ = 'Asia/Manila'
const manila = (date: string, hour: number) => zonedLocalToISO(`${date}T${String(hour).padStart(2, '0')}:00`, TZ)
// Friday 2030-01-04, 10:30 AM in Manila.
const NOW = new Date(manila('2030-01-04', 10).replace(/:00:00/, ':30:00'))
const FRIDAY = '2030-01-04'

const court = (id: string, name: string, sport = 'badminton', is_active = true) => ({ id, name, sport, is_active }) as unknown as Court
const courts = [court('A', 'Badminton 1'), court('B', 'Badminton 2'), court('X', 'Badminton 3', 'badminton', false), court('T', 'Tennis 1', 'tennis')]
const hours = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '06:00:00', close_time: '22:00:00', is_closed: false })) as OperatingHours[]
const settings = { timezone: TZ, booking_window_days: 14 }

function booking(startHour: number, endHour: number, date = FRIDAY): AdminBooking {
  return {
    id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'A', court_name: 'Badminton 1', sport: 'badminton',
    slot_start: manila(date, startHour), slot_end: manila(date, endHour), status: 'confirmed', source: 'online',
    total_amount: 900, expires_at: null, rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com',
    guest_phone: null, created_at: '2030-01-01T00:00:00.000Z', payments: [], cancelled_at: null, cancel_reason: null,
    cancelled_by_venue: false, parent_booking_id: null,
  }
}

/** 8 AM–8 PM slots for each court on `date`; `taken` marks `courtId:hour` pairs as booked. Started slots are 'past' as on the server. */
function daySlots(date: string, taken: string[] = []): Slot[] {
  const slots: Slot[] = []
  for (const courtId of ['A', 'B', 'T']) {
    for (let h = 8; h < 20; h++) {
      const start = manila(date, h)
      const status: SlotStatus = taken.includes(`${courtId}:${h}`) ? 'booked'
        : Date.parse(start) <= NOW.getTime() ? 'past' : 'free'
      slots.push({ court_id: courtId, slot_start: start, slot_end: manila(date, h + 1), price: 300, status,
        booker_first_name: null, open_play_session_id: null, block_key: null })
    }
  }
  return slots
}

function renderForm(b: AdminBooking, props: Partial<React.ComponentProps<typeof RescheduleForm>> = {}) {
  const onSubmit = vi.fn()
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const ui = (extra: Partial<React.ComponentProps<typeof RescheduleForm>> = {}) => (
    <QueryClientProvider client={client}>
      <RescheduleForm booking={b} courts={courts} hours={hours} settings={settings} now={NOW} pending={false} error={null}
        onSubmit={onSubmit} onClose={onClose} {...props} {...extra} />
    </QueryClientProvider>
  )
  const { rerender } = render(ui())
  return { onSubmit, onClose, form: screen.getByRole('form', { name: 'Reschedule booking' }), rerenderAt: (now: Date) => rerender(ui({ now })) }
}

beforeEach(() => {
  vi.mocked(fetchAvailability).mockReset().mockImplementation(async (date) => daySlots(date))
})

describe('RescheduleForm', () => {
  it('moves a booking that has not started, to a same-sport court only', async () => {
    const { form, onSubmit } = renderForm(booking(14, 16))
    // Not started: no "Move from" choice, the whole booking moves.
    expect(within(form).queryByRole('group', { name: 'Move from' })).not.toBeInTheDocument()
    expect(form).toHaveTextContent('Moving 2 hours: Fri, Jan 4, 2 PM–4 PM.')
    // Active courts of the booking's sport only.
    const options = within(within(form).getByLabelText('New court')).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Badminton 1', 'Badminton 2'])

    await userEvent.selectOptions(within(form).getByLabelText('New court'), 'B')
    await userEvent.click(await within(form).findByRole('radio', { name: '5 PM' }))
    await userEvent.type(within(form).getByLabelText('Reason for moving'), '  Rain  ')
    const summary = within(form).getByLabelText('Summary')
    expect(summary).toHaveTextContent('Badminton 1, Fri, Jan 4, 2 PM–4 PM')
    expect(summary).toHaveTextContent('Badminton 2, Fri, Jan 4, 5 PM–7 PM')
    await userEvent.click(within(form).getByRole('button', { name: 'Move booking' }))
    expect(onSubmit).toHaveBeenCalledWith({ fromStart: manila(FRIDAY, 14), courtId: 'B', start: manila(FRIDAY, 17), reason: 'Rain' })
  })

  it('offers only starts with enough free hours in a row', async () => {
    vi.mocked(fetchAvailability).mockImplementation(async (date) => daySlots(date, ['B:15', 'B:18']))
    const { form } = renderForm(booking(14, 16))
    await userEvent.selectOptions(within(form).getByLabelText('New court'), 'B')
    const group = await within(form).findByRole('group', { name: 'New start' })
    // 2 hours in a row; 3 PM and 6 PM are booked on Badminton 2, so 2 PM, 5 PM and 7 PM can't start one. The hour in
    // progress (10 AM) counts as free for staff.
    const labels = within(group).getAllByRole('radio').map((r) => r.closest('label')?.textContent)
    expect(labels).toEqual(['10 AM (now)', '11 AM', '12 PM', '1 PM', '4 PM'])
  })

  it('offers the hour in progress and later hours to move from once the booking has started', async () => {
    // Started at 10 AM (it's 10:30): a 3-hour booking.
    const { form } = renderForm(booking(10, 13))
    const from = within(form).getByRole('group', { name: 'Move from' })
    expect(within(from).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['10 AM', '11 AM', '12 PM'])
    expect(within(from).getByRole('radio', { name: '10 AM' })).toBeChecked()
    // From its first hour: a whole move.
    expect(form).toHaveTextContent('Moving 3 hours: Fri, Jan 4, 10 AM–1 PM.')
    expect(form).not.toHaveTextContent('become a booking of their own')

    await userEvent.click(within(from).getByRole('radio', { name: '11 AM' }))
    expect(form).toHaveTextContent('Moving 2 hours: Fri, Jan 4, 11 AM–1 PM.')
    expect(form).toHaveTextContent('The earlier hours stay where they are, and the moved hours become a booking of their own.')
  })

  it('falls back to the first hour on offer when the chosen "Move from" hour ends while the form is open', async () => {
    const { form, rerenderAt } = renderForm(booking(10, 13))
    await userEvent.click(within(form).getByRole('radio', { name: '11 AM' }))
    expect(form).toHaveTextContent('Moving 2 hours: Fri, Jan 4, 11 AM–1 PM.')
    // Half past noon: 10 AM and 11 AM are over, so only 12 PM is left to move from.
    rerenderAt(new Date(manila(FRIDAY, 12).replace(/:00:00/, ':30:00')))
    const from = within(form).getByRole('group', { name: 'Move from' })
    expect(within(from).getAllByRole('radio')).toHaveLength(1)
    expect(within(from).getByRole('radio', { name: '12 PM' })).toBeChecked()
    expect(form).toHaveTextContent('Moving 1 hour: Fri, Jan 4, 12 PM–1 PM.')
  })

  it('can move into the hour in progress on another court (walk-in rules)', async () => {
    const { form, onSubmit } = renderForm(booking(10, 11))
    await userEvent.selectOptions(within(form).getByLabelText('New court'), 'B')
    // 10 AM is 'past' on the server's grid (it started) but still free: staff may take it.
    await userEvent.click(await within(form).findByRole('radio', { name: '10 AM (now)' }))
    await userEvent.type(within(form).getByLabelText('Reason for moving'), 'Net broke')
    await userEvent.click(within(form).getByRole('button', { name: 'Move booking' }))
    expect(onSubmit).toHaveBeenCalledWith({ fromStart: manila(FRIDAY, 10), courtId: 'B', start: manila(FRIDAY, 10), reason: 'Net broke' })
  })

  it('needs a court and start, and a reason, before sending', async () => {
    const { form, onSubmit } = renderForm(booking(14, 16))
    await within(form).findByRole('group', { name: 'New start' })
    await userEvent.click(within(form).getByRole('button', { name: 'Move booking' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose a new court and start time.')

    await userEvent.click(within(form).getByRole('radio', { name: '5 PM' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Move booking' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Give a reason so the player knows why.')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('says when no start has enough free hours on that court', async () => {
    vi.mocked(fetchAvailability).mockImplementation(async (date) =>
      daySlots(date).map((s) => (s.court_id === 'B' ? { ...s, status: 'booked' as const } : s)))
    const { form } = renderForm(booking(14, 16))
    await userEvent.selectOptions(within(form).getByLabelText('New court'), 'B')
    expect(await within(form).findByText(/No 2 hours in a row are free on Badminton 2 that day/)).toBeInTheDocument()
  })

  it('says when the venue is closed that day', async () => {
    vi.mocked(fetchAvailability).mockResolvedValue([])
    const { form } = renderForm(booking(14, 16))
    expect(await within(form).findByText(/closed on this day, or it's past the booking window/)).toBeInTheDocument()
  })

  it('shows a loader while the day loads', async () => {
    vi.mocked(fetchAvailability).mockReturnValue(new Promise(() => {}))
    const first = renderForm(booking(14, 16))
    expect(within(first.form).getByRole('status')).toBeInTheDocument()
  })

  it('shows an error when the day cannot be loaded, and loads it again', async () => {
    vi.mocked(fetchAvailability).mockRejectedValueOnce(new Error('Failed to fetch')).mockImplementation(async (d) => daySlots(d))
    const { form } = renderForm(booking(14, 16))
    expect(await within(form).findByRole('alert')).toHaveTextContent(/reach the server/i)
    await userEvent.click(within(form).getByRole('button', { name: /try again|retry/i }))
    expect(await within(form).findByRole('group', { name: 'New start' })).toBeInTheDocument()
  })

  it('shows the server error for a move that was refused, and disables the button while saving', () => {
    const error = new ApiError('A booking can only move to a court of the same sport.', 'P0001', 'different_sport')
    const { form } = renderForm(booking(14, 16), { error, pending: true })
    expect(within(form).getByRole('alert')).toHaveTextContent('A booking can only move to a court of the same sport.')
    expect(within(form).getByRole('button', { name: 'Moving…' })).toBeDisabled()
  })

  it('closes without saving', async () => {
    const { form, onClose, onSubmit } = renderForm(booking(14, 16))
    await userEvent.click(within(form).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalled())
  })
})
