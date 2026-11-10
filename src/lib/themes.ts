// Venue color presets (T11.7, RESEARCH M11 "Theme presets"; full palettes T20.3, RESEARCH "Milestone 20"). The tokens
// live in src/index.css: `plotline` is :root itself, every other preset a [data-theme='<key>'] block. The keys must
// match the venue_settings_theme_preset check (migration 20261110124954_t20_2_theme_presets).

export const THEME_PRESETS = ['plotline', 'court-green', 'ocean', 'plum', 'sunset', 'slate', 'midnight'] as const
export type ThemePreset = (typeof THEME_PRESETS)[number]

export const DEFAULT_THEME: ThemePreset = 'plotline'
export const THEME_STORAGE_KEY = 'plotline-theme'

export const THEME_LABELS: Record<ThemePreset, string> = {
  plotline: 'Plotline',
  'court-green': 'Court Green',
  ocean: 'Ocean',
  plum: 'Plum',
  sunset: 'Sunset',
  slate: 'Slate',
  midnight: 'Midnight',
}

export function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && (THEME_PRESETS as readonly string[]).includes(value)
}

type Swatch = { accent: string; btn: string; btnText: string; bg: string; surface: string; text: string }

/** Fixed copies of each preset's tokens for the picker's previews and theme-color; theme.test.ts keeps them equal to index.css. */
export const THEME_SWATCHES: Record<ThemePreset, { light: Swatch; dark: Swatch }> = {
  plotline: {
    light: { accent: '#4c6b3c', btn: '#b7c4a8', btnText: '#3b2f2a', bg: '#f5efe6', surface: '#fffcf7', text: '#3b2f2a' },
    dark: { accent: '#b7c4a8', btn: '#b7c4a8', btnText: '#3b2f2a', bg: '#2a2522', surface: '#3f3833', text: '#f5efe6' },
  },
  'court-green': {
    light: { accent: '#0f7652', btn: '#0f7652', btnText: '#ffffff', bg: '#eef6f1', surface: '#fbfefc', text: '#14341e' },
    dark: { accent: '#63d2a6', btn: '#63d2a6', btnText: '#08140f', bg: '#141f18', surface: '#213026', text: '#e8f3eb' },
  },
  ocean: {
    light: { accent: '#1b6a9c', btn: '#1b6a9c', btnText: '#ffffff', bg: '#eef3f6', surface: '#fbfdfe', text: '#142634' },
    dark: { accent: '#86c5ec', btn: '#86c5ec', btnText: '#0b1a24', bg: '#141a1f', surface: '#212a30', text: '#e8eef3' },
  },
  plum: {
    light: { accent: '#7a3b7d', btn: '#7a3b7d', btnText: '#ffffff', bg: '#f6eef6', surface: '#fdfbfe', text: '#311434' },
    dark: { accent: '#ddafe0', btn: '#ddafe0', btnText: '#2a132b', bg: '#1e141f', surface: '#2f2130', text: '#f2e8f3' },
  },
  sunset: {
    light: { accent: '#a84a12', btn: '#a84a12', btnText: '#ffffff', bg: '#f6f2ee', surface: '#fefcfb', text: '#342314' },
    dark: { accent: '#f2af80', btn: '#f2af80', btnText: '#2a1305', bg: '#1f1914', surface: '#302821', text: '#f3ede8' },
  },
  slate: {
    light: { accent: '#2f4f6f', btn: '#2f4f6f', btnText: '#ffffff', bg: '#f1f2f3', surface: '#fcfcfd', text: '#1f2328' },
    dark: { accent: '#a9c3dd', btn: '#a9c3dd', btnText: '#0f1822', bg: '#18191b', surface: '#27282b', text: '#ecedef' },
  },
  midnight: {
    light: { accent: '#a9b8ff', btn: '#a9b8ff', btnText: '#0e1330', bg: '#14151f', surface: '#212330', text: '#e8e9f3' },
    dark: { accent: '#a9b8ff', btn: '#a9b8ff', btnText: '#0e1330', bg: '#14151f', surface: '#212330', text: '#e8e9f3' },
  },
}

/** Points the browser chrome color (index.html's two theme-color metas) at the preset's page background. */
function setThemeColor(theme: ThemePreset) {
  for (const scheme of ['light', 'dark'] as const) {
    const meta = document.head.querySelector<HTMLMetaElement>(`meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`)
    if (meta) meta.content = THEME_SWATCHES[theme][scheme].bg
  }
}

/** Sets the preset on <html> and remembers it for the inline script in index.html (no flash on the next load). */
export function applyTheme(theme: ThemePreset) {
  const root = document.documentElement
  if (theme === DEFAULT_THEME) delete root.dataset.theme
  else root.dataset.theme = theme
  setThemeColor(theme)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Storage can be blocked (private mode, site data off); the theme still applies for this page.
  }
}
