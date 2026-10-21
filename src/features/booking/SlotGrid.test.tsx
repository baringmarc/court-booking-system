import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Court } from '../catalog/api'
import type { Slot } from './selection'
import { SlotGrid } from './SlotGrid'

const court = (id: string, name: string) => ({ id, name, sport: 'badminton' }) as Court
const courts = [court('A', 'Badminton 1'), court('B', 'Badminton 2')]
// 2030-01-07 Manila 10:00, 11:00, 12:00 (UTC+8)
const times = ['2030-01-07T02:00:00.000Z', '2030-01-07T03:00:00.000Z', '2030-01-07T04:00:00.000Z']
const end = (t: string) => new Date(Date.parse(t) + 3_600_000).toISOString()
const row = (court_id: string, i: number, status: Slot['status']): Slot =>
  ({ court_id, slot_start: times[i], slot_end: end(times[i]), price: 350, status, booker_first_name: null })

const slotsByCourt = new Map<string, Slot[]>([
  ['A', [row('A', 0, 'free'), row('A', 1, 'booked'), row('A', 2, 'free')]],
  ['B', [row('B', 0, 'past'), row('B', 1, 'blackout'), row('B', 2, 'free')]],
])

function renderGrid(onToggle = vi.fn(), selection: { courtId: string; starts: string[] } | null = null) {
  render(
    <SlotGrid courts={courts} times={times} slotsByCourt={slotsByCourt} selection={selection}
      onToggle={onToggle} timeZone="Asia/Manila" currency="PHP" />,
  )
  return onToggle
}

describe('SlotGrid', () => {
  it('shows times in the venue timezone and prices on free slots', () => {
    renderGrid()
    expect(screen.getByRole('rowheader', { name: '10 AM' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Badminton 1, 10 AM, ₱350' })).toBeEnabled()
  })

  it('disables booked, blackout and past slots', () => {
    renderGrid()
    expect(screen.getByRole('button', { name: 'Badminton 1, 11 AM, Booked' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Badminton 2, 11 AM, Closed' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Badminton 2, 10 AM, Past' })).toBeDisabled()
  })

  it('reports taps on free slots only', async () => {
    const onToggle = renderGrid()
    await userEvent.click(screen.getByRole('button', { name: 'Badminton 2, 12 PM, ₱350' }))
    await userEvent.click(screen.getByRole('button', { name: 'Badminton 1, 11 AM, Booked' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledWith(row('B', 2, 'free'))
  })

  it('marks selected slots as pressed', () => {
    renderGrid(vi.fn(), { courtId: 'A', starts: [times[0]] })
    expect(screen.getByRole('button', { name: 'Badminton 1, 10 AM, ₱350' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Badminton 1, 12 PM, ₱350' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('names the booker of a booked slot by first name, in the label and on screen', () => {
    const named = new Map(slotsByCourt)
    named.set('A', [row('A', 0, 'free'), { ...row('A', 1, 'booked'), booker_first_name: 'Ana' }, row('A', 2, 'free')])
    render(<SlotGrid courts={courts} times={times} slotsByCourt={named} selection={null}
      onToggle={vi.fn()} timeZone="Asia/Manila" currency="PHP" />)
    const slot = screen.getByRole('button', { name: 'Badminton 1, 11 AM, Booked by Ana' })
    expect(slot).toBeDisabled()
    expect(slot).toHaveTextContent('BookedAna')
    expect(slot).toHaveClass('slot-booked')
  })

  it('marks after-midnight rows of an overnight day as the next day', () => {
    // Operating date 2030-01-07; a 1 AM slot on the 8th (Manila) belongs to it.
    const late = '2030-01-07T17:00:00.000Z' // 2030-01-08 01:00 Manila
    const lateSlots = new Map<string, Slot[]>([['A', [{ ...row('A', 0, 'free'), slot_start: late, slot_end: end(late) }]], ['B', []]])
    render(<SlotGrid courts={courts} times={[times[0], late]} slotsByCourt={lateSlots} selection={null} date="2030-01-07"
      onToggle={vi.fn()} timeZone="Asia/Manila" currency="PHP" />)
    expect(screen.getByRole('rowheader', { name: '10 AM' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: '1 AM (next day)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Badminton 1, 1 AM (next day), ₱350' })).toBeEnabled()
  })

  it('gives each status its own class and label', () => {
    renderGrid(vi.fn(), { courtId: 'A', starts: [times[0]] })
    const cases: [string, string, string][] = [
      ['Badminton 1, 10 AM, ₱350', 'slot-selected', '✓ ₱350'],
      ['Badminton 1, 12 PM, ₱350', 'slot-free', '₱350'],
      ['Badminton 1, 11 AM, Booked', 'slot-booked', 'Booked'],
      ['Badminton 2, 11 AM, Closed', 'slot-blackout', 'Closed'],
      ['Badminton 2, 10 AM, Past', 'slot-past', '—'],
    ]
    for (const [name, className, text] of cases) {
      const slot = screen.getByRole('button', { name })
      expect(slot.className).toBe(`slot ${className}`)
      expect(slot).toHaveTextContent(text)
    }
  })

  it('shows a legend with every status above the grid', () => {
    renderGrid()
    const legend = screen.getByRole('list', { name: 'Slot key' })
    const items = within(legend).getAllByRole('listitem')
    expect(items.map((li) => li.textContent?.replace('✓', ''))).toEqual(['Available', 'Selected', 'Booked', 'Closed', 'Past'])
    expect(items.map((li) => li.querySelector('.slot-swatch')?.className)).toEqual([
      'slot-swatch slot-free', 'slot-swatch slot-selected', 'slot-swatch slot-booked', 'slot-swatch slot-blackout', 'slot-swatch slot-past',
    ])
    expect(legend.compareDocumentPosition(screen.getByRole('table'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })
})
