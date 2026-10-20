import { describe, expect, it } from 'vitest'
import { PALETTES, paletteChecks } from './palettes'

describe('candidate palettes', () => {
  for (const palette of PALETTES) {
    for (const scheme of ['light', 'dark'] as const) {
      it(`${palette.name} (${scheme}) meets every WCAG AA pair`, () => {
        const failing = paletteChecks(palette[scheme]).filter((c) => !c.pass)
        expect(failing.map((c) => `${c.label}: ${c.ratio.toFixed(2)} < ${c.min}`)).toEqual([])
      })
    }
  }

  it('has four distinct palettes', () => {
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(4)
  })
})
