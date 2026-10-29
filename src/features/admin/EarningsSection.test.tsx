import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Json } from '../../lib/database.types'
import { fetchBookingsForExport, fetchEarnings, fetchPaymentsForExport, type ExportBooking } from './api'
import { downloadCsv } from './csv'
import { EarningsSection } from './EarningsSection'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchEarnings: vi.fn(),
  fetchBookingsForExport: vi.fn(),
  fetchPaymentsForExport: vi.fn(),
}))
vi.mock('./csv', async (importOriginal) => ({ ...(await importOriginal<object>()), downloadCsv: vi.fn() }))

// Sunday 2026-10-25.
const TODAY = '2026-10-25'

const result = (patch: Record<string, Json> = {}): Json => ({
  from: TODAY, to: TODAY, timezone: 'Asia/Manila',
  collected: { total: 1500, count: 3, by_method: [{ method: 'cash', amount: 1000, count: 2 }, { method: 'paymongo', amount: 500, count: 1 }] },
  previous: { from: '2026-10-24', to: '2026-10-24', total: 1000, count: 2, by_method: [] },
  refunds_due: { count: 0, total: 0 },
  daily: [{ date: TODAY, collected: 1500, sold_hours: 5 }],
  courts: [
    { court_id: 'A', name: 'Badminton 1', sport: 'badminton', open_hours: 16, blackout_hours: 0, sold_hours: 4, open_play_hours: 2 },
    { court_id: 'B', name: 'Tennis Court', sport: 'tennis', open_hours: 16, blackout_hours: 14, sold_hours: 3, open_play_hours: 0 },
  ],
  sports: [
    { sport: 'badminton', open_hours: 16, blackout_hours: 0, sold_hours: 4, open_play_hours: 2 },
    { sport: 'tennis', open_hours: 16, blackout_hours: 14, sold_hours: 3, open_play_hours: 0 },
  ],
  coming_up: { count: 2, value: 1300 },
  ...patch,
})

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><EarningsSection today={TODAY} timeZone="Asia/Manila" currency="PHP" /></QueryClientProvider>)
}

describe('EarningsSection', () => {
  beforeEach(() => {
    vi.mocked(fetchEarnings).mockReset().mockResolvedValue(result())
  })

  it('shows a loader while the figures load', () => {
    vi.mocked(fetchEarnings).mockReturnValue(new Promise(() => {}))
    renderSection()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
  })

  it("shows today's money by method, the change since yesterday, hours and what's coming up", async () => {
    renderSection()
    expect(await screen.findByText('₱1,500')).toBeInTheDocument()
    expect(fetchEarnings).toHaveBeenCalledWith(TODAY, TODAY)
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('₱500 more than yesterday (+50%).')).toBeInTheDocument()
    const methods = within(screen.getByRole('list', { name: 'Collected by method' })).getAllByRole('listitem')
    expect(methods.map((li) => li.textContent)).toEqual(['Cash (2)₱1,000', 'PayMongo (1)₱500'])
    expect(screen.getByText('confirmed bookings not played yet, worth ₱1,300.')).toBeInTheDocument()

    // Booked hours as split bars (T11.5): a row per court, each with its figures as text and a bar of its open hours.
    const hours = within(screen.getByRole('region', { name: 'Booked hours' }))
    const badminton = within(hours.getByRole('list', { name: 'Badminton courts' })).getAllByRole('listitem')
    expect(badminton.map((li) => li.textContent)).toEqual(['Badminton 14 h booked · 25% · 2 h open play'])
    expect(within(badminton[0]).getByRole('img', { name: 'Out of 16 h open' })).toBeInTheDocument()
    // 3 sold of 2 bookable hours (a booking under a blackout) is capped at 100%; the bar is full.
    const tennis = within(hours.getByRole('list', { name: 'Tennis courts' })).getByRole('listitem')
    expect(tennis).toHaveTextContent('Tennis Court3 h booked · 100% · 0 h open play')
    expect(within(tennis).getByRole('img', { name: 'Out of 2 h open' }).querySelector('.hours-booked')).toHaveStyle({ width: '100%' })
    // Sport headings carry their totals when there are several sports, then all courts.
    expect(hours.getByRole('heading', { name: 'Badminton' }).parentElement).toHaveTextContent('Badminton4 h booked · 25% · 2 h open play')
    expect(hours.getByText('All courts').parentElement).toHaveTextContent('All courts7 h booked · 39% · 2 h open play')
    // One day: no chart.
    expect(screen.queryByRole('list', { name: 'Collected per day' })).toBeNull()
  })

  it('with one sport, its heading carries no totals (the all-courts row has them)', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue(result({
      courts: [{ court_id: 'A', name: 'Badminton 1', sport: 'badminton', open_hours: 10, blackout_hours: 0, sold_hours: 5, open_play_hours: 0 }],
      sports: [{ sport: 'badminton', open_hours: 10, blackout_hours: 0, sold_hours: 5, open_play_hours: 0 }],
    }))
    renderSection()
    const hours = within(await screen.findByRole('region', { name: 'Booked hours' }))
    expect(hours.getByRole('heading', { name: 'Badminton' }).parentElement).toHaveTextContent(/^Badminton$/)
    expect(hours.getByText('All courts').parentElement).toHaveTextContent('All courts5 h booked · 50% · 0 h open play')
    // No open play: only the booked part of the bar is drawn.
    const bar = hours.getAllByRole('img', { name: 'Out of 10 h open' })[0]
    expect(bar.querySelector('.hours-booked')).toHaveStyle({ width: '50%' })
    expect(bar.querySelector('.hours-open-play')).toHaveStyle({ width: '0%' })
  })

  it('switches to this week (Monday to Sunday) and draws a labelled bar per day', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByText('₱1,500')
    vi.mocked(fetchEarnings).mockResolvedValue(result({
      from: '2026-10-19', to: TODAY,
      daily: [{ date: '2026-10-19', collected: 400, sold_hours: 2 }, { date: '2026-10-20', collected: 0, sold_hours: 0 }],
      previous: { from: '2026-10-12', to: '2026-10-18', total: 2000, count: 4, by_method: [] },
    }))
    await user.click(screen.getByRole('button', { name: 'This week' }))
    expect(fetchEarnings).toHaveBeenLastCalledWith('2026-10-19', TODAY)
    expect(await screen.findByText('₱500 less than last week (-25%).')).toBeInTheDocument()
    const bars = within(screen.getByRole('list', { name: 'Collected per day' })).getAllByRole('listitem')
    expect(bars.map((li) => li.textContent)).toEqual(['Mon, Oct 19₱400 · 2 h', 'Tue, Oct 20₱0 · 0 h'])
    expect(bars[0].querySelector('.bar')).toHaveStyle({ width: '100%' })
    expect(bars[1].querySelector('.bar')).toHaveStyle({ width: '0%' })
  })

  it('asks for valid dates on a custom range before loading', async () => {
    const user = userEvent.setup()
    renderSection()
    await screen.findByText('₱1,500')
    await user.click(screen.getByRole('button', { name: 'Custom range' }))
    expect(fetchEarnings).toHaveBeenLastCalledWith('2026-09-26', TODAY) // the last 30 days by default
    const to = screen.getByRole('group', { name: 'To' })
    await user.click(within(to).getByRole('button', { name: 'Choose a date, Sun, Oct 25' }))
    const dialog = await screen.findByRole('dialog', { name: 'To' })
    await user.click(await within(dialog).findByRole('button', { name: 'Go to the Previous Month' }))
    await user.click(within(dialog).getByRole('button', { name: /September 1st, 2026/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('The end date is before the start date.')
  })

  it('says when nothing came in, and shows refunds due apart', async () => {
    vi.mocked(fetchEarnings).mockResolvedValue(result({
      collected: { total: 0, count: 0, by_method: [] },
      previous: { from: '2026-10-24', to: '2026-10-24', total: 0, count: 0, by_method: [] },
      refunds_due: { count: 1, total: 300 },
      coming_up: { count: 1, value: 300 },
    }))
    renderSection()
    expect(await screen.findByText('Nothing collected in this period.')).toBeInTheDocument()
    expect(screen.getByText('The same as yesterday.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Also received online but not accepted: ₱300 (1 payment)')
    expect(screen.getByText('confirmed booking not played yet, worth ₱300.')).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    vi.mocked(fetchEarnings).mockRejectedValue(new TypeError('Failed to fetch'))
    renderSection()
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument()
    vi.mocked(fetchEarnings).mockResolvedValue(result())
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('₱1,500')).toBeInTheDocument()
  })

  describe('CSV export (T10.8)', () => {
    const booking: ExportBooking = {
      reference_code: 'CB-ABC234', court_name: 'Badminton 1', sport: 'badminton',
      slot_start: '2026-10-25T06:00:00.000Z', slot_end: '2026-10-25T07:00:00.000Z', status: 'confirmed', source: 'online',
      expires_at: null, guest_name: 'Ana Santos', guest_phone: '0917 000 0000', guest_email: 'ana@example.com', total_amount: 350, booking_fee: 0, amount_due: 350,
    }

    beforeEach(() => {
      vi.mocked(fetchBookingsForExport).mockReset().mockResolvedValue([booking])
      vi.mocked(fetchPaymentsForExport).mockReset().mockResolvedValue([])
      vi.mocked(downloadCsv).mockReset()
    })

    it('exports bookings for the range without contact details unless asked', async () => {
      const user = userEvent.setup()
      renderSection()
      await screen.findByText('₱1,500')
      expect(screen.getByRole('checkbox', { name: /Include contact details/ })).not.toBeChecked()
      await user.click(screen.getByRole('button', { name: 'Export bookings (CSV)' }))
      // Today in Manila: midnight to midnight.
      expect(fetchBookingsForExport).toHaveBeenCalledWith('2026-10-24T16:00:00.000Z', '2026-10-25T16:00:00.000Z')
      const [name, text] = vi.mocked(downloadCsv).mock.calls[0]
      expect(name).toBe(`bookings_${TODAY}_to_${TODAY}.csv`)
      expect(text).toContain('"Ana Santos"')
      expect(text).not.toContain('ana@example.com')

      await user.click(screen.getByRole('checkbox', { name: /Include contact details/ }))
      await user.click(screen.getByRole('button', { name: 'Export bookings (CSV)' }))
      expect(vi.mocked(downloadCsv).mock.calls[1][1]).toContain('"ana@example.com"')
    })

    it('exports payments, and says when the export fails', async () => {
      const user = userEvent.setup()
      renderSection()
      await screen.findByText('₱1,500')
      await user.click(screen.getByRole('button', { name: 'Export payments (CSV)' }))
      expect(vi.mocked(downloadCsv).mock.calls[0][0]).toBe(`payments_${TODAY}_to_${TODAY}.csv`)

      vi.mocked(fetchPaymentsForExport).mockRejectedValue(new TypeError('Failed to fetch'))
      await user.click(screen.getByRole('button', { name: 'Export payments (CSV)' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the server/)
      expect(downloadCsv).toHaveBeenCalledTimes(1)
    })
  })
})
