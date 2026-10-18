// jsdom has no image decoding or canvas encoding, so those browser APIs are stubbed here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downscaleImage } from './imageResize'

type Encoder = (type: string) => Blob | null

const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
let encode: Encoder
let encodedSize: { width: number; height: number } | null = null

beforeEach(() => {
  ctx.fillRect.mockReset()
  ctx.drawImage.mockReset()
  encode = (type) => new Blob(['x'], { type })
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 4000, height: 3000, close: vi.fn() })))
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

const photo = () => new File([new Uint8Array(10)], 'photo.jpg', { type: 'image/jpeg' })

describe('downscaleImage', () => {
  it('draws the image at the fitted size on a white background and returns WEBP', async () => {
    const blob = await downscaleImage(photo(), 1600)
    expect(blob.type).toBe('image/webp')
    expect(encodedSize).toEqual({ width: 1600, height: 1200 })
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200)
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200)
  })

  it('falls back to JPEG when the browser silently returns a PNG for WEBP (Safari)', async () => {
    encode = (type) => new Blob(['x'], { type: type === 'image/webp' ? 'image/png' : type })
    const blob = await downscaleImage(photo(), 1600)
    expect(blob.type).toBe('image/jpeg')
  })

  it('explains when the file is not a readable image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new DOMException('bad', 'InvalidStateError') }))
    await expect(downscaleImage(photo(), 1600)).rejects.toThrow("That file isn't a readable image.")
  })

  it('fails clearly when nothing can be encoded', async () => {
    encode = () => null
    await expect(downscaleImage(photo(), 1600)).rejects.toThrow("This browser can't process images.")
  })
})
