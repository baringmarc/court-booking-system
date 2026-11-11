// T20.3: applyTheme keeps the browser's theme-color in step with the preset, and index.html's inline script
// (which runs before any module) uses the same page backgrounds as THEME_SWATCHES.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import indexHtml from '../../index.html?raw'
import { applyTheme, DEFAULT_THEME, THEME_LABELS, THEME_PRESETS, THEME_SWATCHES } from './themes'

// Read loosely: bg, surface, text and the midnight key are added by T20.3.
const SWATCHES = THEME_SWATCHES as unknown as Record<string, Record<'light' | 'dark', Record<string, string>>>
const store = new Map<string, string>()
const metas = () => ({
  light: document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"][media="(prefers-color-scheme: light)"]')!,
  dark: document.head.querySelector<HTMLMetaElement>('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]')!,
})

describe('themes (T20.3)', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
    document.head.innerHTML =
      '<meta name="theme-color" content="#f5efe6" media="(prefers-color-scheme: light)">' +
      '<meta name="theme-color" content="#2a2522" media="(prefers-color-scheme: dark)">'
    delete document.documentElement.dataset.theme
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    document.head.innerHTML = ''
  })

  it('lists the seven presets with their labels', () => {
    expect([...THEME_PRESETS]).toEqual(['plotline', 'court-green', 'ocean', 'plum', 'sunset', 'slate', 'midnight'])
    expect(Object.values(THEME_LABELS)).toEqual(['Plotline', 'Court Green', 'Ocean', 'Plum', 'Sunset', 'Slate', 'Midnight'])
  })

  it('every swatch carries bg, surface and text hex colors; midnight is the same in both modes', () => {
    for (const preset of THEME_PRESETS) {
      for (const scheme of ['light', 'dark'] as const) {
        const s = SWATCHES[preset][scheme]
        for (const key of ['bg', 'surface', 'text'] as const) expect(s[key], `${preset} ${scheme} ${key}`).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
    expect(SWATCHES.midnight.light).toEqual(SWATCHES.midnight.dark)
    expect(SWATCHES.midnight.dark.bg).toBe('#14151f')
  })

  it('sets both theme-color metas to the preset page background', () => {
    for (const preset of THEME_PRESETS.filter((p) => p !== DEFAULT_THEME)) {
      applyTheme(preset)
      expect(metas().light.content, `${preset} light`).toBe(SWATCHES[preset].light.bg)
      expect(metas().dark.content, `${preset} dark`).toBe(SWATCHES[preset].dark.bg)
    }
    applyTheme('midnight' as never)
    expect(metas().light.content).toBe('#14151f')
    expect(metas().dark.content).toBe('#14151f')
  })

  it('restores the default theme-color values when plotline is applied', () => {
    applyTheme('ocean')
    applyTheme('plotline')
    expect(metas().light.content).toBe('#f5efe6')
    expect(metas().dark.content).toBe('#2a2522')
  })

  it("index.html's inline script knows every preset's light and dark background", () => {
    const script = indexHtml.match(/<script>([\s\S]*?)<\/script>/)![1].toLowerCase()
    for (const preset of THEME_PRESETS.filter((p) => p !== DEFAULT_THEME)) {
      expect(script, `${preset} key`).toContain(`'${preset}'`)
      expect(script, `${preset} light bg`).toContain(SWATCHES[preset].light.bg.toLowerCase())
      expect(script, `${preset} dark bg`).toContain(SWATCHES[preset].dark.bg.toLowerCase())
    }
  })
})
