import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_FILTERS } from './bookingFilters'
import { BookingFiltersBar, BookingSearchForm } from './BookingFiltersBar'

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

  it('sorts by play time or booked-on date, the default following the date filter (T11.5b)', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<BookingFiltersBar filters={DEFAULT_FILTERS} onChange={onChange} />)
    expect(screen.getByLabelText('Sort by')).toHaveValue('play-desc')
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'booked-asc')
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, sort: 'booked-asc' })
    // With a day picked, the default is earliest first; choosing it again clears the choice from the URL.
    const day = { ...DEFAULT_FILTERS, date: '2030-01-07', sort: 'booked-asc' as const }
    rerender(<BookingFiltersBar filters={day} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('Sort by'), 'play-asc')
    expect(onChange).toHaveBeenLastCalledWith({ ...day, sort: null })
  })
})

describe('BookingSearchForm', () => {
  it('searches on submit with the trimmed text, and starts from the current search', async () => {
    const onSearch = vi.fn()
    render(<BookingSearchForm value="ana" onSearch={onSearch} />)
    const box = screen.getByRole('searchbox', { name: 'Search' })
    expect(box).toHaveValue('ana')
    await userEvent.clear(box)
    await userEvent.type(box, '  cb-7kq2xd {Enter}')
    expect(onSearch).toHaveBeenLastCalledWith('cb-7kq2xd')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(onSearch).toHaveBeenCalledTimes(2)
  })

  it('asks for 2 characters instead of searching for one, and an empty box clears', async () => {
    const onSearch = vi.fn()
    render(<BookingSearchForm value="" onSearch={onSearch} />)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'a{Enter}')
    expect(screen.getByRole('alert')).toHaveTextContent('Type at least 2 characters to search.')
    expect(onSearch).not.toHaveBeenCalled()
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search' }))
    await userEvent.keyboard('{Enter}')
    expect(onSearch).toHaveBeenCalledWith('')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
