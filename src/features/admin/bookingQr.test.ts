// T34.1: the booking-site QR code. The layout is decoded with jsqr to prove a phone camera can read it, whatever the slug
// length; the canvas drawing is stubbed because jsdom has no canvas (as qrImage.test.ts).
import jsQR from 'jsqr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BOOKING_QR_PX, bookingQrFileName, bookingQrLayout, LOGO_MAX_RATIO, QR_QUIET_ZONE, renderBookingQr } from './bookingQr'

const URLS = {
  'a short slug address': 'https://a.plotline.fit/book',
  'a 40-character slug address': `https://${'a'.repeat(40)}.plotline.fit/book`,
  'the ?venue= form': 'http://localhost:5173/book?venue=claudex-courts',
}

/** Rasterizes the layout the way renderBookingQr paints it, with the logo box left white. */
function rasterize(url: string) {
  const layout = bookingQrLayout(url)
  const px = BOOKING_QR_PX
  const data = new Uint8ClampedArray(px * px * 4).fill(255)
  const { modules, moduleSize, offset, logoBox } = layout
  modules.forEach((row: boolean[], r: number) => row.forEach((dark: boolean, c: number) => {
    if (!dark) return
    for (let y = 0; y < moduleSize; y++) for (let x = 0; x < moduleSize; x++) {
      const i = ((offset + r * moduleSize + y) * px + offset + c * moduleSize + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 0
    }
  }))
  for (let y = logoBox.y; y < logoBox.y + logoBox.size; y++) for (let x = logoBox.x; x < logoBox.x + logoBox.size; x++) {
    const i = (y * px + x) * 4
    data[i] = data[i + 1] = data[i + 2] = 255
  }
  return { layout, data }
}

describe('bookingQrFileName', () => {
  it('is the venue slug plus -booking-qr.png', () => {
    expect(bookingQrFileName('claudex-courts')).toBe('claudex-courts-booking-qr.png')
    expect(bookingQrFileName('a-venue')).toBe('a-venue-booking-qr.png')
  })
})

describe('constants', () => {
  it('are 1024 px, a 4-module quiet zone and a 22% logo cap', () => {
    expect(BOOKING_QR_PX).toBe(1024)
    expect(QR_QUIET_ZONE).toBe(4)
    expect(LOGO_MAX_RATIO).toBe(0.22)
  })
})

describe('bookingQrLayout', () => {
  for (const [label, url] of Object.entries(URLS)) {
    it(`decodes back to the exact address with the logo box blanked: ${label}`, () => {
      const { data } = rasterize(url)
      const decoded = jsQR(data, BOOKING_QR_PX, BOOKING_QR_PX)
      expect(decoded?.data).toBe(url)
    })

    it(`is a square matrix on whole-pixel modules inside the canvas with the quiet zone kept: ${label}`, () => {
      const { moduleCount, moduleSize, offset, modules } = bookingQrLayout(url)
      expect(modules).toHaveLength(moduleCount)
      for (const row of modules) expect(row).toHaveLength(moduleCount)
      expect(Number.isInteger(moduleSize)).toBe(true)
      expect(moduleSize).toBeGreaterThanOrEqual(1)
      expect((moduleCount + 2 * QR_QUIET_ZONE) * moduleSize).toBeLessThanOrEqual(BOOKING_QR_PX)
      expect(offset).toBeGreaterThanOrEqual(QR_QUIET_ZONE * moduleSize)
      expect(offset + moduleCount * moduleSize + QR_QUIET_ZONE * moduleSize).toBeLessThanOrEqual(BOOKING_QR_PX)
      // Centred, within a pixel of rounding.
      const left = offset
      const right = BOOKING_QR_PX - (offset + moduleCount * moduleSize)
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
      expect(modules[0][0]).toBe(true) // finder pattern corner
    })

    it(`keeps the centred logo box within 22% of the code width: ${label}`, () => {
      const { moduleCount, moduleSize, offset, logoBox } = bookingQrLayout(url)
      const side = moduleCount * moduleSize
      expect(logoBox.size).toBeGreaterThan(0)
      expect(logoBox.size).toBeLessThanOrEqual(LOGO_MAX_RATIO * side)
      expect(Math.abs(logoBox.x + logoBox.size / 2 - (offset + side / 2))).toBeLessThanOrEqual(1)
      expect(Math.abs(logoBox.y + logoBox.size / 2 - (offset + side / 2))).toBeLessThanOrEqual(1)
    })
  }

  it('uses the highest error correction level so the logo can cover the middle', () => {
    // Level H at this address makes a bigger matrix than the 21-module version-1 code.
    expect(bookingQrLayout(URLS['a short slug address']).moduleCount).toBeGreaterThanOrEqual(25)
  })

  it('scales to a smaller canvas', () => {
    const { moduleCount, moduleSize } = bookingQrLayout(URLS['a short slug address'], 512)
    expect((moduleCount + 2 * QR_QUIET_ZONE) * moduleSize).toBeLessThanOrEqual(512)
  })
})

const ctx = {
  fillStyle: '' as string, strokeStyle: '' as string, imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
  fillRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  arcTo: vi.fn(), arc: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(), rect: vi.fn(), save: vi.fn(), restore: vi.fn(),
  clip: vi.fn(), roundRect: vi.fn(),
}
const images: FakeImage[] = []
let logoFails = false
class FakeImage {
  crossOrigin: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  width = 200
  height = 100
  naturalWidth = 200
  naturalHeight = 100
  private url = ''
  get src() { return this.url }
  set src(value: string) {
    this.url = value
    images.push(this)
    queueMicrotask(() => (logoFails ? this.onerror?.() : this.onload?.()))
  }
}
let encoded: { type: string | undefined; width: number; height: number } | null = null
let toBlobThrowsOnce = false

beforeEach(() => {
  for (const fn of Object.values(ctx)) if (typeof fn === 'function') (fn as ReturnType<typeof vi.fn>).mockReset()
  images.length = 0
  logoFails = false
  encoded = null
  toBlobThrowsOnce = false
  vi.stubGlobal('Image', FakeImage)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
    if (toBlobThrowsOnce) {
      toBlobThrowsOnce = false
      throw new DOMException('Tainted canvases may not be exported.', 'SecurityError')
    }
    encoded = { type, width: this.width, height: this.height }
    callback(new Blob([new Uint8Array(10)], { type: type ?? 'image/png' }))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ADDRESS = URLS['a short slug address']

describe('renderBookingQr', () => {
  it('encodes a 1024 x 1024 PNG on white, with one black square per dark module', async () => {
    const blob = await renderBookingQr(ADDRESS, null)
    expect(blob.type).toBe('image/png')
    expect(encoded).toEqual({ type: 'image/png', width: 1024, height: 1024 })
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1024, 1024)
    const { moduleSize, offset } = bookingQrLayout(ADDRESS)
    expect(ctx.fillRect).toHaveBeenCalledWith(offset, offset, moduleSize, moduleSize) // top-left finder module
  })

  it('draws no logo when none is given', async () => {
    await renderBookingQr(ADDRESS, null)
    expect(ctx.drawImage).not.toHaveBeenCalled()
    expect(images).toHaveLength(0)
  })

  it('loads the logo anonymously and draws it once, inside the centred box', async () => {
    await renderBookingQr(ADDRESS, 'https://cdn.test/logo.png')
    expect(images).toHaveLength(1)
    expect(images[0].crossOrigin).toBe('anonymous')
    expect(images[0].src).toBe('https://cdn.test/logo.png')
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    const [image, ...rest] = ctx.drawImage.mock.calls[0] as unknown as [unknown, ...number[]]
    expect(image).toBe(images[0])
    const { logoBox } = bookingQrLayout(ADDRESS)
    const [x, y, w, h] = rest.slice(-4)
    expect(x).toBeGreaterThanOrEqual(logoBox.x)
    expect(y).toBeGreaterThanOrEqual(logoBox.y)
    expect(x + w).toBeLessThanOrEqual(logoBox.x + logoBox.size)
    expect(y + h).toBeLessThanOrEqual(logoBox.y + logoBox.size)
  })

  it('falls back to a plain QR code when the logo fails to load', async () => {
    logoFails = true
    const blob = await renderBookingQr(ADDRESS, 'https://cdn.test/missing.png')
    expect(blob.type).toBe('image/png')
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('retries without the logo when the canvas is tainted and toBlob throws', async () => {
    toBlobThrowsOnce = true
    const blob = await renderBookingQr(ADDRESS, 'https://cdn.test/logo.png')
    expect(blob.type).toBe('image/png')
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(2)
    expect(ctx.drawImage).toHaveBeenCalledTimes(1) // the failed first attempt only; the retry is plain
    expect(encoded).toEqual({ type: 'image/png', width: 1024, height: 1024 })
  })

  it('rejects with an Error when the browser has no canvas support', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    await expect(renderBookingQr(ADDRESS, null)).rejects.toBeInstanceOf(Error)
  })
})
