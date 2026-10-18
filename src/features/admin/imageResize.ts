// Browser-side downscale and re-encode for venue media (RESEARCH M6). Re-encoding also drops EXIF data
// (e.g. GPS location) and fails on files that aren't really images.
import { fitWithin } from './mediaInput'

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

/** Scales the image to fit within `maxWidth` and encodes it as WEBP, or JPEG where WEBP encoding isn't supported. */
export async function downscaleImage(file: Blob, maxWidth: number): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("That file isn't a readable image.")
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, maxWidth)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error("This browser can't process images.")
  }
  // White under transparent PNGs, so a JPEG fallback doesn't turn them black.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  // toBlob silently returns a PNG when it can't encode WEBP (Safari), so check the type.
  const webp = await toBlob(canvas, 'image/webp', 0.82)
  if (webp?.type === 'image/webp') return webp
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.85)
  if (!jpeg) throw new Error("This browser can't process images.")
  return jpeg
}
