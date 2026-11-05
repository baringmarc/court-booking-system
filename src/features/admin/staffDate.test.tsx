import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useStaffOperatingDate } from './staffDate'

const h = vi.hoisted(() => ({ periods: [] as { court_id: string; period_start: string; period_end: string }[] }))
vi.mock('../catalog/hooks', () => ({ useStaffSchedule: () => ({ data: h.periods }) }))

describe('staff operating date', () => {
  it('uses the prior date while a custom court remains open after midnight', () => {
    h.periods = [{ court_id: 'custom', period_start: '2030-01-07T14:00:00Z', period_end: '2030-01-07T18:00:00Z' }]
    const at = new Date('2030-01-07T17:00:00Z') // 1 AM Manila, Jan 8
    expect(renderHook(() => useStaffOperatingDate('Asia/Manila', at, ['custom'])).result.current).toBe('2030-01-07')
    expect(renderHook(() => useStaffOperatingDate('Asia/Manila', at, ['other'])).result.current).toBe('2030-01-08')
  })
})
