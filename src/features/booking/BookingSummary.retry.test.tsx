// T27.5: "Try this time again" after an expired or rejected hold, "Book a court" once the start has passed.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { BookingDetail } from './api'
import { BookingSummary } from './BookingSummary'
import { parseCheckoutSearch } from './checkoutParams'

const COURT = '0b8e7c1a-3d2f-4a5b-9c6d-7e8f90a1b2c3'

const booking: BookingDetail = {
  id: 'b1',
  reference_code: 'CB-7KQ2XD',
  court_id: COURT,
  court_name: 'Badminton 1',
  sport: 'badminton',
  slot_start: '2030-01-07T09:00:00.000Z', // 5 PM Manila
  slot_end: '2030-01-07T11:00:00.000Z', // 2 hours
  status: 'pending_payment',
  total_amount: 900, booking_fee: 0, amount_due: 900, waiver_text: null, waiver_accepted_at: null,
  expires_at: '2030-01-07T03:00:00.000Z',
  rejection_count: 0,
  guest_name: 'Gina Guest',
  guest_email: 'gina@example.com',
  created_at: '2030-01-07T02:00:00.000Z',
  payments: [],
  cancelled_at: null,
  cancel_reason: null,
  cancelled_by_venue: false,
  user_id: null,
  parent_reference_code: null,
  continuations: [],
  changes: [], refund: null,
}

const BEFORE_START = '2030-01-07T05:00:00.000Z' // hold expired at 03:00, start is 09:00
const AFTER_START = '2030-01-07T09:30:00.000Z'

const renderAt = (now: string, overrides: Partial<BookingDetail> = {}) =>
  render(
    <MemoryRouter>
      <BookingSummary booking={{ ...booking, ...overrides }} paymentInstructions="Pay here"
        timeZone="Asia/Manila" currency="PHP" now={new Date(now)} />
    </MemoryRouter>,
  )

const rejected: Partial<BookingDetail> = {
  status: 'rejected',
  payments: [{ id: 'p1', method: 'maya', amount: 900, reference_number: null, submitted_at: '2030-01-07T02:10:00.000Z',
    review_status: 'rejected', reviewed_at: null, review_note: 'Not a receipt' }],
}

describe('BookingSummary: try this time again (T27.5)', () => {
  it('offers Try this time again on an expired hold whose start is in the future, with the checkout search', () => {
    renderAt(BEFORE_START)
    const link = screen.getByRole('link', { name: 'Try this time again' })
    const url = new URL(link.getAttribute('href') ?? '', 'http://x')
    expect(url.pathname).toBe('/book/checkout')
    expect(parseCheckoutSearch(url.searchParams)).toEqual({ courtId: COURT, start: '2030-01-07T09:00:00.000Z', slots: 2 })
    expect(screen.queryByRole('link', { name: 'Book a court' })).not.toBeInTheDocument()
  })

  it('puts the link inside the expired alert', () => {
    renderAt(BEFORE_START)
    const alert = screen.getByText(/hold expired/).closest('[role="status"]') as HTMLElement
    expect(alert).not.toBeNull()
    expect(alert).toContainElement(screen.getByRole('link', { name: 'Try this time again' }))
  })

  it('counts the hours from the booking length (one hour)', () => {
    renderAt(BEFORE_START, { slot_end: '2030-01-07T10:00:00.000Z' })
    const url = new URL(screen.getByRole('link', { name: 'Try this time again' }).getAttribute('href') ?? '', 'http://x')
    expect(parseCheckoutSearch(url.searchParams)?.slots).toBe(1)
  })

  it('offers Try this time again on a rejected booking whose start is in the future', () => {
    renderAt(BEFORE_START, rejected)
    const alert = screen.getByText(/booking was cancelled and the times were released/).closest('[role="status"]') as HTMLElement
    const link = screen.getByRole('link', { name: 'Try this time again' })
    expect(alert).toContainElement(link)
    const url = new URL(link.getAttribute('href') ?? '', 'http://x')
    expect(url.pathname).toBe('/book/checkout')
    expect(parseCheckoutSearch(url.searchParams)).toEqual({ courtId: COURT, start: '2030-01-07T09:00:00.000Z', slots: 2 })
  })

  it('shows Book a court instead once an expired hold has started', () => {
    renderAt(AFTER_START)
    expect(screen.queryByRole('link', { name: 'Try this time again' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book a court' })).toHaveAttribute('href', '/book')
  })

  it('shows Book a court instead once a rejected booking has started', () => {
    renderAt(AFTER_START, rejected)
    expect(screen.queryByRole('link', { name: 'Try this time again' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book a court' })).toHaveAttribute('href', '/book')
  })

  it('treats a start equal to now as past', () => {
    renderAt(booking.slot_start)
    expect(screen.queryByRole('link', { name: 'Try this time again' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Book a court' })).toBeInTheDocument()
  })

  it.each([
    ['cancelled', { status: 'cancelled', expires_at: null, cancelled_at: '2030-01-07T02:20:00.000Z' }],
    ['confirmed', { status: 'confirmed', expires_at: null }],
    ['payment_submitted', { status: 'payment_submitted' }],
  ] as const)('has neither link on a %s booking', (_name, overrides) => {
    renderAt('2030-01-07T02:30:00.000Z', overrides)
    expect(screen.queryByRole('link', { name: 'Try this time again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Book a court' })).not.toBeInTheDocument()
  })

  it('has neither link while the hold is still running', () => {
    renderAt('2030-01-07T02:30:00.000Z')
    expect(screen.queryByRole('link', { name: 'Try this time again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Book a court' })).not.toBeInTheDocument()
  })
})
