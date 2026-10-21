// The contrast pairs that matter in this app's theme (T9.1, T9.2), with WCAG AA minimums:
// 4.5:1 for text, 3:1 for UI boundaries. theme.test.ts runs them on the real tokens in src/index.css.
// The mix weights below copy index.css's color-mix rules; theme.test.ts fails if those rules change.
import { contrast, mix, over, parseColor } from './contrast'

/** The theme tokens, named like the custom properties in src/index.css (camelCase here, --kebab-case there). */
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
  dangerContrast: string
}

export type Check = { label: string; ratio: number; min: number; pass: boolean }

const PENDING_YELLOW = '#f5b400' // .badge.status-pending_* in index.css

export function themeChecks(t: Tokens): Check[] {
  const tint = (color: string, alpha: number, bg: string) => over({ ...parseColor(color), a: alpha }, bg)
  const pairs: [string, number, number][] = [
    ['Text on page', contrast(t.text, t.bg), 4.5],
    ['Text on card', contrast(t.text, t.surface), 4.5],
    ['Muted text on card', contrast(t.muted, t.surface), 4.5],
    ['Muted text on page (incl. past slots)', contrast(t.muted, t.bg), 4.5],
    ['Links on card', contrast(t.accent, t.surface), 4.5],
    ['Button and selected-slot text', contrast(t.accentContrast, t.accent), 4.5],
    ['Button hover text', contrast(t.accentContrast, t.accentHover), 4.5],
    ['Danger button text', contrast(t.dangerContrast, t.danger), 4.5],
    ['Danger button hover text', contrast(t.dangerContrast, mix(t.danger, '#000000', 0.85)), 4.5],
    ['Confirmed badge', contrast(t.accent, over(t.accentSoft, t.surface)), 4.5],
    ['Cancelled badge', contrast(t.danger, tint(t.danger, 0.12, t.surface)), 4.5],
    ['Pending badge', contrast(t.text, tint(PENDING_YELLOW, 0.25, t.surface)), 4.5],
    ['Error alert text', contrast(t.danger, tint(t.danger, 0.1, t.bg)), 4.5],
    ['Booked-slot text', contrast(t.text, mix(t.text, t.surface, 0.1)), 4.5],
    // The /book grid sits on the page background (T8.5 measured it there); cards use the surface.
    ['Free-slot outline on page', contrast(mix(t.accent, t.border, 0.7), t.bg), 3],
    ['Free-slot outline on card', contrast(mix(t.accent, t.border, 0.7), t.surface), 3],
    ['Focus ring on page', contrast(t.accent, t.bg), 3],
  ]
  return pairs.map(([label, ratio, min]) => ({ label, ratio, min, pass: ratio >= min }))
}
