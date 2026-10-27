import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DateStrip } from './DateStrip'

// 2026-10-27 is a Tuesday; Sundays (0) are closed in these tests. A 30-day window.
const TODAY = '2026-10-27'
const LAST = '2026-11-26'

function Harness({ start = TODAY, last = LAST, onChange = () => {} }: { start?: string; last?: string; onChange?: (d: string) => void }) {
  const [value, setValue] = useState(start)
  return <DateStrip value={value} today={TODAY} lastDay={last} closedDays={[0]} onChange={(d) => { setValue(d); onChange(d) }} />
}

const tiles = () => within(screen.getByRole('group', { name: 'Date' })).getAllByRole('button', { pressed: undefined })
  .filter((b) => b.classList.contains('date-tile'))
const tileNames = () => tiles().map((t) => t.textContent)

describe('DateStrip', () => {
  // Compile the lazy calendar once, as DatePicker.test does, so findBy doesn't time out on a cold transform.
  beforeAll(async () => {
    await import('../../components/Calendar')
  })

  it('heads with Today, Tomorrow or the weekday, with the full date', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    expect(screen.getByRole('heading', { level: 2, name: 'Today Tuesday, October 27, 2026' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.getByText('Tomorrow')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(screen.getByText('Thursday')).toBeInTheDocument()
    expect(screen.getByText('Thursday, October 29, 2026')).toBeInTheDocument()
  })

  it('shows 10 days from today, the month span, a pressed day and a marked today', () => {
    render(<Harness />)
    expect(tiles()).toHaveLength(10)
    expect(screen.getByText('Oct – Nov 2026')).toBeInTheDocument()
    const today = screen.getByRole('button', { name: 'Tuesday, October 27, today' })
    expect(today).toHaveAttribute('aria-pressed', 'true')
    expect(today).toHaveClass('is-today')
    expect(screen.getByRole('button', { name: 'Thursday, November 5' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('greys out closed days so they cannot be picked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const sunday = screen.getByRole('button', { name: 'Sunday, November 1, closed' })
    expect(sunday).toBeDisabled()
    await user.click(sunday)
    expect(onChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Friday, October 30' }))
    expect(onChange).toHaveBeenCalledWith('2026-10-30')
    expect(screen.getByRole('button', { name: 'Friday, October 30' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('stops the arrows at today and the last bookable day', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness />)
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next day' })).toBeEnabled()
    unmount()
    render(<Harness start={LAST} />)
    expect(screen.getByRole('button', { name: 'Next day' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(screen.getByText('Wednesday, November 25, 2026')).toBeInTheDocument()
  })

  it('slides one day when a step passes the last tile', async () => {
    const user = userEvent.setup()
    render(<Harness start="2026-11-05" />) // the 10th tile from today
    expect(tileNames()[0]).toContain('Tuesday, October 27')
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(tileNames()[0]).toContain('Wednesday, October 28')
    expect(tileNames()[9]).toContain('Friday, November 6')
    expect(screen.getByRole('button', { name: 'Friday, November 6' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('has fewer tiles when the booking window is short', () => {
    render(<Harness last="2026-10-30" />)
    expect(tiles()).toHaveLength(4)
    expect(screen.getByText('Oct 2026')).toBeInTheDocument()
  })

  it('jumps to a date through the calendar, and the strip moves to show it', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: 'Jump to date' }))
    const dialog = await screen.findByRole('dialog', { name: 'Choose a date' })
    await within(dialog).findByRole('grid')
    await user.click(within(dialog).getByRole('button', { name: /next month/i }))
    await user.click(within(dialog).getByRole('button', { name: /November 20th, 2026/ }))
    expect(onChange).toHaveBeenCalledWith('2026-11-20')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Friday, November 20, 2026')).toBeInTheDocument()
    expect(tileNames()[9]).toContain('Friday, November 20')
    expect(screen.getByRole('button', { name: 'Friday, November 20' })).toHaveAttribute('aria-pressed', 'true')
  })
})
