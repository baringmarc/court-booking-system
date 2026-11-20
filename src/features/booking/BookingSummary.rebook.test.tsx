// T30.4: "Same time next week" on a confirmed or completed booking (SPEC §8): a link to checkout for the same court,
// the same venue-local weekday and time one week on (or the next future week), the same hours and `rebook=<reference>`.
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { BookingDetail } from './api'
import { BookingSummary } from './BookingSummary'
import { parseCheckoutSearch, parseRebookReference } from './checkoutParams'

const COURT = '0b8e7c1a-3d2f-4a5b-9c6d-7e8f90a1b2c3'
const NAME = 'Same time next week'

const booking: BookingDetail = {
  id: 'b1',
  reference_code: 'CB-7KQ2XD',
  court_id: COURT,
  court_name: 'Badminton 1',
  sport: 'badminton',
  slot_start: '2030-01-07T09:00:00.000Z', // 5 PM Manila
  slot_end: '2030-01-07T11:00:00.000Z', // 2 hours
  status: 'confirmed',
  total_amount: 900, booking_fee: 0, amount_due: 900, waiver_text: null, waiver_accepted_at: null,
  expires_at: null,
  rejection_count: 0,
  guest_name: 'Gina Guest',
  guest_email: 'gina@example.com',
  created_at: '2030-01-06T02:00:00.000Z',
  payments: [],
  cancelled_at: null,
  cancel_reason: null,
  cancelled_by_venue: false,
  user_id: null,
  parent_reference_code: null,
  continuations: [],
  changes: [],
}

const BEFORE_PLAY = '2030-01-07T05:00:00.000Z'
const AFTER_PLAY = '2030-01-07T12:00:00.000Z' // the booking ended at 11:00Z

const renderAt = (now: string, overrides: Partial<BookingDetail> = {}) =>
  render(
    <MemoryRouter>
      <BookingSummary booking={{ ...booking, ...overrides }} paymentInstructions="Pay here"
        timeZone="Asia/Manila" currency="PHP" now={new Date(now)} />
    </MemoryRouter>,
  )

/** The checkout URL the link points at. */
function linkUrl() {
  const link = screen.getByRole('link', { name: NAME })
  return new URL(link.getAttribute('href') ?? '', 'http://x')
}

describe('BookingSummary: Same time next week (T30.4)', () => {
  it('shows the link on a confirmed booking before play, to checkout with the start plus 7 days, the hours and the reference', () => {
    renderAt(BEFORE_PLAY)
    const url = linkUrl()
    expect(url.pathname).toBe('/book/checkout')
    expect(parseCheckoutSearch(url.searchParams)).toEqual({ courtId: COURT, start: '2030-01-14T09:00:00.000Z', slots: 2 })
    expect(parseRebookReference(url.searchParams)).toBe('CB-7KQ2XD')
  })

  it('shows the link on a completed booking (a confirmed one whose end has passed)', () => {
    renderAt(AFTER_PLAY)
    expect(screen.getByText('Completed')).toBeInTheDocument()
    const url = linkUrl()
    expect(parseCheckoutSearch(url.searchParams)).toEqual({ courtId: COURT, start: '2030-01-14T09:00:00.000Z', slots: 2 })
    expect(parseRebookReference(url.searchParams)).toBe('CB-7KQ2XD')
  })

  it('skips a week that has already passed (a booking played two weeks ago)', () => {
    // 2030-01-14T09:00Z is behind us at 2030-01-15, so the next one is 01-21.
    renderAt('2030-01-15T00:00:00.000Z')
    expect(parseCheckoutSearch(linkUrl().searchParams)?.start).toBe('2030-01-21T09:00:00.000Z')
  })

  it('does not offer a start that equals now (the week after is used)', () => {
    renderAt('2030-01-14T09:00:00.000Z')
    expect(parseCheckoutSearch(linkUrl().searchParams)?.start).toBe('2030-01-21T09:00:00.000Z')
  })

  it('counts the hours from the booking length (one hour)', () => {
    renderAt(BEFORE_PLAY, { slot_end: '2030-01-07T10:00:00.000Z' })
    expect(parseCheckoutSearch(linkUrl().searchParams)?.slots).toBe(1)
  })

  it('keeps the venue-local hour across the date line (1 AM Manila is the previous UTC date)', () => {
    // 2030-01-07T17:00Z is 01:00 on Jan 8 in Manila; next week at 1 AM Manila is 2030-01-14T17:00Z.
    renderAt('2030-01-07T10:00:00.000Z', { slot_start: '2030-01-07T17:00:00.000Z', slot_end: '2030-01-07T19:00:00.000Z' })
    expect(parseCheckoutSearch(linkUrl().searchParams)?.start).toBe('2030-01-14T17:00:00.000Z')
  })

  it('keeps the venue-local hour for a 7 AM Manila booking (11 PM UTC the day before)', () => {
    renderAt('2030-01-06T10:00:00.000Z', { slot_start: '2030-01-06T23:00:00.000Z', slot_end: '2030-01-07T00:00:00.000Z' })
    const parsed = parseCheckoutSearch(linkUrl().searchParams)
    expect(parsed?.start).toBe('2030-01-13T23:00:00.000Z')
    expect(parsed?.slots).toBe(1)
  })

  it.each([
    ['pending_payment', { status: 'pending_payment', expires_at: '2030-01-07T03:00:00.000Z' }, '2030-01-07T02:30:00.000Z'],
    ['payment_submitted', { status: 'payment_submitted', expires_at: '2030-01-07T03:00:00.000Z' }, '2030-01-07T02:30:00.000Z'],
    ['expired', { status: 'expired', expires_at: '2030-01-07T03:00:00.000Z' }, BEFORE_PLAY],
    ['a pending hold that has run out', { status: 'pending_payment', expires_at: '2030-01-07T03:00:00.000Z' }, BEFORE_PLAY],
    ['rejected', { status: 'rejected', expires_at: null }, BEFORE_PLAY],
    ['cancelled', { status: 'cancelled', expires_at: null, cancelled_at: '2030-01-07T02:20:00.000Z' }, BEFORE_PLAY],
    ['cancelled, after play time', { status: 'cancelled', expires_at: null, cancelled_at: '2030-01-07T02:20:00.000Z' }, AFTER_PLAY],
  ] as const)('does not show the link on %s', (_name, overrides, now) => {
    renderAt(now, overrides)
    expect(screen.queryByRole('link', { name: NAME })).not.toBeInTheDocument()
  })
})
