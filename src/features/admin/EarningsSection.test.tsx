import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Json } from '../../lib/database.types'
import { fetchBookingsForExport, fetchEarnings, fetchPaymentsForExport, type ExportBooking } from './api'
import { fetchPlatformFee } from '../booking/api'
import { downloadCsv } from './csv'
import { EarningsSection } from './EarningsSection'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchEarnings: vi.fn(),
  fetchBookingsForExport: vi.fn(),
  fetchPaymentsForExport: vi.fn(),
}))
// The fee note reads the current fee (T11.14).
vi.mock('../booking/api', async (importOriginal) => ({ ...(await importOriginal<object>()), fetchPlatformFee: vi.fn() }))
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
  // T11.12: total revenue is what was collected; two online bookings paid today carry the ₱10 fee, one yesterday.
  split: {
    total_revenue: 1500, plotline_fees: 20, owner_earnings: 1480,
    previous: { total_revenue: 1000, plotline_fees: 10, owner_earnings: 990 },
  },
  ...patch,
})

const ZERO_SPLIT = { total_revenue: 0, plotline_fees: 0, owner_earnings: 0, previous: { total_revenue: 0, plotline_fees: 0, owner_earnings: 0 } }

/** The rows of the revenue split, in order (T11.14). */
const splitRows = async () => within(await screen.findByRole('list', { name: 'Revenue split' })).getAllByRole('listitem')

/** Elements with this text outside the revenue split (the Collected line repeats the total revenue's change). */
function outsideSplit(text: string) {
  const split = screen.queryByRole('list', { name: 'Revenue split' })
  return screen.getAllByText(text).filter((el) => !split?.contains(el))
}

/** A split row: its label, its amount for the period (its own text) and, when given, its change line. */
function expectRow(row: HTMLElement, label: string, amount: string, sentence?: string) {
  expect(within(row).getByText(label)).toBeInTheDocument()
  expect(within(row).getByText(amount)).toBeInTheDocument()
  if (sentence) expect(within(row).getByText(sentence)).toBeInTheDocument()
}

const FEE_NOTE = /per confirmed online booking, paid by the player/

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><EarningsSection today={TODAY} timeZone="Asia/Manila" currency="PHP" /></QueryClientProvider>)
}

describe('EarningsSection', () => {
  beforeEach(() => {
    vi.mocked(fetchEarnings).mockReset().mockResolvedValue(result())
    vi.mocked(fetchPlatformFee).mockReset().mockResolvedValue(10)
  })

  it('shows a loader while the figures load', () => {
    vi.mocked(fetchEarnings).mockReturnValue(new Promise(() => {}))
    renderSection()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
  })

  it("shows today's money by method, the change since yesterday, hours and what's coming up", async () => {
    renderSection()
    expect(await screen.findByText('₱1,500', { selector: '.big-number' })).toBeInTheDocument()
    expect(fetchEarnings).toHaveBeenCalledWith(TODAY, TODAY)
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    expect(outsideSplit('₱500 more than yesterday (+50%).')).toHaveLength(1)
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
    await screen.findByText('₱1,500', { selector: '.big-number' })
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
    await screen.findByText('₱1,500', { selector: '.big-number' })
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
      split: ZERO_SPLIT,
    }))
    renderSection()
    expect(await screen.findByText('Nothing collected in this period.')).toBeInTheDocument()
    // The Collected total says it once, outside the split; each split row (T11.14) says it itself.
    expect(outsideSplit('The same as yesterday.')).toHaveLength(1)
    const rows = await splitRows()
    expectRow(rows[0], 'Total revenue', '₱0', 'The same as yesterday.')
    expectRow(rows[1], 'Your earnings', '₱0', 'The same as yesterday.')
    expectRow(rows[2], 'Plotline fees', '₱0', 'The same as yesterday.')
    expect(screen.getByRole('status')).toHaveTextContent('Also received online but not accepted: ₱300 (1 payment)')
    expect(screen.getByText('confirmed booking not played yet, worth ₱300.')).toBeInTheDocument()
  })

  describe('revenue split (T11.14)', () => {
    it('shows total revenue, your earnings and Plotline fees in the Collected card, each against yesterday', async () => {
      renderSection()
      const rows = await splitRows()
      expect(rows).toHaveLength(3)
      expectRow(rows[0], 'Total revenue', '₱1,500', '₱500 more than yesterday (+50%).')
      expectRow(rows[1], 'Your earnings', '₱1,480', '₱490 more than yesterday (+49%).')
      expectRow(rows[2], 'Plotline fees', '₱20', '₱10 more than yesterday (+100%).')
      // In the Collected card, under the collected total.
      const card = screen.getByRole('heading', { name: 'Collected' }).closest('section')!
      expect(card).toContainElement(screen.getByRole('list', { name: 'Revenue split' }))
    })

    it('explains the fee with the current fee in the venue currency', async () => {
      renderSection()
      await splitRows()
      expect(await screen.findByText(FEE_NOTE)).toHaveTextContent('₱10 per confirmed online booking, paid by the player')
      expect(screen.getByRole('heading', { name: 'Collected' }).closest('section')).toContainElement(screen.getByText(FEE_NOTE))
    })

    it('shows centavos in the fee note when the fee has them', async () => {
      vi.mocked(fetchPlatformFee).mockResolvedValue(12.5)
      renderSection()
      expect(await screen.findByText(FEE_NOTE)).toHaveTextContent('₱12.50 per confirmed online booking, paid by the player')
    })

    it('says less, with the percentage, when the figures went down', async () => {
      vi.mocked(fetchEarnings).mockResolvedValue(result({
        collected: { total: 800, count: 2, by_method: [{ method: 'cash', amount: 800, count: 2 }] },
        split: { total_revenue: 800, plotline_fees: 0, owner_earnings: 800, previous: { total_revenue: 1000, plotline_fees: 10, owner_earnings: 990 } },
      }))
      renderSection()
      const rows = await splitRows()
      expectRow(rows[0], 'Total revenue', '₱800', '₱200 less than yesterday (-20%).')
      expectRow(rows[1], 'Your earnings', '₱800', '₱190 less than yesterday (-19%).')
      expectRow(rows[2], 'Plotline fees', '₱0', '₱10 less than yesterday (-100%).')
    })

    it('leaves out the percentage when there was nothing before', async () => {
      vi.mocked(fetchEarnings).mockResolvedValue(result({
        collected: { total: 360, count: 1, by_method: [{ method: 'paymongo', amount: 360, count: 1 }] },
        previous: { from: '2026-10-24', to: '2026-10-24', total: 0, count: 0, by_method: [] },
        split: { total_revenue: 360, plotline_fees: 10, owner_earnings: 350, previous: { total_revenue: 0, plotline_fees: 0, owner_earnings: 0 } },
      }))
      renderSection()
      const rows = await splitRows()
      expect(rows[0]).toHaveTextContent('₱360 more than yesterday.')
      expectRow(rows[1], 'Your earnings', '₱350', '₱350 more than yesterday.')
      expect(rows[2]).toHaveTextContent('₱10 more than yesterday.')
      // The Collected line words it the same way (it uses changeText too).
      expect(outsideSplit('₱360 more than yesterday.')).toHaveLength(1)
    })

    it('compares with last week on the week view', async () => {
      const user = userEvent.setup()
      renderSection()
      await screen.findByText('₱1,500', { selector: '.big-number' })
      vi.mocked(fetchEarnings).mockResolvedValue(result({
        from: '2026-10-19', to: TODAY,
        previous: { from: '2026-10-12', to: '2026-10-18', total: 1000, count: 2, by_method: [] },
        split: { total_revenue: 1500, plotline_fees: 30, owner_earnings: 1470, previous: { total_revenue: 1000, plotline_fees: 30, owner_earnings: 970 } },
      }))
      await user.click(screen.getByRole('button', { name: 'This week' }))
      await screen.findAllByText(/last week/)
      const rows = await splitRows()
      expect(rows[1]).toHaveTextContent('₱500 more than last week (+52%).')
      expect(rows[2]).toHaveTextContent('The same as last week.')
    })

    it('reads a missing split as zero', async () => {
      vi.mocked(fetchEarnings).mockResolvedValue(result({ split: null }))
      renderSection()
      const rows = await splitRows()
      expectRow(rows[0], 'Total revenue', '₱0', 'The same as yesterday.')
      expectRow(rows[1], 'Your earnings', '₱0', 'The same as yesterday.')
      expectRow(rows[2], 'Plotline fees', '₱0', 'The same as yesterday.')
    })

    it('leaves out the fee note while the fee loads, and still shows the split', async () => {
      vi.mocked(fetchPlatformFee).mockReturnValue(new Promise(() => {}))
      renderSection()
      expect(await splitRows()).toHaveLength(3)
      expect(screen.queryByText(FEE_NOTE)).toBeNull()
    })

    it('leaves out the fee note when the fee fails to load, and the rest of the section still renders', async () => {
      const failure = Promise.reject(new TypeError('Failed to fetch'))
      failure.catch(() => {})
      vi.mocked(fetchPlatformFee).mockReturnValue(failure)
      renderSection()
      expect(await splitRows()).toHaveLength(3)
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      expect(fetchPlatformFee).toHaveBeenCalled()
      expect(screen.queryByText(FEE_NOTE)).toBeNull()
      expect(screen.queryByText(/Could not reach the server/)).toBeNull()
      expect(screen.getByText('₱1,500', { selector: '.big-number' })).toBeInTheDocument()
      expect(screen.getByRole('list', { name: 'Collected by method' })).toBeInTheDocument()
    })
  })

  it('shows an error with a retry', async () => {
    vi.mocked(fetchEarnings).mockRejectedValue(new TypeError('Failed to fetch'))
    renderSection()
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument()
    vi.mocked(fetchEarnings).mockResolvedValue(result())
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('₱1,500', { selector: '.big-number' })).toBeInTheDocument()
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
      await screen.findByText('₱1,500', { selector: '.big-number' })
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
      await screen.findByText('₱1,500', { selector: '.big-number' })
      await user.click(screen.getByRole('button', { name: 'Export payments (CSV)' }))
      expect(vi.mocked(downloadCsv).mock.calls[0][0]).toBe(`payments_${TODAY}_to_${TODAY}.csv`)

      vi.mocked(fetchPaymentsForExport).mockRejectedValue(new TypeError('Failed to fetch'))
      await user.click(screen.getByRole('button', { name: 'Export payments (CSV)' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/Could not reach the server/)
      expect(downloadCsv).toHaveBeenCalledTimes(1)
    })
  })
})
