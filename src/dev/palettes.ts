// Candidate palettes for the M9 theme (T9.1). Dev-only: imported by the preview route only.
// Token names match the custom properties in src/index.css (camelCase here, --kebab-case there).
import { contrast, mix, over, parseColor } from '../lib/contrast'

export type Tokens = {
  bg: string
  surface: string
  text: string
  muted: string
  border: string
  accent: string
  accentHover: string
  accentContrast: string
  accentSoft: string
  danger: string
}

export type Palette = { id: string; name: string; mood: string; light: Tokens; dark: Tokens }

export const PALETTES: Palette[] = [
  {
    id: 'court-green',
    name: 'Court Green',
    mood: 'The current theme: calm green on soft neutrals.',
    light: {
      bg: '#f7f8f6', surface: '#ffffff', text: '#1c2321', muted: '#5e6b66', border: '#dfe4e1',
      accent: '#0f7a55', accentHover: '#0c6446', accentContrast: '#ffffff', accentSoft: 'rgba(15, 122, 85, 0.1)',
      danger: '#b42318',
    },
    dark: {
      bg: '#111513', surface: '#1a201d', text: '#e8ece9', muted: '#9aa7a1', border: '#2c3531',
      accent: '#34c48b', accentHover: '#4fd39e', accentContrast: '#08140f', accentSoft: 'rgba(52, 196, 139, 0.12)',
      danger: '#f97066',
    },
  },
  {
    id: 'clay',
    name: 'Clay Court',
    mood: 'Warm terracotta on sand neutrals, like a clay tennis court.',
    light: {
      bg: '#faf7f4', surface: '#ffffff', text: '#251f1b', muted: '#6a5f57', border: '#e8dfd7',
      accent: '#b4471c', accentHover: '#963a16', accentContrast: '#ffffff', accentSoft: 'rgba(180, 71, 28, 0.1)',
      danger: '#a3123a',
    },
    dark: {
      bg: '#15110e', surface: '#1f1a16', text: '#f0e9e3', muted: '#a99d93', border: '#3a3029',
      accent: '#f2915f', accentHover: '#f6a882', accentContrast: '#1c0d05', accentSoft: 'rgba(242, 145, 95, 0.14)',
      danger: '#ff7d9a',
    },
  },
  {
    id: 'indigo',
    name: 'Indigo Night',
    mood: 'Cool indigo on blue-grey neutrals, crisp and modern.',
    light: {
      bg: '#f6f7fb', surface: '#ffffff', text: '#1a1f2e', muted: '#5a6278', border: '#dde1ea',
      accent: '#3445c2', accentHover: '#2a389f', accentContrast: '#ffffff', accentSoft: 'rgba(52, 69, 194, 0.1)',
      danger: '#b42318',
    },
    dark: {
      bg: '#0f1220', surface: '#181c2e', text: '#e7e9f3', muted: '#9ca3ba', border: '#2c3149',
      accent: '#8c9dff', accentHover: '#a8b5ff', accentContrast: '#0b0f24', accentSoft: 'rgba(140, 157, 255, 0.14)',
      danger: '#ff8a80',
    },
  },
  {
    id: 'berry',
    name: 'Berry',
    mood: 'Bold plum on cool neutrals, energetic and distinctive.',
    light: {
      bg: '#f8f6f9', surface: '#ffffff', text: '#231c26', muted: '#665d6b', border: '#e4dee7',
      accent: '#8a2b7c', accentHover: '#712264', accentContrast: '#ffffff', accentSoft: 'rgba(138, 43, 124, 0.1)',
      danger: '#b42318',
    },
    dark: {
      bg: '#141017', surface: '#1e1922', text: '#efe8f1', muted: '#a99fae', border: '#372e3c',
      accent: '#e58fd6', accentHover: '#eeaae2', accentContrast: '#210a1d', accentSoft: 'rgba(229, 143, 214, 0.14)',
      danger: '#ff8a80',
    },
  },
]

export type Check = { label: string; ratio: number; min: number; pass: boolean }

/** The contrast pairs that matter in this app, with WCAG AA minimums (text 4.5:1, UI boundaries 3:1). */
export function paletteChecks(t: Tokens): Check[] {
  const softOnSurface = over(t.accentSoft, t.surface)
  const errorBg = over({ ...parseColor(t.danger), a: 0.1 }, t.bg) // .alert-error: danger at 10% over the page
  const pairs: [string, number, number][] = [
    ['Text on page', contrast(t.text, t.bg), 4.5],
    ['Text on card', contrast(t.text, t.surface), 4.5],
    ['Muted text on card', contrast(t.muted, t.surface), 4.5],
    ['Muted text on page', contrast(t.muted, t.bg), 4.5],
    ['Links on card', contrast(t.accent, t.surface), 4.5],
    ['Button and selected-slot text', contrast(t.accentContrast, t.accent), 4.5],
    ['Button hover text', contrast(t.accentContrast, t.accentHover), 4.5],
    ['Confirmed badge', contrast(t.accent, softOnSurface), 4.5],
    ['Error alert text', contrast(t.danger, errorBg), 4.5],
    ['Booked-slot text', contrast(t.text, mix(t.text, t.surface, 0.1)), 4.5],
    // The /book grid sits on the page background; T8.5 measured it there. Cards use the surface.
    ['Free-slot outline on page', contrast(mix(t.accent, t.border, 0.7), t.bg), 3],
    ['Free-slot outline on card', contrast(mix(t.accent, t.border, 0.7), t.surface), 3],
    ['Focus ring on page', contrast(t.accent, t.bg), 3],
  ]
  return pairs.map(([label, ratio, min]) => ({ label, ratio, min, pass: ratio >= min }))
}

/** The tokens as CSS custom properties, for a preview wrapper's style attribute. */
export function tokenStyle(t: Tokens): Record<string, string> {
  return {
    '--bg': t.bg, '--surface': t.surface, '--text': t.text, '--muted': t.muted, '--border': t.border,
    '--accent': t.accent, '--accent-hover': t.accentHover, '--accent-contrast': t.accentContrast,
    '--accent-soft': t.accentSoft, '--danger': t.danger,
  }
}
