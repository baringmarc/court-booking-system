// T19.2: the Promos tab. "Today" is Fri 2030-01-04, 10:30 AM in Manila (02:30 UTC), so the status badges and the quick
// date picks are deterministic. The api modules are mocked; nothing touches the network.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import baseUserEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatDateLabel } from '../../../lib/time'
import { formatMoney } from '../../../lib/format'
import { ApiError } from '../../../lib/queryClient'
import { fetchCourts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../../catalog/api'
import { deletePromo, fetchPromos, savePromo, type Promo } from './api'
import { PromosPanel } from './PromosPanel'

// No per-action macrotask delay (H12): the real-timer waits dominated this file's runtime.
const userEvent = baseUserEvent.setup({ delay: null })

vi.mock('../../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchPromos: vi.fn(),
  savePromo: vi.fn(),
  deletePromo: vi.fn(),
}))

const TZ = 'Asia/Manila'
const court = (id: string, name: string, active = true): CourtWithPhotos => ({
  id, name, sport: 'tennis', default_hourly_rate: 700, is_active: active, sort_order: 1, court_photos: [],
  venue_id: 'v1', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})
const promo = (over: Partial<Promo> = {}): Promo => ({
  id: 'p1', label: 'Weekend promo', starts_on: '2030-01-01', ends_on: '2030-01-31', days_of_week: [0, 6], start_hour: 18, end_hour: 21,
  price: 500, is_active: true, court_ids: ['c1', 'c2'], ...over,
})

function mount(promos: Promo[] = [promo()], currency = 'PHP') {
  vi.mocked(fetchPromos).mockResolvedValue(promos)
  vi.mocked(fetchVenueSettings).mockResolvedValue({ timezone: TZ, currency } as VenueSettings)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><PromosPanel /></QueryClientProvider>)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2030-01-04T02:30:00.000Z'))
  vi.mocked(fetchPromos).mockReset()
  vi.mocked(savePromo).mockReset().mockResolvedValue('new-id')
  vi.mocked(deletePromo).mockReset().mockResolvedValue(undefined)
  vi.mocked(fetchCourts).mockReset().mockResolvedValue([court('c1', 'Court One'), court('c2', 'Court Two')])
  vi.mocked(fetchVenueSettings).mockReset()
})
afterEach(() => { vi.useRealTimers() })

const group = (name: string) => within(screen.getByRole('group', { name }))
const rowOf = async (label: string) => (await screen.findByText(label)).closest('li') as HTMLElement
const openAdd = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Add promo' }))
  return screen.findByRole('form', { name: 'Promo' })
}
const price = () => screen.getByLabelText('Price per hour')
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save promo' }))

type Fill = { name?: string; days?: string[]; courts?: string[]; price?: string; from?: string; until?: string }
/** A valid promo unless a field is overridden: Sat + Sun, Court One, 6 PM–9 PM, ₱500, Today to Tomorrow. */
async function fill(over: Fill = {}) {
  const f = { name: 'Weekend promo', days: ['Saturday', 'Sunday'], courts: ['Court One'], price: '500', from: '18', until: '21', ...over }
  if (f.name) await userEvent.type(screen.getByLabelText('Promo name'), f.name)
  await userEvent.click(group('Starts on').getByRole('button', { name: 'Today' }))
  await userEvent.click(group('Ends on').getByRole('button', { name: 'Tomorrow' }))
  for (const d of f.days) await userEvent.click(group('Days').getByRole('checkbox', { name: d }))
  for (const c of f.courts) await userEvent.click(group('Courts').getByRole('checkbox', { name: c }))
  await userEvent.selectOptions(screen.getByLabelText('From', { exact: true }), f.from)
  await userEvent.selectOptions(screen.getByLabelText('Until', { exact: true }), f.until)
  if (f.price) await userEvent.type(price(), f.price)
}

describe('states', () => {
  it('shows the Promos heading and the empty text when there are none', async () => {
    mount([])
    expect(await screen.findByText('No promos yet.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Promos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add promo' })).toBeInTheDocument()
  })

  it('shows a loading indicator while the promos load', () => {
    vi.mocked(fetchPromos).mockReturnValue(new Promise(() => {}))
    vi.mocked(fetchVenueSettings).mockResolvedValue({ timezone: TZ, currency: 'PHP' } as VenueSettings)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><PromosPanel /></QueryClientProvider>)
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText('No promos yet.')).not.toBeInTheDocument()
  })

  it('shows an error with Try again, and Try again reads the promos again', async () => {
    vi.mocked(fetchVenueSettings).mockResolvedValue({ timezone: TZ, currency: 'PHP' } as VenueSettings)
    vi.mocked(fetchPromos).mockRejectedValueOnce(new ApiError('Could not load promos.')).mockResolvedValue([promo()])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><PromosPanel /></QueryClientProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load promos.')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Weekend promo')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reads the courts including archived ones', async () => {
    mount([])
    await screen.findByText('No promos yet.')
    expect(fetchCourts).toHaveBeenCalledWith(true)
  })
})

describe('the list', () => {
  it('shows a promo row with label, courts, price per hour, hours, days, dates and the status', async () => {
    mount()
    const row = within(await rowOf('Weekend promo'))
    expect(row.getByText('Weekend promo')).toBeInTheDocument()
    expect(row.getByText(/Court One, Court Two/)).toBeInTheDocument()
    expect(row.getByText(/₱500\/hr/)).toBeInTheDocument()
    expect(row.getByText(/6 PM – 9 PM/)).toBeInTheDocument()
    expect(row.getByText(/Sat/)).toBeInTheDocument()
    expect(row.getByText(/Sun/)).toBeInTheDocument()
    expect(row.getByText('Active')).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Edit promo: Weekend promo' })).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Delete promo: Weekend promo' })).toBeInTheDocument()
  })

  it('shows the date range of the promo', async () => {
    mount()
    const text = (await rowOf('Weekend promo')).textContent ?? ''
    expect(text).toContain(formatDateLabel('2030-01-01', TZ))
    expect(text).toContain(formatDateLabel('2030-01-31', TZ))
  })

  it('formats the price in the venue currency', async () => {
    mount([promo({ price: 12.5 })], 'USD')
    const row = await rowOf('Weekend promo')
    expect(row).toHaveTextContent(`${formatMoney(12.5, 'USD')}/hr`)
    expect(row).not.toHaveTextContent('₱')
  })

  it('wears a badge per status: Active, Upcoming, Ended and Paused (paused wins over the dates)', async () => {
    mount([
      promo({ id: 'a', label: 'Now' }),
      promo({ id: 'u', label: 'Soon', starts_on: '2030-01-05', ends_on: '2030-01-09' }),
      promo({ id: 'e', label: 'Past', starts_on: '2029-12-01', ends_on: '2030-01-03' }),
      promo({ id: 'x', label: 'Off', is_active: false }),
    ])
    expect(within(await rowOf('Now')).getByText('Active')).toBeInTheDocument()
    expect(within(await rowOf('Soon')).getByText('Upcoming')).toBeInTheDocument()
    expect(within(await rowOf('Past')).getByText('Ended')).toBeInTheDocument()
    expect(within(await rowOf('Off')).getByText('Paused')).toBeInTheDocument()
    expect(within(await rowOf('Off')).queryByText('Active')).not.toBeInTheDocument()
  })

  it('a promo ending today is still Active and one starting today is Active', async () => {
    mount([
      promo({ id: 'l', label: 'Last day', starts_on: '2029-12-30', ends_on: '2030-01-04' }),
      promo({ id: 'f', label: 'First day', starts_on: '2030-01-04', ends_on: '2030-01-10' }),
    ])
    expect(within(await rowOf('Last day')).getByText('Active')).toBeInTheDocument()
    expect(within(await rowOf('First day')).getByText('Active')).toBeInTheDocument()
  })
})

describe('adding a promo', () => {
  it('opens a Promo form with all its fields, blank, Active ticked', async () => {
    mount([])
    const form = within(await openAdd())
    expect(form.getByLabelText('Promo name')).toHaveValue('')
    expect(form.getByRole('group', { name: 'Starts on' })).toBeInTheDocument()
    expect(form.getByRole('group', { name: 'Ends on' })).toBeInTheDocument()
    expect(form.getAllByRole('checkbox', { name: /^(Sun|Mon|Tues|Wednes|Thurs|Fri|Satur)day$/ })).toHaveLength(7)
    expect(form.getByRole('group', { name: 'Courts' })).toBeInTheDocument()
    expect(form.getByRole('checkbox', { name: 'Court One' })).not.toBeChecked()
    expect(form.getByRole('checkbox', { name: 'Court Two' })).not.toBeChecked()
    expect(form.getByLabelText('From', { exact: true })).toBeInTheDocument()
    expect(form.getByLabelText('Until', { exact: true })).toBeInTheDocument()
    expect(form.getByLabelText('Price per hour')).toBeInTheDocument()
    expect(form.getByRole('checkbox', { name: 'Active' })).toBeChecked()
    expect(form.getByRole('button', { name: 'Save promo' })).toBeInTheDocument()
    expect(form.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('offers hours 0–23 in From and 1–24 in Until, worded with formatHour', async () => {
    mount([])
    await openAdd()
    const from = within(screen.getByLabelText('From', { exact: true })).getAllByRole('option')
    const until = within(screen.getByLabelText('Until', { exact: true })).getAllByRole('option')
    expect(from.map((o) => (o as HTMLOptionElement).value)).toEqual(Array.from({ length: 24 }, (_, i) => String(i)))
    expect(until.map((o) => (o as HTMLOptionElement).value)).toEqual(Array.from({ length: 24 }, (_, i) => String(i + 1)))
    expect(from.find((o) => (o as HTMLOptionElement).value === '18')).toHaveTextContent('6 PM')
    expect(until.find((o) => (o as HTMLOptionElement).value === '24')).toHaveTextContent('12 AM')
  })

  it('lists archived courts too as options (the promo may still apply to them)', async () => {
    vi.mocked(fetchCourts).mockResolvedValue([court('c1', 'Court One'), court('c3', 'Old Court', false)])
    mount([])
    await openAdd()
    expect(group('Courts').getByRole('checkbox', { name: /Old Court/ })).toBeInTheDocument()
  })

  it('saves exactly what was entered: id null, dates, ticked courts and days, hours, a numeric price, active', async () => {
    mount([])
    await openAdd()
    await fill()
    await save()
    await waitFor(() => expect(savePromo).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(savePromo).mock.calls[0][0]
    expect(sent).toMatchObject({
      id: null, label: 'Weekend promo', starts_on: '2030-01-04', ends_on: '2030-01-05', court_ids: ['c1'],
      start_hour: 18, end_hour: 21, price: 500, is_active: true,
    })
    expect([...sent.days].sort()).toEqual([0, 6])
    expect(typeof sent.price).toBe('number')
    expect(typeof sent.start_hour).toBe('number')
  })

  it('sends is_active false when Active is unticked', async () => {
    mount([])
    await openAdd()
    await fill()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Active' }))
    await save()
    await waitFor(() => expect(savePromo).toHaveBeenCalled())
    expect(vi.mocked(savePromo).mock.calls[0][0].is_active).toBe(false)
  })

  it('sends every ticked court', async () => {
    mount([])
    await openAdd()
    await fill({ courts: ['Court One', 'Court Two'] })
    await save()
    await waitFor(() => expect(savePromo).toHaveBeenCalled())
    expect([...vi.mocked(savePromo).mock.calls[0][0].court_ids].sort()).toEqual(['c1', 'c2'])
  })

  it('closes the form after a successful save', async () => {
    mount([])
    await openAdd()
    await fill()
    await save()
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Promo' })).not.toBeInTheDocument())
  })

  it('Cancel closes the form without saving, and the next Add promo starts blank', async () => {
    mount([])
    await openAdd()
    await userEvent.type(screen.getByLabelText('Promo name'), 'Half typed')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Promo' })).not.toBeInTheDocument()
    expect(savePromo).not.toHaveBeenCalled()
    await openAdd()
    expect(screen.getByLabelText('Promo name')).toHaveValue('')
  })
})

describe('server errors', () => {
  it('shows the overlap message in an alert and keeps the form open with its values', async () => {
    const message = 'This promo overlaps "Happy hour" on the same court, day and hour.'
    vi.mocked(savePromo).mockRejectedValue(new ApiError(message, 'P0001', 'promo_overlap'))
    mount([])
    await openAdd()
    await fill()
    await save()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('form', { name: 'Promo' })).toBeInTheDocument()
    expect(screen.getByLabelText('Promo name')).toHaveValue('Weekend promo')
    expect(price()).toHaveValue(500)
    expect(group('Courts').getByRole('checkbox', { name: 'Court One' })).toBeChecked()
    expect(group('Days').getByRole('checkbox', { name: 'Saturday' })).toBeChecked()
    expect(screen.getByLabelText('From', { exact: true })).toHaveValue('18')
  })

  it('shows the invalid_input message in an alert and keeps the form open', async () => {
    const message = 'Check the promo: a label (up to 60 characters), dates in order, at least one day and court, an hour window and a price above zero.'
    vi.mocked(savePromo).mockRejectedValue(new ApiError(message, 'P0001', 'invalid_input'))
    mount([])
    await openAdd()
    await fill()
    await save()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('form', { name: 'Promo' })).toBeInTheDocument()
  })

  it('lets the user fix the form and save again after an overlap', async () => {
    vi.mocked(savePromo).mockRejectedValueOnce(new ApiError('This promo overlaps "X" on the same court, day and hour.', 'P0001', 'promo_overlap'))
    mount([])
    await openAdd()
    await fill()
    await save()
    await screen.findByRole('alert')
    await userEvent.selectOptions(screen.getByLabelText('From', { exact: true }), '19')
    await save()
    await waitFor(() => expect(savePromo).toHaveBeenCalledTimes(2))
    expect(vi.mocked(savePromo).mock.calls[1][0].start_hour).toBe(19)
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Promo' })).not.toBeInTheDocument())
  })
})

describe('client checks before saving', () => {
  const blocked = async (over: Fill) => {
    mount([])
    await openAdd()
    await fill(over)
    await save()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(savePromo).not.toHaveBeenCalled()
    expect(screen.getByRole('form', { name: 'Promo' })).toBeInTheDocument()
  }

  it('refuses an empty name', async () => { await blocked({ name: '' }) })
  it('refuses a promo with no day ticked', async () => { await blocked({ days: [] }) })
  it('refuses a promo with no court ticked', async () => { await blocked({ courts: [] }) })
  it('refuses a price of zero', async () => { await blocked({ price: '0' }) })
  it('refuses a negative price', async () => { await blocked({ price: '-5' }) })
  it('refuses no price at all', async () => { await blocked({ price: '' }) })
  it('refuses Until equal to From', async () => { await blocked({ from: '18', until: '18' }) })
  it('refuses Until before From', async () => { await blocked({ from: '20', until: '19' }) })
})

describe('editing a promo', () => {
  it('opens the form seeded from the promo', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit promo: Weekend promo' }))
    const form = within(await screen.findByRole('form', { name: 'Promo' }))
    expect(form.getByLabelText('Promo name')).toHaveValue('Weekend promo')
    expect(form.getByRole('group', { name: 'Starts on' })).toHaveTextContent(formatDateLabel('2030-01-01', TZ))
    expect(form.getByRole('group', { name: 'Ends on' })).toHaveTextContent(formatDateLabel('2030-01-31', TZ))
    expect(form.getByRole('checkbox', { name: 'Saturday' })).toBeChecked()
    expect(form.getByRole('checkbox', { name: 'Sunday' })).toBeChecked()
    expect(form.getByRole('checkbox', { name: 'Monday' })).not.toBeChecked()
    expect(form.getByRole('checkbox', { name: 'Court One' })).toBeChecked()
    expect(form.getByRole('checkbox', { name: 'Court Two' })).toBeChecked()
    expect(form.getByLabelText('From', { exact: true })).toHaveValue('18')
    expect(form.getByLabelText('Until', { exact: true })).toHaveValue('21')
    expect(form.getByLabelText('Price per hour')).toHaveValue(500)
    expect(form.getByRole('checkbox', { name: 'Active' })).toBeChecked()
  })

  it('seeds Active unticked for a paused promo', async () => {
    mount([promo({ is_active: false })])
    await userEvent.click(await screen.findByRole('button', { name: 'Edit promo: Weekend promo' }))
    expect(await screen.findByRole('checkbox', { name: 'Active' })).not.toBeChecked()
  })

  it('saves the promo id with the changed price, and the rest as it was', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Edit promo: Weekend promo' }))
    await screen.findByRole('form', { name: 'Promo' })
    await userEvent.clear(price())
    await userEvent.type(price(), '450')
    await save()
    await waitFor(() => expect(savePromo).toHaveBeenCalledTimes(1))
    const sent = vi.mocked(savePromo).mock.calls[0][0]
    expect(sent).toMatchObject({
      id: 'p1', label: 'Weekend promo', starts_on: '2030-01-01', ends_on: '2030-01-31', start_hour: 18, end_hour: 21,
      price: 450, is_active: true,
    })
    expect([...sent.court_ids].sort()).toEqual(['c1', 'c2'])
    expect([...sent.days].sort()).toEqual([0, 6])
  })

  it('shows the other promo\'s values after switching which promo is edited', async () => {
    mount([promo(), promo({ id: 'p2', label: 'Lunch deal', price: 300, start_hour: 12, end_hour: 14, days_of_week: [1], court_ids: ['c2'] })])
    await userEvent.click(await screen.findByRole('button', { name: 'Edit promo: Weekend promo' }))
    expect(await screen.findByLabelText('Promo name')).toHaveValue('Weekend promo')
    await userEvent.click(screen.getByRole('button', { name: 'Edit promo: Lunch deal' }))
    await waitFor(() => expect(screen.getByLabelText('Promo name')).toHaveValue('Lunch deal'))
    expect(price()).toHaveValue(300)
    expect(screen.getByLabelText('From', { exact: true })).toHaveValue('12')
    expect(group('Courts').getByRole('checkbox', { name: 'Court One' })).not.toBeChecked()
  })
})

describe('deleting a promo', () => {
  const ask = async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete promo: Weekend promo' }))
    return within(await screen.findByRole('dialog', { name: 'Delete this promo?' }))
  }

  it('asks first with Keep promo and Delete promo, and deletes nothing yet', async () => {
    const dialog = await ask()
    expect(dialog.getByRole('button', { name: 'Keep promo' })).toBeInTheDocument()
    expect(dialog.getByRole('button', { name: 'Delete promo' })).toBeInTheDocument()
    expect(deletePromo).not.toHaveBeenCalled()
  })

  it('Keep promo closes the dialog and keeps the promo', async () => {
    const dialog = await ask()
    await userEvent.click(dialog.getByRole('button', { name: 'Keep promo' }))
    expect(screen.queryByRole('dialog', { name: 'Delete this promo?' })).not.toBeInTheDocument()
    expect(deletePromo).not.toHaveBeenCalled()
    expect(screen.getByText('Weekend promo')).toBeInTheDocument()
  })

  it('Delete promo deletes that promo by id and closes the dialog', async () => {
    const dialog = await ask()
    await userEvent.click(dialog.getByRole('button', { name: 'Delete promo' }))
    await waitFor(() => expect(deletePromo).toHaveBeenCalledTimes(1))
    expect(vi.mocked(deletePromo).mock.calls[0][0]).toBe('p1')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete this promo?' })).not.toBeInTheDocument())
  })
})

describe('reading after a change', () => {
  it('reads the list again after a save (the hooks invalidate the promo list)', async () => {
    mount([])
    await openAdd()
    await fill()
    await save()
    await waitFor(() => expect(vi.mocked(fetchPromos).mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('reads the list again after a delete', async () => {
    mount()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete promo: Weekend promo' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Delete this promo?' })).getByRole('button', { name: 'Delete promo' }))
    await waitFor(() => expect(vi.mocked(fetchPromos).mock.calls.length).toBeGreaterThanOrEqual(2))
  })
})
