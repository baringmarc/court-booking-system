import { describe, expect, it } from 'vitest'
import { contrast, mix, over, parseColor, relativeLuminance } from './contrast'

describe('contrast', () => {
  it('parses hex, short hex, rgb and rgba', () => {
    expect(parseColor('#0f7a55')).toEqual({ r: 15, g: 122, b: 85, a: 1 })
    expect(parseColor('#FFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
    expect(parseColor('rgba(15, 122, 85, 0.1)')).toEqual({ r: 15, g: 122, b: 85, a: 0.1 })
    expect(() => parseColor('green')).toThrow('Unsupported color')
  })

  it('matches the WCAG reference values', () => {
    expect(relativeLuminance('#000')).toBe(0)
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 10)
    expect(contrast('#000', '#fff')).toBeCloseTo(21, 10)
    expect(contrast('#fff', '#fff')).toBe(1)
    // Well-known pairs: #767676 on white is the classic 4.54:1 minimum grey.
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrast('#ffffff', '#767676')).toBeCloseTo(4.54, 2)
  })

  it('mixes like color-mix(in srgb) and composites translucent colors', () => {
    expect(mix('#ffffff', '#000000', 0.5)).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 })
    expect(mix('#0f7a55', '#dfe4e1', 1)).toEqual(parseColor('#0f7a55'))
    expect(over('rgba(0, 0, 0, 0.5)', '#ffffff')).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 })
    expect(over('#123456', '#ffffff')).toEqual(parseColor('#123456'))
  })

  it('reproduces the T8.5 measurements of the current theme', () => {
    // Free-slot outline (accent 70% into border) against the light page background: 3.16:1 in T8.5.
    expect(contrast(mix('#0f7a55', '#dfe4e1', 0.7), '#f7f8f6')).toBeCloseTo(3.16, 1)
    // Button text on the accent: 5.34:1 in T8.5.
    expect(contrast('#ffffff', '#0f7a55')).toBeCloseTo(5.34, 1)
  })
})
