import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { Slot } from '../booking/selection'
import { DayView } from './DayView'
import { maxWalkInSlots } from './dashboard'
import { validStarts } from './reschedule'

// 11 PM and midnight Manila: adjacent effective periods still cannot be joined.
const slot = (start: string, end: string, periodEnd: string): Slot => ({
  court_id: 'A', slot_start: start, slot_end: end, period_end: periodEnd,
  status: 'free', price: 300, booker_first_name: null, open_play_session_id: null, block_key: null,
})
const first = slot('2030-01-07T15:00:00.000Z', '2030-01-07T16:00:00.000Z', '2030-01-07T16:00:00.000Z')
const second = slot('2030-01-07T16:00:00.000Z', '2030-01-07T17:00:00.000Z', '2030-01-07T17:00:00.000Z')
const now = new Date('2030-01-07T12:00:00.000Z')

describe('staff scheduling across effective periods', () => {
  it('does not offer a walk-in duration across touching period boundaries', () => {
    expect(maxWalkInSlots([first, second], 0, now)).toBe(1)
  })
  it('does not offer a reschedule destination spanning touching period boundaries', () => {
    expect(validStarts([first, second], 2, now)).toEqual([])
  })
  it('keeps a protected booking visible when no current availability covers its time', () => {
    render(<MemoryRouter><DayView date="2030-01-07" courts={[{ id: 'A', name: 'Court A' }]} slots={[first]}
      bookings={[{ id: 'b1', reference_code: 'CB-PROTECT', court_name: 'Court A', slot_start: second.slot_start,
        slot_end: second.slot_end, guest_name: 'Protected Guest' }]} timeZone="Asia/Manila" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'CB-PROTECT' })).toBeInTheDocument()
    expect(screen.getByText('Protected Guest')).toBeInTheDocument()
  })
})
