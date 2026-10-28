// Venue color presets (T11.7, RESEARCH M11 "Theme presets"). The tokens live in src/index.css: `plotline` is :root
// itself, every other preset a [data-theme='<key>'] block. The keys must match the venue_settings_theme_preset check.

export const THEME_PRESETS = ['plotline', 'court-green', 'ocean', 'plum', 'sunset'] as const
export type ThemePreset = (typeof THEME_PRESETS)[number]

export const DEFAULT_THEME: ThemePreset = 'plotline'
export const THEME_STORAGE_KEY = 'plotline-theme'

export const THEME_LABELS: Record<ThemePreset, string> = {
  plotline: 'Plotline',
  'court-green': 'Court Green',
  ocean: 'Ocean',
  plum: 'Plum',
  sunset: 'Sunset',
}

export function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && (THEME_PRESETS as readonly string[]).includes(value)
}

type Swatch = { accent: string; btn: string; btnText: string }

/** Fixed copies of each preset's tokens for the picker's light and dark previews; theme.test.ts keeps them equal to index.css. */
export const THEME_SWATCHES: Record<ThemePreset, { light: Swatch; dark: Swatch }> = {
  plotline: {
    light: { accent: '#4c6b3c', btn: '#b7c4a8', btnText: '#3b2f2a' },
    dark: { accent: '#b7c4a8', btn: '#b7c4a8', btnText: '#3b2f2a' },
  },
  'court-green': {
    light: { accent: '#0f7652', btn: '#0f7652', btnText: '#ffffff' },
    dark: { accent: '#63d2a6', btn: '#63d2a6', btnText: '#08140f' },
  },
  ocean: {
    light: { accent: '#1b6a9c', btn: '#1b6a9c', btnText: '#ffffff' },
    dark: { accent: '#86c5ec', btn: '#86c5ec', btnText: '#0b1a24' },
  },
  plum: {
    light: { accent: '#7a3b7d', btn: '#7a3b7d', btnText: '#ffffff' },
    dark: { accent: '#ddafe0', btn: '#ddafe0', btnText: '#2a132b' },
  },
  sunset: {
    light: { accent: '#a84a12', btn: '#a84a12', btnText: '#ffffff' },
    dark: { accent: '#f2af80', btn: '#f2af80', btnText: '#2a1305' },
  },
}

/** Sets the preset on <html> and remembers it for the inline script in index.html (no flash on the next load). */
export function applyTheme(theme: ThemePreset) {
  const root = document.documentElement
  if (theme === DEFAULT_THEME) delete root.dataset.theme
  else root.dataset.theme = theme
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage can be blocked (private mode, site data off); the theme still applies for this page.
  }
}
