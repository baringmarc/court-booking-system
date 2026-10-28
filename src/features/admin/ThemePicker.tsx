import type { CSSProperties } from 'react'
import { SaveStatus } from '../../components/SaveStatus'
import { applyTheme, DEFAULT_THEME, isThemePreset, THEME_LABELS, THEME_PRESETS, THEME_SWATCHES, type ThemePreset } from '../../lib/themes'
import type { VenueSettings } from '../catalog/api'
import { useUpdateVenueSettings } from '../catalog/hooks'

/** "Website colors" on /admin/settings (T11.7): a tap saves the preset and applies it at once. */
export function ThemePicker({ settings }: { settings: VenueSettings }) {
  const save = useUpdateVenueSettings()
  const saved: ThemePreset = isThemePreset(settings.theme) ? settings.theme : DEFAULT_THEME
  const shown = save.isPending && isThemePreset(save.variables?.theme) ? save.variables.theme : saved

  function pick(theme: ThemePreset) {
    if (theme === shown || save.isPending) return
    applyTheme(theme)
    save.mutate({ theme }, { onError: () => applyTheme(saved) })
  }

  return (
    <section className="card stack" aria-labelledby="theme-heading">
      <h2 id="theme-heading">Website colors</h2>
      <p className="muted">The colors of your booking site and this admin area. Players see the change right away.</p>
      <div className="theme-grid" role="group" aria-labelledby="theme-heading" aria-busy={save.isPending}>
        {THEME_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="theme-card"
            aria-pressed={preset === shown}
            onClick={() => pick(preset)}
          >
            <span className="theme-previews" aria-hidden="true">
              <Preview preset={preset} scheme="light" />
              <Preview preset={preset} scheme="dark" />
            </span>
            <span className="theme-name">
              {THEME_LABELS[preset]}
              {preset === shown && <span className="theme-check" aria-hidden="true">✓</span>}
            </span>
          </button>
        ))}
      </div>
      <SaveStatus isSuccess={save.isSuccess} error={save.error} />
    </section>
  )
}

function Preview({ preset, scheme }: { preset: ThemePreset; scheme: 'light' | 'dark' }) {
  const s = THEME_SWATCHES[preset][scheme]
  const style = { '--p-accent': s.accent, '--p-btn': s.btn, '--p-btn-text': s.btnText } as CSSProperties
  return (
    <span className={`theme-preview ${scheme}`} style={style}>
      <span className="p-btn">Book</span>
      <span className="p-badge">Confirmed</span>
      <span className="p-slots">
        <span className="p-slot free" />
        <span className="p-slot selected" />
        <span className="p-slot booked" />
      </span>
    </span>
  )
}
