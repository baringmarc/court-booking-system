// T31.1: the "Slots image" control on the dashboard's Today's courts card. Availability, the venue, the clock and the
// canvas drawing are mocked; the caption, file names and the share, copy and download flows are the subject.
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Slot } from '../booking/selection'
import type { Court, VenueSettings } from '../catalog/api'
import { mediaUrl } from '../catalog/media'
import { THEME_SWATCHES } from '../../lib/themes'
import { buildCaption, buildCourtRanges } from './slotsImage'

type RenderInput = { venueName: string; logoUrl: string | null; palette: unknown; courts: { name: string; ranges: { label: string }[] }[] } & Record<string, unknown>

const h = vi.hoisted(() => ({
  dates: [] as string[],
  slotsByDate: {} as Record<string, unknown[]>,
  state: 'ready' as 'ready' | 'pending' | 'error',
  refetch: undefined as unknown as ReturnType<typeof vi.fn>,
  render: undefined as unknown as Mock<(input: RenderInput) => Promise<Blob>>,
}))

vi.mock('../venue/useVenue', () => ({ useVenue: () => ({ id: 'venue-a', slug: 'a-venue', status: 'active' }) }))
vi.mock('../booking/hooks', () => ({
  useAvailability: (date: string) => {
    h.dates.push(date)
    if (h.state === 'pending') return { data: undefined, isPending: true, isError: false, error: null, refetch: h.refetch }
    if (h.state === 'error') return { data: undefined, isPending: false, isError: true, error: new Error('Could not load slots'), refetch: h.refetch }
    return { data: h.slotsByDate[date] ?? [], isPending: false, isError: false, error: null, refetch: h.refetch }
  },
}))
// 10:30 in Manila on Monday 2030-01-07.
vi.mock('../booking/useNow', () => ({ useNow: () => new Date('2030-01-07T02:30:00.000Z') }))
vi.mock('./slotsImage', async (orig) => ({ ...(await orig<typeof import('./slotsImage')>()), renderSlotsImage: (input: RenderInput) => h.render(input) }))

const TODAY = '2030-01-07'
const TOMORROW = '2030-01-08'
const at = (day: number, hour: number) => new Date(Date.UTC(2030, 0, day, hour - 8)).toISOString()
const free = (court: string, day: number, hour: number): Slot => ({
  court_id: court, slot_start: at(day, hour), slot_end: at(day, hour + 1), price: 350, status: 'free',
  booker_first_name: null, open_play_session_id: null, block_key: null,
})

const settings: VenueSettings = {
  address: '1 Court St', banner_alt: null, banner_path: null, booking_window_days: 14, cancel_cutoff_hours: 24, city: 'Manila',
  currency: 'PHP', logo_path: null, maps_url: '', max_rejections: 3, name: 'Claudex Courts', online_payments_enabled: false,
  payment_hold_minutes: 30, payment_instructions: '', showcase_opt_in: false, slot_minutes: 60, sport_order: [], theme: 'plotline',
  timezone: 'Asia/Manila', updated_at: '2030-01-01T00:00:00Z', venue_id: 'venue-a', waiver_text: '', walk_ins_enabled: false,
}
const court = (id: string, name: string, sort: number): Court => ({
  id, name, sport: 'badminton', description: '', default_hourly_rate: 350, is_active: true, sort_order: sort,
  created_at: '2030-01-01T00:00:00Z', updated_at: '2030-01-01T00:00:00Z', venue_id: 'venue-a',
})
const courts = [court('c1', 'Court 1', 1), court('c2', 'Court 2', 2)]
const ADDRESS = 'http://localhost:3000/book?venue=a-venue'

async function renderControl(over: Partial<VenueSettings> = {}) {
  const { SlotsImageControl } = await import('./SlotsImageControl')
  render(<SlotsImageControl settings={{ ...settings, ...over }} courts={courts} today={TODAY} />)
}

let clicked: { download: string; href: string }[] = []
const nav = navigator as unknown as Record<string, unknown>

beforeEach(() => {
  h.dates = []
  h.state = 'ready'
  h.refetch = vi.fn()
  h.render = vi.fn<(input: RenderInput) => Promise<Blob>>(async () => new Blob([new Uint8Array(8)], { type: 'image/png' }))
  h.slotsByDate = {
    [TODAY]: [14, 15, 16, 20, 21].map((hr) => free('c1', 7, hr)),
    [TOMORROW]: [6, 7].map((hr) => free('c2', 8, hr)),
  }
  clicked = []
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:slots'), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ download: this.download, href: this.href })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete nav.canShare
  delete nav.share
  delete nav.clipboard
})

describe('SlotsImageControl (T31.1)', () => {
  it('is a "Slots image" group with Today checked and Tomorrow available, reading today first', async () => {
    await renderControl()
    const group = screen.getByRole('group', { name: 'Slots image' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Today' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Tomorrow' })).not.toBeChecked()
    expect(h.dates.every((d) => d === TODAY)).toBe(true)
  })

  it('choosing Tomorrow reads tomorrow\'s availability', async () => {
    await renderControl()
    await userEvent.click(screen.getByRole('radio', { name: 'Tomorrow' }))
    expect(screen.getByRole('radio', { name: 'Tomorrow' })).toBeChecked()
    expect(h.dates.at(-1)).toBe(TOMORROW)
  })

  it('Download image saves <slug>-slots-<date>.png for today and for tomorrow', async () => {
    await renderControl()
    await userEvent.click(screen.getByRole('button', { name: 'Download image' }))
    await waitFor(() => expect(clicked).toHaveLength(1))
    expect(clicked[0].download).toBe('a-venue-slots-2030-01-07.png')
    expect(clicked[0].href).toBe('blob:slots')
    await userEvent.click(screen.getByRole('radio', { name: 'Tomorrow' }))
    await userEvent.click(screen.getByRole('button', { name: 'Download image' }))
    await waitFor(() => expect(clicked).toHaveLength(2))
    expect(clicked[1].download).toBe('a-venue-slots-2030-01-08.png')
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('draws the image from the venue, the date label, the clock, the free ranges and the book address', async () => {
    await renderControl()
    await userEvent.click(screen.getByRole('button', { name: 'Download image' }))
    await waitFor(() => expect(h.render).toHaveBeenCalledTimes(1))
    const input = h.render.mock.calls[0][0]
    expect(input).toMatchObject({ venueName: 'Claudex Courts', logoUrl: null, dateLabel: 'Mon, Jan 7', isToday: true, asOf: '10:30 AM', address: ADDRESS })
    expect(input.palette).toEqual(THEME_SWATCHES.plotline.light)
    expect(input.courts.map((c) => [c.name, c.ranges.map((r) => r.label)])).toEqual([
      ['Court 1', ['2–5 PM', '8–10 PM']], ['Court 2', []],
    ])
  })

  it('tomorrow has no "as of" and its own ranges', async () => {
    await renderControl()
    await userEvent.click(screen.getByRole('radio', { name: 'Tomorrow' }))
    await userEvent.click(screen.getByRole('button', { name: 'Download image' }))
    await waitFor(() => expect(h.render).toHaveBeenCalled())
    const input = h.render.mock.calls[0][0]
    expect(input).toMatchObject({ isToday: false, asOf: null, dateLabel: 'Tue, Jan 8' })
    expect(input.courts.map((c) => c.ranges.map((r) => r.label))).toEqual([[], ['6–8 AM']])
  })

  it('uses the venue logo url and the venue theme palette; an unknown theme falls back to the default', async () => {
    await renderControl({ logo_path: 'venue-a/logo.png', theme: 'ocean' })
    await userEvent.click(screen.getByRole('button', { name: 'Download image' }))
    await waitFor(() => expect(h.render).toHaveBeenCalled())
    expect(h.render.mock.calls[0][0].logoUrl).toBe(mediaUrl('venue-a/logo.png'))
    expect(h.render.mock.calls[0][0].palette).toEqual(THEME_SWATCHES.ocean.light)
  })

  it('an unknown theme uses the default palette', async () => {
    await renderControl({ theme: 'not-a-theme' })
    await userEvent.click(screen.getByRole('button', { name: 'Download image' }))
    await waitFor(() => expect(h.render).toHaveBeenCalled())
    expect(h.render.mock.calls[0][0].palette).toEqual(THEME_SWATCHES.plotline.light)
  })

  it('Copy caption writes the caption text and the button reads Copied', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderControl()
    await userEvent.click(screen.getByRole('button', { name: 'Copy caption' }))
    const expected = buildCaption({
      venueName: 'Claudex Courts', dateLabel: 'Mon, Jan 7', isToday: true, address: ADDRESS,
      courts: buildCourtRanges(courts, h.slotsByDate[TODAY] as Slot[], TODAY, 'Asia/Manila', new Date()),
    })
    expect(writeText).toHaveBeenCalledWith(expected)
    expect(expected).toBe('Open slots today at Claudex Courts, Mon, Jan 7:\nCourt 1: 2–5 PM, 8–10 PM\nCourt 2: Fully booked\n\nBook at ' + ADDRESS)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('the caption follows the chosen day', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderControl()
    await userEvent.click(screen.getByRole('radio', { name: 'Tomorrow' }))
    await userEvent.click(screen.getByRole('button', { name: 'Copy caption' }))
    expect(writeText).toHaveBeenCalledWith(
      'Open slots tomorrow at Claudex Courts, Tue, Jan 8:\nCourt 1: Fully booked\nCourt 2: 6–8 AM\n\nBook at ' + ADDRESS,
    )
  })

  it('Share is absent when the browser cannot share files', async () => {
    await renderControl()
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
  })

  it('Share is absent when canShare refuses the file', async () => {
    nav.canShare = vi.fn(() => false)
    await renderControl()
    await waitFor(() => expect(nav.canShare as ReturnType<typeof vi.fn>).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
  })

  it('Share hands the PNG file, named like the download, to the share sheet', async () => {
    const canShare = vi.fn(() => true)
    const share = vi.fn(async () => {})
    nav.canShare = canShare
    nav.share = share
    await renderControl()
    await userEvent.click(await screen.findByRole('button', { name: 'Share' }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const arg = (share.mock.calls[0] as unknown as [{ files: File[] }])[0]
    expect(arg.files).toHaveLength(1)
    expect(arg.files[0].name).toBe('a-venue-slots-2030-01-07.png')
    expect(arg.files[0].type).toBe('image/png')
  })

  it('while availability loads there is a Loading status and no usable buttons', async () => {
    h.state = 'pending'
    await renderControl()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    for (const name of ['Download image', 'Copy caption']) {
      const b = screen.queryByRole('button', { name })
      expect(!b || (b as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('a failed availability read shows the error with a retry that refetches', async () => {
    h.state = 'error'
    await renderControl()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load slots')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(h.refetch).toHaveBeenCalled()
  })

  it('shows the message in an alert when the image cannot be drawn', async () => {
    h.render = vi.fn<(input: RenderInput) => Promise<Blob>>(async () => { throw new Error("This browser can't make images.") })
    await renderControl()
    await userEvent.click(screen.getByRole('button', { name: 'Download image' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("This browser can't make images.")
    expect(clicked).toHaveLength(0)
  })
})
