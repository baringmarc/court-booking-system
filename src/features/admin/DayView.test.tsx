import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Slot } from '../booking/selection'
import { DayView } from './DayView'

// 2030-01-07, Manila 5 PM–8 PM (UTC+8)
const at = (h: number) => new Date(Date.UTC(2030, 0, 7, h - 8)).toISOString()
const courts = [{ id: 'A', name: 'Badminton 1' }, { id: 'B', name: 'Badminton 2' }]
const slot = (court_id: string, h: number, status: Slot['status'], booker_first_name: string | null = null): Slot =>
  ({ court_id, slot_start: at(h), slot_end: at(h + 1), price: 350, status, booker_first_name })
const slots = [
  slot('A', 17, 'past'), slot('A', 18, 'booked', 'Ana'), slot('A', 19, 'booked', 'Ana'),
  slot('B', 17, 'blackout'), slot('B', 18, 'free'), slot('B', 19, 'free'),
]
const bookings = [{
  id: 'b1', reference_code: 'CB-7KQ2XD', court_name: 'Badminton 1', slot_start: at(18), slot_end: at(20), guest_name: 'Ana Maria Santos',
}]

function renderDay(s = slots) {
  render(
    <MemoryRouter>
      <DayView date="2030-01-07" courts={courts} slots={s} bookings={bookings} timeZone="Asia/Manila" />
    </MemoryRouter>,
  )
}

describe('DayView', () => {
  it('lays out courts across and hours down', () => {
    renderDay()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Time', 'Badminton 1', 'Badminton 2'])
    expect(screen.getAllByRole('rowheader').map((h) => h.textContent)).toEqual(['5 PM', '6 PM', '7 PM'])
  })

  it('shows the full name and reference on every hour of a booking, linking to that booking', () => {
    renderDay()
    const rows = screen.getAllByRole('row').slice(1)
    for (const row of rows.slice(1)) {
      const cell = within(row).getAllByRole('cell')[0]
      expect(cell).toHaveTextContent('Ana Maria Santos')
      expect(within(cell).getByRole('link', { name: 'CB-7KQ2XD' })).toHaveAttribute('href', '/admin/bookings?status=all&date=2030-01-07&booking=b1')
    }
  })

  it('matches bookings to slots by time, whatever format each timestamp comes in', () => {
    // Slots from get_availability use "+00:00"; bookings parsed from a range use ".000Z". Same instants.
    const pgSlots = slots.map((s) => ({ ...s, slot_start: s.slot_start.replace('.000Z', '+00:00'), slot_end: s.slot_end.replace('.000Z', '+00:00') }))
    renderDay(pgSlots)
    expect(screen.getAllByText('Ana Maria Santos')).toHaveLength(2)
  })

  it('lets keyboard users scroll the grid on a small screen', () => {
    renderDay()
    expect(screen.getByRole('region', { name: 'Courts by hour' })).toHaveAttribute('tabindex', '0')
  })

  it('marks closed and past cells, and leaves free cells empty', () => {
    renderDay()
    const [five, six] = screen.getAllByRole('row').slice(1)
    expect(within(five).getAllByRole('cell').map((c) => c.textContent)).toEqual(['—', 'Closed'])
    expect(within(six).getAllByRole('cell')[1]).toHaveTextContent(/^$/)
  })

  it('says when the venue is closed', () => {
    renderDay([])
    expect(screen.getByText('The venue is closed on this day.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
