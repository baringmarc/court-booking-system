// T33.1: the slot grid opens scrolled so the row containing "now" sits just under the sticky header.
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Court } from '../catalog/api'
import type { Selection, Slot } from './selection'
import { SlotGrid } from './SlotGrid'

const court = (id: string, name: string) => ({ id, name, sport: 'badminton' }) as Court
const courtsAB = [court('A', 'Badminton 1'), court('B', 'Badminton 2')]
const HOUR = 3_600_000
const ROW_H = 44
const HEAD_BOTTOM = 40

const hoursFrom = (startIso: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(startIso) + i * HOUR).toISOString())
const endOf = (t: string) => new Date(Date.parse(t) + HOUR).toISOString()
const slot = (court_id: string, time: string, block_key: string | null = null, status: Slot['status'] = 'free'): Slot =>
  ({ court_id, slot_start: time, slot_end: endOf(time), price: 350, status, booker_first_name: null, open_play_session_id: null, block_key })
const mapFor = (times: string[], blocks: Record<number, string> = {}) => new Map<string, Slot[]>(
  ['A', 'B'].map((id) => [id, times.map((t, i) => slot(id, t, blocks[i] ?? null, blocks[i] ? 'booked' : 'free'))]),
)

// 2030-01-07 Manila 16:00 .. 21:00 (UTC+8): rows 4 PM, 5 PM, 6 PM, 7 PM, 8 PM, 9 PM
const evening = hoursFrom('2030-01-07T08:00:00.000Z', 6)

type GridProps = Partial<React.ComponentProps<typeof SlotGrid>>
function ui(times: string[], props: GridProps = {}) {
  return (
    <SlotGrid courts={courtsAB} times={times} slotsByCourt={mapFor(times)} selection={null}
      onToggle={vi.fn()} timeZone="Asia/Manila" currency="PHP" {...props} />
  )
}
const region = () => screen.getByRole('region', { name: 'Court times' })

/** jsdom has no layout: row i's header sits at 40 + 44*i minus whatever the region has scrolled; the thead bottom is fixed. */
function stubLayout() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    let top = 0
    let bottom = 0
    if (this.tagName === 'THEAD') {
      top = 0
      bottom = HEAD_BOTTOM
    } else if (this.tagName === 'TH' && this.getAttribute('scope') === 'row') {
      const tr = this.closest('tr')!
      const index = Array.from(tr.parentElement!.children).indexOf(tr)
      const scrolled = this.closest('.table-scroll')?.scrollTop ?? 0
      top = HEAD_BOTTOM + ROW_H * index - scrolled
      bottom = top + ROW_H
    }
    return { top, bottom, left: 0, right: 0, width: 0, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  })
}

function setNow(iso: string) {
  vi.setSystemTime(new Date(iso))
}

describe('SlotGrid scrolls to the current hour (T33.1)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    stubLayout()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('puts the row containing now at the bottom edge of the header on mount', () => {
    setNow('2030-01-07T12:15:00.000Z') // 8:15 PM Manila -> row 4
    render(ui(evening))
    expect(screen.getByRole('rowheader', { name: '8 PM – 9 PM' })).toBeInTheDocument()
    expect(region().scrollTop).toBe(ROW_H * 4)
  })

  it('does not scroll when now is before the first row', () => {
    setNow('2030-01-07T07:59:00.000Z') // 3:59 PM Manila
    render(ui(evening))
    expect(region().scrollTop).toBe(0)
  })

  it('does not scroll when now is at or after the end of the last row', () => {
    setNow('2030-01-07T14:00:00.000Z') // 10 PM Manila, last row ends exactly then
    render(ui(evening))
    expect(region().scrollTop).toBe(0)
  })

  it('does not scroll on another day (no row contains now)', () => {
    setNow('2030-01-08T12:15:00.000Z')
    render(ui(evening))
    expect(region().scrollTop).toBe(0)
  })

  it('treats a row start as inside the row and its end as the next row', () => {
    setNow('2030-01-07T11:00:00.000Z') // exactly 7 PM Manila -> row 3
    const first = render(ui(evening))
    expect(region().scrollTop).toBe(ROW_H * 3)
    first.unmount()
    setNow('2030-01-07T11:59:59.999Z') // last ms of the 7 PM row
    render(ui(evening))
    expect(region().scrollTop).toBe(ROW_H * 3)
  })

  it('uses the first row when now is in it (nothing to scroll past)', () => {
    setNow('2030-01-07T08:30:00.000Z') // 4:30 PM
    render(ui(evening))
    expect(region().scrollTop).toBe(0)
  })

  it('finds the row inside a multi-row block (now in the middle of a 2-hour booking)', () => {
    setNow('2030-01-07T12:15:00.000Z') // 8:15 PM, booking runs 7 PM - 9 PM on both courts
    const blocks = { 3: 'blk-1', 4: 'blk-1' }
    render(ui(evening, { slotsByCourt: mapFor(evening, blocks) }))
    expect(region().scrollTop).toBe(ROW_H * 4)
  })

  it('late night: now 12:30 AM Manila belongs to the 12 AM row of the overnight day', () => {
    // Operating date 2030-01-07 running 10 PM .. 2 AM (next day) Manila
    const overnight = hoursFrom('2030-01-07T14:00:00.000Z', 4)
    setNow('2030-01-07T16:30:00.000Z') // 2030-01-08 00:30 Manila -> row 2
    render(ui(overnight, { date: '2030-01-07' }))
    expect(screen.getByRole('rowheader', { name: '12 AM – 1 AM (next day)' })).toBeInTheDocument()
    expect(region().scrollTop).toBe(ROW_H * 2)
  })

  it('early morning: now 7:30 AM Manila is the previous day in UTC and still finds the 7 AM row', () => {
    const morning = hoursFrom('2030-01-06T22:00:00.000Z', 5) // 6 AM .. 10 AM Manila on the 7th
    setNow('2030-01-06T23:30:00.000Z') // 2030-01-07 07:30 Manila -> row 1
    render(ui(morning, { date: '2030-01-07' }))
    expect(screen.getByRole('rowheader', { name: '7 AM – 8 AM' })).toBeInTheDocument()
    expect(region().scrollTop).toBe(ROW_H * 1)
  })

  it('re-measures from the current scroll position (adds the row offset to scrollTop)', () => {
    setNow('2030-01-07T12:15:00.000Z')
    const view = render(ui(evening, { date: '2030-01-07' }))
    region().scrollTop = 100
    view.rerender(ui(evening, { date: '2030-01-08' }))
    expect(region().scrollTop).toBe(ROW_H * 4)
  })

  it('scrolls again when the date prop changes', () => {
    setNow('2030-01-07T12:15:00.000Z')
    const view = render(ui(evening, { date: '2030-01-07' }))
    region().scrollTop = 0
    view.rerender(ui(evening, { date: '2030-01-08' }))
    expect(region().scrollTop).toBe(ROW_H * 4)
  })

  it('scrolls again when the set of courts changes', () => {
    setNow('2030-01-07T12:15:00.000Z')
    const view = render(ui(evening))
    region().scrollTop = 0
    const other = [court('C', 'Pickleball 1')]
    view.rerender(ui(evening, {
      courts: other,
      slotsByCourt: new Map([['C', evening.map((t) => slot('C', t))]]),
    }))
    expect(region().scrollTop).toBe(ROW_H * 4)
  })

  it('does not scroll again for a background refetch (new slotsByCourt) or a new selection', () => {
    setNow('2030-01-07T12:15:00.000Z')
    const view = render(ui(evening, { date: '2030-01-07' }))
    expect(region().scrollTop).toBe(ROW_H * 4)
    region().scrollTop = 7 // the user scrolled
    view.rerender(ui(evening, { date: '2030-01-07', slotsByCourt: mapFor(evening) }))
    expect(region().scrollTop).toBe(7)
    const selection: Selection = { courtId: 'A', starts: [evening[0]] }
    view.rerender(ui(evening, { date: '2030-01-07', slotsByCourt: mapFor(evening), selection }))
    expect(region().scrollTop).toBe(7)
  })

  it('does not scroll again when courts are a new array with the same ids', () => {
    setNow('2030-01-07T12:15:00.000Z')
    const view = render(ui(evening))
    region().scrollTop = 7
    view.rerender(ui(evening, { courts: [court('A', 'Badminton 1'), court('B', 'Badminton 2')] }))
    expect(region().scrollTop).toBe(7)
  })

  it('never calls scrollIntoView (the page itself must not scroll)', () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    setNow('2030-01-07T12:15:00.000Z')
    render(ui(evening))
    expect(spy).not.toHaveBeenCalled()
  })
})
