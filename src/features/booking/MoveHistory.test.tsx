import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { BookingChange, BookingContinuation, BookingDetail } from './api'
import { MoveHistory } from './MoveHistory'
import { describeChange, describeContinuation } from './moves'

const TZ = 'Asia/Manila'
const base: BookingDetail = {
  id: 'b1', reference_code: 'CB-ROOTAA', court_id: 'c1', court_name: 'Badminton 1', sport: 'badminton',
  slot_start: '2030-01-07T07:00:00.000Z', slot_end: '2030-01-07T08:00:00.000Z', status: 'confirmed', total_amount: 900, booking_fee: 0, amount_due: 900, waiver_text: null, waiver_accepted_at: null,
  expires_at: null, rejection_count: 0, guest_name: 'Gina Guest', guest_email: 'gina@example.com',
  created_at: '2030-01-05T02:00:00.000Z', payments: [], cancelled_at: null, cancel_reason: null, cancelled_by_venue: false,
  user_id: null, parent_reference_code: null, continuations: [], changes: [],
}
// 3 PM–5 PM Mon Jan 7 on Badminton 1 → 4 PM–6 PM Tue Jan 8 on Badminton 2 (Manila is UTC+8).
const change: BookingChange = {
  old_court_name: 'Badminton 1', old_start: '2030-01-07T07:00:00.000Z', old_end: '2030-01-07T09:00:00.000Z',
  new_court_name: 'Badminton 2', new_start: '2030-01-08T08:00:00.000Z', new_end: '2030-01-08T10:00:00.000Z',
  continuation_reference: null, reason: 'Rain flooded the court', changed_at: '2030-01-07T01:00:00.000Z',
}
const part: BookingContinuation = {
  reference_code: 'CB-MOVEDA', court_name: 'Badminton 2', slot_start: '2030-01-08T08:00:00.000Z',
  slot_end: '2030-01-08T09:00:00.000Z', status: 'confirmed',
}

const renderHistory = (booking: BookingDetail) =>
  render(<MemoryRouter><MoveHistory booking={booking} timeZone={TZ} /></MemoryRouter>)

describe('move text', () => {
  it('describes a move between courts, with the venue times', () => {
    expect(describeChange(change, TZ)).toBe('Moved from Mon, Jan 7, 3 PM–5 PM (Badminton 1) to Tue, Jan 8, 4 PM–6 PM (Badminton 2)')
  })

  it('leaves the court out of the "from" part when it stayed the same', () => {
    expect(describeChange({ ...change, new_court_name: 'Badminton 1' }, TZ))
      .toBe('Moved from Mon, Jan 7, 3 PM–5 PM to Tue, Jan 8, 4 PM–6 PM (Badminton 1)')
  })

  it('counts the hours of a moved part', () => {
    expect(describeContinuation(part, TZ)).toBe('1 hour moved to Tue, Jan 8, 4 PM–5 PM (Badminton 2)')
    expect(describeContinuation({ ...part, slot_end: '2030-01-08T10:00:00.000Z' }, TZ)).toMatch(/^2 hours moved/)
  })
})

describe('MoveHistory', () => {
  it('renders nothing for a booking that was never moved', () => {
    const { container } = renderHistory(base)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each change with its reason', () => {
    renderHistory({ ...base, changes: [change] })
    const list = screen.getByRole('list', { name: 'Changes' })
    expect(list).toHaveTextContent('Moved from Mon, Jan 7, 3 PM–5 PM (Badminton 1) to Tue, Jan 8, 4 PM–6 PM (Badminton 2)')
    expect(list).toHaveTextContent('Reason: Rain flooded the court')
  })

  it('lists the moved parts under their booking, with links to their references', () => {
    renderHistory({ ...base, changes: [{ ...change, continuation_reference: 'CB-MOVEDA' }], continuations: [part, { ...part, reference_code: 'CB-MOVEDB', status: 'cancelled' }] })
    const parts = screen.getByRole('list', { name: 'Moved parts' })
    expect(within(parts).getByRole('link', { name: 'CB-MOVEDA' })).toHaveAttribute('href', '/booking/CB-MOVEDA')
    expect(within(parts).getByText(/Cancelled/)).toBeInTheDocument()
  })

  it('says a moved part came from its booking and is paid through it', () => {
    renderHistory({ ...base, reference_code: 'CB-MOVEDA', parent_reference_code: 'CB-ROOTAA', changes: [change] })
    expect(screen.getByText(/moved part of/i)).toHaveTextContent("It's covered by that booking's payment")
    expect(screen.getByRole('link', { name: 'CB-ROOTAA' })).toHaveAttribute('href', '/booking/CB-ROOTAA')
  })
})
