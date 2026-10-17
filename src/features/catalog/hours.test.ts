import { describe, expect, it } from 'vitest'
import type { OperatingHours } from './api'
import { summarizeHours } from './hours'

function day(day_of_week: number, open = '06:00:00', close = '22:00:00', is_closed = false): OperatingHours {
  return { day_of_week, open_time: open, close_time: close, is_closed }
}

const week = (fn: (d: number) => OperatingHours) => [0, 1, 2, 3, 4, 5, 6].map(fn)

describe('summarizeHours', () => {
  it('collapses identical days into one line', () => {
    expect(summarizeHours(week((d) => day(d)))).toEqual(['Open daily, 6 AM – 10 PM'])
  })

  it('reports a fully closed week', () => {
    expect(summarizeHours(week((d) => day(d, undefined, undefined, true)))).toEqual(['Temporarily closed'])
  })

  it('groups weekdays and weekends, Monday first', () => {
    const hours = week((d) => (d === 0 || d === 6 ? day(d, '08:00:00', '20:00:00') : day(d)))
    expect(summarizeHours(hours)).toEqual(['Mon–Fri: 6 AM – 10 PM', 'Sat–Sun: 8 AM – 8 PM'])
  })

  it('does not merge non-adjacent days with the same hours', () => {
    const hours = week((d) => day(d, undefined, undefined, d === 0 || d === 1))
    expect(summarizeHours(hours)).toEqual(['Mon: Closed', 'Tue–Sat: 6 AM – 10 PM', 'Sun: Closed'])
  })

  it('treats a missing day as closed', () => {
    const hours = week((d) => day(d)).filter((h) => h.day_of_week !== 0)
    expect(summarizeHours(hours)).toEqual(['Mon–Sat: 6 AM – 10 PM', 'Sun: Closed'])
  })
})
