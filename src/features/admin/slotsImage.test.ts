// T31.1: the pure parts of the "slots image" (ranges, caption, row fitting, file name) and the canvas drawing,
// with the canvas stubbed as qrImage.test.ts does (jsdom has no canvas).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Slot } from '../booking/selection'
import {
  buildCaption, buildCourtRanges, fitCourtRows, MAX_ROW_HEIGHT, MIN_ROW_HEIGHT, renderSlotsImage, ROWS_AREA_HEIGHT,
  slotsImageFileName, SLOTS_IMAGE_HEIGHT, SLOTS_IMAGE_WIDTH, type CourtRanges,
} from './slotsImage'

const TZ = 'Asia/Manila'
const DATE = '2030-01-07'
// Manila hour h on day d (1-based day of January 2030); h may be 24+ for after midnight.
const at = (day: number, hour: number) => new Date(Date.UTC(2030, 0, day, hour - 8)).toISOString()
const slot = (court: string, hour: number, status: Slot['status'] = 'free', extra: Partial<Slot> = {}, day = 7): Slot => ({
  court_id: court, slot_start: at(day, hour), slot_end: at(day, hour + 1), price: 350, status,
  booker_first_name: null, open_play_session_id: null, block_key: null, ...extra,
})
const courts = [{ id: 'c1', name: 'Court 1' }, { id: 'c2', name: 'Court 2' }]
const labels = (r: CourtRanges) => r.ranges.map((x) => x.label)

describe('buildCourtRanges (T31.1)', () => {
  it('merges consecutive free slots into one range and splits at a gap', () => {
    const out = buildCourtRanges(courts, [14, 15, 16, 20, 21].map((h) => slot('c1', h)), DATE, TZ, new Date())
    expect(labels(out[0])).toEqual(['2–5 PM', '8–10 PM'])
    expect(out[0].ranges[0]).toMatchObject({ start: at(7, 14), end: at(7, 17) })
    expect(out[0].ranges[1]).toMatchObject({ start: at(7, 20), end: at(7, 22) })
  })

  it('keeps the court order and gives a fully booked court an empty list', () => {
    const out = buildCourtRanges(courts, [slot('c1', 9), slot('c2', 9, 'booked', { booker_first_name: 'Ann' })], DATE, TZ, new Date())
    expect(out.map((c) => [c.courtId, c.name])).toEqual([['c1', 'Court 1'], ['c2', 'Court 2']])
    expect(out[1].ranges).toEqual([])
  })

  it('booked, open play, blackout and past slots never appear and break a run', () => {
    for (const status of ['booked', 'open_play', 'blackout', 'past'] as const) {
      const out = buildCourtRanges(courts, [slot('c1', 9), slot('c1', 10, status), slot('c1', 11)], DATE, TZ, new Date())
      expect(labels(out[0])).toEqual(['9–10 AM', '11 AM–12 PM'])
    }
  })

  it('a range crossing noon names both suffixes', () => {
    const out = buildCourtRanges(courts, [slot('c1', 11), slot('c1', 12)], DATE, TZ, new Date())
    expect(labels(out[0])).toEqual(['11 AM–1 PM'])
  })

  it('a range closing at midnight reads 12 AM and is not "next day"', () => {
    const out = buildCourtRanges(courts, [18, 19, 20, 21, 22, 23].map((h) => slot('c1', h)), DATE, TZ, new Date())
    expect(labels(out[0])).toEqual(['6 PM–12 AM'])
  })

  it('a range running past midnight is marked (next day)', () => {
    const out = buildCourtRanges(courts, [22, 23, 24, 25].map((h) => slot('c1', h)), DATE, TZ, new Date())
    expect(labels(out[0])).toEqual(['10 PM–2 AM (next day)'])
  })

  it('does not merge across a period boundary (period_end) even when the slots touch', () => {
    const periodEnd = at(7, 12)
    const out = buildCourtRanges(courts, [slot('c1', 11, 'free', { period_end: periodEnd }), slot('c1', 12, 'free', { period_end: at(7, 20) })], DATE, TZ, new Date())
    expect(labels(out[0])).toEqual(['11 AM–12 PM', '12–1 PM'])
  })

  it('does not merge slots whose end and start differ', () => {
    // 9:00-9:30 then 10:00-11:00: not adjacent
    const first = { ...slot('c1', 9), slot_end: new Date(Date.parse(at(7, 9)) + 30 * 60_000).toISOString() }
    const second = slot('c1', 10)
    const out = buildCourtRanges(courts, [first, second], DATE, TZ, new Date())
    expect(out[0].ranges).toHaveLength(2)
  })

  it('works the same for tomorrow', () => {
    const out = buildCourtRanges(courts, [6, 7].map((h) => slot('c2', h, 'free', {}, 8)), '2030-01-08', TZ, new Date())
    expect(labels(out[1])).toEqual(['6–8 AM'])
  })

  it('a court with no slots at all gets an empty list', () => {
    expect(buildCourtRanges(courts, [], DATE, TZ, new Date()).map((c) => c.ranges)).toEqual([[], []])
  })
})

describe('buildCaption (T31.1)', () => {
  const ranged: CourtRanges[] = [
    { courtId: 'c1', name: 'Court 1', ranges: [{ start: at(7, 14), end: at(7, 17), label: '2–5 PM' }, { start: at(7, 20), end: at(7, 22), label: '8–10 PM' }] },
    { courtId: 'c2', name: 'Court 2', ranges: [] },
  ]
  it('lists open ranges per court, "Fully booked", and the address', () => {
    expect(buildCaption({ venueName: 'Claudex Courts', dateLabel: 'Mon, Jan 7', isToday: true, courts: ranged, address: 'https://x.plotline.fit/book' })).toBe(
      'Open slots today at Claudex Courts, Mon, Jan 7:\nCourt 1: 2–5 PM, 8–10 PM\nCourt 2: Fully booked\n\nBook at https://x.plotline.fit/book',
    )
  })
  it('says tomorrow for tomorrow', () => {
    expect(buildCaption({ venueName: 'V', dateLabel: 'Tue, Jan 8', isToday: false, courts: ranged, address: 'a' }).split('\n')[0]).toBe('Open slots tomorrow at V, Tue, Jan 8:')
  })
})

describe('fitCourtRows (T31.1)', () => {
  it('0 courts shows nothing', () => {
    expect(fitCourtRows(0)).toMatchObject({ shown: 0, hidden: 0 })
  })
  it('a few courts get the biggest rows', () => {
    for (const n of [1, 2, 3]) expect(fitCourtRows(n).rowHeight).toBe(MAX_ROW_HEIGHT)
  })
  it('keeps every invariant for 1..40 courts', () => {
    let prev = Infinity
    for (let n = 1; n <= 40; n++) {
      const { shown, hidden, rowHeight } = fitCourtRows(n)
      expect(shown + hidden).toBe(n)
      expect(rowHeight).toBeGreaterThanOrEqual(MIN_ROW_HEIGHT)
      expect(rowHeight).toBeLessThanOrEqual(MAX_ROW_HEIGHT)
      expect(rowHeight).toBeLessThanOrEqual(prev)
      prev = rowHeight
      expect(shown * rowHeight).toBeLessThanOrEqual(ROWS_AREA_HEIGHT)
      expect(shown).toBeGreaterThanOrEqual(1)
      if (hidden > 0) expect((shown + 1) * rowHeight).toBeLessThanOrEqual(ROWS_AREA_HEIGHT)
    }
  })
  it('hides nothing while everything fits at the minimum row height, and hides some past that', () => {
    const fits = Math.floor(ROWS_AREA_HEIGHT / MIN_ROW_HEIGHT)
    expect(fitCourtRows(fits)).toMatchObject({ hidden: 0, shown: fits })
    const over = fitCourtRows(fits + 1)
    expect(over.hidden).toBeGreaterThan(0)
    expect(over.rowHeight).toBe(MIN_ROW_HEIGHT)
  })
})

describe('slotsImageFileName and size (T31.1)', () => {
  it('names the file after the venue and date', () => {
    expect(slotsImageFileName('a-venue', '2030-01-07')).toBe('a-venue-slots-2030-01-07.png')
  })
  it('is a 4:5 portrait', () => {
    expect([SLOTS_IMAGE_WIDTH, SLOTS_IMAGE_HEIGHT]).toEqual([1080, 1350])
  })
})

describe('renderSlotsImage (T31.1)', () => {
  const texts: string[] = []
  const ctx = {
    fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '', lineWidth: 0, globalAlpha: 1,
    fillRect: vi.fn(), fillText: vi.fn((t: string) => { texts.push(t) }), measureText: vi.fn(() => ({ width: 100 })), drawImage: vi.fn(),
    beginPath: vi.fn(), closePath: vi.fn(), roundRect: vi.fn(), rect: vi.fn(), arc: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    save: vi.fn(), restore: vi.fn(), clip: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), strokeText: vi.fn(),
  }
  let size: { width: number; height: number } | null = null
  let imageMode: 'load' | 'error' = 'load'
  let crossOrigin: string | undefined
  let context: CanvasRenderingContext2D | null = null

  class FakeImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    width = 200
    height = 200
    naturalWidth = 200
    naturalHeight = 200
    set crossOrigin(v: string) { crossOrigin = v }
    get crossOrigin() { return crossOrigin ?? '' }
    set src(_: string) { setTimeout(() => (imageMode === 'load' ? this.onload?.() : this.onerror?.()), 0) }
  }

  const palette = { bg: '#f5efe6', surface: '#fffcf7', text: '#3b2f2a', accent: '#4c6b3c', btn: '#b7c4a8', btnText: '#3b2f2a' }
  const base = (over: Partial<Parameters<typeof renderSlotsImage>[0]> = {}) => ({
    venueName: 'Claudex Courts', logoUrl: null, dateLabel: 'Mon, Jan 7', isToday: true, asOf: '10:30 AM', address: 'https://x.plotline.fit/book', palette,
    courts: [
      { courtId: 'c1', name: 'Court 1', ranges: [{ start: at(7, 14), end: at(7, 17), label: '2–5 PM' }] },
      { courtId: 'c2', name: 'Court 2', ranges: [] },
    ] as CourtRanges[],
    ...over,
  })

  beforeEach(() => {
    texts.length = 0
    imageMode = 'load'
    crossOrigin = undefined
    size = null
    context = ctx as unknown as CanvasRenderingContext2D
    for (const fn of Object.values(ctx)) if (typeof fn === 'function' && 'mockClear' in fn) (fn as ReturnType<typeof vi.fn>).mockClear()
    vi.stubGlobal('Image', FakeImage)
    Object.defineProperty(document, 'fonts', { value: { ready: Promise.resolve() }, configurable: true })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => context as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      size = { width: this.width, height: this.height }
      callback(new Blob([new Uint8Array(10)], { type: type ?? 'image/png' }))
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete (document as unknown as { fonts?: unknown }).fonts
  })

  it('draws a 1080x1350 canvas and returns a PNG', async () => {
    const blob = await renderSlotsImage(base())
    expect(blob.type).toBe('image/png')
    expect(size).toEqual({ width: 1080, height: 1350 })
  })

  it('draws the venue, the date, the headline, ranges, "Fully booked" and the address', async () => {
    await renderSlotsImage(base())
    const all = texts.join('\n')
    expect(all).toContain('Claudex Courts')
    expect(all).toContain('Mon, Jan 7')
    expect(all).toContain('Open slots')
    expect(all).toContain('Court 1')
    expect(all).toContain('2–5 PM')
    expect(all).toContain('Fully booked')
    expect(all).toContain('https://x.plotline.fit/book')
  })

  it('shows "as of" for today only', async () => {
    await renderSlotsImage(base())
    expect(texts.some((t) => t.includes('as of 10:30 AM'))).toBe(true)
    texts.length = 0
    await renderSlotsImage(base({ isToday: false, asOf: null, dateLabel: 'Tue, Jan 8' }))
    expect(texts.some((t) => /as of/i.test(t))).toBe(false)
  })

  it('draws a "+N more courts" line when the courts do not fit', async () => {
    const many: CourtRanges[] = Array.from({ length: 30 }, (_, i) => ({ courtId: `c${i}`, name: `Court ${i + 1}`, ranges: [] }))
    await renderSlotsImage(base({ courts: many }))
    const { hidden } = fitCourtRows(30)
    expect(hidden).toBeGreaterThan(0)
    expect(texts.some((t) => /\+\d+ more courts?/.test(t))).toBe(true)
    expect(texts.some((t) => t.includes(`+${hidden} more court`))).toBe(true)
  })

  it('no "more courts" line when every court fits', async () => {
    await renderSlotsImage(base())
    expect(texts.some((t) => /more courts?/.test(t))).toBe(false)
  })

  it('never draws prices or who booked', async () => {
    await renderSlotsImage(base())
    const all = texts.join('\n')
    expect(all).not.toContain('₱')
    expect(all.toLowerCase()).not.toContain('booked by')
  })

  it('loads the logo anonymously (so the canvas stays exportable) and draws it', async () => {
    await renderSlotsImage(base({ logoUrl: 'https://cdn.example/logo.png' }))
    expect(crossOrigin).toBe('anonymous')
    expect(ctx.drawImage).toHaveBeenCalled()
  })

  it('without a logo url, draws no image', async () => {
    await renderSlotsImage(base())
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('a logo that fails to load is skipped and the PNG still comes out', async () => {
    imageMode = 'error'
    const blob = await renderSlotsImage(base({ logoUrl: 'https://cdn.example/missing.png' }))
    expect(blob.type).toBe('image/png')
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('rejects when the browser has no canvas context', async () => {
    context = null
    await expect(renderSlotsImage(base())).rejects.toThrow("This browser can't make images.")
  })
})
