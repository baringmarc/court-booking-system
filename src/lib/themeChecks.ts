// The contrast pairs that matter in this app's theme (T9.1, T9.2), with WCAG AA minimums:
// 4.5:1 for text, 3:1 for UI boundaries. theme.test.ts runs them on the real tokens in src/index.css.
// The mix weights below copy index.css's color-mix rules; theme.test.ts fails if those rules change.
import { contrast, mix, over, parseColor } from './contrast'

/** The theme tokens, named like the custom properties in src/index.css (camelCase here, --kebab-case there). */
export type Tokens = {
  bg: string
  surface: string
  field: string
  text: string
  muted: string
  border: string
  borderStrong: string
  accent: string
  accentSoft: string
  btn: string
  btnHover: string
  btnText: string
  danger: string
  dangerContrast: string
  pendingBg: string
  highlight: string
  openPlay: string
  slotFreeBorder: string
  tintSage: string
  tintRose: string
  bandBg: string
  bandCard: string
  bandChip: string
  bandText: string
  bandMuted: string
  bandAccent: string
}

export type Check = { label: string; ratio: number; min: number; pass: boolean }

export function themeChecks(t: Tokens): Check[] {
  const tint = (color: string, alpha: number, bg: string) => over({ ...parseColor(color), a: alpha }, bg)
  const pairs: [string, number, number][] = [
    ['Text on page', contrast(t.text, t.bg), 4.5],
    ['Text on card', contrast(t.text, t.surface), 4.5],
    ['Text in a field', contrast(t.text, t.field), 4.5],
    ['Muted text on card', contrast(t.muted, t.surface), 4.5],
    ['Muted text on page (incl. past slots)', contrast(t.muted, t.bg), 4.5],
    ['Links on card', contrast(t.accent, t.surface), 4.5],
    ['Links on page', contrast(t.accent, t.bg), 4.5],
    ['Highlight words on page', contrast(t.highlight, t.bg), 4.5],
    ['Button and selected-slot text', contrast(t.btnText, t.btn), 4.5],
    ['Button hover text', contrast(t.btnText, t.btnHover), 4.5],
    // A primary button's edge (its accent border) must stand out from the page: the sage fill alone doesn't.
    ['Button border on page', contrast(t.accent, t.bg), 3],
    ['Button border on card', contrast(t.accent, t.surface), 3],
    ['Danger button text', contrast(t.dangerContrast, t.danger), 4.5],
    ['Danger button hover text', contrast(t.dangerContrast, mix(t.danger, '#000000', 0.85)), 4.5],
    ['Confirmed badge', contrast(t.accent, over(t.accentSoft, t.surface)), 4.5],
    ['Cancelled badge', contrast(t.danger, tint(t.danger, 0.12, t.surface)), 4.5],
    ['Pending badge', contrast(t.text, over(t.pendingBg, t.surface)), 4.5],
    ['Warning text on page', contrast(t.highlight, t.bg), 4.5],
    ['Error alert text', contrast(t.danger, tint(t.danger, 0.1, t.bg)), 4.5],
    ['Booked-slot text', contrast(t.text, mix(t.text, t.surface, 0.1)), 4.5],
    ['Open-play slot text', contrast(t.text, mix(t.openPlay, t.surface, 0.12)), 4.5],
    ['Selected-slot border on card', contrast(t.accent, t.surface), 3],
    // Input edges, the slot grid on the page background (T8.5 measured it there) and cards on the surface.
    ['Input edge on field', contrast(t.borderStrong, t.field), 3],
    ['Input edge on page', contrast(t.borderStrong, t.bg), 3],
    ['Input edge on card', contrast(t.borderStrong, t.surface), 3],
    ['Free-slot outline on page', contrast(t.slotFreeBorder, t.bg), 3],
    ['Free-slot outline on card', contrast(t.slotFreeBorder, t.surface), 3],
    ['Open-play bar on page', contrast(t.openPlay, t.bg), 3],
    ['Focus ring on page', contrast(t.accent, t.bg), 3],
    ['Focus ring on card', contrast(t.accent, t.surface), 3],
    // Card heading bands (T11.4): headings and the sport line on sage, the pay countdown (accent) on rose.
    ['Heading on sage band', contrast(t.text, t.tintSage), 4.5],
    ['Muted text on sage band', contrast(t.muted, t.tintSage), 4.5],
    ['Heading on rose band', contrast(t.text, t.tintRose), 4.5],
    ['Countdown on rose band', contrast(t.accent, t.tintRose), 4.5],
    // The current page's nav tab: btn-text on btn is checked above; its ink edge against the header.
    ['Active tab edge on header', contrast(t.accent, t.surface), 3],
    // The footer's "Stay connected" band (T11.4).
    ['Band text', contrast(t.bandText, t.bandBg), 4.5],
    ['Band muted text', contrast(t.bandMuted, t.bandBg), 4.5],
    ['Band eyebrow', contrast(t.bandAccent, t.bandBg), 4.5],
    ['Social card label', contrast(t.bandText, t.bandCard), 4.5],
    ['Social card label on hover', contrast(t.bandText, t.bandChip), 4.5],
    ['Social logo on its chip', contrast(t.bandText, t.bandChip), 3],
    ['Focus ring in the band', contrast(t.bandText, t.bandBg), 3],
  ]
  return pairs.map(([label, ratio, min]) => ({ label, ratio, min, pass: ratio >= min }))
}
