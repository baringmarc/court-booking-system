import { addDays, todayInZone } from '../../lib/time'
import { useStaffSchedule } from '../catalog/hooks'

/** The active operating date at an instant, including a custom court's overnight period. */
export function useStaffOperatingDate(timeZone: string, instant: Date, courtIds: string[] = []) {
  const local = todayInZone(timeZone, instant)
  const previous = addDays(local, -1)
  const schedule = useStaffSchedule(previous)
  const inPrevious = schedule.data?.some((p) =>
    (courtIds.length === 0 || courtIds.includes(p.court_id)) &&
    Date.parse(p.period_start) <= instant.getTime() && instant.getTime() < Date.parse(p.period_end))
  return inPrevious ? previous : local
}
