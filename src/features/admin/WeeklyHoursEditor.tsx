import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { SaveStatus } from '../../components/SaveStatus'
import { ApiError } from '../../lib/queryClient'
import { errorMessage } from '../../lib/errors'
import { DAY_NAMES, DISPLAY_DAY_ORDER, formatHour, formatMoney } from '../../lib/format'
import { useCourts, useVenueSettings } from '../catalog/hooks'
import type { CourtWithPhotos } from '../catalog/api'
import type { ScheduleChanges, ScheduleData, SchedulePeriod } from './api'
import { formatDateTimeInZone, todayInZone } from '../../lib/time'
import { filtersToParams } from './bookingFilters'
import { ReviewDialog } from './ReviewDialog'
import { UnsavedMark } from './ScheduleTabs'
import { tabId, type ScheduleTab } from './scheduleTabState'
import { useSaveSchedule, useSchedule, useScheduleImpact } from './hooks'
import { ConfirmDialog } from './ConfirmDialog'
import { CourtExceptions } from './CourtExceptions'
import { HoursTable } from './HoursTable'
import { WeekChart } from './WeekChart'
import { useUnsavedGuard } from './UnsavedGuard'
import { changedDays, dayText, hourLabel, overlapDays, periodsOfDay, samePeriods, toSave } from './weeklySchedule'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

type CourtDraft = { mode: 'inherit' | 'custom'; periods: SchedulePeriod[] }
/** Pending override per "day:hour": a price, or null to go back to the court's default rate. */
type RateEdits = Record<string, number | null>

/**
 * Opening hours and Prices of /admin/schedule (T17.31): one draft and one `save_schedule` call, whichever tab is open.
 * Renders into the page's fixed `slots` (the two panels, the save bar's place and the tabs' unsaved marks), so the
 * page's elements stay put while this loads, saves or discards.
 */
export function WeeklyHoursEditor({ tab, slots }: { tab: ScheduleTab; slots: Slots }) {
  const schedule = useSchedule()
  const courts = useCourts({ includeInactive: true })
  const save = useSaveSchedule()
  const [generation, setGeneration] = useState(0)
  const [priceCourt, setPriceCourt] = useState('')

  if (schedule.isPending || courts.isPending || schedule.isError || courts.isError) {
    const body = schedule.isPending || courts.isPending
      ? <PageLoader />
      : <ErrorMessage error={schedule.error ?? courts.error} onRetry={() => { void schedule.refetch(); void courts.refetch() }} />
    return into(tab === 'hours' ? slots.hours : tab === 'prices' ? slots.prices : null, body)
  }
  // The save bar leaves once the draft is clean, so focus goes back to the open tab after a save or Discard.
  const focusTab = () => document.getElementById(tabId(tab))?.focus()
  const resetDraft = () => { save.reset(); setGeneration((g) => g + 1) }
  return (
    <Editor
      key={generation}
      schedule={schedule.data}
      courts={courts.data}
      slots={slots}
      priceCourt={priceCourt}
      onPriceCourt={setPriceCourt}
      save={save}
      onSaved={() => { setGeneration((g) => g + 1); focusTab() }}
      onDiscard={() => { resetDraft(); focusTab() }}
      onReload={() => { void schedule.refetch().then(resetDraft) }}
    />
  )
}

type Slots = Record<'hours' | 'prices' | 'bar' | 'hoursMark' | 'pricesMark', HTMLElement | null>
const into = (slot: HTMLElement | null, node: ReactNode) => (slot ? createPortal(node, slot) : null)

function Editor({ schedule, courts, slots, priceCourt, onPriceCourt, save, onSaved, onDiscard, onReload }: {
  schedule: ScheduleData
  courts: CourtWithPhotos[]
  slots: Slots
  priceCourt: string
  onPriceCourt: (id: string) => void
  save: ReturnType<typeof useSaveSchedule>
  onSaved: () => void
  onDiscard: () => void
  onReload: () => void
}) {
  // The draft is seeded once; a save or "Reload latest" remounts this with fresh data (CLAUDE.md form rule).
  const [base] = useState(schedule)
  const currency = useVenueSettings().data?.currency ?? 'PHP'
  const baseCourt = (id: string) => base.courts.find((c) => c.court_id === id)
  const [venue, setVenue] = useState<SchedulePeriod[]>(() => base.venue_periods.map(clean))
  const [courtDrafts, setCourtDrafts] = useState<Record<string, CourtDraft>>(() =>
    Object.fromEntries(base.courts.map((c) => [c.court_id, { mode: c.schedule_mode, periods: c.periods.map(clean) }])))
  const [rateEdits, setRateEdits] = useState<Record<string, RateEdits>>({})
  const [rateDay, setRateDay] = useState(1)
  const [rateFrom, setRateFrom] = useState(6)
  const [rateTo, setRateTo] = useState(7)
  const [price, setPrice] = useState('')
  // The court whose own hours the table is editing ("Editing Court 3 only"), or null for the venue's opening hours.
  const [editing, setEditing] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const reviewButton = useRef<HTMLButtonElement>(null)
  const discardButton = useRef<HTMLButtonElement>(null)
  const bar = useRef<HTMLElement>(null)
  // The impact horizon is fixed per draft session so the preview's key only changes with the draft.
  const [horizon] = useState(() => {
    const now = Date.now()
    return { from: new Date(now).toISOString(), to: new Date(now + 90 * 86_400_000).toISOString() }
  })
  const timezone = useVenueSettings().data?.timezone ?? 'Asia/Manila'

  const courtName = (id: string) => courts.find((c) => c.id === id)?.name ?? 'A court'
  const draftOf = (id: string): CourtDraft => courtDrafts[id] ?? { mode: 'inherit', periods: [] }
  const court = courts.find((c) => c.id === editing && draftOf(c.id).mode === 'custom')
  const courtId = court?.id ?? null
  const periods = courtId === null ? venue : draftOf(courtId).periods
  /** A court's week as it stands in the draft: its own hours, or the venue's when it follows them. */
  const effectiveOf = (id: string) => (draftOf(id).mode === 'custom' ? draftOf(id).periods : venue)
  const savedOf = (id: string | null) => {
    const was = id === null ? undefined : baseCourt(id)
    return was?.schedule_mode === 'custom' ? was.periods : base.venue_periods
  }
  // The Prices tab picks its court separately from the court being edited on Opening hours (first court by default).
  const priced = courts.find((c) => c.id === priceCourt) ?? courts[0]
  const pricedId = priced?.id ?? null
  const setPeriods = (next: SchedulePeriod[]) => {
    if (courtId === null) setVenue(next)
    else setCourtDrafts((d) => ({ ...d, [courtId]: { ...draftOf(courtId), periods: next } }))
  }

  const originalRate = (id: string, day: number, hour: number) =>
    baseCourt(id)?.rates.find((r) => r.day_of_week === day && r.start_hour === hour)?.price
  const effectiveRate = (id: string, day: number, hour: number) => {
    const edit = rateEdits[id]?.[`${day}:${hour}`]
    return edit === undefined ? originalRate(id, day, hour) : edit ?? undefined
  }

  // --- what will be saved ---------------------------------------------------
  const venueChanged = !samePeriods(venue, base.venue_periods)
  const courtChanges = courts.flatMap((c) => {
    const draft = draftOf(c.id)
    const was = baseCourt(c.id)
    const wasMode = was?.schedule_mode ?? 'inherit'
    const moved = draft.mode !== wasMode || (draft.mode === 'custom' && !samePeriods(draft.periods, was?.periods ?? []))
    return moved ? [{ court: c, draft, wasMode, was }] : []
  })
  const rateChanges = courts.flatMap((c) =>
    Object.entries(rateEdits[c.id] ?? {})
      .map(([key, value]) => {
        const [day, hour] = key.split(':').map(Number)
        return { court_id: c.id, day_of_week: day, start_hour: hour, price: value }
      })
      .filter((r) => {
        const was = originalRate(c.id, r.day_of_week, r.start_hour)
        return r.price === null ? was !== undefined : was !== r.price
      })
      .sort((a, b) => a.day_of_week - b.day_of_week || a.start_hour - b.start_hour))

  const changes: ScheduleChanges = {}
  if (venueChanged) changes.venue_periods = toSave(venue)
  if (courtChanges.length) {
    changes.courts = courtChanges.map(({ court: c, draft }) =>
      draft.mode === 'custom'
        ? { court_id: c.id, schedule_mode: 'custom', periods: toSave(draft.periods) }
        : { court_id: c.id, schedule_mode: 'inherit' })
  }
  if (rateChanges.length) changes.rate_changes = rateChanges

  const hoursChanged = venueChanged || courtChanges.length > 0
  const dirty = hoursChanged || rateChanges.length > 0
  const venueOverlaps = overlapDays(venue)
  const invalid = venueOverlaps.size > 0 || courts.some((c) => draftOf(c.id).mode === 'custom' && overlapDays(draftOf(c.id).periods).size > 0)
  const conflict = save.error instanceof ApiError && save.error.hint === 'schedule_conflict'
  const guard = useUnsavedGuard(dirty)

  // Informative only: the preview never gates Save, because the database decides what is protected. It is asked for
  // only while the Review changes dialog is open.
  const impactDraft = reviewing && hoursChanged && !invalid
    ? {
        venue_periods: toSave(venue),
        courts: courts.map((c) => {
          const d = draftOf(c.id)
          return { court_id: c.id, schedule_mode: d.mode, periods: d.mode === 'custom' ? toSave(d.periods) : [] }
        }),
      }
    : null
  const impact = useScheduleImpact(impactDraft, horizon.from, horizon.to)

  // Every pending change in plain words, in week order (Monday first): venue days, then courts in court order, then prices.
  const dayLines = (prefix: string, draft: SchedulePeriod[], saved: SchedulePeriod[]) =>
    DISPLAY_DAY_ORDER.filter((d) => changedDays(draft, saved).includes(d))
      .map((d) => `${prefix}${DAY_NAMES[d]}: ${dayText(periodsOfDay(saved, d))} → ${dayText(periodsOfDay(draft, d))}`)
  const money = (amount: number) => formatMoney(amount, currency)
  const reviewLines = [
    ...(venueChanged ? dayLines('', venue, base.venue_periods) : []),
    ...courtChanges.flatMap(({ court: c, draft, wasMode, was }) => {
      if (draft.mode !== wasMode) return [draft.mode === 'custom' ? `${c.name}: now has its own hours` : `${c.name}: back to the venue's opening hours`]
      return dayLines(`${c.name}, `, draft.periods, was?.periods ?? [])
    }),
    ...courts.flatMap((c) => rateChanges
      .filter((r) => r.court_id === c.id)
      .sort((a, b) => DISPLAY_DAY_ORDER.indexOf(a.day_of_week) - DISPLAY_DAY_ORDER.indexOf(b.day_of_week) || a.start_hour - b.start_hour)
      .map((r) => {
        const when = `${c.name}, ${DAY_NAMES[r.day_of_week]} ${hourLabel(r.start_hour)} – ${hourLabel(r.start_hour + 1)}`
        if (r.price === null) return `${when}: back to the court's default rate (${money(c.default_hourly_rate)})`
        return `${when}: ${money(r.price)} (was ${money(originalRate(c.id, r.day_of_week, r.start_hour) ?? c.default_hourly_rate)})`
      })),
  ]

  // --- courts with different hours -------------------------------------------
  const setCourt = (id: string, draft: CourtDraft) => setCourtDrafts((d) => ({ ...d, [id]: draft }))
  function giveOwnHours(id: string) {
    setCourt(id, { mode: 'custom', periods: venue.map(clean) })
    setEditing(id)
  }
  function followOpeningHours(id: string) {
    setCourt(id, { mode: 'inherit', periods: [] })
    if (editing === id) setEditing(null)
  }
  function copyFromCourt(source: string) {
    if (courtId === null) return
    setCourt(courtId, { mode: 'custom', periods: effectiveOf(source).map(clean) })
  }

  function applyRate(e: FormEvent) {
    e.preventDefault()
    if (pricedId === null) return
    const value = price.trim() === '' ? null : Number(price)
    if (value !== null && (!Number.isFinite(value) || value < 0)) return
    const to = Math.max(rateTo, rateFrom + 1)
    setRateEdits((all) => {
      const mine = { ...all[pricedId] }
      for (let h = rateFrom; h < to; h++) {
        const key = `${rateDay}:${h}`
        if (value !== null) mine[key] = value
        else if (originalRate(pricedId, rateDay, h) !== undefined) mine[key] = null
        else delete mine[key]
      }
      return { ...all, [pricedId]: mine }
    })
  }

  const submit = (variables: { revision: number; changes: ScheduleChanges }) => save.mutate(variables, { onSuccess: onSaved })
  const canReview = dirty && !invalid && !conflict && !save.isPending
  function saveReviewed() {
    setReviewing(false)
    bar.current?.focus()
    if (canReview) submit({ revision: base.schedule_revision, changes })
  }
  function keepEditing() {
    setReviewing(false)
    reviewButton.current?.focus()
  }

  const rateTop = Math.max(rateTo, rateFrom + 1)
  /** A court's effective override rates on a day, as "6 PM ₱800". */
  const overridesOf = (id: string, day: number) => HOURS.flatMap((h) => {
    const rate = effectiveRate(id, day, h)
    return rate === undefined ? [] : [`${formatHour(h)} ${formatMoney(rate, currency)}`]
  })
  // Each affected booking opens on its own venue-local date in /admin/bookings, with the booking preselected (as DayView).
  const bookingLink = (id: string, start: string) => {
    const params = filtersToParams({ status: 'all', source: 'all', date: todayInZone(timezone, new Date(start)), q: '', sort: null })
    params.set('booking', id)
    return `/admin/bookings?${params}`
  }
  const count = reviewLines.length

  let saveBar: ReactNode = null
  if (dirty) {
    saveBar = (
      <section ref={bar} className="selection-bar save-bar" aria-label="Unsaved changes" tabIndex={-1}>
        <p className="selection-text">
          <strong>{count} unsaved {count === 1 ? 'change' : 'changes'}</strong>
          {save.isPending && <span className="muted small" role="status">Saving…</span>}
        </p>
        <div className="selection-actions">
          <button ref={discardButton} type="button" className="btn btn-outline" disabled={save.isPending} onClick={() => setConfirmDiscard(true)}>
            Discard
          </button>
          <button ref={reviewButton} type="button" className="btn" disabled={!canReview} onClick={() => setReviewing(true)}>Review &amp; save</button>
        </div>
      </section>
    )
  }

  return (
    <>
      {hoursChanged && into(slots.hoursMark, <UnsavedMark />)}
      {rateChanges.length > 0 && into(slots.pricesMark, <UnsavedMark />)}
      {conflict && (
        <div className="alert alert-error" role="alert">
          <p>The schedule was changed somewhere else since you opened it. Reload the latest schedule to keep editing; your edits here stay until you do.</p>
          <button type="button" className="btn btn-small btn-outline" onClick={onReload}>Reload latest</button>
        </div>
      )}
      {save.isError && !conflict && (
        <div className="alert alert-error" role="alert">
          <p>{errorMessage(save.error)}</p>
          {save.variables && <button type="button" className="btn btn-small btn-outline" onClick={() => submit(save.variables)}>Try again</button>}
        </div>
      )}
      {!dirty && <SaveStatus isSuccess={save.isSuccess} error={null} />}

      {into(slots.hours, <>
        <p className="muted small">
          Open hours are whole hours. A break closes the courts between two ranges, and nothing changes until you save.
        </p>
        {court && (
          <div className="alert alert-info court-editing" role="status">
            <p><strong>{`Editing ${court.name} only`}</strong>. The other courts keep their hours.</p>
            <div className="form-actions">
              <button type="button" className="btn btn-small btn-outline" onClick={() => setEditing(null)}>Back to all courts</button>
              {courts.filter((c) => c.id !== court.id).map((c) => (
                <button key={c.id} type="button" className="btn btn-small btn-ghost" onClick={() => copyFromCourt(c.id)}>{`Copy hours from ${c.name}`}</button>
              ))}
            </div>
          </div>
        )}
        <HoursTable
          key={courtId ?? 'venue'}
          periods={periods}
          saved={savedOf(courtId)}
          onChange={setPeriods}
        />
        <WeekChart periods={periods} />
        {!court && (
          <CourtExceptions courts={courts} venue={venue} draftOf={draftOf} onEdit={setEditing} onInherit={followOpeningHours} onGive={giveOwnHours} />
        )}
      </>)}

      {into(slots.prices, <>
        {!priced ? <p className="muted">No courts yet. Add a court to set prices.</p> : (
          <>
            <label className="field">
              <span>Prices for</span>
              <select value={priced.id} onChange={(e) => onPriceCourt(e.target.value)}>
                {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <p className="muted small">Default rate: {formatMoney(priced.default_hourly_rate, currency)}/hr. Overrides below replace it for the hours you pick.</p>
            <fieldset className="stack">
              <legend>Weekly override rates</legend>
              <p className="muted small">Fill a range of hours with one price. Leave the price empty to go back to the court's default rate. Moving hours never changes rates.</p>
              <div className="form-grid">
                <label className="field"><span>Rate day</span>
                  <select value={rateDay} onChange={(e) => setRateDay(Number(e.target.value))}>
                    {DISPLAY_DAY_ORDER.map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
                  </select>
                </label>
                <label className="field"><span>Rate from</span>
                  <select value={rateFrom} onChange={(e) => setRateFrom(Number(e.target.value))}>
                    {HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
                  </select>
                </label>
                <label className="field"><span>Rate to</span>
                  <select value={rateTop} onChange={(e) => setRateTo(Number(e.target.value))}>
                    {Array.from({ length: 24 - rateFrom }, (_, i) => rateFrom + 1 + i).map((h) => <option key={h} value={h}>{h === 24 ? 'Midnight' : formatHour(h)}</option>)}
                  </select>
                </label>
                <label className="field"><span>Override price</span>
                  <input type="number" min={0} step="any" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
                </label>
              </div>
              <div className="form-actions"><button type="button" className="btn btn-outline" onClick={applyRate}>Apply rate</button></div>
            </fieldset>
            <section className="stack" aria-labelledby="price-overrides-title">
              <h3 id="price-overrides-title">{priced.name}'s override rates</h3>
              {DISPLAY_DAY_ORDER.every((d) => overridesOf(priced.id, d).length === 0)
                ? <p className="muted small">None yet. Every hour uses the default rate.</p>
                : (
                  <ul className="list">
                    {DISPLAY_DAY_ORDER.filter((d) => overridesOf(priced.id, d).length > 0).map((d) => (
                      <li key={d}><strong>{DAY_NAMES[d]}</strong>: {overridesOf(priced.id, d).join(', ')}</li>
                    ))}
                  </ul>
                )}
            </section>
          </>
        )}
      </>)}

      {into(slots.bar, saveBar)}

      {reviewing && (
        <ReviewDialog lines={reviewLines} onKeep={keepEditing} onSave={saveReviewed}>
          {impactDraft && (
            <section className="stack" aria-labelledby="review-impact-title">
              <h3 id="review-impact-title">Bookings outside the new hours</h3>
              {impact.isPending && <p className="muted small">Checking existing reservations…</p>}
              {impact.isError && (
                <div className="stack">
                  <p className="muted small">Couldn't check existing reservations. You can still save; existing reservations are always kept.</p>
                  <button type="button" className="btn btn-small btn-outline" onClick={() => void impact.refetch()}>Retry</button>
                </div>
              )}
              {impact.data && (impact.data.bookings.total === 0 && impact.data.open_play.total === 0
                ? <p className="muted small">No existing reservations are affected</p>
                : (
                  <>
                    <p className="muted small">These stay booked. Only new bookings follow the new hours.</p>
                    {impact.data.bookings.total > 0 && <p>{plural(impact.data.bookings.total, 'booking')} in the next 90 days</p>}
                    {impact.data.open_play.total > 0 && <p>{plural(impact.data.open_play.total, 'open play session')} in the next 90 days</p>}
                    <ul className="list">
                      {impact.data.bookings.items.map((b) => (
                        <li key={b.booking_id}>
                          <Link to={bookingLink(b.booking_id, b.starts_at)}>{courtName(b.court_id)} · {formatDateTimeInZone(b.starts_at, timezone)} · {b.status}</Link>
                        </li>
                      ))}
                      {impact.data.open_play.items.map((o) => (
                        <li key={`${o.session_id}:${o.court_id}`}>{o.title} · {courtName(o.court_id)} · {formatDateTimeInZone(o.starts_at, timezone)}</li>
                      ))}
                    </ul>
                    {(impact.data.bookings.total > impact.data.bookings.items.length || impact.data.open_play.total > impact.data.open_play.items.length) && (
                      <p className="muted small">Only the first of each are listed.</p>
                    )}
                  </>
                ))}
            </section>
          )}

        </ReviewDialog>
      )}
      {confirmDiscard && (
        <ConfirmDialog
          id="discard-changes" title="Discard changes"
          body="Every unsaved edit to opening hours and prices is thrown away and the saved schedule comes back."
          stay="Keep editing" confirm="Discard"
          onStay={() => { setConfirmDiscard(false); discardButton.current?.focus() }}
          onConfirm={() => { setConfirmDiscard(false); onDiscard() }}
        />
      )}
      {guard}
    </>
  )
}

const clean = ({ day_of_week, start_minute, end_minute }: SchedulePeriod): SchedulePeriod => ({ day_of_week, start_minute, end_minute })
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
