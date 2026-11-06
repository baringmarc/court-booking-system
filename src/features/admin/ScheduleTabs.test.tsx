// T17.31: the Schedule page's tabs (Opening hours, Prices, Closures): URL state, keyboard behavior, the Prices tab and the
// unsaved-changes dot. Hours and prices stay one draft, so switching tabs keeps it.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { fetchClosureConflicts, fetchSchedule, saveSchedule } from './api'
import { SchedulePage } from './SchedulePage'

const previewMock = vi.hoisted(() => vi.fn())

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchUpcomingBlackouts: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSchedule: vi.fn(),
  saveSchedule: vi.fn(),
  fetchClosureConflicts: vi.fn(),
  previewScheduleImpact: previewMock,
}))

type Period = { day_of_week: number; start_minute: number; end_minute: number }
type Rate = { day_of_week: number; start_hour: number; price: number }

const court = (id: string, name: string, rate = 700): CourtWithPhotos => ({
  id, name, sport: 'tennis', default_hourly_rate: rate, is_active: true, sort_order: 1, court_photos: [],
  venue_id: 'v1', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})
const allDays = (start = 360, end = 1320): Period[] => [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_minute: start, end_minute: end }))

const scheduleData = () => ({
  venue_id: 'v1',
  schedule_revision: 7,
  venue_periods: allDays(),
  courts: [
    { court_id: 'c1', schedule_mode: 'inherit', schedule_revision: 0, periods: [], rates: [] as Rate[] },
    { court_id: 'c2', schedule_mode: 'custom', schedule_revision: 0, periods: allDays(480, 1200), rates: [{ day_of_week: 1, start_hour: 18, price: 800 }] },
  ],
})

function mount(entry = '/admin/schedule', courts: CourtWithPhotos[] = [court('c1', 'Court One'), court('c2', 'Court Two', 800)]) {
  vi.mocked(fetchSchedule).mockResolvedValue(scheduleData() as never)
  vi.mocked(fetchCourts).mockResolvedValue(courts)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: [entry] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return router
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })
const HOURS = /^Opening hours/
const PRICES = /^Prices/
const CLOSURES = /^Closures/
// A hidden panel has no accessible name (accname step 2A), so find it through its tab's aria-controls.
const panel = (name: RegExp) => {
  const el = document.getElementById(tab(name).getAttribute('aria-controls') ?? 'none')
  if (!el) throw new Error(`no panel controlled by the tab ${String(name)}`)
  return el
}
const openTab = async (name: RegExp) => userEvent.click(tab(name))
const pick = async (label: string, value: string) => userEvent.selectOptions(await screen.findByLabelText(label), value)
const search = (router: ReturnType<typeof mount>) => router.state.location.search

beforeEach(() => {
  previewMock.mockReset()
  previewMock.mockResolvedValue({ from: '2026-11-05', to: '2027-02-03', bookings: { total: 0, items: [] }, open_play: { total: 0, items: [] } })
  vi.mocked(fetchSchedule).mockReset()
  vi.mocked(fetchClosureConflicts).mockReset().mockResolvedValue({ bookings: [], sessions: [] })
  vi.mocked(saveSchedule).mockReset().mockResolvedValue({ venue_id: 'v1', schedule_revision: 8 } as never)
  vi.mocked(fetchCourts).mockReset()
  vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
})

describe('tabs and the URL', () => {
  it('offers a tablist named Schedule sections with Opening hours, Prices and Closures, and no Weekly Hours & Rates heading', async () => {
    mount()
    const list = await screen.findByRole('tablist', { name: 'Schedule sections' })
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Opening hours', 'Prices', 'Closures'])
    expect(screen.queryByRole('heading', { name: 'Weekly Hours & Rates' })).not.toBeInTheDocument()
  })

  it('opens Opening hours when the URL has no tab or an unknown one', async () => {
    mount('/admin/schedule?tab=nonsense')
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    expect(tab(HOURS)).toHaveAttribute('aria-selected', 'true')
    expect(tab(PRICES)).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel', { name: HOURS })).toBeVisible()
  })

  it('opens the tab named in the URL', async () => {
    mount('/admin/schedule?tab=prices')
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    expect(tab(PRICES)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: PRICES })).toBeVisible()
    expect(panel(HOURS)).toHaveAttribute('role', 'tabpanel')
    expect(panel(HOURS)).toHaveAttribute('aria-labelledby', tab(HOURS).id)
    expect(panel(HOURS)).toHaveAttribute('hidden')
  })

  it('opens Closures from ?tab=closures', async () => {
    mount('/admin/schedule?tab=closures')
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    expect(tab(CLOSURES)).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel', { name: CLOSURES })).getByRole('button', { name: 'Add closure' })).toBeInTheDocument()
  })

  it('clicking a tab pushes the URL, and Back returns to the previous tab', async () => {
    const router = mount()
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    await openTab(PRICES)
    expect(search(router)).toBe('?tab=prices')
    expect(tab(PRICES)).toHaveAttribute('aria-selected', 'true')
    await openTab(CLOSURES)
    expect(search(router)).toBe('?tab=closures')
    await act(async () => { await router.navigate(-1) })
    expect(search(router)).toBe('?tab=prices')
    expect(tab(PRICES)).toHaveAttribute('aria-selected', 'true')
    await act(async () => { await router.navigate(-1) })
    expect(tab(HOURS)).toHaveAttribute('aria-selected', 'true')
  })

  it('each tab controls a tabpanel named by it, and only the open panel is shown', async () => {
    mount()
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    for (const name of [HOURS, PRICES, CLOSURES]) {
      const controlled = document.getElementById(tab(name).getAttribute('aria-controls') ?? 'none')
      expect(controlled).toBe(panel(name))
      expect(controlled).toHaveAttribute('role', 'tabpanel')
      expect(controlled).toHaveAttribute('aria-labelledby', tab(name).id)
    }
    expect(panel(HOURS)).not.toHaveAttribute('hidden')
    expect(panel(PRICES)).toHaveAttribute('hidden')
    expect(panel(CLOSURES)).toHaveAttribute('hidden')
  })
})

describe('tab keyboard behavior', () => {
  it('uses a roving tabindex: the selected tab is the one tab stop', async () => {
    mount('/admin/schedule?tab=prices')
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    expect(tab(PRICES)).toHaveAttribute('tabindex', '0')
    expect(tab(HOURS)).toHaveAttribute('tabindex', '-1')
    expect(tab(CLOSURES)).toHaveAttribute('tabindex', '-1')
    await userEvent.tab()
    expect(tab(PRICES)).toHaveFocus()
  })

  it('ArrowRight moves focus and selection to the next tab and updates the URL', async () => {
    const router = mount()
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    await userEvent.tab()
    expect(tab(HOURS)).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(tab(PRICES)).toHaveFocus()
    expect(tab(PRICES)).toHaveAttribute('aria-selected', 'true')
    expect(tab(PRICES)).toHaveAttribute('tabindex', '0')
    expect(tab(HOURS)).toHaveAttribute('tabindex', '-1')
    expect(search(router)).toBe('?tab=prices')
  })

  it('ArrowLeft and ArrowRight wrap around the ends', async () => {
    mount()
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    await userEvent.tab()
    await userEvent.keyboard('{ArrowLeft}')
    expect(tab(CLOSURES)).toHaveFocus()
    expect(tab(CLOSURES)).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowRight}')
    expect(tab(HOURS)).toHaveFocus()
    expect(tab(HOURS)).toHaveAttribute('aria-selected', 'true')
  })

  it('Home and End jump to the first and last tab and select them', async () => {
    mount('/admin/schedule?tab=prices')
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    await userEvent.tab()
    await userEvent.keyboard('{End}')
    expect(tab(CLOSURES)).toHaveFocus()
    expect(tab(CLOSURES)).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{Home}')
    expect(tab(HOURS)).toHaveFocus()
    expect(tab(HOURS)).toHaveAttribute('aria-selected', 'true')
  })
})

describe('the draft is kept across tabs', () => {
  it('keeps every panel mounted: an hours edit survives a visit to Prices', async () => {
    mount()
    await pick('Monday closes', '12')
    await openTab(PRICES)
    expect(panel(HOURS)).toHaveAttribute('hidden')
    // still in the document, still holding the edit
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    await openTab(HOURS)
    expect(screen.getByRole('tabpanel', { name: HOURS })).toBeVisible()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
  })

  it('keeps a pending rate when switching to Opening hours and back', async () => {
    mount('/admin/schedule?tab=prices')
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    await pick('Prices for', 'c2')
    await pick('Rate from', '9')
    await pick('Rate to', '10')
    await userEvent.type(screen.getByLabelText('Override price'), '950')
    await userEvent.click(screen.getByRole('button', { name: 'Apply rate' }))
    await openTab(HOURS)
    await openTab(PRICES)
    expect(tab(PRICES)).toHaveAccessibleName('Prices, unsaved changes')
    expect(screen.getByLabelText('Override price')).toHaveValue(950)
  })
})

describe('Opening hours tab', () => {
  it('is the opening hours table: day switches and time lists, breaks, the copy row and Courts with different hours, but no rate fields or default rate', async () => {
    mount()
    const hours = within(await screen.findByRole('tabpanel', { name: HOURS }))
    expect(await hours.findByRole('switch', { name: 'Monday open' })).toBeChecked()
    expect(hours.getByLabelText('Monday opens')).toHaveValue('6')
    expect(hours.getByLabelText('Monday closes')).toHaveValue('22')
    expect(within(hours.getByRole('group', { name: 'Monday' })).getByRole('button', { name: /Add a break/ })).toBeInTheDocument()
    expect(hours.getByRole('button', { name: 'Copy to Mon–Fri' })).toBeInTheDocument()
    expect(hours.getByRole('region', { name: 'Courts with different hours' })).toBeInTheDocument()
    expect(hours.getByRole('region', { name: 'Week at a glance' })).toBeInTheDocument()
    expect(hours.queryByRole('combobox', { name: 'Schedule for' })).not.toBeInTheDocument()
    expect(hours.queryByRole('combobox', { name: 'Court hours' })).not.toBeInTheDocument()
    expect(hours.queryByRole('button', { name: /Add .*period/ })).not.toBeInTheDocument()
    expect(hours.queryByRole('button', { name: 'Copy to another court' })).not.toBeInTheDocument()
    expect(hours.queryByRole('group', { name: 'Weekly override rates' })).not.toBeInTheDocument()
    expect(hours.queryByLabelText('Override price')).not.toBeInTheDocument()
    expect(hours.queryByText(/Default rate/)).not.toBeInTheDocument()
    await userEvent.click(hours.getByRole('button', { name: /Edit hours for Court Two/ }))
    expect(hours.getByText(/Editing Court Two only/)).toBeInTheDocument()
    expect(hours.getByLabelText('Monday opens')).toHaveValue('8')
    expect(hours.getByRole('button', { name: 'Copy hours from Court One' })).toBeInTheDocument()
  })
})

describe('Prices tab', () => {
  it('holds the weekly override rate fields, a Prices for select of the courts (first court default) and the default rate line', async () => {
    mount('/admin/schedule?tab=prices')
    const prices = within(await screen.findByRole('tabpanel', { name: PRICES }))
    const select = await prices.findByRole('combobox', { name: 'Prices for' })
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Court One', 'Court Two'])
    expect(select).toHaveDisplayValue('Court One')
    expect(prices.getByRole('group', { name: 'Weekly override rates' })).toBeInTheDocument()
    for (const label of ['Rate day', 'Rate from', 'Rate to', 'Override price']) expect(prices.getByLabelText(label)).toBeInTheDocument()
    expect(prices.getByRole('button', { name: 'Apply rate' })).toBeInTheDocument()
    expect(prices.getByText(/Default rate: ₱700\/hr/)).toBeInTheDocument()
    await userEvent.selectOptions(select, 'Court Two')
    expect(prices.getByText(/Default rate: ₱800\/hr/)).toBeInTheDocument()
  })

  it('says there are no courts when the venue has none', async () => {
    mount('/admin/schedule?tab=prices', [])
    const prices = within(await screen.findByRole('tabpanel', { name: PRICES }))
    expect(await prices.findByText('No courts yet. Add a court to set prices.')).toBeInTheDocument()
    expect(prices.queryByLabelText('Override price')).not.toBeInTheDocument()
  })

  it('applies a rate to the court chosen in Prices for and saves exactly the rate_changes it saved before', async () => {
    mount('/admin/schedule?tab=prices')
    await pick('Prices for', 'c2')
    await pick('Rate day', '2')
    await pick('Rate from', '9')
    await pick('Rate to', '11')
    await userEvent.type(screen.getByLabelText('Override price'), '950')
    await userEvent.click(screen.getByRole('button', { name: 'Apply rate' }))
    await userEvent.click(screen.getByRole('button', { name: 'Review & save' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Review changes' })).getByRole('button', { name: 'Save changes' }))
    expect(saveSchedule).toHaveBeenCalledTimes(1)
    expect(saveSchedule).toHaveBeenCalledWith(7, {
      rate_changes: [
        { court_id: 'c2', day_of_week: 2, start_hour: 9, price: 950 },
        { court_id: 'c2', day_of_week: 2, start_hour: 10, price: 950 },
      ],
    })
  }, 20000)
})

describe('the unsaved-changes dot', () => {
  it('names clean tabs plainly', async () => {
    mount()
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    expect(tab(HOURS)).toHaveAccessibleName('Opening hours')
    expect(tab(PRICES)).toHaveAccessibleName('Prices')
    expect(tab(CLOSURES)).toHaveAccessibleName('Closures')
  })

  it('an hours edit marks Opening hours only, with visually hidden text for screen readers', async () => {
    mount()
    await pick('Monday closes', '12')
    expect(tab(HOURS)).toHaveAccessibleName('Opening hours, unsaved changes')
    expect(tab(PRICES)).toHaveAccessibleName('Prices')
    expect(tab(CLOSURES)).toHaveAccessibleName('Closures')
  })

  it('a court hours change (own hours) also marks Opening hours', async () => {
    mount()
    await userEvent.selectOptions(await screen.findByLabelText('Choose a court'), 'Court One')
    await userEvent.click(screen.getByRole('button', { name: 'Give this court different hours' }))
    expect(tab(HOURS)).toHaveAccessibleName('Opening hours, unsaved changes')
    expect(tab(PRICES)).toHaveAccessibleName('Prices')
  })

  it('a rate edit marks Prices only', async () => {
    mount('/admin/schedule?tab=prices')
    await pick('Rate from', '9')
    await pick('Rate to', '10')
    await userEvent.type(screen.getByLabelText('Override price'), '500')
    await userEvent.click(screen.getByRole('button', { name: 'Apply rate' }))
    expect(tab(PRICES)).toHaveAccessibleName('Prices, unsaved changes')
    expect(tab(HOURS)).toHaveAccessibleName('Opening hours')
    expect(tab(CLOSURES)).toHaveAccessibleName('Closures')
  })

  it('clears when the edit is undone by Discard', async () => {
    mount()
    await pick('Monday closes', '12')
    expect(tab(HOURS)).toHaveAccessibleName('Opening hours, unsaved changes')
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes' })).getByRole('button', { name: 'Discard' }))
    expect(tab(HOURS)).toHaveAccessibleName('Opening hours')
  })

  it('Closures never shows it, even with edits elsewhere', async () => {
    mount('/admin/schedule?tab=closures')
    await screen.findByRole('tablist', { name: 'Schedule sections' })
    await openTab(HOURS)
    await pick('Monday closes', '12')
    await openTab(CLOSURES)
    expect(tab(CLOSURES)).toHaveAccessibleName('Closures')
  })
})
