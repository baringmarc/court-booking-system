import { DayPicker, type Matcher } from '@daypicker/react'
import '@daypicker/react/style.css'
import './Calendar.css'
import { toPickerDate, fromPickerDate } from './pickerHours'

export type CalendarProps = {
  /** "YYYY-MM-DD" dates in the venue's calendar. */
  selected: string
  today: string
  min?: string
  max?: string
  /** Days of the week (0 = Sunday) that can't be picked. */
  closedDays?: number[]
  onSelect: (date: string) => void
}

/**
 * The month calendar (T10.2) on @daypicker/react, loaded lazily by DatePicker so pages pay for it only when it
 * opens (RESEARCH M10). It works in calendar days, so it gets local Dates and no time zone.
 */
export default function Calendar({ selected, today, min, max, closedDays = [], onSelect }: CalendarProps) {
  const disabled: Matcher[] = []
  if (min) disabled.push({ before: toPickerDate(min) })
  if (max) disabled.push({ after: toPickerDate(max) })
  if (closedDays.length > 0) disabled.push({ dayOfWeek: closedDays })

  return (
    <DayPicker
      className="calendar"
      mode="single"
      required
      selected={toPickerDate(selected)}
      onSelect={(date: Date) => onSelect(fromPickerDate(date))}
      defaultMonth={toPickerDate(selected)}
      today={toPickerDate(today)}
      startMonth={min ? toPickerDate(min) : undefined}
      endMonth={max ? toPickerDate(max) : undefined}
      disabled={disabled}
      weekStartsOn={1}
      autoFocus
    />
  )
}
