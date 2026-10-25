import { ChoiceGroup } from './ChoiceGroup'
import { durationLabel, findHour, type HourOption } from './pickerHours'

type HourProps = {
  label: string
  /** From operatingHourOptions (one operating day) or calendarHourOptions (all 24 hours). */
  options: HourOption[]
  /** The chosen start instant; matched to an option as an instant, so any ISO form works. */
  value: string | null
  onChange: (start: string) => void
  empty?: string
}

/** Start-hour buttons for one day (T10.2). Never minutes; hours after midnight say "(next day)". */
export function HourPicker({ label, options, value, onChange, empty = 'Closed on this day.' }: HourProps) {
  return (
    <ChoiceGroup
      label={label}
      value={findHour(options, value)?.start ?? null}
      onChange={onChange}
      empty={empty}
      choices={options.map((o) => ({
        value: o.start,
        label: o.nextDay ? <>{o.label} <span className="choice-note">(next day)</span></> : o.label,
      }))}
    />
  )
}

type DurationProps = {
  label?: string
  /** The most hours that fit (maxDuration); 0 shows `empty`. */
  max: number
  value: number | null
  onChange: (hours: number) => void
  empty?: string
}

/** 1 hr, 2 hrs… up to what fits in the operating day (T10.2). */
export function DurationPicker({ label = 'How long', max, value, onChange, empty = 'Choose a start time first.' }: DurationProps) {
  return (
    <ChoiceGroup
      label={label}
      value={value !== null && value <= max ? value : null}
      onChange={onChange}
      empty={empty}
      choices={Array.from({ length: max }, (_, i) => ({ value: i + 1, label: durationLabel(i + 1) }))}
    />
  )
}
