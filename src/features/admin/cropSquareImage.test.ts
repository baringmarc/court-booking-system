// jsdom has no image decoding or canvas encoding, so those browser APIs are stubbed here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cropSquareImage } from './imageResize'
import { LOGO_SIZE } from './mediaInput'

type Encoder = (type: string) => Blob | null

const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
let encode: Encoder
let encodedSize: { width: number; height: number } | null = null
let bitmapSize = { width: 4000, height: 3000 }

beforeEach(() => {
  ctx.fillRect.mockReset()
  ctx.drawImage.mockReset()
  encode = (type) => new Blob(['x'], { type })
  bitmapSize = { width: 4000, height: 3000 }
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ ...bitmapSize, close: vi.fn() })))
  encodedSize = null
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback, type) {
    encodedSize = { width: this.width, height: this.height }
    callback(encode(type ?? 'image/png'))
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const photo = () => new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' })

describe('cropSquareImage', () => {
  it('LOGO_SIZE is 512', () => {
    expect(LOGO_SIZE).toBe(512)
  })

  it('centre-crops a landscape image to a square of maxSide on a white background and returns WEBP', async () => {
    const blob = await cropSquareImage(photo(), 512)
    expect(blob.type).toBe('image/webp')
    expect(encodedSize).toEqual({ width: 512, height: 512 })
    expect(ctx.fillStyle).toBe('#fff')
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 512, 512)
    // 4000x3000: the square is the middle 3000x3000, starting 500 px in.
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 500, 0, 3000, 3000, 0, 0, 512, 512)
  })

  it('centre-crops a portrait image', async () => {
    bitmapSize = { width: 1000, height: 3000 }
    await cropSquareImage(photo(), 512)
    expect(encodedSize).toEqual({ width: 512, height: 512 })
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 1000, 1000, 1000, 0, 0, 512, 512)
  })

  it('never upscales: a small image keeps its shorter side', async () => {
    bitmapSize = { width: 300, height: 200 }
    await cropSquareImage(photo(), 512)
    expect(encodedSize).toEqual({ width: 200, height: 200 })
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 200)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 50, 0, 200, 200, 0, 0, 200, 200)
  })

  it('falls back to JPEG when the browser silently returns a PNG for WEBP (Safari)', async () => {
    encode = (type) => new Blob(['x'], { type: type === 'image/webp' ? 'image/png' : type })
    const blob = await cropSquareImage(photo(), 512)
    expect(blob.type).toBe('image/jpeg')
  })

  it('explains when the file is not a readable image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new DOMException('bad', 'InvalidStateError') }))
    await expect(cropSquareImage(photo(), 512)).rejects.toThrow("That file isn't a readable image.")
  })

  it('fails clearly when nothing can be encoded', async () => {
    encode = () => null
    await expect(cropSquareImage(photo(), 512)).rejects.toThrow("This browser can't process images.")
  })
})
