import { useId, type ReactNode } from 'react'

export type Choice<T> = { value: T; label: ReactNode }

type Props<T> = {
  label: string
  choices: Choice<T>[]
  value: T | null
  onChange: (value: T) => void
  /** Shown instead of the choices when there are none. */
  empty?: ReactNode
}

/**
 * One choice out of a row of pills (T10.2): native radio buttons, so the browser gives arrow-key movement, a
 * single tab stop and the group's name to screen readers. The input is visually hidden but keeps the focus ring.
 */
export function ChoiceGroup<T extends string | number>({ label, choices, value, onChange, empty }: Props<T>) {
  const name = useId()
  return (
    <fieldset className="choice-group">
      <legend>{label}</legend>
      {choices.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <div className="choice-options">
          {choices.map((c) => (
            <label key={String(c.value)} className="choice">
              <input type="radio" name={name} value={String(c.value)} checked={c.value === value}
                onChange={() => onChange(c.value)} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}
