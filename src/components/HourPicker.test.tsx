import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DurationPicker, HourPicker } from './HourPicker'
import { operatingHourOptions } from './pickerHours'

const TZ = 'Asia/Manila'
const overnight = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '22:00:00', close_time: '02:00:00', is_closed: false }))
const options = operatingHourOptions(overnight, '2026-10-24', TZ) // 10 PM, 11 PM, 12 AM, 1 AM

function Harness({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState<string | null>(null)
  return <HourPicker label="Start time" options={options} value={value} onChange={(v) => { setValue(v); onChange(v) }} />
}

describe('HourPicker', () => {
  it('names the group and marks hours after midnight', () => {
    render(<HourPicker label="Start time" options={options} value={null} onChange={() => {}} />)
    const group = screen.getByRole('group', { name: 'Start time' })
    expect(group).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('radio', { name: '12 AM (next day)' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: '10 PM' })).not.toBeChecked()
  })

  it('checks the option matching a server-written start', () => {
    render(<HourPicker label="Start time" options={options} value="2026-10-24T16:00:00+00:00" onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: '12 AM (next day)' })).toBeChecked()
  })

  it('selects by click and moves with the arrow keys', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await user.click(screen.getByRole('radio', { name: '11 PM' }))
    expect(onChange).toHaveBeenLastCalledWith(options[1].start)
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: '12 AM (next day)' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '12 AM (next day)' })).toHaveFocus()
    expect(onChange).toHaveBeenLastCalledWith(options[2].start)
  })

  it('is one tab stop', async () => {
    const user = userEvent.setup()
    render(<><HourPicker label="Start time" options={options} value={options[1].start} onChange={() => {}} /><button>After</button></>)
    await user.tab()
    expect(screen.getByRole('radio', { name: '11 PM' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
  })

  it('says so when the day is closed', () => {
    render(<HourPicker label="Start time" options={[]} value={null} onChange={() => {}} />)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByText('Closed on this day.')).toBeInTheDocument()
  })
})

describe('DurationPicker', () => {
  it('offers 1 hr up to the max and reports the choice', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<DurationPicker max={3} value={1} onChange={onChange} />)
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(['1 hr', '2 hrs', '3 hrs'])
    expect(screen.getByRole('radio', { name: '1 hr' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: '3 hrs' }))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('drops a value that no longer fits', () => {
    render(<DurationPicker max={2} value={3} onChange={() => {}} />)
    expect(screen.getAllByRole('radio').some((r) => (r as HTMLInputElement).checked)).toBe(false)
  })

  it('asks for a start time when nothing fits', () => {
    render(<DurationPicker max={0} value={null} onChange={() => {}} />)
    expect(screen.getByText('Choose a start time first.')).toBeInTheDocument()
  })
})
