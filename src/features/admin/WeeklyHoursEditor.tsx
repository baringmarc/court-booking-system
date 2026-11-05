import { Fragment, useState, type FormEvent } from 'react'
import { ErrorMessage } from '../../components/ErrorMessage'
import { PageLoader } from '../../components/PageLoader'
import { SaveStatus } from '../../components/SaveStatus'
import { ApiError } from '../../lib/queryClient'
import { errorMessage } from '../../lib/errors'
import { DAY_NAMES, DISPLAY_DAY_ORDER, formatHour, formatMoney } from '../../lib/format'
import { useCourts, useVenueSettings } from '../catalog/hooks'
import type { CourtWithPhotos } from '../catalog/api'
import type { ScheduleChanges, ScheduleData, SchedulePeriod } from './api'
import { formatDateTimeInZone } from '../../lib/time'
import { useSaveSchedule, useSchedule, useScheduleImpact } from './hooks'
import { ConfirmDialog } from './ConfirmDialog'
import { useUnsavedGuard } from './UnsavedGuard'
import {
  changedDays,
  closeHours,
  gaps,
  hourLabel,
  hourOfMinute,
  maxEnd,
  overlapDays,
  periodsOfDay,
  periodText,
  samePeriods,
  toSave,
} from './weeklySchedule'

const VENUE = 'venue'
const HOURS = Array.from({ length: 24 }, (_, i) => i)

type CourtDraft = { mode: 'inherit' | 'custom'; periods: SchedulePeriod[] }
/** Pending override per "day:hour": a price, or null to go back to the court's default rate. */
type RateEdits = Record<string, number | null>

export function WeeklyHoursEditor() {
  const schedule = useSchedule()
  const courts = useCourts({ includeInactive: true })
  const save = useSaveSchedule()
  const [generation, setGeneration] = useState(0)
  const [target, setTarget] = useState(VENUE)

  let body
  if (schedule.isPending || courts.isPending) {
    body = <PageLoader />
  } else if (schedule.isError || courts.isError) {
    body = <ErrorMessage error={schedule.error ?? courts.error} onRetry={() => { void schedule.refetch(); void courts.refetch() }} />
  } else {
    const resetDraft = () => { save.reset(); setGeneration((g) => g + 1) }
    body = (
      <Editor
        key={generation}
        schedule={schedule.data}
        courts={courts.data}
        target={target}
        onTarget={setTarget}
        save={save}
        onSaved={() => setGeneration((g) => g + 1)}
        onReload={() => { void schedule.refetch().then(resetDraft) }}
      />
    )
  }
  return (
    <section className="card stack">
      <h2>Weekly Hours &amp; Rates</h2>
      {body}
    </section>
  )
}

function Editor({ schedule, courts, target, onTarget, save, onSaved, onReload }: {
  schedule: ScheduleData
  courts: CourtWithPhotos[]
  target: string
  onTarget: (target: string) => void
  save: ReturnType<typeof useSaveSchedule>
  onSaved: () => void
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
  const [confirmInherit, setConfirmInherit] = useState(false)
  const [confirmRevert, setConfirmRevert] = useState(false)
  const [copyFrom, setCopyFrom] = useState<number | null>(null)
  const [copyDays, setCopyDays] = useState<number[]>([])
  const [copyRates, setCopyRates] = useState(false)
  const [courtCopyOpen, setCourtCopyOpen] = useState(false)
  const [ccTarget, setCcTarget] = useState('')
  const [ccFrom, setCcFrom] = useState(1)
  const [ccTo, setCcTo] = useState(1)
  const [ccRates, setCcRates] = useState(false)
  const [pendingCourtCopy, setPendingCourtCopy] = useState<{ target: CourtWithPhotos; from: number; to: number; rates: boolean } | null>(null)
  // The impact horizon is fixed per draft session so the preview's key only changes with the draft.
  const [horizon] = useState(() => {
    const now = Date.now()
    return { from: new Date(now).toISOString(), to: new Date(now + 90 * 86_400_000).toISOString() }
  })
  const timezone = useVenueSettings().data?.timezone ?? 'Asia/Manila'

  const court = courts.find((c) => c.id === target)
  const courtName = (id: string) => courts.find((c) => c.id === id)?.name ?? 'A court'
  const courtId = court?.id ?? null
  const draftOf = (id: string): CourtDraft => courtDrafts[id] ?? { mode: 'inherit', periods: [] }
  const custom = courtId !== null && draftOf(courtId).mode === 'custom'
  const editable = courtId === null || custom
  const periods = courtId === null ? venue : custom ? draftOf(courtId).periods : venue
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

  const dirty = venueChanged || courtChanges.length > 0 || rateChanges.length > 0
  const venueOverlaps = overlapDays(venue)
  const invalid = venueOverlaps.size > 0 || courts.some((c) => draftOf(c.id).mode === 'custom' && overlapDays(draftOf(c.id).periods).size > 0)
  const conflict = save.error instanceof ApiError && save.error.hint === 'schedule_conflict'
  const guard = useUnsavedGuard(dirty)

  // Informative only: the preview never gates Save, because the database decides what is protected.
  const hoursChanged = venueChanged || courtChanges.length > 0
  const impactDraft = hoursChanged && !invalid
    ? {
        venue_periods: toSave(venue),
        courts: courts.map((c) => {
          const d = draftOf(c.id)
          return { court_id: c.id, schedule_mode: d.mode, periods: d.mode === 'custom' ? toSave(d.periods) : [] }
        }),
      }
    : null
  const impact = useScheduleImpact(impactDraft, horizon.from, horizon.to)

  const summary = [
    ...(venueChanged ? [`Venue defaults: hours changed on ${dayList(changedDays(venue, base.venue_periods))}.`] : []),
    ...courtChanges.map(({ court: c, draft, wasMode, was }) => {
      if (draft.mode !== wasMode) {
        return `${c.name}: ${draft.mode === 'custom' ? 'custom hours (a copy of the venue hours, edited below)' : 'back to venue hours'}.`
      }
      return `${c.name}: hours changed on ${dayList(changedDays(draft.periods, was?.periods ?? []))}.`
    }),
    ...courts.flatMap((c) => {
      const n = rateChanges.filter((r) => r.court_id === c.id).length
      return n ? [`${c.name}: ${n} hourly ${n === 1 ? 'rate' : 'rates'} changed.`] : []
    }),
  ]

  // --- edits ----------------------------------------------------------------
  const nth = (day: number, index: number) => {
    let seen = -1
    return periods.findIndex((p) => p.day_of_week === day && ++seen === index)
  }
  const editPeriod = (day: number, index: number, patch: (p: SchedulePeriod) => SchedulePeriod) => {
    const at = nth(day, index)
    setPeriods(periods.map((p, i) => (i === at ? patch(p) : p)))
  }
  const setOpens = (day: number, index: number, hour: number) =>
    editPeriod(day, index, (p) => {
      const end = hourOfMinute(p.end_minute)
      const next = end <= hour ? hour + 1 : Math.min(end, maxEnd(hour))
      return { ...p, start_minute: hour * 60, end_minute: next * 60 }
    })
  const setCloses = (day: number, index: number, hour: number) =>
    editPeriod(day, index, (p) => ({ ...p, end_minute: hour * 60 }))
  const removePeriod = (day: number, index: number) => setPeriods(periods.filter((_, i) => i !== nth(day, index)))
  const addPeriod = (day: number) => {
    const today = periodsOfDay(periods, day)
    const start = today.length ? Math.min(Math.max(...today.map((p) => hourOfMinute(p.end_minute))), 23) : 6
    const end = today.length ? start + 1 : 22
    setPeriods([...periods, { day_of_week: day, start_minute: start * 60, end_minute: end * 60 }])
  }

  function chooseMode(mode: string) {
    if (courtId === null) return
    if (mode === 'inherit') {
      if (custom) setConfirmInherit(true)
      return
    }
    const was = baseCourt(courtId)
    setCourtDrafts((d) => ({
      ...d,
      [courtId]: { mode: 'custom', periods: (was?.schedule_mode === 'custom' ? was.periods : venue).map(clean) },
    }))
  }

  /** Replaces the target day's rate overrides with the source day's (a saved override the source lacks is cleared). */
  const copyRatesDay = (all: Record<string, RateEdits>, from: string, fromDay: number, to: string, toDay: number) => {
    const mine = { ...all[to] }
    for (const h of HOURS) {
      const key = `${toDay}:${h}`
      const rate = effectiveRate(from, fromDay, h)
      if (rate !== undefined) mine[key] = rate
      else if (originalRate(to, toDay, h) !== undefined) mine[key] = null
      else delete mine[key]
    }
    return { ...all, [to]: mine }
  }
  const dayPeriods = (list: SchedulePeriod[], fromDay: number, toDay: number) =>
    periodsOfDay(list, fromDay).map((p) => ({ ...p, day_of_week: toDay }))

  function openCopy(day: number) {
    setCopyFrom(copyFrom === day ? null : day)
    setCopyDays([])
    setCopyRates(false)
  }
  function applyCopy() {
    if (copyFrom === null || copyDays.length === 0) return
    const source = dayPeriods(periods, copyFrom, copyFrom)
    setPeriods([
      ...periods.filter((p) => !copyDays.includes(p.day_of_week)),
      ...copyDays.flatMap((d) => source.map((p) => ({ ...p, day_of_week: d }))),
    ])
    if (copyRates && courtId !== null) {
      setRateEdits((all) => copyDays.reduce((next, d) => copyRatesDay(next, courtId, copyFrom, courtId, d), all))
    }
    setCopyFrom(null)
  }

  const otherCourts = courts.filter((c) => c.id !== courtId)
  const ccTargetCourt = otherCourts.find((c) => c.id === ccTarget) ?? otherCourts[0]
  function confirmCourtCopy() {
    if (!pendingCourtCopy || courtId === null) return
    const { target, from, to, rates } = pendingCourtCopy
    const targetDraft = draftOf(target.id)
    const seed = targetDraft.mode === 'custom' ? targetDraft.periods : venue
    setCourtDrafts((d) => ({
      ...d,
      [target.id]: { mode: 'custom', periods: [...seed.filter((p) => p.day_of_week !== to), ...dayPeriods(periods, from, to)].map(clean) },
    }))
    if (rates) setRateEdits((all) => copyRatesDay(all, courtId, from, target.id, to))
    setPendingCourtCopy(null)
    setCourtCopyOpen(false)
  }

  function applyRate(e: FormEvent) {
    e.preventDefault()
    if (courtId === null) return
    const value = price.trim() === '' ? null : Number(price)
    if (value !== null && (!Number.isFinite(value) || value < 0)) return
    const to = Math.max(rateTo, rateFrom + 1)
    setRateEdits((all) => {
      const mine = { ...all[courtId] }
      for (let h = rateFrom; h < to; h++) {
        const key = `${rateDay}:${h}`
        if (value !== null) mine[key] = value
        else if (originalRate(courtId, rateDay, h) !== undefined) mine[key] = null
        else delete mine[key]
      }
      return { ...all, [courtId]: mine }
    })
  }

  const submit = (variables: { revision: number; changes: ScheduleChanges }) => save.mutate(variables, { onSuccess: onSaved })
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (dirty && !invalid && !conflict) submit({ revision: base.schedule_revision, changes })
  }

  const rateTop = Math.max(rateTo, rateFrom + 1)
  return (
    <form className="stack" onSubmit={handleSubmit} noValidate>
      <p className="muted small">
        Open hours are whole hours. A closed gap between two periods can't be booked, and nothing changes until you save.
        Hours and rates are saved together.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>Schedule for</span>
          <select value={courtId ?? VENUE} onChange={(e) => onTarget(e.target.value)}>
            <option value={VENUE}>Venue defaults</option>
            {courts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        {court && (
          <label className="field">
            <span>Court hours</span>
            <select value={custom ? 'custom' : 'inherit'} onChange={(e) => chooseMode(e.target.value)}>
              <option value="inherit">Use venue hours</option>
              <option value="custom">Custom hours</option>
            </select>
          </label>
        )}
      </div>
      {courts.length === 0 && <p className="muted small">No courts yet. Add a court to give it its own hours and rates.</p>}
      {court && <p className="muted small">Default rate: {formatMoney(court.default_hourly_rate, currency)}/hr. Overrides below replace it for the hours you pick.</p>}
      {court && !custom && <p className="muted small">This court follows the venue hours. Choose Custom hours to give it its own.</p>}

      <div className="stack">
        {DISPLAY_DAY_ORDER.map((day) => {
          const mine = periodsOfDay(periods, day)
          const overrides = courtId === null ? [] : HOURS.flatMap((h) => {
            const rate = effectiveRate(courtId, day, h)
            return rate === undefined ? [] : [`${formatHour(h)} ${formatMoney(rate, currency)}`]
          })
          return (
            <Fragment key={day}>
            <fieldset className="weekly-day stack">
              <legend>{DAY_NAMES[day]}</legend>
              {mine.length === 0 && <p className="muted">Closed all day</p>}
              {editable ? mine.map((p, i) => {
                const start = hourOfMinute(p.start_minute)
                const label = `${DAY_NAMES[day]} period ${i + 1}`
                return (
                  <div key={i} className="hours-row">
                    <select aria-label={`${label} opens`} value={start} onChange={(e) => setOpens(day, i, Number(e.target.value))}>
                      {HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
                    </select>
                    <span className="muted">to</span>
                    <select aria-label={`${label} closes`} value={hourOfMinute(p.end_minute)} onChange={(e) => setCloses(day, i, Number(e.target.value))}>
                      {closeHours(start).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                    </select>
                    <button type="button" className="btn btn-small btn-ghost" aria-label={`Remove ${label}`} onClick={() => removePeriod(day, i)}>Remove</button>
                  </div>
                )
              }) : mine.length > 0 && <p>{[...mine].sort((a, b) => a.start_minute - b.start_minute).map(periodText).join(', ')}</p>}
              {gaps(mine).map(([from, to]) => <p key={from} className="muted small">{`Closed ${hourLabel(from)} to ${hourLabel(to)}`}</p>)}
              {editable && overlapDays(periods).has(day) && (
                <p className="form-error" role="alert">{DAY_NAMES[day]} has periods that overlap. Adjust the hours so they only touch.</p>
              )}
              {editable && (
                <button type="button" className="btn btn-small btn-outline" aria-label={`Add ${DAY_NAMES[day]} period`} onClick={() => addPeriod(day)}>
                  Add period
                </button>
              )}
              {overrides.length > 0 && <p className="muted small">Override rates: {overrides.join(', ')}</p>}
              {editable && mine.length > 0 && (
                <button type="button" className="btn btn-small btn-ghost" onClick={() => openCopy(day)}>{`Copy ${DAY_NAMES[day]} hours`}</button>
              )}
            </fieldset>
            {editable && copyFrom === day && (
              <div role="group" aria-label={`Copy ${DAY_NAMES[day]} hours to`} className="card stack">
                <p className="muted small">Choose the days that should get {DAY_NAMES[day]}'s hours. Their current hours are replaced.</p>
                {DISPLAY_DAY_ORDER.filter((d) => d !== day).map((d) => (
                  <label key={d} className="checkbox">
                    <input type="checkbox" checked={copyDays.includes(d)}
                      onChange={(e) => setCopyDays(e.target.checked ? [...copyDays, d] : copyDays.filter((x) => x !== d))} />
                    <span>{DAY_NAMES[d]}</span>
                  </label>
                ))}
                {courtId !== null && (
                  <label className="checkbox">
                    <input type="checkbox" checked={copyRates} onChange={(e) => setCopyRates(e.target.checked)} />
                    <span>Also copy hourly rates</span>
                  </label>
                )}
                <div className="form-actions">
                  <button type="button" className="btn btn-small" disabled={copyDays.length === 0} onClick={applyCopy}>Apply copy</button>
                  <button type="button" className="btn btn-small btn-outline" onClick={() => setCopyFrom(null)}>Close</button>
                </div>
              </div>
            )}
            </Fragment>
          )
        })}
      </div>

      {court && (
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
      )}

      {court && (
        <div className="stack">
          <button type="button" className="btn btn-small btn-outline" onClick={() => setCourtCopyOpen(!courtCopyOpen)}>Copy to another court</button>
          {courtCopyOpen && (
            <div role="group" aria-label="Copy to another court" className="card stack">
              {otherCourts.length === 0 ? <p className="muted small">There is no other court to copy to.</p> : (
                <>
                  <div className="form-grid">
                    <label className="field"><span>Target court</span>
                      <select value={ccTargetCourt?.id} onChange={(e) => setCcTarget(e.target.value)}>
                        {otherCourts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </label>
                    <label className="field"><span>Source weekday</span>
                      <select value={ccFrom} onChange={(e) => setCcFrom(Number(e.target.value))}>
                        {DISPLAY_DAY_ORDER.map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
                      </select>
                    </label>
                    <label className="field"><span>Target weekday</span>
                      <select value={ccTo} onChange={(e) => setCcTo(Number(e.target.value))}>
                        {DISPLAY_DAY_ORDER.map((d) => <option key={d} value={d}>{DAY_NAMES[d]}</option>)}
                      </select>
                    </label>
                  </div>
                  <label className="checkbox">
                    <input type="checkbox" checked={ccRates} onChange={(e) => setCcRates(e.target.checked)} />
                    <span>Also copy hourly rates</span>
                  </label>
                  <div className="form-actions">
                    <button type="button" className="btn btn-small" disabled={!ccTargetCourt}
                      onClick={() => ccTargetCourt && setPendingCourtCopy({ target: ccTargetCourt, from: ccFrom, to: ccTo, rates: ccRates })}>
                      Review copy
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {impactDraft && (
        <section className="card stack" aria-label="Reservations outside the new hours">
          <h3>Reservations outside the new hours</h3>
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
                <p className="muted small">These keep their place and their payment rules. Only new bookings follow the new hours.</p>
                {impact.data.bookings.total > 0 && <p>{plural(impact.data.bookings.total, 'booking')} in the next 90 days</p>}
                {impact.data.open_play.total > 0 && <p>{plural(impact.data.open_play.total, 'open play session')} in the next 90 days</p>}
                <ul className="list">
                  {impact.data.bookings.items.map((b) => (
                    <li key={b.booking_id}>{courtName(b.court_id)} · {formatDateTimeInZone(b.starts_at, timezone)} · {b.status}</li>
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

      {dirty && <p className="muted" role="status">You have unsaved changes.</p>}
      {summary.length > 0 && (
        <section className="card stack" aria-label="Pending changes">
          <h3>Pending changes</h3>
          <ul className="list">{summary.map((line) => <li key={line}>{line}</li>)}</ul>
        </section>
      )}

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
      <div className="form-actions">
        <button type="submit" className="btn" disabled={!dirty || invalid || conflict || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save schedule'}
        </button>
        {dirty && <button type="button" className="btn btn-outline" onClick={() => setConfirmRevert(true)}>Revert unsaved changes</button>}
        {!dirty && <SaveStatus isSuccess={save.isSuccess} error={null} />}
      </div>

      {confirmInherit && courtId && (
        <ConfirmDialog
          id="switch-venue-hours" title="Switch to venue hours"
          body="This court will follow the venue's hours again. Its custom hours are dropped when you save. Its hourly rates stay."
          stay="Keep custom hours" confirm="Switch to venue hours"
          onStay={() => setConfirmInherit(false)}
          onConfirm={() => {
            setCourtDrafts((d) => ({ ...d, [courtId]: { mode: 'inherit', periods: [] } }))
            setConfirmInherit(false)
          }}
        />
      )}
      {pendingCourtCopy && (
        <ConfirmDialog
          id="copy-to-court" title={`Copy to ${pendingCourtCopy.target.name}`}
          body={`This will overwrite ${pendingCourtCopy.target.name}'s ${DAY_NAMES[pendingCourtCopy.to]} hours${pendingCourtCopy.rates ? ' and hourly rates' : ''} with ${court?.name}'s ${DAY_NAMES[pendingCourtCopy.from]}. ${pendingCourtCopy.target.name} will use custom hours${draftOf(pendingCourtCopy.target.id).mode === 'custom' ? '' : ' (a copy of the venue hours, with that day replaced)'}. Nothing is saved until you save.`}
          stay="Cancel" confirm={`Copy to ${pendingCourtCopy.target.name}`}
          onStay={() => setPendingCourtCopy(null)}
          onConfirm={confirmCourtCopy}
        />
      )}
      {confirmRevert && (
        <ConfirmDialog
          id="revert-changes" title="Revert unsaved changes"
          body="Every unsaved edit to hours and rates is discarded and the saved schedule comes back."
          stay="Keep editing" confirm="Revert"
          onStay={() => setConfirmRevert(false)}
          onConfirm={() => { setConfirmRevert(false); save.reset(); onSaved() }}
        />
      )}
      {guard}
    </form>
  )
}

const clean = ({ day_of_week, start_minute, end_minute }: SchedulePeriod): SchedulePeriod => ({ day_of_week, start_minute, end_minute })
const dayList = (days: number[]) => days.map((d) => DAY_NAMES[d]).join(', ')
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
