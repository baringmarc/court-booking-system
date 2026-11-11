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
import migration from '../../supabase/migrations/20261110124954_t20_2_theme_presets.sql?raw'

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
      'color-mix(in srgb, var(--open-play) 26%, var(--surface))', // open-play slot
      'color-mix(in srgb, var(--text) 16%, var(--surface))', // booked slot
      'color-mix(in srgb, var(--accent) 8%, var(--surface))', // free slot
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
        expect({ accent: t.accent, btn: t.btn, btnText: t.btnText, bg: t.bg, surface: t.surface, text: t.text }, `${preset} ${scheme}`).toEqual(
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

// T20.3: the full palettes from RESEARCH.md "Milestone 20" (every token a preset owns), light and dark.
type Palette = Record<string, string>
const cols = ['bg', 'surface', 'field', 'text', 'muted', 'border', 'borderStrong', 'tintSage', 'tintRose', 'pendingBg', 'highlight',
  'bandBg', 'bandCard', 'bandChip', 'bandBorder', 'bandText', 'bandMuted', 'bandAccent', 'shapeRing', 'shapeDot', 'shapeLeaf'] as const
const row = (accent: string, btnHover: string, btnText: string, ...values: string[]): Palette => ({
  accent, btn: accent, btnHover, btnText, ...Object.fromEntries(cols.map((c, i) => [c, values[i]])), openPlay: values[10],
})
const PALETTES: Record<string, { light: Palette; dark: Palette }> = {
  'court-green': {
    light: row('#0f7652', '#0b5c40', '#ffffff', '#eef6f1', '#fbfefc', '#ffffff', '#14341e', '#3c6249', '#cce1d3', '#567661', '#ddeee3', '#f6e7df', '#f6e7df', '#7a3d1f', '#182a1e', '#263b2d', '#344b3c', '#3e5646', '#edf7f1', '#c0d8c8', '#63d2a6', '#cce1d3', '#f6e7df', '#ddeee3'),
    dark: row('#63d2a6', '#85dcb9', '#08140f', '#141f18', '#213026', '#0f1a13', '#e8f3eb', '#b1c9b9', '#3d5144', '#819c8a', '#32483a', '#513d34', 'rgba(233,188,165,0.2)', '#e9bca5', '#213026', '#2d3e33', '#3b4e42', '#435649', '#ebf4ee', '#c2d6c9', '#63d2a6', '#35463a', '#513d34', '#32483a'),
  },
  ocean: {
    light: row('#1b6a9c', '#14507a', '#ffffff', '#eef3f6', '#fbfdfe', '#ffffff', '#142634', '#3c5262', '#ccd8e1', '#566976', '#dde7ee', '#f6ebdf', '#f6ebdf', '#7a4d1f', '#18232a', '#26323b', '#34424b', '#3e4c56', '#edf3f7', '#c0ced8', '#86c5ec', '#ccd8e1', '#f6ebdf', '#dde7ee'),
    dark: row('#86c5ec', '#a5d4f1', '#0b1a24', '#141a1f', '#212a30', '#0f151a', '#e8eef3', '#b1bfc9', '#3d4951', '#81919c', '#323f48', '#514234', 'rgba(233,199,165,0.2)', '#e9c7a5', '#212a30', '#2d373e', '#3b464e', '#434e56', '#ebf0f4', '#c2ced6', '#86c5ec', '#353f46', '#514234', '#323f48'),
  },
  plum: {
    light: row('#7a3b7d', '#5e2d61', '#ffffff', '#f6eef6', '#fdfbfe', '#ffffff', '#311434', '#5f3c62', '#dfcce1', '#745676', '#edddee', '#f6eedf', '#f6eedf', '#7a5c1f', '#29182a', '#39263b', '#49344b', '#543e56', '#f7edf7', '#d6c0d8', '#ddafe0', '#dfcce1', '#f6eedf', '#edddee'),
    dark: row('#ddafe0', '#e7c6e9', '#2a132b', '#1e141f', '#2f2130', '#190f1a', '#f2e8f3', '#c7b1c9', '#503d51', '#9a819c', '#463248', '#514734', 'rgba(233,210,165,0.2)', '#e9d2a5', '#2f2130', '#3d2d3e', '#4d3b4e', '#544356', '#f4ebf4', '#d5c2d6', '#ddafe0', '#443546', '#514734', '#463248'),
  },
  sunset: {
    light: row('#a84a12', '#86390d', '#ffffff', '#f6f2ee', '#fefcfb', '#ffffff', '#342314', '#624e3c', '#e1d5cc', '#766556', '#eee5dd', '#f6e3df', '#f6e3df', '#7a2e1f', '#2a2118', '#3b3026', '#4b3f34', '#56493e', '#f7f2ed', '#d8cbc0', '#f2af80', '#e1d5cc', '#f6e3df', '#eee5dd'),
    dark: row('#f2af80', '#f5c3a0', '#2a1305', '#1f1914', '#302821', '#1a140f', '#f3ede8', '#c9bcb1', '#51473d', '#9c8e81', '#483c32', '#513934', 'rgba(233,176,165,0.2)', '#e9b0a5', '#302821', '#3e352d', '#4e443b', '#564c43', '#f4efeb', '#d6cbc2', '#f2af80', '#463d35', '#513934', '#483c32'),
  },
  slate: {
    light: row('#2f4f6f', '#223c56', '#ffffff', '#f1f2f3', '#fcfcfd', '#ffffff', '#1f2328', '#4a4e55', '#d3d6d9', '#62656a', '#e3e5e8', '#eeeae7', '#eeeae7', '#7a451f', '#1e2124', '#2e3033', '#3d3f43', '#47494d', '#f1f2f4', '#c8cbd0', '#a9c3dd', '#d3d6d9', '#eeeae7', '#e3e5e8'),
    dark: row('#a9c3dd', '#c1d4e7', '#0f1822', '#18191b', '#27282b', '#131416', '#ecedef', '#b9bcc0', '#45474a', '#8b8e92', '#3a3d40', '#4a413a', 'rgba(233,193,165,0.2)', '#e9c1a5', '#27282b', '#333538', '#424448', '#4a4c4f', '#eeeff1', '#c9cbcf', '#a9c3dd', '#3b3d40', '#4a413a', '#3a3d40'),
  },
  midnight: {
    light: row('#a9b8ff', '#c2cdff', '#0e1330', '#14151f', '#212330', '#0f101a', '#e8e9f3', '#b1b3c9', '#3d3f51', '#81849c', '#323448', '#4a3451', 'rgba(216,165,233,0.2)', '#d8a5e9', '#212330', '#2d2e3e', '#3b3d4e', '#434556', '#ebecf4', '#c2c4d6', '#a9b8ff', '#353646', '#4a3451', '#323448'),
    dark: row('#a9b8ff', '#c2cdff', '#0e1330', '#14151f', '#212330', '#0f101a', '#e8e9f3', '#b1b3c9', '#3d3f51', '#81849c', '#323448', '#4a3451', 'rgba(216,165,233,0.2)', '#d8a5e9', '#212330', '#2d2e3e', '#3b3d4e', '#434556', '#ebecf4', '#c2c4d6', '#a9b8ff', '#353646', '#4a3451', '#323448'),
  },
}
const norm = (v: string) => v.replace(/\s+/g, '').toLowerCase()

describe('full preset palettes (T20.3)', () => {
  it('has a palette for every non-default preset', () => {
    expect(Object.keys(PALETTES)).toEqual(THEME_PRESETS.filter((p) => p !== DEFAULT_THEME))
  })

  for (const [preset, palette] of Object.entries(PALETTES)) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`${preset} ${scheme} sets every token to its RESEARCH M20 value`, () => {
        const actual = presetTokens(preset)[scheme] as unknown as Record<string, string>
        const expected = palette[scheme]
        expect(Object.fromEntries(Object.keys(expected).map((k) => [k, norm(actual[k] ?? '')]))).toEqual(
          Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, norm(v)])),
        )
        expect(actual.accentSoft, 'accent-soft').toBeTruthy()
        if (scheme === 'dark') expect(norm(actual.shadow), 'dark shadow').toBe('none')
        else if (preset === 'midnight') expect(norm(actual.shadow), 'midnight light shadow (equals dark block)').toBe('none')
        else expect(norm(actual.shadow), 'light shadow').toContain('0 12px 34px'.replace(/\s+/g, ''))
      })
    }
  }

  it('the preset blocks themselves declare the full token list (no inheriting from :root)', () => {
    const names = ['bg', 'surface', 'field', 'text', 'muted', 'border', 'border-strong', 'accent', 'accent-soft', 'btn', 'btn-hover', 'btn-text',
      'highlight', 'pending-bg', 'tint-sage', 'tint-rose', 'band-bg', 'band-card', 'band-chip', 'band-border', 'band-text', 'band-muted',
      'band-accent', 'shape-ring', 'shape-dot', 'shape-leaf', 'open-play', 'shadow']
    for (const preset of Object.keys(PALETTES)) {
      const blocks = [...css.matchAll(new RegExp(`\\[data-theme='${preset}'\\]\\s*{([^}]*)}`, 'g'))].map((m) => declarations(m[1]))
      expect(blocks, preset).toHaveLength(2)
      for (const [i, block] of blocks.entries()) {
        expect(names.filter((n) => !(n in block)), `${preset} block ${i}`).toEqual([])
      }
    }
  })

  it('midnight is dark in both modes', () => {
    const t = presetTokens('midnight')
    expect(t.light).toEqual(t.dark)
  })
})
