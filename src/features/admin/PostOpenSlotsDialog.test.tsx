// T31.1b: the "Post your open courts" dialog (replaces T31.1's inline control). Availability, the venue, the clock and the
// canvas drawing are mocked; the preview, caption, download and copy flows are the subject.
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

let onClose: Mock<() => void>
async function renderDialog(over: Partial<VenueSettings> = {}) {
  const { PostOpenSlotsDialog } = await import('./PostOpenSlotsDialog')
  render(<PostOpenSlotsDialog settings={{ ...settings, ...over }} courts={courts} today={TODAY} onClose={onClose} />)
}

let clicked: { download: string; href: string }[] = []
let urlCount = 0
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
  onClose = vi.fn<() => void>()
  clicked = []
  urlCount = 0
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:slots-${++urlCount}`), revokeObjectURL: vi.fn() }))
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

const preview = () => screen.findByRole('img', { name: /^Open slots (today|tomorrow) at / })

describe('PostOpenSlotsDialog (T31.1b)', () => {
  it('is a modal dialog named "Post your open courts" with the hint, Close and Day radios', async () => {
    await renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Post your open courts' })
    expect(dialog).toHaveAttribute('open')
    expect(screen.getByText("A picture of every court's free times, and a caption with your booking link. Post them together on Facebook or Messenger.")).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Day' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Today · Mon, Jan 7' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Tomorrow · Tue, Jan 8' })).not.toBeChecked()
    expect(h.dates.every((d) => d === TODAY)).toBe(true)
  })

  it('Close calls onClose', async () => {
    await renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('draws the preview automatically, with no Preview button', async () => {
    await renderDialog()
    const img = await preview()
    expect(img).toHaveAttribute('alt', 'Open slots today at Claudex Courts, Mon, Jan 7')
    expect(img).toHaveAttribute('src', 'blob:slots-1')
    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument()
    expect(screen.getByText('Press and hold the picture to save it to Photos.')).toBeInTheDocument()
  })

  it('choosing Tomorrow reads tomorrow, redraws, swaps the picture and revokes the old URL', async () => {
    await renderDialog()
    await preview()
    await userEvent.click(screen.getByRole('radio', { name: 'Tomorrow · Tue, Jan 8' }))
    expect(h.dates.at(-1)).toBe(TOMORROW)
    const img = await screen.findByRole('img', { name: 'Open slots tomorrow at Claudex Courts, Tue, Jan 8' })
    await waitFor(() => expect(img.getAttribute('src')).not.toBe('blob:slots-1'))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:slots-1')
    expect(h.render.mock.calls.at(-1)![0]).toMatchObject({ isToday: false, asOf: null, dateLabel: 'Tue, Jan 8' })
  })

  it('draws from the venue, date label, clock, free ranges and book address', async () => {
    await renderDialog()
    await preview()
    const input = h.render.mock.calls[0][0]
    expect(input).toMatchObject({ venueName: 'Claudex Courts', logoUrl: null, dateLabel: 'Mon, Jan 7', isToday: true, asOf: '10:30 AM', address: ADDRESS })
    expect(input.palette).toEqual(THEME_SWATCHES.plotline.light)
    expect(input.courts.map((c) => [c.name, c.ranges.map((r) => r.label)])).toEqual([
      ['Court 1', ['2–5 PM', '8–10 PM']], ['Court 2', []],
    ])
  })

  it('tomorrow has its own ranges', async () => {
    await renderDialog()
    await userEvent.click(screen.getByRole('radio', { name: 'Tomorrow · Tue, Jan 8' }))
    await screen.findByRole('img', { name: /^Open slots tomorrow at / })
    expect(h.render.mock.calls.at(-1)![0].courts.map((c) => c.ranges.map((r) => r.label))).toEqual([[], ['6–8 AM']])
  })

  it('uses the venue logo url and theme palette; an unknown theme falls back to the default', async () => {
    await renderDialog({ logo_path: 'venue-a/logo.png', theme: 'ocean' })
    await preview()
    expect(h.render.mock.calls[0][0].logoUrl).toBe(mediaUrl('venue-a/logo.png'))
    expect(h.render.mock.calls[0][0].palette).toEqual(THEME_SWATCHES.ocean.light)
  })

  it('an unknown theme uses the default palette', async () => {
    await renderDialog({ theme: 'not-a-theme' })
    await preview()
    expect(h.render.mock.calls[0][0].palette).toEqual(THEME_SWATCHES.plotline.light)
  })

  it('shows a read-only Caption textarea equal to the caption for the chosen day', async () => {
    await renderDialog()
    const box = screen.getByRole('textbox', { name: 'Caption' }) as HTMLTextAreaElement
    expect(box.tagName).toBe('TEXTAREA')
    expect(box).toHaveAttribute('readonly')
    const expected = buildCaption({
      venueName: 'Claudex Courts', dateLabel: 'Mon, Jan 7', isToday: true, address: ADDRESS,
      courts: buildCourtRanges(courts, h.slotsByDate[TODAY] as Slot[], TODAY, 'Asia/Manila', new Date()),
    })
    expect(expected).toBe('Open slots today at Claudex Courts, Mon, Jan 7:\nCourt 1: 2–5 PM, 8–10 PM\nCourt 2: Fully booked\n\nBook at ' + ADDRESS)
    expect(box.value).toBe(expected)
    await userEvent.click(screen.getByRole('radio', { name: 'Tomorrow · Tue, Jan 8' }))
    expect((screen.getByLabelText('Caption') as HTMLTextAreaElement).value).toBe(
      'Open slots tomorrow at Claudex Courts, Tue, Jan 8:\nCourt 1: Fully booked\nCourt 2: 6–8 AM\n\nBook at ' + ADDRESS,
    )
  })

  it('Download picture is disabled until drawn, then saves the drawn PNG without redrawing', async () => {
    let finish!: (b: Blob) => void
    h.render = vi.fn<(input: RenderInput) => Promise<Blob>>(() => new Promise<Blob>((r) => { finish = r }))
    await renderDialog()
    expect(screen.getByRole('button', { name: 'Download picture' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent('Drawing the picture…')
    expect(screen.queryByRole('img', { name: /^Open slots / })).not.toBeInTheDocument()
    finish(new Blob([new Uint8Array(8)], { type: 'image/png' }))
    const img = await preview()
    const button = screen.getByRole('button', { name: 'Download picture' })
    await waitFor(() => expect(button).toBeEnabled())
    const drawn = h.render.mock.calls.length
    await userEvent.click(button)
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('a-venue-slots-2030-01-07.png')
    expect(clicked[0].href).toBe(img.getAttribute('src'))
    expect(h.render.mock.calls.length).toBe(drawn)
  })

  it('Download picture names tomorrow\'s file by tomorrow\'s date', async () => {
    await renderDialog()
    await userEvent.click(screen.getByRole('radio', { name: 'Tomorrow · Tue, Jan 8' }))
    const img = await screen.findByRole('img', { name: /^Open slots tomorrow at / })
    const button = screen.getByRole('button', { name: 'Download picture' })
    await waitFor(() => expect(button).toBeEnabled())
    await userEvent.click(button)
    expect(clicked.at(-1)!.download).toBe('a-venue-slots-2030-01-08.png')
    expect(clicked.at(-1)!.href).toBe(img.getAttribute('src'))
  })

  it('Copy caption writes the caption, reads Copied, and resets after choosing the other day', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Copy caption' }))
    expect(writeText).toHaveBeenCalledWith('Open slots today at Claudex Courts, Mon, Jan 7:\nCourt 1: 2–5 PM, 8–10 PM\nCourt 2: Fully booked\n\nBook at ' + ADDRESS)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Tomorrow · Tue, Jan 8' }))
    expect(await screen.findByRole('button', { name: 'Copy caption' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument()
  })

  it('has no Share button even when the browser can share files', async () => {
    nav.canShare = vi.fn(() => true)
    nav.share = vi.fn(async () => {})
    await renderDialog()
    await preview()
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
  })

  it('while availability loads there is a Loading status, no picture, and Download picture is disabled', async () => {
    h.state = 'pending'
    await renderDialog()
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByRole('img', { name: /^Open slots / })).not.toBeInTheDocument()
    const b = screen.queryByRole('button', { name: 'Download picture' })
    expect(!b || (b as HTMLButtonElement).disabled).toBe(true)
  })

  it('a failed availability read shows the error with a retry that refetches', async () => {
    h.state = 'error'
    await renderDialog()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load slots')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(h.refetch).toHaveBeenCalled()
  })

  it('shows the message in an alert, with no picture, when the image cannot be drawn', async () => {
    h.render = vi.fn<(input: RenderInput) => Promise<Blob>>(async () => { throw new Error("This browser can't make images.") })
    await renderDialog()
    expect(await screen.findByRole('alert')).toHaveTextContent("This browser can't make images.")
    expect(screen.queryByRole('img', { name: /^Open slots / })).not.toBeInTheDocument()
    expect(clicked).toHaveLength(0)
  })
})
