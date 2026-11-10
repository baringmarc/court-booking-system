// T17.31: the sticky save bar, Discard, the Review changes dialog (plain-word list and affected bookings), conflict and the
// leave-page guard. Hours and prices are one draft and one save_schedule call, whichever tab is open.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { fetchCourts } from '../catalog/api'
import { fetchSchedule, saveSchedule } from './api'
import { SchedulePage } from './SchedulePage'
import { userEvent, court, allDays, scheduleData, mount, HOURS, CLOSURES, openTab, pick, editCourt, backToAll, giveHours, addBreak, bar, barButton, openReview, lines, saveFromDialog, editMonday, addRate } from './scheduleReviewSupport'

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
  previewScheduleImpact: vi.fn(),
}))

describe('the save bar', () => {
  it('is not rendered when nothing changed, and the old controls are gone', async () => {
    mount()
    await screen.findByRole('switch', { name: 'Monday open' })
    expect(bar()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save schedule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revert unsaved changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Pending changes' })).not.toBeInTheDocument()
    expect(screen.queryByText('You have unsaved changes.')).not.toBeInTheDocument()
  })

  it('appears on the first change with "1 unsaved change", Discard and Review & save, and none of the old controls', async () => {
    mount()
    await editMonday()
    const region = screen.getByRole('region', { name: 'Unsaved changes' })
    expect(region).toHaveTextContent(/1 unsaved change(?!s)/)
    expect(within(region).getByRole('button', { name: 'Discard' })).toBeEnabled()
    expect(within(region).getByRole('button', { name: 'Review & save' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Save schedule' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revert unsaved changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Pending changes' })).not.toBeInTheDocument()
    expect(screen.queryByText('You have unsaved changes.')).not.toBeInTheDocument()
  })

  it('counts one per line of the review list: two changed days make "2 unsaved changes"', async () => {
    mount()
    await editMonday()
    await pick('Tuesday closes', '20')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent(/2 unsaved changes/)
  })

  it('is also present while another tab is open, and counts rate edits too', async () => {
    mount()
    await editMonday()
    await openTab(CLOSURES)
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent(/1 unsaved change(?!s)/)
    await addRate('800')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent(/2 unsaved changes/)
    await openTab(CLOSURES)
    expect(barButton('Review & save')).toBeEnabled()
  })

  it('disables Review & save while a day overlaps the next, and enables it again once fixed', async () => {
    mount()
    await pick('Tuesday opens', '1')
    await pick('Monday closes', '26')
    expect(within(screen.getByRole('group', { name: 'Monday' })).getByRole('alert')).toHaveTextContent(/overlap/i)
    expect(barButton('Review & save')).toBeDisabled()
    await pick('Monday closes', '24')
    expect(barButton('Review & save')).toBeEnabled()
  })

  it('disables Review & save while saving', async () => {
    vi.mocked(saveSchedule).mockReturnValue(new Promise(() => {}))
    mount()
    await editMonday()
    await saveFromDialog()
    await waitFor(() => expect(saveSchedule).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Review & save', hidden: true })).toBeDisabled()
  })
})

describe('Discard', () => {
  it('opens the app\'s own dialog "Discard changes" with Keep editing and Discard; the safe button has focus', async () => {
    mount()
    await editMonday()
    await userEvent.click(barButton('Discard'))
    const dialog = await screen.findByRole('dialog', { name: 'Discard changes' })
    expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })

  it('Keep editing keeps the draft and returns focus to the Discard button', async () => {
    mount()
    await editMonday()
    await userEvent.click(barButton('Discard'))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes' })).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('dialog', { name: 'Discard changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(barButton('Discard')).toHaveFocus()
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('Escape keeps the draft and returns focus to the Discard button', async () => {
    mount()
    await editMonday()
    await userEvent.click(barButton('Discard'))
    await screen.findByRole('dialog', { name: 'Discard changes' })
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Discard changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(barButton('Discard')).toHaveFocus()
  })

  it('confirming restores the loaded schedule and rates, hides the bar and never saves', async () => {
    mount()
    await editMonday()
    await addRate('800')
    await openTab(HOURS)
    await userEvent.click(barButton('Discard'))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes' })).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('dialog', { name: 'Discard changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('22')
    expect(bar()).not.toBeInTheDocument()
    expect(saveSchedule).not.toHaveBeenCalled()
    expect(screen.getByRole('tab', { name: 'Opening hours' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Prices' })).toBeInTheDocument()
  })
})

describe('Review changes: the plain-word list', () => {
  it('opens a dialog named Review changes with Keep editing and Save changes', async () => {
    mount()
    await editMonday()
    const dialog = await openReview()
    expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('a venue day reads "Saturday: 6 AM – 10 PM → 7 AM – 9 PM"', async () => {
    mount()
    await pick('Saturday opens', '7')
    await pick('Saturday closes', '21')
    expect(lines(await openReview())).toEqual(['Saturday: 6 AM – 10 PM → 7 AM – 9 PM'])
  })

  it('uses Midnight and (next day) for late closings', async () => {
    mount()
    await pick('Monday closes', '24')
    await pick('Friday closes', '26')
    expect(lines(await openReview())).toEqual([
      'Monday: 6 AM – 10 PM → 6 AM – Midnight',
      'Friday: 6 AM – 10 PM → 6 AM – 2 AM (next day)',
    ])
  })

  it('says Closed for a day with no periods', async () => {
    mount()
    await userEvent.click(await screen.findByRole('switch', { name: 'Tuesday open' }))
    expect(lines(await openReview())).toEqual(['Tuesday: 6 AM – 10 PM → Closed'])
  })

  it('joins several periods with ", " in start order', async () => {
    mount()
    await addBreak('Wednesday')
    await pick('Wednesday break 1 starts', '12')
    await pick('Wednesday break 1 ends', '14')
    expect(lines(await openReview())).toEqual(['Wednesday: 6 AM – 10 PM → 6 AM – 12 PM, 2 PM – 10 PM'])
  })

  it('a day that was closed and opens reads "Closed → 8 AM – 10 AM"', async () => {
    vi.mocked(fetchSchedule).mockResolvedValue(scheduleData({ venue: allDays().filter((p) => p.day_of_week !== 3) }) as never)
    vi.mocked(fetchCourts).mockResolvedValue([court('c1', 'Court One'), court('c2', 'Court Two')])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const router = createMemoryRouter([{ path: '/admin/schedule', element: <SchedulePage /> }], { initialEntries: ['/admin/schedule'] })
    render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
    await userEvent.click(await screen.findByRole('switch', { name: 'Wednesday open' }))
    await pick('Wednesday opens', '8')
    await pick('Wednesday closes', '10')
    expect(lines(await openReview())).toEqual(['Wednesday: Closed → 8 AM – 10 AM'])
  })

  it('a court going to its own hours reads "Court One: now has its own hours"', async () => {
    mount()
    await giveHours('Court One')
    expect(lines(await openReview())).toEqual(['Court One: now has its own hours'])
  })

  it('a court going back to the venue hours reads "Court Two: back to the venue\'s opening hours"', async () => {
    mount()
    await userEvent.click(await within(await screen.findByRole('region', { name: 'Courts with different hours' })).findByRole('button', { name: /^Use opening hours for Court Two/ }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Use opening hours for Court Two' })).getByRole('button', { name: 'Use opening hours' }))
    expect(lines(await openReview())).toEqual(["Court Two: back to the venue's opening hours"])
  })

  it('a custom court\'s day edit reads "Court Two, Monday: 8 AM – 8 PM → 8 AM – 12 PM"', async () => {
    mount()
    await editCourt('Court Two')
    await pick('Monday closes', '12')
    expect(lines(await openReview())).toEqual(['Court Two, Monday: 8 AM – 8 PM → 8 AM – 12 PM'])
  })

  it('a new override shows the court\'s default as "was": "Court Two, Monday 6 AM – 7 AM: ₱800 (was ₱700)"', async () => {
    mount()
    await addRate('800')
    expect(lines(await openReview())).toEqual(['Court Two, Monday 6 AM – 7 AM: ₱800 (was ₱700)'])
  })

  it('changing an existing override shows the old override as "was"', async () => {
    mount()
    await addRate('900', '18', '19')
    expect(lines(await openReview())).toEqual(['Court Two, Monday 6 PM – 7 PM: ₱900 (was ₱800)'])
  })

  it('clearing an override reads "back to the court\'s default rate (₱700)"', async () => {
    mount()
    await addRate('', '18', '19')
    expect(lines(await openReview())).toEqual(["Court Two, Monday 6 PM – 7 PM: back to the court's default rate (₱700)"])
  })

  it('lists one line per changed hour', async () => {
    mount()
    await addRate('800', '6', '8')
    expect(lines(await openReview())).toEqual([
      'Court Two, Monday 6 AM – 7 AM: ₱800 (was ₱700)',
      'Court Two, Monday 7 AM – 8 AM: ₱800 (was ₱700)',
    ])
  })

  it('orders venue days Monday to Sunday, then courts in court order, then prices; the bar count equals the lines', async () => {
    mount()
    await pick('Sunday closes', '20')
    await pick('Saturday opens', '7')
    await pick('Monday closes', '12')
    await giveHours('Court One')
    await backToAll()
    await editCourt('Court Two')
    await pick('Monday closes', '12')
    await addRate('800')
    await openTab(HOURS)
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent(/6 unsaved changes/)
    expect(lines(await openReview())).toEqual([
      'Monday: 6 AM – 10 PM → 6 AM – 12 PM',
      'Saturday: 6 AM – 10 PM → 7 AM – 10 PM',
      'Sunday: 6 AM – 10 PM → 6 AM – 8 PM',
      'Court One: now has its own hours',
      'Court Two, Monday: 8 AM – 8 PM → 8 AM – 12 PM',
      'Court Two, Monday 6 AM – 7 AM: ₱800 (was ₱700)',
    ])
  })
})

