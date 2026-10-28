// Payment QR codes (T11.11, RESEARCH M11): re-encoded in the browser as lossless PNG so they stay scannable
// (lossy WEBP or JPEG blurs the modules), on white so a transparent QR still scans from a phone's gallery.
import { ACCEPTED_IMAGE_TYPES, MAX_SOURCE_BYTES } from './mediaInput'

/** The payment-qr bucket's limit (T11.10). */
export const QR_MAX_BYTES = 1024 * 1024
/** Longest side kept: plenty for a phone to scan, and a typical QR stays well under 1 MB as PNG. */
export const QR_MAX_SIDE = 1200

export function checkQrFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return 'Choose a PNG, JPG or WEBP image of the QR code.'
  if (file.size > MAX_SOURCE_BYTES) return 'The image is larger than 15 MB.'
  return null
}

/** Size whose longest side is at most `max`, keeping the aspect ratio and never upscaling. */
export function fitLongSide(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function prepareQrImage(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error("That file isn't a readable image.")
  }
  const { width, height } = fitLongSide(bitmap.width, bitmap.height, QR_MAX_SIDE)
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
  // High-quality smoothing when shrinking: nearest-neighbour keeps one pixel in three of a camera photo and brings in
  // speckle, which QR readers handle worse than soft grey edges. At its own size nothing is resampled.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (png?.type !== 'image/png') throw new Error("This browser can't process images.")
  if (png.size > QR_MAX_BYTES) throw new Error('The QR image is larger than 1 MB even after resizing. Try a tighter crop of the code.')
  return png
}

const QR_STORAGE_MESSAGES: Record<string, string> = {
  '403': "You don't have permission to change payment QR codes.",
  '413': 'The QR image is larger than 1 MB.',
  '415': 'QR codes are uploaded as PNG images.',
}

export function qrStorageMessage(error: { message: string; statusCode?: string | number; status?: number }) {
  const code = String(error.statusCode ?? error.status ?? '')
  if (!code) return error.message
  return QR_STORAGE_MESSAGES[code] ?? "The QR image couldn't be saved. Please try again."
}
