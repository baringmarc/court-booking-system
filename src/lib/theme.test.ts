// Guards the shipped theme (T9.2): the real tokens in src/index.css, light and dark, must meet WCAG AA
// for every pair in themeChecks. Change a token and this test re-measures it.
import { describe, expect, it } from 'vitest'
// The stylesheet's source text. vitest.config.ts lets index.css through Vite (Vitest stubs CSS as empty otherwise).
import css from '../index.css?raw'
import { themeChecks, type Tokens } from './themeChecks'
import { DEFAULT_THEME, THEME_PRESETS, THEME_SWATCHES } from './themes'
// The T11.6 migration, so the TypeScript keys can't drift from the check constraint.
// index.html's inline script names the non-default presets itself (it runs before any module loads).
import indexHtml from '../../index.html?raw'
import migration from '../../supabase/migrations/20261028121458_venue_theme.sql?raw'

/** The custom properties declared directly in a block, keyed in camelCase. */
function declarations(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim().replace(/\s*\/\*.*$/, '')]))
}

const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
const lightRaw = declarations(css.match(/^:root\s*{([^}]*)}/m)![1])
const darkRaw = { ...lightRaw, ...declarations(css.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]*)}/)![1]) }

/** A mode's tokens with `var(--x)` references followed, keyed in camelCase. */
function tokensOf(raw: Record<string, string>): Tokens {
  const resolve = (value: string): string => value.replace(/^var\(--([a-z-]+)\)$/, (_, n: string) => resolve(raw[n]))
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => [camel(name), resolve(value)])) as unknown as Tokens
}

const light = tokensOf(lightRaw)
const dark = tokensOf(darkRaw)

/** A preset's tokens as the cascade builds them: its first block applies in both modes, its second (in the dark media query) on top. */
function presetTokens(preset: string): { light: Tokens; dark: Tokens } {
  const blocks = [...css.matchAll(new RegExp(`\\[data-theme='${preset}'\\]\\s*{([^}]*)}`, 'g'))].map((m) => declarations(m[1]))
  expect(blocks, `${preset} needs a light and a dark block`).toHaveLength(2)
  return { light: tokensOf({ ...lightRaw, ...blocks[0] }), dark: tokensOf({ ...darkRaw, ...blocks[0], ...blocks[1] }) }
}

describe('shipped theme (src/index.css)', () => {
  it('declares every theme token in light mode', () => {
    for (const key of ['bg', 'surface', 'field', 'text', 'muted', 'border', 'borderStrong', 'accent', 'accentSoft',
      'btn', 'btnHover', 'btnText', 'danger', 'dangerContrast', 'pendingBg', 'highlight', 'openPlay', 'slotFreeBorder',
      'tintSage', 'tintRose', 'bandBg', 'bandCard', 'bandChip', 'bandText', 'bandMuted', 'bandAccent'] as const) {
      expect(light[key], key).toBeTruthy()
    }
  })

  it('still uses the color-mix formulas that themeChecks measures', () => {
    // themeChecks copies these weights; if one changes in index.css, update themeChecks to match.
    for (const formula of [
      'color-mix(in srgb, var(--open-play) 12%, var(--surface))', // open-play slot
      'color-mix(in srgb, var(--text) 10%, var(--surface))', // booked slot
      'color-mix(in srgb, var(--danger) 85%, black)', // danger button hover
      'color-mix(in srgb, var(--danger) 12%, transparent)', // cancelled badge
      'color-mix(in srgb, var(--danger) 10%, transparent)', // error alert
    ]) {
      expect(css, formula).toContain(formula)
    }
  })

  for (const [scheme, tokens] of [['light', light], ['dark', dark]] as const) {
    it(`meets WCAG AA for every checked pair in ${scheme} mode`, () => {
      const failing = themeChecks(tokens).filter((c) => !c.pass)
      expect(failing.map((c) => `${c.label}: ${c.ratio.toFixed(2)} < ${c.min}`)).toEqual([])
    })
  }

  it('declares the default preset on :root, with no attribute block of its own', () => {
    expect(css).not.toContain(`[data-theme='${DEFAULT_THEME}']`)
  })

  for (const preset of THEME_PRESETS.filter((p) => p !== DEFAULT_THEME)) {
    const tokens = presetTokens(preset)
    for (const scheme of ['light', 'dark'] as const) {
      it(`preset ${preset} meets WCAG AA for every checked pair in ${scheme} mode`, () => {
        const failing = themeChecks(tokens[scheme]).filter((c) => !c.pass)
        expect(failing.map((c) => `${c.label}: ${c.ratio.toFixed(2)} < ${c.min}`)).toEqual([])
      })
    }
  }

  it("the picker's preview swatches match each preset's tokens", () => {
    for (const preset of THEME_PRESETS) {
      const tokens = preset === DEFAULT_THEME ? { light, dark } : presetTokens(preset)
      for (const scheme of ['light', 'dark'] as const) {
        const t = tokens[scheme]
        expect({ accent: t.accent, btn: t.btn, btnText: t.btnText }, `${preset} ${scheme}`).toEqual(
          Object.fromEntries(Object.entries(THEME_SWATCHES[preset][scheme]).map(([k, v]) => [k, expect.stringMatching(new RegExp(`^${v}$`, 'i'))])),
        )
      }
    }
  })
})

describe('theme preset keys', () => {
  it('match the venue_settings_theme_preset check in the database', () => {
    const list = migration.match(/check \(theme in \(([^)]*)\)\)/)![1]
    expect([...list.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])).toEqual([...THEME_PRESETS])
  })

  it("match the list in index.html's inline script", () => {
    const list = indexHtml.match(/\[([^\]]*)\]\.indexOf\(theme\)/)![1]
    expect([...list.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])).toEqual(THEME_PRESETS.filter((p) => p !== DEFAULT_THEME))
  })
})
