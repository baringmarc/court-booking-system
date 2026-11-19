// Browser-side downscale and re-encode for venue media (RESEARCH M6). Re-encoding also drops EXIF data
// (e.g. GPS location) and fails on files that aren't really images.
import { fitWithin } from './mediaInput'

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

async function readBitmap(file: Blob) {
  try {
    return await createImageBitmap(file)
  } catch {
    throw new Error("That file isn't a readable image.")
  }
}

/**
 * Draws onto a white canvas of `width` × `height` (so a JPEG fallback doesn't turn transparent PNGs black), then encodes
 * it as WEBP, or JPEG where WEBP encoding isn't supported. Closes the bitmap.
 */
async function renderAndEncode(bitmap: ImageBitmap, width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error("This browser can't process images.")
  }
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  draw(ctx)
  bitmap.close()

  // toBlob silently returns a PNG when it can't encode WEBP (Safari), so check the type.
  const webp = await toBlob(canvas, 'image/webp', 0.82)
  if (webp?.type === 'image/webp') return webp
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.85)
  if (!jpeg) throw new Error("This browser can't process images.")
  return jpeg
}

/** Scales the image to fit within `maxWidth` and encodes it as WEBP, or JPEG where WEBP encoding isn't supported. */
export async function downscaleImage(file: Blob, maxWidth: number): Promise<Blob> {
  const bitmap = await readBitmap(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxWidth)
  return renderAndEncode(bitmap, width, height, (ctx) => ctx.drawImage(bitmap, 0, 0, width, height))
}

/** Crops the middle square of the image and scales it to at most `maxSide` (never up), encoded like downscaleImage. */
export async function cropSquareImage(file: Blob, maxSide: number): Promise<Blob> {
  const bitmap = await readBitmap(file)
  const square = Math.min(bitmap.width, bitmap.height)
  const side = Math.min(square, maxSide)
  const sx = Math.floor((bitmap.width - square) / 2)
  const sy = Math.floor((bitmap.height - square) / 2)
  return renderAndEncode(bitmap, side, side, (ctx) => ctx.drawImage(bitmap, sx, sy, square, square, 0, 0, side, side))
}
