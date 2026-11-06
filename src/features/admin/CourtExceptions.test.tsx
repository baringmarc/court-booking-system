// T17.32: "Courts with different hours" under the opening hours table. A court with its own hours is listed with the days
// that differ; Edit hours opens the same table under an "Editing Court N only" banner; Use opening hours (confirmed in the
// app's own dialog) returns it to the venue's hours; Give this court different hours starts from a copy of the venue's.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchCourts, fetchUpcomingBlackouts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { fetchSchedule, saveSchedule, type ScheduleData, type SchedulePeriod } from './api'
import { SchedulePage } from './SchedulePage'

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
  previewScheduleImpact: vi.fn().mockResolvedValue({ from: '', to: '', bookings: { total: 0, items: [] }, open_play: { total: 0, items: [] } }),
}))

const p = (day: number, startHour: number, endHour: number): SchedulePeriod => ({ day_of_week: day, start_minute: startHour * 60, end_minute: endHour * 60 })
const week = (start = 6, end = 22): SchedulePeriod[] => [0, 1, 2, 3, 4, 5, 6].map((d) => p(d, start, end))
const replaceDays = (base: SchedulePeriod[], ...extra: SchedulePeriod[]) =>
  [...base.filter((x) => !extra.some((e) => e.day_of_week === x.day_of_week)), ...extra]
    .sort((a, b) => a.day_of_week - b.day_of_week || a.start_minute - b.start_minute)

const court = (id: string, name: string): CourtWithPhotos => ({
  id, name, sport: 'tennis', default_hourly_rate: 700, is_active: true, sort_order: 1, court_photos: [],
  venue_id: 'v1', description: '', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
})
const TWO_OWN = replaceDays(week(), p(1, 8, 20)).filter((x) => x.day_of_week !== 6) // Monday 8 AM – 8 PM, Saturday closed
const THREE_OWN = replaceDays(week(), p(2, 9, 17)) // Tuesday 9 AM – 5 PM

function mount(over: { venue?: SchedulePeriod[]; modes?: Record<string, 'inherit' | 'custom'>; courts?: CourtWithPhotos[] } = {}) {
  const courts = over.courts ?? [court('c1', 'Court One'), court('c2', 'Court Two'), court('c3', 'Court Three'), court('c4', 'Court Four')]
  const mode = (id: string) => over.modes?.[id] ?? (id === 'c1' ? 'inherit' : 'custom')
  const periodsOf = (id: string) => (id === 'c2' ? TWO_OWN : id === 'c3' ? THREE_OWN : id === 'c4' ? week() : [])
  const data: ScheduleData = {
    venue_id: 'v1',
    schedule_revision: 7,
    venue_periods: over.venue ?? week(),
    courts: courts.map((c) => ({
      court_id: c.id, schedule_mode: mode(c.id), schedule_revision: 0,
      periods: mode(c.id) === 'custom' ? periodsOf(c.id) : [], rates: [],
    })),
  }
  vi.mocked(fetchSchedule).mockResolvedValue(data)
  vi.mocked(fetchCourts).mockResolvedValue(courts)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: ['/admin/schedule'] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}

const section = async () => within(await screen.findByRole('region', { name: 'Courts with different hours' }))
const item = async (name: string) => {
  const found = (await section()).getAllByRole('listitem').find((li) => li.textContent?.includes(name))
  if (!found) throw new Error(`no list item for ${name}`)
  return within(found)
}
const editCourt = async (name: string) => userEvent.click((await item(name)).getByRole('button', { name: /^Edit hours/ }))
const back = () => userEvent.click(screen.getByRole('button', { name: 'Back to all courts' }))
const pick = async (label: string, value: string) => userEvent.selectOptions(await screen.findByLabelText(label), value)
const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' })
const reviewButton = () => screen.getByRole('button', { name: 'Review & save' })
const save = async () => {
  await userEvent.click(reviewButton())
  await userEvent.click(within(await screen.findByRole('dialog', { name: 'Review changes' })).getByRole('button', { name: 'Save changes' }))
}
const lastChanges = () => vi.mocked(saveSchedule).mock.calls.at(-1)![1] as Record<string, unknown>
const give = async (name: string) => {
  await userEvent.selectOptions(await screen.findByLabelText('Choose a court'), name)
  await userEvent.click(screen.getByRole('button', { name: 'Give this court different hours' }))
}

beforeEach(() => {
  vi.mocked(fetchUpcomingBlackouts).mockReset().mockResolvedValue([])
  vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
  vi.mocked(fetchSchedule).mockReset()
  vi.mocked(fetchCourts).mockReset()
  vi.mocked(saveSchedule).mockReset().mockResolvedValue({ venue_id: 'v1', schedule_revision: 8 } as never)
})

describe('the list', () => {
  it('lists the courts with their own hours and not the ones on the opening hours', async () => {
    mount()
    const names = (await section()).getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(names.some((t) => t.includes('Court Two'))).toBe(true)
    expect(names.some((t) => t.includes('Court Three'))).toBe(true)
    expect(names.some((t) => t.includes('Court One'))).toBe(false)
  })

  it('summarises the days that differ from the opening hours, and only those', async () => {
    mount()
    const two = await item('Court Two')
    expect(two.getByText(/Monday: 8 AM – 8 PM/)).toBeInTheDocument()
    expect(two.getByText(/Saturday: Closed/)).toBeInTheDocument()
    expect(two.queryByText(/Tuesday/)).not.toBeInTheDocument()
    const three = await item('Court Three')
    expect(three.getByText(/Tuesday: 9 AM – 5 PM/)).toBeInTheDocument()
    expect(three.queryByText(/Monday/)).not.toBeInTheDocument()
  })

  it('says so when a court with its own hours has the same days as the venue', async () => {
    mount()
    expect((await item('Court Four')).getByText(/same as/i)).toBeInTheDocument()
  })

  it('has an Edit hours and a Use opening hours button for each listed court, named for the court', async () => {
    mount()
    const two = await item('Court Two')
    expect(two.getByRole('button', { name: 'Edit hours for Court Two' })).toBeInTheDocument()
    expect(two.getByRole('button', { name: 'Use opening hours for Court Two' })).toBeInTheDocument()
  })

  it('offers no list and no Give control when the venue has no courts', async () => {
    mount({ courts: [] })
    await screen.findByRole('switch', { name: 'Monday open' })
    expect(screen.queryByRole('button', { name: 'Give this court different hours' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit hours/ })).not.toBeInTheDocument()
  })
})

describe('edit hours', () => {
  it('opens the table for that court under an "Editing Court Two only" banner with its own hours', async () => {
    mount()
    await editCourt('Court Two')
    expect(screen.getByText(/Editing Court Two only/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to all courts' })).toBeInTheDocument()
    expect(screen.getByLabelText('Monday opens')).toHaveValue('8')
    expect(screen.getByLabelText('Monday closes')).toHaveValue('20')
    expect(screen.getByRole('switch', { name: 'Saturday open' })).not.toBeChecked()
  })

  it('edits the court\'s draft, not the venue\'s: Back to all courts shows the venue table unchanged and the list updated', async () => {
    mount()
    await editCourt('Court Two')
    await pick('Monday closes', '12')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('1 unsaved change')
    await back()
    expect(screen.queryByText(/Editing Court Two only/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday opens')).toHaveValue('6')
    expect(screen.getByLabelText('Monday closes')).toHaveValue('22')
    expect((await item('Court Two')).getByText(/Monday: 8 AM – 12 PM/)).toBeInTheDocument()
    expect(bar()).toBeInTheDocument()
  })

  it('saves only the court: schedule_mode custom with its seven days, and no venue_periods', async () => {
    mount()
    await editCourt('Court Two')
    await pick('Monday closes', '12')
    await save()
    expect(saveSchedule).toHaveBeenCalledTimes(1)
    expect(saveSchedule).toHaveBeenCalledWith(7, {
      courts: [{ court_id: 'c2', schedule_mode: 'custom', periods: replaceDays(TWO_OWN, p(1, 8, 12)) }],
    })
  })

  it('a court\'s own table supports breaks and the Open/Closed switch', async () => {
    mount()
    await editCourt('Court Three')
    await userEvent.click(screen.getByRole('switch', { name: 'Sunday open' }))
    await userEvent.click(within(screen.getByRole('group', { name: 'Tuesday' })).getByRole('button', { name: /Add a break/ }))
    expect(within(screen.getByRole('group', { name: 'Tuesday' })).getByText(/^Break /)).toBeInTheDocument()
    await save()
    const periods = (lastChanges().courts as { periods: SchedulePeriod[] }[])[0].periods
    expect(periods.some((x) => x.day_of_week === 0)).toBe(false)
    expect(periods.filter((x) => x.day_of_week === 2)).toHaveLength(2)
  })

  it('an overlap in the court\'s hours is explained and blocks Review & save', async () => {
    mount()
    await editCourt('Court Four')
    await pick('Tuesday opens', '1')
    await pick('Monday closes', '26')
    expect(within(screen.getByRole('group', { name: 'Monday' })).getByRole('alert')).toHaveTextContent(/overlap/i)
    expect(reviewButton()).toBeDisabled()
  })

  it('Back to all courts without changes leaves nothing to save', async () => {
    mount()
    await editCourt('Court Two')
    await back()
    expect(bar()).not.toBeInTheDocument()
  })
})

describe('use opening hours', () => {
  it('asks in the app\'s own dialog; Keep different hours leaves the court as it was', async () => {
    mount()
    await userEvent.click((await item('Court Two')).getByRole('button', { name: /^Use opening hours/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Use opening hours for Court Two' })
    expect(within(dialog).getByRole('button', { name: 'Keep different hours' })).toHaveFocus()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep different hours' }))
    expect(screen.queryByRole('dialog', { name: 'Use opening hours for Court Two' })).not.toBeInTheDocument()
    expect((await item('Court Two')).getByText(/Monday: 8 AM – 8 PM/)).toBeInTheDocument()
    expect(bar()).not.toBeInTheDocument()
  })

  it('Escape also keeps the different hours', async () => {
    mount()
    await userEvent.click((await item('Court Two')).getByRole('button', { name: /^Use opening hours/ }))
    await screen.findByRole('dialog', { name: 'Use opening hours for Court Two' })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Use opening hours for Court Two' })).not.toBeInTheDocument()
    expect(bar()).not.toBeInTheDocument()
  })

  it('confirming takes the court out of the list and saves it as inherit', async () => {
    mount()
    await userEvent.click((await item('Court Two')).getByRole('button', { name: /^Use opening hours/ }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Use opening hours for Court Two' })).getByRole('button', { name: 'Use opening hours' }))
    expect((await section()).getAllByRole('listitem').some((li) => li.textContent?.includes('Court Two'))).toBe(false)
    await save()
    expect(saveSchedule).toHaveBeenCalledWith(7, { courts: [{ court_id: 'c2', schedule_mode: 'inherit' }] })
  })
})

describe('give this court different hours', () => {
  it('offers only the courts that follow the opening hours', async () => {
    mount()
    const select = await screen.findByLabelText('Choose a court')
    const options = within(select).getAllByRole('option').map((o) => o.textContent)
    expect(options).toContain('Court One')
    expect(options).not.toContain('Court Two')
    expect(options).not.toContain('Court Four')
  })

  it('starts from a copy of the venue\'s current hours, edit view open, and lists the court afterwards', async () => {
    mount()
    await pick('Monday closes', '16') // an unsaved venue edit is part of "the venue's hours"
    await give('Court One')
    expect(screen.getByText(/Editing Court One only/)).toBeInTheDocument()
    expect(screen.getByLabelText('Monday opens')).toHaveValue('6')
    expect(screen.getByLabelText('Monday closes')).toHaveValue('16')
    await back()
    expect((await item('Court One')).getByText(/same as/i)).toBeInTheDocument()
  })

  it('saves the court as custom with the copied seven days, and nothing else about the court', async () => {
    mount()
    await give('Court One')
    await save()
    expect(saveSchedule).toHaveBeenCalledWith(7, { courts: [{ court_id: 'c1', schedule_mode: 'custom', periods: week() }] })
  })

  it('is one change in the review list', async () => {
    mount()
    await give('Court One')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('1 unsaved change')
    await userEvent.click(reviewButton())
    const dialog = await screen.findByRole('dialog', { name: 'Review changes' })
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Court One: now has its own hours'])
  })

  it('a court that was just given hours can go back to the opening hours with nothing left to save', async () => {
    mount()
    await give('Court One')
    await back()
    await userEvent.click((await item('Court One')).getByRole('button', { name: /^Use opening hours/ }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Use opening hours for Court One' })).getByRole('button', { name: 'Use opening hours' }))
    expect(bar()).not.toBeInTheDocument()
  })
})

describe('copy hours from a court', () => {
  it('is offered only inside a court\'s edit view, for each other court', async () => {
    mount()
    expect(screen.queryByRole('button', { name: /^Copy hours from Court/ })).not.toBeInTheDocument()
    await editCourt('Court Two')
    for (const name of ['Court One', 'Court Three', 'Court Four']) {
      expect(screen.getByRole('button', { name: `Copy hours from ${name}` })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Copy hours from Court Two' })).not.toBeInTheDocument()
  })

  it('copies the other court\'s whole week into this court\'s draft and saves it', async () => {
    mount()
    await editCourt('Court Two')
    await userEvent.click(screen.getByRole('button', { name: 'Copy hours from Court Three' }))
    expect(screen.getByLabelText('Tuesday opens')).toHaveValue('9')
    expect(screen.getByLabelText('Tuesday closes')).toHaveValue('17')
    expect(screen.getByLabelText('Monday opens')).toHaveValue('6')
    expect(screen.getByRole('switch', { name: 'Saturday open' })).toBeChecked()
    await save()
    expect(saveSchedule).toHaveBeenCalledWith(7, { courts: [{ court_id: 'c2', schedule_mode: 'custom', periods: THREE_OWN }] })
  })

  it('copying from a court that follows the opening hours copies the venue\'s hours', async () => {
    mount()
    await editCourt('Court Two')
    await userEvent.click(screen.getByRole('button', { name: 'Copy hours from Court One' }))
    expect(screen.getByLabelText('Monday opens')).toHaveValue('6')
    expect(screen.getByRole('switch', { name: 'Saturday open' })).toBeChecked()
    await save()
    expect(saveSchedule).toHaveBeenCalledWith(7, { courts: [{ court_id: 'c2', schedule_mode: 'custom', periods: week() }] })
  })

  it('leaves the source court and the venue untouched', async () => {
    mount()
    await editCourt('Court Two')
    await userEvent.click(screen.getByRole('button', { name: 'Copy hours from Court Three' }))
    await back()
    expect((await item('Court Three')).getByText(/Tuesday: 9 AM – 5 PM/)).toBeInTheDocument()
    expect(screen.getByLabelText('Tuesday opens')).toHaveValue('6')
    await save()
    expect(Object.keys(lastChanges())).toEqual(['courts'])
    expect((lastChanges().courts as { court_id: string }[]).map((c) => c.court_id)).toEqual(['c2'])
  })
})
