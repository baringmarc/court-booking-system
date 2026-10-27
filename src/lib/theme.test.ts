// Guards the shipped theme (T9.2): the real tokens in src/index.css, light and dark, must meet WCAG AA
// for every pair in themeChecks. Change a token and this test re-measures it.
import { describe, expect, it } from 'vitest'
// The stylesheet's source text. vitest.config.ts lets index.css through Vite (Vitest stubs CSS as empty otherwise).
import css from '../index.css?raw'
import { themeChecks, type Tokens } from './themeChecks'

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

describe('shipped theme (src/index.css)', () => {
  it('declares every theme token in light mode', () => {
    for (const key of ['bg', 'surface', 'field', 'text', 'muted', 'border', 'borderStrong', 'accent', 'accentSoft',
      'btn', 'btnHover', 'btnText', 'danger', 'dangerContrast', 'pendingBg', 'highlight', 'openPlay', 'slotFreeBorder'] as const) {
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
})
