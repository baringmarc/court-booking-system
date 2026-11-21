// T30.6: the Refunds select on the bookings filters.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTERS } from './bookingFilters'
import { BookingFiltersBar } from './BookingFiltersBar'

describe('BookingFiltersBar Refunds filter (T30.6)', () => {
  it('offers All bookings and Refund owed, starting on All bookings', () => {
    render(<BookingFiltersBar filters={DEFAULT_FILTERS} onChange={vi.fn()} />)
    const select = screen.getByLabelText('Refunds', { exact: true })
    expect(select).toHaveValue('')
    expect(within(select).getAllByRole('option').map((o) => [o.textContent, (o as HTMLOptionElement).value])).toEqual([
      ['All bookings', ''], ['Refund owed', 'owed'],
    ])
  })

  it('shows Refund owed when the filter is on', () => {
    render(<BookingFiltersBar filters={{ ...DEFAULT_FILTERS, refund: 'owed' }} onChange={vi.fn()} />)
    expect(screen.getByLabelText('Refunds', { exact: true })).toHaveDisplayValue('Refund owed')
  })

  it('picking Refund owed reports it, and picking All bookings removes the key', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<BookingFiltersBar filters={DEFAULT_FILTERS} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Refunds', { exact: true }), 'owed')
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, refund: 'owed' })

    const on = { ...DEFAULT_FILTERS, status: 'all' as const, refund: 'owed' as const }
    rerender(<BookingFiltersBar filters={on} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Refunds', { exact: true }), '')
    const next = onChange.mock.lastCall![0] as Record<string, unknown>
    expect(next).toEqual({ ...DEFAULT_FILTERS, status: 'all' })
    expect('refund' in next).toBe(false)
  })
})
