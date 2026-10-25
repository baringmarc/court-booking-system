import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { DatePicker } from './DatePicker'

const TZ = 'Asia/Manila'
// 2026-10-24 is a Saturday; Monday (1) is closed in these tests.
const TODAY = '2026-10-24'

function Harness({ onChange = () => {}, closedDays = [1], max = '2026-10-31' }: { onChange?: (d: string) => void; closedDays?: number[]; max?: string }) {
  const [value, setValue] = useState(TODAY)
  return (
    <DatePicker label="Date" value={value} today={TODAY} min={TODAY} max={max} closedDays={closedDays} timeZone={TZ}
      onChange={(d) => { setValue(d); onChange(d) }} />
  )
}

describe('DatePicker', () => {
  // Compile the lazy calendar module (DayPicker and date-fns) once up front: under a full parallel run, its first
  // transform can outlast findBy's 1 s wait. React.lazy still suspends on the first open, so that path stays tested.
  beforeAll(async () => {
    await import('./Calendar')
  })

  it('shows the date and presses the matching quick pick', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} closedDays={[]} />)
    expect(screen.getByRole('group', { name: 'Date' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Choose a date, Sat, Oct 24' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tomorrow' }))
    expect(onChange).toHaveBeenCalledWith('2026-10-25')
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Choose a date, Sun, Oct 25' })).toBeInTheDocument()
  })

  it('disables a quick pick that is closed or out of range', () => {
    // Tomorrow (Sunday) closed; and a range that ends today.
    const { unmount } = render(<Harness closedDays={[0]} />)
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toBeDisabled()
    unmount()
    render(<Harness closedDays={[]} max={TODAY} />)
    expect(screen.getByRole('button', { name: 'Tomorrow' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Today' })).toBeEnabled()
  })

  it('opens the calendar with closed and out-of-range days disabled', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: /Choose a date/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Date' })
    const day = (n: number) => within(dialog).getByRole('button', { name: new RegExp(`October ${n}(st|nd|rd|th)?, 2026`) })
    expect(await within(dialog).findByRole('grid')).toBeInTheDocument()
    expect(day(23)).toBeDisabled() // before today
    expect(day(26)).toBeDisabled() // a Monday (closed)
    expect(day(25)).toBeEnabled()
    expect(day(24)).toHaveFocus() // the selected day takes focus
  })

  it('picks a day with the keyboard, closes and returns focus', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const opener = screen.getByRole('button', { name: /Choose a date/ })
    await user.click(opener)
    const dialog = await screen.findByRole('dialog', { name: 'Date' })
    await within(dialog).findByRole('grid')
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName(/October 24th, 2026/))
    await user.keyboard('{ArrowRight}{ArrowRight}') // Sun 25, then Tue 27: the closed Monday is skipped
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-10-27')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes without changing the date', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /Choose a date/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Date' })
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})
