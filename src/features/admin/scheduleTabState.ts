import { useSearchParams } from 'react-router-dom'

// The Schedule page's sections (T17.31). The open tab is URL state (`?tab=`), so reload and Back keep it.
export const SCHEDULE_TABS = [
  { id: 'hours', label: 'Opening hours' },
  { id: 'prices', label: 'Prices' },
  { id: 'closures', label: 'Closures' },
] as const
export type ScheduleTab = (typeof SCHEDULE_TABS)[number]['id']

export const tabId = (tab: ScheduleTab) => `schedule-tab-${tab}`
export const panelId = (tab: ScheduleTab) => `schedule-panel-${tab}`

/**
 * The open tab from the URL (unknown or missing: Opening hours) and a setter that pushes a history entry. The setter
 * doesn't skip "the open tab": the router commits in a transition, so `tab` can be stale between quick key presses
 * (ArrowLeft then Home would be dropped). Callers skip a tab that is already open (ScheduleTabList).
 */
export function useScheduleTab(): [ScheduleTab, (tab: ScheduleTab) => void] {
  const [params, setParams] = useSearchParams()
  const value = params.get('tab')
  const tab = SCHEDULE_TABS.find((t) => t.id === value)?.id ?? 'hours'
  const setTab = (next: ScheduleTab) => {
    const copy = new URLSearchParams(params)
    copy.set('tab', next)
    setParams(copy)
  }
  return [tab, setTab]
}

/** Props for a tab's panel: named by its tab, and `hidden` (but still mounted, so drafts survive) when closed. */
export const panelProps = (tab: ScheduleTab, open: ScheduleTab) => ({
  id: panelId(tab),
  role: 'tabpanel',
  'aria-labelledby': tabId(tab),
  hidden: tab !== open,
})
