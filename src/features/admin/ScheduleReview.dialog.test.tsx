// T17.31: the Review changes dialog, the bookings it warns about, conflict and save errors, and the leave-page guard.
// Split from ScheduleReview.test.tsx for H12; shared helpers are in scheduleReviewSupport.tsx.
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { formatDateTimeInZone } from '../../lib/time'
import { fetchSchedule, previewScheduleImpact, saveSchedule } from './api'
import { userEvent, TZ, allDays, noImpact, scheduleData, mount, HOURS, PRICES, CLOSURES, openTab, pick, giveHours, bar, barButton, openReview, saveFromDialog, lastChanges, editMonday, addRate, type Impact, type Period } from './scheduleReviewSupport'

const previewMock = vi.mocked(previewScheduleImpact)

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

describe('Review changes: the dialog', () => {
  it('Keep editing closes it, keeps the draft and returns focus to Review & save', async () => {
    mount()
    await editMonday()
    const dialog = await openReview()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('dialog', { name: 'Review changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(barButton('Review & save')).toHaveFocus()
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('Escape closes it and returns focus to Review & save', async () => {
    mount()
    await editMonday()
    await openReview()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Review changes' })).not.toBeInTheDocument()
    expect(barButton('Review & save')).toHaveFocus()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
  })

  it('moves focus inside and keeps Tab and Shift+Tab inside', async () => {
    previewMock.mockResolvedValue({
      ...noImpact(),
      bookings: { total: 1, items: [{ booking_id: 'b1', court_id: 'c2', starts_at: '2026-11-10T00:00:00Z', ends_at: '2026-11-10T01:00:00Z', status: 'confirmed' }] },
    })
    mount()
    await editMonday()
    const dialog = await openReview()
    await within(dialog).findByRole('link')
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    for (let i = 0; i < 8; i++) {
      await userEvent.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    for (let i = 0; i < 8; i++) {
      await userEvent.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('Save changes calls saveSchedule once with the loaded revision and the same changes payload as before', async () => {
    mount()
    await editMonday()
    await saveFromDialog()
    expect(saveSchedule).toHaveBeenCalledTimes(1)
    expect(saveSchedule).toHaveBeenCalledWith(7, {
      venue_periods: allDays().map((p) => (p.day_of_week === 1 ? { ...p, end_minute: 720 } : p)),
    })
  })

  it('sends hours, a custom court and rates together in one save', async () => {
    mount()
    await editMonday()
    await giveHours('Court One')
    await addRate('1000', '8', '9')
    await saveFromDialog()
    expect(saveSchedule).toHaveBeenCalledTimes(1)
    const [revision, changes] = vi.mocked(saveSchedule).mock.calls[0]
    expect(revision).toBe(7)
    expect(changes).toMatchObject({
      courts: [{ court_id: 'c1', schedule_mode: 'custom' }],
      rate_changes: [{ court_id: 'c2', day_of_week: 1, start_hour: 8, price: 1000 }],
    })
    expect((changes as { venue_periods: Period[] }).venue_periods).toContainEqual({ day_of_week: 1, start_minute: 360, end_minute: 720 })
  })

  it('on success the dialog closes, the draft remounts from the saved data and the bar disappears', async () => {
    mount()
    await editMonday()
    vi.mocked(fetchSchedule).mockResolvedValue(
      scheduleData({ revision: 8, venue: allDays().map((p) => (p.day_of_week === 1 ? { ...p, end_minute: 720 } : p)) }) as never)
    await saveFromDialog()
    await waitFor(() => expect(bar()).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Review changes' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(screen.getByRole('tab', { name: 'Opening hours' })).toBeInTheDocument()
    // the next save uses the new revision
    await pick('Monday closes', '20')
    await saveFromDialog()
    expect(vi.mocked(saveSchedule).mock.calls[1][0]).toBe(8)
  })

  it('a price-only save sends only rate_changes', async () => {
    mount()
    await addRate('800')
    await saveFromDialog()
    expect(lastChanges()).toEqual({ rate_changes: [{ court_id: 'c2', day_of_week: 1, start_hour: 6, price: 800 }] })
  })
})

describe('Review changes: existing bookings outside the new hours', () => {
  // Late night and early morning in Manila (UTC+8): 01:00 on Nov 10 is Nov 9 17:00 UTC; 07:30 on Nov 11 is Nov 10 23:30 UTC.
  const late = '2026-11-09T17:00:00Z'
  const early = '2026-11-10T23:30:00Z'
  const withItems = (): Impact => ({
    from: '2026-11-05', to: '2027-02-03',
    bookings: {
      total: 2,
      items: [
        { booking_id: 'b-late', court_id: 'c2', starts_at: late, ends_at: '2026-11-09T18:00:00Z', status: 'confirmed' },
        { booking_id: 'b-early', court_id: 'c1', starts_at: early, ends_at: '2026-11-11T00:30:00Z', status: 'confirmed' },
      ],
    },
    open_play: { total: 1, items: [{ session_id: 's1', court_id: 'c1', title: 'Friday Rally', starts_at: '2026-11-11T10:00:00Z', ends_at: '2026-11-11T12:00:00Z' }] },
  })

  it('shows the section heading, and each booking links to its booking on the venue-zone date', async () => {
    previewMock.mockResolvedValue(withItems())
    mount()
    await editMonday()
    const dialog = await openReview()
    expect(within(dialog).getByRole('heading', { name: 'Bookings outside the new hours' })).toBeInTheDocument()

    const lateLink = await within(dialog).findByRole('link', { name: `Court Two · ${formatDateTimeInZone(late, TZ)} · confirmed` })
    const lateUrl = new URL(lateLink.getAttribute('href') ?? '', 'http://x')
    expect(lateUrl.pathname).toBe('/admin/bookings')
    expect(lateUrl.searchParams.get('status')).toBe('all')
    expect([null, 'all']).toContain(lateUrl.searchParams.get('source'))
    expect(lateUrl.searchParams.get('date')).toBe('2026-11-10') // not the UTC date 2026-11-09
    expect(lateUrl.searchParams.get('booking')).toBe('b-late')

    const earlyLink = within(dialog).getByRole('link', { name: `Court One · ${formatDateTimeInZone(early, TZ)} · confirmed` })
    const earlyUrl = new URL(earlyLink.getAttribute('href') ?? '', 'http://x')
    expect(earlyUrl.searchParams.get('date')).toBe('2026-11-11') // not the UTC date 2026-11-10
    expect(earlyUrl.searchParams.get('booking')).toBe('b-early')
  })

  it('lists open play without a link, and says the reservations stay booked', async () => {
    previewMock.mockResolvedValue(withItems())
    mount()
    await editMonday()
    const dialog = await openReview()
    const item = (await within(dialog).findByText(/Friday Rally/)).closest('li')!
    expect(item).toHaveTextContent(`Friday Rally · Court One · ${formatDateTimeInZone('2026-11-11T10:00:00Z', TZ)}`)
    expect(within(item).queryByRole('link')).not.toBeInTheDocument()
    expect(within(dialog).getByText('These stay booked. Only new bookings follow the new hours.')).toBeInTheDocument()
  })

  it('previews the whole hours draft', async () => {
    mount()
    await editMonday()
    await openReview()
    await waitFor(() => expect(previewMock).toHaveBeenCalled())
    const [draft] = previewMock.mock.calls.at(-1)!
    expect(draft.venue_periods.filter((p: Period) => p.day_of_week === 1)).toEqual([{ day_of_week: 1, start_minute: 360, end_minute: 720 }])
    expect(draft.courts.map((c: { court_id: string }) => c.court_id)).toEqual(['c1', 'c2'])
  })

  it('says nothing is affected for a zero result', async () => {
    mount()
    await editMonday()
    const dialog = await openReview()
    expect(await within(dialog).findByText(/No existing reservations are affected/)).toBeInTheDocument()
  })

  it('says it is checking while the preview is pending, and Save changes still works', async () => {
    previewMock.mockReturnValue(new Promise(() => {}))
    mount()
    await editMonday()
    const dialog = await openReview()
    expect(within(dialog).getByText('Checking existing reservations…')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(saveSchedule).toHaveBeenCalledTimes(1)
  })

  it('a failed preview is quiet, retryable and does not block saving', async () => {
    previewMock.mockRejectedValueOnce(new Error('boom'))
    previewMock.mockResolvedValue(withItems())
    mount()
    await editMonday()
    const dialog = await openReview()
    expect(await within(dialog).findByText("Couldn't check existing reservations. You can still save; existing reservations are always kept.")).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }))
    expect(await within(dialog).findByRole('link', { name: `Court Two · ${formatDateTimeInZone(late, TZ)} · confirmed` })).toBeInTheDocument()
  })

  it('a price-only change asks for no impact and shows no impact section', async () => {
    mount()
    await addRate('800')
    const dialog = await openReview()
    expect(within(dialog).queryByRole('heading', { name: 'Bookings outside the new hours' })).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/Checking existing reservations/)).not.toBeInTheDocument()
    expect(previewMock).not.toHaveBeenCalled()
  })

  it('is not shown on the page itself, outside the dialog', async () => {
    previewMock.mockResolvedValue(withItems())
    mount()
    await editMonday()
    expect(screen.queryByRole('region', { name: 'Reservations outside the new hours' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Bookings outside the new hours' })).not.toBeInTheDocument()
  })
})

describe('conflict and save errors', () => {
  it('schedule_conflict closes the dialog, keeps the draft, offers Reload latest and disables Review & save until reload', async () => {
    vi.mocked(saveSchedule).mockRejectedValue(new ApiError('The schedule changed. Reload and try again.', 'P0001', 'schedule_conflict'))
    mount()
    await editMonday()
    await saveFromDialog()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/reload/i)
    expect(screen.queryByRole('dialog', { name: 'Review changes' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    expect(barButton('Review & save')).toBeDisabled()
    await waitFor(() => expect(vi.mocked(fetchSchedule).mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('the conflict alert shows on whichever tab is open', async () => {
    vi.mocked(saveSchedule).mockRejectedValue(new ApiError('The schedule changed. Reload and try again.', 'P0001', 'schedule_conflict'))
    mount()
    await editMonday()
    await saveFromDialog()
    await screen.findByRole('alert')
    await openTab(PRICES)
    expect(screen.getByRole('alert')).toHaveTextContent(/reload/i)
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeVisible()
    await openTab(CLOSURES)
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeVisible()
  })

  it('Reload latest refetches and remounts the draft clean', async () => {
    vi.mocked(saveSchedule).mockRejectedValue(new ApiError('The schedule changed. Reload and try again.', 'P0001', 'schedule_conflict'))
    mount()
    await editMonday()
    await saveFromDialog()
    const reload = await screen.findByRole('button', { name: 'Reload latest' })
    vi.mocked(fetchSchedule).mockResolvedValue(
      scheduleData({ revision: 9, venue: allDays().map((p) => (p.day_of_week === 1 ? { ...p, end_minute: 1200 } : p)) }) as never)
    await userEvent.click(reload)
    await waitFor(() => expect(screen.getByLabelText('Monday closes')).toHaveValue('20'))
    expect(bar()).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload latest' })).not.toBeInTheDocument()
  })

  it('shows other save errors in an alert with the message and a Try again that saves again', async () => {
    vi.mocked(saveSchedule).mockRejectedValueOnce(new ApiError('permission denied for table courts', 'P0001'))
    mount()
    await editMonday()
    await saveFromDialog()
    expect(await screen.findByText(/permission denied for table courts/)).toBeInTheDocument()
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    await openTab(PRICES)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(saveSchedule).toHaveBeenCalledTimes(2))
    expect(vi.mocked(saveSchedule).mock.calls[1]).toEqual(vi.mocked(saveSchedule).mock.calls[0])
    await waitFor(() => expect(bar()).not.toBeInTheDocument())
  })
})

describe('the leave-page guard', () => {
  it('warns when leaving with unsaved changes; Stay keeps the draft, Leave goes without saving', async () => {
    mount()
    await editMonday()
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Stay' }))
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Leave' }))
    expect(await screen.findByText('Elsewhere page')).toBeInTheDocument()
    expect(saveSchedule).not.toHaveBeenCalled()
  })

  it('does not block leaving when nothing is pending', async () => {
    mount()
    await screen.findByRole('switch', { name: 'Monday open' })
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    expect(await screen.findByText('Elsewhere page')).toBeInTheDocument()
  })

  it('switching tabs inside the page never triggers it', async () => {
    const router = mount()
    await editMonday()
    await openTab(PRICES)
    await openTab(CLOSURES)
    await openTab(HOURS)
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin/schedule')
    expect(screen.getByLabelText('Monday closes')).toHaveValue('12')
  })

  it('still fires when dirty and another tab is open', async () => {
    mount()
    await editMonday()
    await openTab(CLOSURES)
    await userEvent.click(screen.getByRole('link', { name: 'Elsewhere' }))
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument()
  })
})
