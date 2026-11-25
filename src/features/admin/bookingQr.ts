// The booking-site QR code (T34.1, SPEC §9 item 34): the venue's `/book` address as a 1024×1024 PNG, drawn in the
// browser. Error correction H, a 4-module quiet zone and plain black squares on white, so any phone camera reads it,
// with the venue logo (when set) on a white square in the middle that H's redundancy covers.
import QRCode from 'qrcode'

export const BOOKING_QR_PX = 1024
export const QR_QUIET_ZONE = 4
/** The logo box's side, at most this share of the code's side (about 5% of its area; level H recovers 30%). */
export const LOGO_MAX_RATIO = 0.22

const CANNOT = "This browser can't draw the QR code."

export const bookingQrFileName = (slug: string) => `${slug}-booking-qr.png`

export type BookingQrLayout = {
  modules: boolean[][]
  moduleCount: number
  /** Whole pixels per module, so every edge is crisp. */
  moduleSize: number
  /** Pixel position of module (0, 0); the code is centred with at least the quiet zone around it. */
  offset: number
  logoBox: { x: number; y: number; size: number }
}

export function bookingQrLayout(url: string, px = BOOKING_QR_PX): BookingQrLayout {
  const { modules: matrix } = QRCode.create(url, { errorCorrectionLevel: 'H' })
  const moduleCount = matrix.size
  const modules = Array.from({ length: moduleCount }, (_, row) =>
    Array.from({ length: moduleCount }, (_, col) => !!matrix.get(row, col)),
  )
  const moduleSize = Math.max(1, Math.floor(px / (moduleCount + 2 * QR_QUIET_ZONE)))
  const side = moduleCount * moduleSize
  const offset = Math.floor((px - side) / 2)
  const size = Math.floor(LOGO_MAX_RATIO * side)
  const start = offset + Math.round((side - size) / 2)
  return { modules, moduleCount, moduleSize, offset, logoBox: { x: start, y: start, size } }
}

function loadLogo(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function roundedSquare(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, radius: number) {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + size, y, x + size, y + size, radius)
  ctx.arcTo(x + size, y + size, x, y + size, radius)
  ctx.arcTo(x, y + size, x, y, radius)
  ctx.arcTo(x, y, x + size, y, radius)
  ctx.closePath()
  ctx.fill()
}

async function encode(layout: BookingQrLayout, px: number, logo: HTMLImageElement | null): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(CANNOT)
  const { modules, moduleSize, offset, logoBox } = layout
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  ctx.fillStyle = '#000000'
  modules.forEach((row, r) => row.forEach((dark, c) => {
    if (dark) ctx.fillRect(offset + c * moduleSize, offset + r * moduleSize, moduleSize, moduleSize)
  }))
  if (logo) {
    const { x, y, size } = logoBox
    ctx.fillStyle = '#ffffff'
    roundedSquare(ctx, x, y, size, Math.round(size * 0.16))
    // The logo keeps its proportions inside the box, with a margin so it never touches the modules.
    const inner = size * 0.8
    const width = logo.naturalWidth || logo.width
    const height = logo.naturalHeight || logo.height
    const scale = width && height ? Math.min(inner / width, inner / height) : 0
    if (scale > 0) {
      const [w, h] = [width * scale, height * scale]
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(logo, x + (size - w) / 2, y + (size - h) / 2, w, h)
    }
  }
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!png || png.type !== 'image/png') throw new Error(CANNOT)
  return png
}

/** The PNG of the code, with the logo in the middle when it loads; a logo that fails or taints the canvas is left out. */
export async function renderBookingQr(url: string, logoUrl: string | null, px = BOOKING_QR_PX): Promise<Blob> {
  const layout = bookingQrLayout(url, px)
  const logo = await loadLogo(logoUrl)
  try {
    return await encode(layout, px, logo)
  } catch (error) {
    // A logo served without CORS headers taints the canvas, and toBlob then throws: draw it again without the logo.
    if (logo && !(error instanceof Error && error.message === CANNOT)) return encode(layout, px, null)
    throw error
  }
}
