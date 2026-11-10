import { useState } from 'react'
import { ClosuresPanel } from './ClosuresPanel'
import { PromosPanel } from './promos/PromosPanel'
import { WeeklyHoursEditor } from './WeeklyHoursEditor'
import { panelProps, useScheduleTab } from './scheduleTabState'
import { ScheduleTabList } from './ScheduleTabs'

/**
 * Four tabs (T17.31, T19.2): Opening hours and Prices share one draft and one save; Promos and Closures save on their own. The panels
 * are fixed elements here and the hours editor renders into them, so they stay put while it loads, saves or discards
 * (a remount of the draft never resets the Closures form). The save bar comes last, so it stays at the bottom whichever
 * tab is open.
 */
export function SchedulePage() {
  const [tab, setTab] = useScheduleTab()
  const [hours, setHours] = useState<HTMLElement | null>(null)
  const [prices, setPrices] = useState<HTMLElement | null>(null)
  const [bar, setBar] = useState<HTMLElement | null>(null)
  const [hoursMark, setHoursMark] = useState<HTMLElement | null>(null)
  const [pricesMark, setPricesMark] = useState<HTMLElement | null>(null)
  return (
    <section className="page schedule-page">
      <h1>Schedule</h1>
      <ScheduleTabList tab={tab} onTab={setTab} markRefs={{ hours: setHoursMark, prices: setPricesMark }} />
      <WeeklyHoursEditor tab={tab} slots={{ hours, prices, bar, hoursMark, pricesMark }} />
      <div ref={setHours} {...panelProps('hours', tab)} className="card stack" />
      <div ref={setPrices} {...panelProps('prices', tab)} className="card stack" />
      <div {...panelProps('promos', tab)}>
        <PromosPanel />
      </div>
      <div {...panelProps('closures', tab)}>
        <ClosuresPanel />
      </div>
      <div ref={setBar} className="save-bar-slot" />
    </section>
  )
}
