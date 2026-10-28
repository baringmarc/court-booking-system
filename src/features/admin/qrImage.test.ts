// jsdom has no image decoding or canvas encoding, so those browser APIs are stubbed (as imageResize.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkQrFile, fitLongSide, prepareQrImage, QR_MAX_BYTES, qrStorageMessage } from './qrImage'

const ctx = { fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: 'low', fillRect: vi.fn(), drawImage: vi.fn() }
let source = { width: 800, height: 800 }
let encoded: { type: string; size: number; width: number; height: number } | null = null
let encodeAs = (type: string) => type
let encodedBytes = 5000

beforeEach(() => {
  ctx.fillRect.mockReset()
  ctx.drawImage.mockReset()
  source = { width: 800, height: 800 }
  encodeAs = (type) => type
  encodedBytes = 5000
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ ...source, close: vi.fn() })))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
    const blob = new Blob([new Uint8Array(encodedBytes)], { type: encodeAs(type ?? 'image/png') })
    encoded = { type: blob.type, size: blob.size, width: this.width, height: this.height }
    callback(blob)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const file = (type = 'image/png', size = 100) => new File([new Uint8Array(size)], 'qr', { type })

describe('checkQrFile', () => {
  it('accepts PNG, JPG and WEBP up to 15 MB', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) expect(checkQrFile(file(type))).toBeNull()
    expect(checkQrFile(file('application/pdf'))).toMatch(/PNG, JPG or WEBP/)
    expect(checkQrFile(file('image/png', 15 * 1024 * 1024 + 1))).toMatch(/15 MB/)
  })
})

describe('fitLongSide', () => {
  it('shrinks the longest side to the limit and never upscales', () => {
    expect(fitLongSide(2400, 1200, 1200)).toEqual({ width: 1200, height: 600 })
    expect(fitLongSide(900, 3000, 1200)).toEqual({ width: 360, height: 1200 })
    expect(fitLongSide(500, 500, 1200)).toEqual({ width: 500, height: 500 })
  })
})

describe('prepareQrImage', () => {
  it('re-encodes as lossless PNG on white, at its own size when small enough', async () => {
    const blob = await prepareQrImage(file('image/jpeg'))
    expect(blob.type).toBe('image/png')
    expect(encoded).toMatchObject({ type: 'image/png', width: 800, height: 800 })
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 800)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 800, 800)
  })

  it('shrinks a large screenshot to 1200 px on its long side, with high-quality smoothing', async () => {
    source = { width: 1170, height: 2532 }
    await prepareQrImage(file())
    expect(encoded).toMatchObject({ width: 555, height: 1200 })
    expect(ctx.imageSmoothingEnabled).toBe(true)
    expect(ctx.imageSmoothingQuality).toBe('high')
  })

  it('refuses a file that is not a readable image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('decode') }))
    await expect(prepareQrImage(file())).rejects.toThrow(/readable image/)
  })

  it('refuses when the browser cannot encode PNG', async () => {
    encodeAs = () => 'image/jpeg'
    await expect(prepareQrImage(file())).rejects.toThrow(/can't process images/)
  })

  it('refuses a result over the 1 MB bucket limit', async () => {
    encodedBytes = QR_MAX_BYTES + 1
    await expect(prepareQrImage(file())).rejects.toThrow(/larger than 1 MB/)
  })
})

describe('qrStorageMessage', () => {
  it('maps the bucket statuses to plain words', () => {
    expect(qrStorageMessage({ message: 'x', statusCode: '413' })).toBe('The QR image is larger than 1 MB.')
    expect(qrStorageMessage({ message: 'x', statusCode: 415 })).toMatch(/PNG/)
    expect(qrStorageMessage({ message: 'x', status: 403 })).toMatch(/permission/)
    expect(qrStorageMessage({ message: 'x', statusCode: '500' })).toMatch(/couldn't be saved/)
    expect(qrStorageMessage({ message: 'Failed to fetch' })).toBe('Failed to fetch')
  })
})
