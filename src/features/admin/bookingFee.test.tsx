// T11.13: staff see Plotline's booking fee apart from the court price: in the review panel (whose amount check
// compares a proof with amount_due), in the bookings list (the amount due) and in the bookings CSV (booking_fee_php
// right after amount_php, which stays the court price).
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AdminBooking, AdminPayment, ExportBooking } from './api'
import { BookingRow } from './AdminBookingsPage'
import { bookingsCsv } from './csv'
import { ReviewPanel } from './ReviewPanel'

const proof = (amount: number): AdminPayment => ({
  id: 'p1', method: 'gcash', amount, reference_number: '1234', storage_path: 'b1/proof.png',
  submitted_at: '2030-01-07T02:10:00.000Z', review_status: 'pending', review_note: null,
  reviewed_at: null, reviewed_by: null, provider_payment_id: null, provider_source: null,
})

// 6 AM–8 AM in Manila (10 PM–midnight UTC the day before): court price 900, fee 10, amount due 910.
const booking = (overrides: Partial<AdminBooking> = {}): AdminBooking => ({
  id: 'b1', reference_code: 'CB-7KQ2XD', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-06T22:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z',
  status: 'payment_submitted', source: 'online', total_amount: 900, booking_fee: 10, amount_due: 910,
  expires_at: null, rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com', guest_phone: '0917 222 2222',
  created_at: '2030-01-06T20:00:00.000Z', payments: [proof(910)],
  cancelled_at: null, cancel_reason: null, cancelled_by_venue: false, parent_booking_id: null,
  ...overrides,
})

function renderPanel(b: AdminBooking) {
  render(
    <ReviewPanel booking={b} timeZone="Asia/Manila" currency="PHP" proof={{ state: 'ready', url: 'https://signed/proof' }}
      pending={false} error={null} onApprove={vi.fn()} onReject={vi.fn()} now={new Date('2030-01-06T21:00:00.000Z')} />,
  )
}

/** The value shown next to a label in the booking facts (the label and its value share a row). */
function amountFor(label: string) {
  const term = screen.getByText(label, { exact: true })
  return term.parentElement?.textContent?.replace(label, '').trim()
}

describe('ReviewPanel: the booking fee split (T11.13)', () => {
  it('shows the court price, the booking fee and the total (amount due)', () => {
    renderPanel(booking())
    expect(amountFor('Court price')).toBe('₱900')
    expect(amountFor('Booking fee')).toBe('₱10')
    expect(amountFor('Total')).toBe('₱910')
  })

  it('accepts a proof for the amount due without a mismatch warning', () => {
    renderPanel(booking({ payments: [proof(910)] }))
    expect(screen.queryByText(/but the total is/)).not.toBeInTheDocument()
  })

  it('warns when a proof covers only the court price, comparing with the amount due', () => {
    renderPanel(booking({ payments: [proof(900)] }))
    expect(screen.getByRole('status')).toHaveTextContent('Paid ₱900 but the total is ₱910')
  })

  it('has no booking fee row for a booking without a fee', () => {
    renderPanel(booking({ booking_fee: 0, amount_due: 900, payments: [proof(900)] }))
    expect(amountFor('Court price')).toBe('₱900')
    expect(amountFor('Total')).toBe('₱900')
    expect(screen.queryByText('Booking fee')).not.toBeInTheDocument()
    expect(screen.queryByText(/but the total is/)).not.toBeInTheDocument()
  })
})

describe('BookingRow: the amount is the amount due (T11.13)', () => {
  it('shows court price + fee', () => {
    render(<ul><li><BookingRow booking={booking({ status: 'confirmed', payments: [] })} timeZone="Asia/Manila" currency="PHP" /></li></ul>)
    expect(screen.getByText('₱910')).toBeInTheDocument()
    expect(screen.queryByText('₱900')).not.toBeInTheDocument()
  })
})

describe('bookingsCsv: booking_fee_php (T11.13)', () => {
  const TZ = 'Asia/Manila'
  const lines = (text: string) => text.replace(/^\uFEFF/, '').split('\r\n')
  // 6 AM–8 AM in Manila on Oct 25 (10 PM–midnight UTC on Oct 24).
  const online: ExportBooking = {
    reference_code: 'CB-ABC234', court_name: 'Court A', sport: 'badminton',
    slot_start: '2026-10-24T22:00:00.000Z', slot_end: '2026-10-25T00:00:00.000Z',
    status: 'confirmed', source: 'online', expires_at: null,
    guest_name: 'Ana', guest_phone: '0917 000 0000', guest_email: 'ana@example.com',
    total_amount: 700, booking_fee: 10, amount_due: 710,
  }
  const options = { timeZone: TZ, currency: 'PHP', now: new Date('2026-10-24T00:00:00Z') }

  it('adds booking_fee_php right after amount_php, which stays the court price', () => {
    const [header, row] = lines(bookingsCsv([online], { ...options, includeContact: false }))
    expect(header).toBe('"reference","court","sport","start (Asia/Manila)","end (Asia/Manila)","status","source","name","amount_php","booking_fee_php"')
    expect(row).toBe('"CB-ABC234","Court A","Badminton","2026-10-25 06:00","2026-10-25 08:00","Confirmed","Online","Ana","700","10"')
  })

  it('keeps booking_fee_php after amount_php with contact details', () => {
    const [header, row] = lines(bookingsCsv([online], { ...options, includeContact: true }))
    expect(header).toMatch(/"name","phone","email","amount_php","booking_fee_php"$/)
    expect(row).toMatch(/"ana@example\.com","700","10"$/)
  })

  it('writes a fee of 0 for walk-ins and bookings made at ₱0', () => {
    const [, row] = lines(bookingsCsv([{ ...online, source: 'walk_in', booking_fee: 0, amount_due: 700 }], { ...options, includeContact: false }))
    expect(row).toMatch(/"700","0"$/)
  })
})
