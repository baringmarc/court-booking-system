import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTERS } from './bookingFilters'
import { BookingFiltersBar } from './BookingFiltersBar'

describe('BookingFiltersBar', () => {
  it('starts on the review queue and reports filter changes', async () => {
    const onChange = vi.fn()
    render(<BookingFiltersBar filters={DEFAULT_FILTERS} onChange={onChange} />)
    expect(screen.getByLabelText('Status')).toHaveDisplayValue('Needs review')
    await userEvent.selectOptions(screen.getByLabelText('Source'), 'walk_in')
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, source: 'walk_in' })
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'all')
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, status: 'all' })
  })
})
