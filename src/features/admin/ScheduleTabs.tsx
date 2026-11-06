import { useRef, type KeyboardEvent } from 'react'
import { panelId, SCHEDULE_TABS, tabId, type ScheduleTab } from './scheduleTabState'

/**
 * Tabs with automatic activation: arrows (wrapping), Home and End move focus and select. Each tab has a `mark` slot
 * where the hours editor renders its unsaved-changes dot, so the tabs themselves never remount while it loads or saves.
 */
export function ScheduleTabList({ tab, onTab, markRefs }: {
  tab: ScheduleTab
  onTab: (tab: ScheduleTab) => void
  markRefs: Partial<Record<ScheduleTab, (el: HTMLElement | null) => void>>
}) {
  const refs = useRef<Partial<Record<ScheduleTab, HTMLButtonElement | null>>>({})
  function handleKeyDown(e: KeyboardEvent) {
    // From the focused tab, not `tab`: the router commits a tab change in a transition, so quick key presses can run
    // before the selected tab re-renders.
    const focused = SCHEDULE_TABS.findIndex((t) => refs.current[t.id] === e.target)
    const at = focused >= 0 ? focused : SCHEDULE_TABS.findIndex((t) => t.id === tab)
    const n = SCHEDULE_TABS.length
    const index = e.key === 'ArrowRight' ? (at + 1) % n : e.key === 'ArrowLeft' ? (at - 1 + n) % n
      : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : null
    if (index === null) return
    e.preventDefault()
    const next = SCHEDULE_TABS[index].id
    onTab(next)
    refs.current[next]?.focus()
  }
  return (
    <div className="tabs" role="tablist" aria-label="Schedule sections" onKeyDown={handleKeyDown}>
      {SCHEDULE_TABS.map((t) => (
        <button key={t.id} ref={(el) => { refs.current[t.id] = el }} type="button" role="tab" id={tabId(t.id)}
          className="tab" aria-selected={t.id === tab} aria-controls={panelId(t.id)} tabIndex={t.id === tab ? 0 : -1}
          onClick={() => onTab(t.id)}>
          {/* One flex item: a separate one would put a space before the mark's words in the tab's name. */}
          <span>{t.label}{markRefs[t.id] && <span ref={markRefs[t.id]} />}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * The words screen readers hear in a tab with unsaved edits; CSS draws the dot after the tab. The text is an inline
 * span at font-size 0, not `.sr-only`: Chromium puts a space before a positioned or inline-block child in the name.
 */
export function UnsavedMark() {
  return <span className="tab-unsaved">, unsaved changes</span>
}
