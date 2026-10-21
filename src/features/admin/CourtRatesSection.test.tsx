import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchCourtRates, fetchOperatingHours, fetchVenueSettings, saveCourtRates,
  type Court, type OperatingHours, type VenueSettings,
} from '../catalog/api'
import { CourtRatesSection } from './CourtRatesSection'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourtRates: vi.fn(),
  fetchOperatingHours: vi.fn(),
  fetchVenueSettings: vi.fn(),
  saveCourtRates: vi.fn(),
}))

const court = { id: 'c1', name: 'Badminton 1', default_hourly_rate: 350 } as Court
const week = (patch: Partial<Record<number, Partial<OperatingHours>>> = {}): OperatingHours[] =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '20:00:00', close_time: '22:00:00', is_closed: false, ...patch[d] }))

function renderRates(hours: OperatingHours[]) {
  vi.mocked(fetchOperatingHours).mockResolvedValue(hours)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><CourtRatesSection court={court} /></QueryClientProvider>)
}

describe('CourtRatesSection with overnight hours', () => {
  beforeEach(() => {
    vi.mocked(fetchCourtRates).mockReset().mockResolvedValue([])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ currency: 'PHP' } as VenueSettings)
    vi.mocked(saveCourtRates).mockReset().mockResolvedValue()
  })

  it('lists after-midnight hours under the day they belong to', async () => {
    // Monday 20:00 → 02:00 Tuesday; other days 20:00–22:00.
    renderRates(week({ 1: { close_time: '02:00:00' } }))
    const rows = (await screen.findAllByRole('row')).slice(1).map((r) => within(r).getByRole('rowheader').textContent)
    expect(rows).toEqual(['8 PM', '9 PM', '10 PM', '11 PM', '12 AM (next day)', '1 AM (next day)'])
    expect(screen.getByLabelText('Monday 1 AM (next day)')).toBeInTheDocument()
    // Tuesday isn't open then (its own day is 20:00–22:00).
    const lastRow = screen.getAllByRole('row').at(-1)!
    expect(within(lastRow).getAllByLabelText('Closed')).toHaveLength(6)
  })

  it("stores an after-midnight price under the operating day's row, at that hour", async () => {
    renderRates(week({ 1: { close_time: '02:00:00' } }))
    await userEvent.type(await screen.findByLabelText('Monday 1 AM (next day)'), '500')
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 change' }))
    expect(saveCourtRates).toHaveBeenCalledWith('c1', {
      upserts: [{ court_id: 'c1', day_of_week: 1, start_hour: 1, price: 500 }], deletes: [],
    })
  })

  it('handles a week where every day runs past midnight', async () => {
    renderRates(week(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { close_time: '01:00:00' }]))))
    expect(await screen.findByLabelText('Sunday 12 AM (next day)')).toBeInTheDocument()
  })
})
