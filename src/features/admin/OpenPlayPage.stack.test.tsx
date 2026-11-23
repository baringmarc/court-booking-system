// T29.7: "Run this as a stack" on /admin/open-play: confirm, create the live stack, hand off to plotline.fit.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import baseUserEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { zonedLocalToISO } from '../../lib/time'
import { ApiError } from '../../lib/queryClient'
import { fetchCourts, fetchStaffSchedule, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { fetchUpcomingOpenPlay, type OpenPlaySession } from '../openPlay/api'
import { createVenueLiveStack } from './api'
import { OpenPlayPage } from './OpenPlayPage'

const userEvent = baseUserEvent.setup({ delay: null })

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchVenueSettings: vi.fn(),
  fetchStaffSchedule: vi.fn(),
}))
vi.mock('../openPlay/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchUpcomingOpenPlay: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createVenueLiveStack: vi.fn(),
}))

const court = (id: string, name: string) => ({ id, name, sport: 'pickleball', is_active: true, court_photos: [] }) as unknown as CourtWithPhotos
const base: OpenPlaySession = {
  id: 'S1', title: 'Saturday open play', details: '', links: [],
  starts_at: '2030-01-05T05:00:00.000Z', // Sat 1 PM Manila
  ends_at: '2030-01-05T07:00:00.000Z',
  court_ids: ['A'],
}
const inProgress: OpenPlaySession = { ...base, id: 'S0', title: 'Morning drills', starts_at: '2030-01-04T01:00:00.000Z', ends_at: '2030-01-04T03:00:00.000Z' }
const laterToday: OpenPlaySession = { ...base, id: 'S2', title: 'Evening ladder', starts_at: '2030-01-04T10:00:00.000Z', ends_at: '2030-01-04T12:00:00.000Z' }
// 00:30 on Sat 5 Jan in Manila, but still Fri 4 Jan in UTC.
const justAfterMidnight: OpenPlaySession = { ...base, id: 'S3', title: 'Midnight run', starts_at: '2030-01-04T16:30:00.000Z', ends_at: '2030-01-04T18:30:00.000Z' }

const FRI_10AM_MANILA = new Date('2030-01-04T02:00:00.000Z')
const SAT_0030_MANILA = new Date('2030-01-04T16:30:00.000Z') // Fri 16:30 UTC

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><OpenPlayPage /></QueryClientProvider>)
}

const runButton = (title: string) => screen.findByRole('button', { name: `Run ${title} as a stack` })

describe('OpenPlayPage: run as a stack', () => {
  let open: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(FRI_10AM_MANILA)
    vi.mocked(fetchStaffSchedule).mockReset().mockImplementation(async (date) => ['A'].map((court_id) => ({ court_id, operating_date: date, period_start: zonedLocalToISO(`${date}T06:00`, 'Asia/Manila'), period_end: zonedLocalToISO(`${date}T22:00`, 'Asia/Manila') })))
    vi.mocked(fetchCourts).mockReset().mockResolvedValue([court('A', 'Pickleball 1')])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
    vi.mocked(fetchUpcomingOpenPlay).mockReset().mockResolvedValue([base])
    vi.mocked(createVenueLiveStack).mockReset().mockResolvedValue({ code: 'CODE42', secret: 'sec ret/1' })
    open = vi.spyOn(window, 'open').mockReturnValue(null)
  })

  afterEach(() => {
    open.mockRestore()
    vi.useRealTimers()
  })

  it('shows a button per listed session and none when the list is empty', async () => {
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([base, inProgress])
    renderPage()
    expect(await runButton('Saturday open play')).toHaveTextContent('Run this as a stack')
    expect(await runButton('Morning drills')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /as a stack$/ })).toHaveLength(2)
  })

  it('has no button when there are no upcoming sessions', async () => {
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No upcoming open play sessions.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /as a stack$/ })).toBeNull()
  })

  it('is disabled before the session day begins in the venue zone, enabled once the day has begun', async () => {
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([base, inProgress, laterToday, justAfterMidnight])
    renderPage()
    expect(await runButton('Saturday open play')).toBeDisabled()   // tomorrow
    expect(await runButton('Midnight run')).toBeDisabled()          // tomorrow in Manila, still today in UTC
    expect(await runButton('Morning drills')).toBeEnabled()         // in progress
    expect(await runButton('Evening ladder')).toBeEnabled()         // later today
  })

  it('is enabled after midnight in the venue zone, even while it is still the previous day in UTC', async () => {
    vi.setSystemTime(SAT_0030_MANILA)
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([base, justAfterMidnight])
    renderPage()
    expect(await runButton('Saturday open play')).toBeEnabled()
    expect(await runButton('Midnight run')).toBeEnabled()
  })

  it('opens a confirm dialog with the takeover notice, and Not now makes no call', async () => {
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([inProgress])
    renderPage()
    await userEvent.click(await runButton('Morning drills'))
    const dialog = await screen.findByRole('dialog', { name: 'Run this as a stack' })
    expect(dialog).toHaveTextContent(/already running on another device/i)
    expect(dialog).toHaveTextContent(/newest device takes over/i)
    expect(within(dialog).getByRole('button', { name: 'Open the stack' })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(createVenueLiveStack).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  })

  it('confirming creates the stack for that session and opens the hand-off URL with the secret only in the fragment', async () => {
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([base, inProgress])
    renderPage()
    await userEvent.click(await runButton('Morning drills'))
    const dialog = await screen.findByRole('dialog', { name: 'Run this as a stack' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open the stack' }))
    expect(createVenueLiveStack).toHaveBeenCalledTimes(1)
    expect(createVenueLiveStack).toHaveBeenCalledWith('S0')
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1))
    expect(open).toHaveBeenCalledWith(
      `https://plotline.fit/paddle-stack?live=CODE42#key=${encodeURIComponent('sec ret/1')}`, '_blank', 'noopener')
    const [url] = open.mock.calls[0] as [string]
    expect(url.split('#')[0]).not.toContain('sec')
    expect(url.split('#')[1]).toBe(`key=${encodeURIComponent('sec ret/1')}`)
  })

  it('disables the confirm button while the request is pending', async () => {
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([inProgress])
    let resolve!: (v: { code: string; secret: string }) => void
    vi.mocked(createVenueLiveStack).mockReturnValue(new Promise((r) => { resolve = r }))
    renderPage()
    await userEvent.click(await runButton('Morning drills'))
    const dialog = await screen.findByRole('dialog', { name: 'Run this as a stack' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open the stack' }))
    await vi.waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Open the stack' })).toBeDisabled())
    expect(createVenueLiveStack).toHaveBeenCalledTimes(1)
    resolve({ code: 'C', secret: 'S' })
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1))
  })

  it('shows the error in the dialog, keeps it open and opens nothing', async () => {
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([inProgress])
    vi.mocked(createVenueLiveStack).mockRejectedValue(new ApiError('That open play session has ended.', 'P0001', 'session_ended'))
    renderPage()
    await userEvent.click(await runButton('Morning drills'))
    const dialog = await screen.findByRole('dialog', { name: 'Run this as a stack' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open the stack' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That open play session has ended.')
    expect(screen.getByRole('dialog', { name: 'Run this as a stack' })).toBeInTheDocument()
    expect(open).not.toHaveBeenCalled()
  })
})
