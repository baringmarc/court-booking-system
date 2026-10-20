// WCAG 2.x contrast math for the theme work (T9.1). Pure functions, no DOM.
// https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio and #dfn-relative-luminance

export type Rgba = { r: number; g: number; b: number; a: number }

/** Parses #rgb, #rrggbb, rgb(r, g, b) and rgba(r, g, b, a). Throws on anything else. */
export function parseColor(input: string): Rgba {
  const value = input.trim().toLowerCase()
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 }
  }
  const fn = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/)
  if (fn) return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) }
  throw new Error(`Unsupported color: ${input}`)
}

/** Like CSS `color-mix(in srgb, a weight%, b)`: a straight sRGB blend, `weight` (0–1) of `a`. */
export function mix(a: string | Rgba, b: string | Rgba, weight: number): Rgba {
  const x = typeof a === 'string' ? parseColor(a) : a
  const y = typeof b === 'string' ? parseColor(b) : b
  const blend = (p: number, q: number) => p * weight + q * (1 - weight)
  return { r: blend(x.r, y.r), g: blend(x.g, y.g), b: blend(x.b, y.b), a: blend(x.a, y.a) }
}

/** A translucent color painted over an opaque background. */
export function over(fg: string | Rgba, bg: string | Rgba): Rgba {
  const f = typeof fg === 'string' ? parseColor(fg) : fg
  const b = typeof bg === 'string' ? parseColor(bg) : bg
  return { ...mix({ ...f, a: 1 }, { ...b, a: 1 }, f.a), a: 1 }
}

export function relativeLuminance(color: string | Rgba): number {
  const c = typeof color === 'string' ? parseColor(color) : color
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/** Contrast ratio between two opaque colors, from 1 to 21. */
export function contrast(a: string | Rgba, b: string | Rgba): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((p, q) => q - p)
  return (hi + 0.05) / (lo + 0.05)
}
