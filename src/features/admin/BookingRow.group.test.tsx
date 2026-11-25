// T33.4: a booking row in the admin list. In the review queue one row stands for a whole checkout ("N courts" and the sum
// of the courts' amounts due); elsewhere a grouped booking carries a "Group booking" badge; a single booking is unchanged.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AdminBooking } from './api'
import { BookingRow } from './AdminBookingsPage'

const booking = (id: string, group: string | null | undefined, overrides: Partial<AdminBooking> = {}): AdminBooking => ({
  id, reference_code: `CB-${id}`, court_id: `c-${id}`, court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z', status: 'payment_submitted', source: 'online',
  total_amount: 350, booking_fee: 10, amount_due: 360, expires_at: null, rejection_count: 0, guest_name: 'Gina Guest',
  guest_email: null, guest_phone: null, created_at: '2030-01-06T15:00:00.000Z', payments: [], refunds: [],
  cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null, booking_group_id: group, ...overrides,
})

const renderRow = (b: AdminBooking, courts?: AdminBooking[]) =>
  render(<ul><li><BookingRow booking={b} courts={courts} timeZone="Asia/Manila" currency="PHP" /></li></ul>)

describe('BookingRow with the courts of a checkout', () => {
  it('says "N courts" in the second line and shows the sum of the courts’ amounts due', () => {
    const a = booking('LEAD01', 'g1')
    const b = booking('PART02', 'g1', { amount_due: 700, court_name: 'Tennis Court' })
    renderRow(a, [a, b])
    expect(screen.getByText(/2 courts/)).toBeInTheDocument()
    expect(screen.getByText('₱1,060')).toBeInTheDocument()
    expect(screen.queryByText('₱360')).not.toBeInTheDocument()
    // Still titled with the booking's reference and the customer.
    expect(screen.getByText('CB-LEAD01')).toBeInTheDocument()
    expect(screen.getByText(/Gina Guest/)).toBeInTheDocument()
    // The row stands for the whole checkout, so no group badge.
    expect(screen.queryByText('Group booking')).not.toBeInTheDocument()
  })

  it('counts three courts', () => {
    const rows = [booking('A', 'g1'), booking('B', 'g1', { amount_due: 700 }), booking('C', 'g1', { amount_due: 500 })]
    renderRow(rows[0], rows)
    expect(screen.getByText(/3 courts/)).toBeInTheDocument()
    expect(screen.getByText('₱1,560')).toBeInTheDocument()
  })
})

describe('BookingRow without the courts', () => {
  it('badges a booking in a group "Group booking"', () => {
    renderRow(booking('LEAD01', 'g1'))
    expect(screen.getByText('Group booking')).toHaveClass('badge')
    expect(screen.queryByText(/courts/)).not.toBeInTheDocument()
    expect(screen.getByText('₱360')).toBeInTheDocument()
  })

  it('badges it when `courts` has only that booking', () => {
    const a = booking('LEAD01', 'g1')
    renderRow(a, [a])
    expect(screen.getByText('Group booking')).toBeInTheDocument()
    expect(screen.queryByText(/1 court/)).not.toBeInTheDocument()
  })

  it.each([null, undefined])('is unchanged for a single booking (booking_group_id = %s)', (group) => {
    renderRow(booking('SOLO09', group))
    expect(screen.queryByText('Group booking')).not.toBeInTheDocument()
    expect(screen.queryByText(/courts/)).not.toBeInTheDocument()
    expect(screen.getByText('Payment under review')).toBeInTheDocument()
    expect(screen.getByText('₱360')).toBeInTheDocument()
  })
})
