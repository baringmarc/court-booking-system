// Guards the shipped theme (T9.2): the real tokens in src/index.css, light and dark, must meet WCAG AA
// for every pair in themeChecks. Change a token and this test re-measures it.
import { describe, expect, it } from 'vitest'
// The stylesheet's source text. vitest.config.ts lets index.css through Vite (Vitest stubs CSS as empty otherwise).
import css from '../index.css?raw'
import { themeChecks, type Tokens } from './themeChecks'

/** The custom properties declared directly in a block, keyed in camelCase. */
function tokensIn(block: string): Partial<Tokens> {
  const entries = [...block.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [
    name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()),
    value.trim(),
  ])
  return Object.fromEntries(entries)
}

const light = tokensIn(css.match(/^:root\s*{([^}]*)}/m)![1]) as Tokens
const dark = { ...light, ...tokensIn(css.match(/@media \(prefers-color-scheme: dark\)\s*{\s*:root\s*{([^}]*)}/)![1]) }

describe('shipped theme (src/index.css)', () => {
  it('declares every theme token in light mode', () => {
    for (const key of ['bg', 'surface', 'text', 'muted', 'border', 'accent', 'accentHover', 'accentContrast',
      'accentSoft', 'danger', 'dangerContrast'] as const) {
      expect(light[key], key).toBeTruthy()
    }
  })

  it('still uses the color-mix formulas that themeChecks measures', () => {
    // themeChecks copies these weights; if one changes in index.css, update themeChecks to match.
    for (const formula of [
      'color-mix(in srgb, var(--accent) 70%, var(--border))', // free-slot outline
      'color-mix(in srgb, var(--text) 10%, var(--surface))', // booked slot
      'color-mix(in srgb, var(--danger) 85%, black)', // danger button hover
      'color-mix(in srgb, var(--danger) 12%, transparent)', // cancelled badge
      'color-mix(in srgb, #f5b400 25%, transparent)', // pending badge
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
