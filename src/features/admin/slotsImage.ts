// The daily "open slots" picture an owner posts to Facebook (T31.1, SPEC §9 item 31): each court's free time ranges
// for today or tomorrow, drawn on a canvas in the browser as a 1080×1350 PNG, plus a caption built from the same ranges.
import { formatHour } from '../../lib/format'
import { hourInZone } from '../../lib/time'
import type { Slot } from '../booking/selection'
import { isAfterMidnight } from '../catalog/hours'

export const SLOTS_IMAGE_WIDTH = 1080
export const SLOTS_IMAGE_HEIGHT = 1350

export type CourtRanges = { courtId: string; name: string; ranges: { start: string; end: string; label: string }[] }

/** "2–5 PM", "11 AM–1 PM", "10 PM–2 AM (next day)": the suffix once when both ends share it. */
function rangeLabel(start: string, end: string, lastStart: string, date: string, timeZone: string) {
  const [from, to] = [formatHour(hourInZone(start, timeZone)), formatHour(hourInZone(end, timeZone))]
  const [fromHour, fromSuffix] = from.split(' ')
  const text = fromSuffix === to.split(' ')[1] ? `${fromHour}–${to}` : `${from}–${to}`
  // Marked like DayView: an hour that starts after midnight belongs to the next calendar date.
  return isAfterMidnight(lastStart, date, timeZone) ? `${text} (next day)` : text
}

/**
 * Each court's free time ranges, in the courts' order. Only `free` slots count: hours that have started (`past`),
 * bookings, open play and blackouts are never listed and end a run. A `free` slot that has started by `now` counts as
 * past too (availability can be up to a minute old). Slots merge when one ends where the next starts, within one
 * opening period (as `isRunOfFreeSlots` in selection.ts).
 */
export function buildCourtRanges(courts: { id: string; name: string }[], slots: Slot[], date: string, timeZone: string, now: Date): CourtRanges[] {
  const open = (s: Slot) => s.status === 'free' && Date.parse(s.slot_start) > now.getTime()
  return courts.map((court) => {
    const own = slots.filter((s) => s.court_id === court.id).sort((a, b) => Date.parse(a.slot_start) - Date.parse(b.slot_start))
    const runs: Slot[][] = []
    let run: Slot[] = []
    for (const slot of own) {
      const prev = run.at(-1)
      const joins = !!prev && open(slot) && Date.parse(prev.slot_end) === Date.parse(slot.slot_start)
        && (!prev.period_end || Date.parse(slot.slot_start) < Date.parse(prev.period_end))
      if (!joins && run.length) { runs.push(run); run = [] }
      if (open(slot)) run.push(slot)
    }
    if (run.length) runs.push(run)
    return {
      courtId: court.id,
      name: court.name,
      ranges: runs.map((r) => {
        const start = r[0].slot_start
        const end = r[r.length - 1].slot_end
        return { start, end, label: rangeLabel(start, end, r[r.length - 1].slot_start, date, timeZone) }
      }),
    }
  })
}

const courtLine = (c: CourtRanges) => (c.ranges.length ? c.ranges.map((r) => r.label).join(', ') : 'Fully booked')

type CaptionInput = { venueName: string; dateLabel: string; isToday: boolean; courts: CourtRanges[]; address: string }

export function buildCaption({ venueName, dateLabel, isToday, courts, address }: CaptionInput) {
  return [
    `Open slots ${isToday ? 'today' : 'tomorrow'} at ${venueName}, ${dateLabel}:`,
    ...courts.map((c) => `${c.name}: ${courtLine(c)}`),
    '',
    `Book at ${address}`,
  ].join('\n')
}

export const slotsImageFileName = (slug: string, date: string) => `${slug}-slots-${date}.png`

// Layout, in image pixels. The court rows fill the band between the header and the footer.
const PAD = 72
const ROWS_TOP = 400
const FOOTER_HEIGHT = 150
const ROW_GAP_RATIO = 0.14
export const ROWS_AREA_HEIGHT = SLOTS_IMAGE_HEIGHT - ROWS_TOP - FOOTER_HEIGHT - PAD + 22
export const MAX_ROW_HEIGHT = 120
export const MIN_ROW_HEIGHT = 56

/**
 * Every court gets a row: rows shrink from MAX to MIN_ROW_HEIGHT as courts are added. Past what fits at the minimum,
 * the last row's place goes to a "+N more courts" line, so the image never runs off the bottom.
 */
export function fitCourtRows(courtCount: number): { shown: number; hidden: number; rowHeight: number } {
  if (courtCount <= 0) return { shown: 0, hidden: 0, rowHeight: MAX_ROW_HEIGHT }
  const rowHeight = Math.min(MAX_ROW_HEIGHT, Math.floor(ROWS_AREA_HEIGHT / courtCount))
  if (rowHeight >= MIN_ROW_HEIGHT) return { shown: courtCount, hidden: 0, rowHeight }
  const shown = Math.max(1, Math.floor(ROWS_AREA_HEIGHT / MIN_ROW_HEIGHT) - 1)
  return { shown, hidden: courtCount - shown, rowHeight: MIN_ROW_HEIGHT }
}

type Palette = { bg: string; surface: string; text: string; accent: string; btn: string; btnText: string }

export type SlotsImageInput = {
  venueName: string
  logoUrl: string | null
  dateLabel: string
  isToday: boolean
  /** "10:30 AM" for today's picture, null for tomorrow's. */
  asOf: string | null
  courts: CourtRanges[]
  address: string
  palette: Palette
}

const CANNOT = "This browser can't make images."
const SERIF = "'Fraunces', Georgia, serif"
const SANS = "'DM Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"

/** Resolves with the loaded logo, or null when it can't load: a missing logo never fails the picture. */
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

/** Text cut with "…" to fit `width` at the current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text
  let cut = text
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

/** Largest font size from `max` down to `min` at which `text` fits `width`. */
function fontToFit(ctx: CanvasRenderingContext2D, text: string, width: number, max: number, min: number, font: (px: number) => string) {
  let size = max
  ctx.font = font(size)
  while (size > min && ctx.measureText(text).width > width) {
    size -= 2
    ctx.font = font(size)
  }
  return size
}

/** Labels laid out greedily in lines of at most `width`. */
function wrapLabels(ctx: CanvasRenderingContext2D, labels: string[], width: number) {
  const lines: string[] = []
  for (const label of labels) {
    const last = lines.at(-1)
    if (last !== undefined && ctx.measureText(`${last}, ${label}`).width <= width) lines[lines.length - 1] = `${last}, ${label}`
    else lines.push(label)
  }
  return lines
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
  ctx.closePath()
}

function draw(ctx: CanvasRenderingContext2D, input: SlotsImageInput, logo: HTMLImageElement | null) {
  const { palette: p, courts } = input
  const W = SLOTS_IMAGE_WIDTH
  const inner = W - PAD * 2
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.globalAlpha = 1
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, W, SLOTS_IMAGE_HEIGHT)

  // Header: logo and venue name.
  const LOGO = 112
  let nameX = PAD
  if (logo) {
    const scale = Math.min(LOGO / (logo.naturalWidth || logo.width), LOGO / (logo.naturalHeight || logo.height))
    const w = (logo.naturalWidth || logo.width) * scale
    const h = (logo.naturalHeight || logo.height) * scale
    ctx.save()
    roundedRect(ctx, PAD, PAD, LOGO, LOGO, 20)
    ctx.clip()
    ctx.fillStyle = p.surface
    ctx.fillRect(PAD, PAD, LOGO, LOGO)
    ctx.drawImage(logo, PAD + (LOGO - w) / 2, PAD + (LOGO - h) / 2, w, h)
    ctx.restore()
    nameX = PAD + LOGO + 28
  }
  ctx.fillStyle = p.text
  const nameWidth = W - PAD - nameX
  fontToFit(ctx, input.venueName, nameWidth, 52, 34, (px) => `600 ${px}px ${SERIF}`)
  ctx.fillText(fitText(ctx, input.venueName, nameWidth), nameX, PAD + LOGO / 2)

  // Headline and date.
  ctx.fillStyle = p.accent
  ctx.font = `700 84px ${SERIF}`
  ctx.fillText(`Open slots ${input.isToday ? 'today' : 'tomorrow'}`, PAD, 270)
  ctx.fillStyle = p.text
  ctx.font = `500 38px ${SANS}`
  const dateLine = input.isToday && input.asOf ? `${input.dateLabel} · as of ${input.asOf}` : input.dateLabel
  ctx.fillText(fitText(ctx, dateLine, inner), PAD, 345)

  // One row per court.
  const { shown, hidden, rowHeight } = fitCourtRows(courts.length)
  const gap = Math.round(rowHeight * ROW_GAP_RATIO)
  const box = rowHeight - gap
  const nameCol = Math.round(inner * 0.34)
  const textX = PAD + 28
  const rangeX = PAD + nameCol + 20
  const rangeWidth = W - PAD - 28 - rangeX
  const baseSize = Math.round(box * 0.4)
  courts.slice(0, shown).forEach((court, i) => {
    const y = ROWS_TOP + i * rowHeight
    ctx.globalAlpha = 1
    ctx.fillStyle = p.surface
    roundedRect(ctx, PAD, y, inner, box, Math.min(18, box / 3))
    ctx.fill()
    const mid = y + box / 2

    ctx.fillStyle = p.text
    ctx.font = `700 ${baseSize}px ${SANS}`
    ctx.fillText(fitText(ctx, court.name, nameCol - 28), textX, mid)

    if (court.ranges.length === 0) {
      ctx.globalAlpha = 0.6
      ctx.font = `500 ${baseSize}px ${SANS}`
      ctx.fillText('Fully booked', rangeX, mid)
      ctx.globalAlpha = 1
      return
    }
    // Shrink the ranges until their lines fit the row; at the smallest size the last line is cut with "…".
    const labels = court.ranges.map((r) => r.label)
    const minSize = Math.max(18, Math.round(baseSize * 0.6))
    let size = baseSize
    let lines: string[]
    for (;;) {
      ctx.font = `600 ${size}px ${SANS}`
      lines = wrapLabels(ctx, labels, rangeWidth)
      if (lines.length * size * 1.2 <= box - 8 || size <= minSize) break
      size -= 2
    }
    const maxLines = Math.max(1, Math.floor((box - 8) / (size * 1.2)))
    if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), fitText(ctx, `${lines.slice(maxLines - 1).join(', ')}`, rangeWidth)]
    ctx.fillStyle = p.accent
    const lineHeight = size * 1.2
    const top = mid - ((lines.length - 1) * lineHeight) / 2
    lines.forEach((line, n) => ctx.fillText(fitText(ctx, line, rangeWidth), rangeX, top + n * lineHeight))
  })
  if (hidden > 0) {
    ctx.fillStyle = p.text
    ctx.globalAlpha = 0.75
    ctx.font = `600 ${Math.round(box * 0.4)}px ${SANS}`
    ctx.fillText(`+${hidden} more court${hidden === 1 ? '' : 's'} at the booking link`, PAD + 28, ROWS_TOP + shown * rowHeight + box / 2)
    ctx.globalAlpha = 1
  }

  // Footer: where to book.
  const footerY = SLOTS_IMAGE_HEIGHT - PAD - 96
  ctx.fillStyle = p.btn
  roundedRect(ctx, PAD, footerY, inner, 96, 48)
  ctx.fill()
  ctx.fillStyle = p.btnText
  ctx.textAlign = 'center'
  const footer = `Book at ${input.address}`
  fontToFit(ctx, footer, inner - 64, 38, 22, (px) => `700 ${px}px ${SANS}`)
  ctx.fillText(fitText(ctx, footer, inner - 64), W / 2, footerY + 48)
  ctx.textAlign = 'left'
}

async function encode(input: SlotsImageInput, logo: HTMLImageElement | null): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = SLOTS_IMAGE_WIDTH
  canvas.height = SLOTS_IMAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error(CANNOT)
  draw(ctx, input, logo)
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (png?.type !== 'image/png') throw new Error(CANNOT)
  return png
}

/** The picture as PNG. Drawn after the web fonts load, so the text uses the venue page's fonts. */
export async function renderSlotsImage(input: SlotsImageInput): Promise<Blob> {
  await document.fonts.ready
  const logo = await loadLogo(input.logoUrl)
  try {
    return await encode(input, logo)
  } catch (error) {
    // A logo served without CORS headers taints the canvas, and toBlob then throws: draw it again without the logo.
    if (logo && !(error instanceof Error && error.message === CANNOT)) return encode(input, null)
    throw error
  }
}
