// The invoice PDF (T26.4), per the sample the user approved in T26.2 (RESEARCH "Milestone 26", SPEC §10): one A4 page,
// no charge list. Plain TypeScript with no Deno APIs (the fonts and logo are passed in), so Vitest checks it.
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib'
import { formatBillingMonth, formatInvoiceDate, formatPhp } from './invoiceFormat.ts'

export { formatPhp }

export type InvoicePdfAccount = { label: string; accountName: string; accountNumber: string; qr: { bytes: Uint8Array; kind: 'png' | 'jpg' } | null }
/** `amount` is negative for a credit. */
export type InvoicePdfItem = { description: string; quantity: number; rate: number; amount: number }
export type InvoicePdfData = {
  number: string
  status: 'draft' | 'sent' | 'paid'
  /** YYYY-MM-DD: `sent_at`, or today for a draft preview. */
  invoiceDate: string
  termsDays: number
  dueDate: string
  billingMonth: string
  venueName: string
  ownerName: string | null
  address: string
  items: InvoicePdfItem[]
  subTotal: number
  total: number
  /** 0 when paid. */
  balanceDue: number
  accounts: InvoicePdfAccount[]
  supportEmail: string
}
/** The three WOFF fonts and the logo PNG, bundled with the function. */
export type InvoicePdfAssets = { sansRegular: Uint8Array; sansBold: Uint8Array; display: Uint8Array; logo: Uint8Array }

const A4: [number, number] = [595.28, 841.89]
const MARGIN = 48
const INK = rgb(0.231, 0.184, 0.165) // #3b2f2a
const MUTED = rgb(0.42, 0.365, 0.333) // #6b5d55
const ROSE = rgb(0.851, 0.659, 0.639) // #d9a8a3
const TERRACOTTA = rgb(0.729, 0.373, 0.255) // #ba5f41
const CREAM = rgb(0.965, 0.945, 0.918) // #f6f1ea
const LINE = rgb(0.871, 0.839, 0.808)
const SAGE = rgb(0.298, 0.42, 0.235) // #4c6b3c

type Fonts = { regular: PDFFont; bold: PDFFont; display: PDFFont }

/** Splits text into lines that fit `width`, at most `maxLines`; the last kept line ends with an ellipsis if cut. */
function wrap(text: string, font: PDFFont, size: number, width: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (fits(next)) {
      line = next
      continue
    }
    if (line) lines.push(line)
    line = word
    while (!fits(line) && line.length > 1) {
      // A single word wider than the column: hard-break it.
      let cut = line.length - 1
      while (cut > 1 && !fits(line.slice(0, cut))) cut--
      lines.push(line.slice(0, cut))
      line = line.slice(cut)
    }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1)
  kept[maxLines - 1] = `${last.trimEnd()}…`
  return kept
}

function text(page: PDFPage, s: string, x: number, y: number, font: PDFFont, size: number, color = INK) {
  page.drawText(s, { x, y, font, size, color })
}
function right(page: PDFPage, s: string, xRight: number, y: number, font: PDFFont, size: number, color = INK) {
  page.drawText(s, { x: xRight - font.widthOfTextAtSize(s, size), y, font, size, color })
}

export async function buildInvoicePdf(data: InvoicePdfData, assets: InvoicePdfAssets): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(`Invoice ${data.number}`)
  doc.setAuthor('Plotline')
  doc.setCreator('Plotline')
  doc.setProducer('Plotline')
  const f: Fonts = {
    regular: await doc.embedFont(assets.sansRegular, { subset: true }),
    bold: await doc.embedFont(assets.sansBold, { subset: true }),
    display: await doc.embedFont(assets.display, { subset: true }),
  }
  const logo = await doc.embedPng(assets.logo)
  const qrs: (PDFImage | null)[] = []
  for (const a of data.accounts.slice(0, 5)) {
    qrs.push(a.qr ? await (a.qr.kind === 'png' ? doc.embedPng(a.qr.bytes) : doc.embedJpg(a.qr.bytes)) : null)
  }

  const page = doc.addPage(A4)
  const [W, H] = A4
  const left = MARGIN
  const rightX = W - MARGIN
  const contentW = rightX - left

  // Top strip and brand.
  page.drawRectangle({ x: 0, y: H - 10, width: W, height: 10, color: ROSE })
  let y = H - MARGIN - 4
  page.drawImage(logo, { x: left, y: y - 40, width: 40, height: 40 })
  text(page, 'plotline', left + 50, y - 26, f.display, 22)
  right(page, 'INVOICE', rightX, y - 22, f.display, 28)
  right(page, `# ${data.number}`, rightX, y - 40, f.regular, 10, MUTED)
  if (data.status === 'draft') right(page, 'DRAFT', rightX, y - 56, f.bold, 11, TERRACOTTA)
  if (data.status === 'paid') right(page, 'PAID', rightX, y - 56, f.bold, 11, SAGE)

  y -= 70
  text(page, 'Plotline', left, y, f.bold, 10)
  text(page, data.supportEmail, left, y - 14, f.regular, 10, MUTED)
  right(page, 'Balance Due', rightX, y, f.regular, 10, MUTED)
  right(page, formatPhp(data.balanceDue), rightX, y - 18, f.bold, 16, TERRACOTTA)

  // Bill To and dates.
  y -= 56
  const colW = contentW * 0.55
  text(page, 'Bill To', left, y, f.bold, 10, MUTED)
  let by = y - 16
  const billTo: [string, PDFFont, number, number, typeof INK][] = [
    ...wrap(data.venueName, f.bold, 11, colW, 2).map((l): [string, PDFFont, number, number, typeof INK] => [l, f.bold, 11, 14, INK]),
    ...(data.ownerName?.trim() ? wrap(data.ownerName, f.regular, 10, colW, 1) : []).map((l): [string, PDFFont, number, number, typeof INK] => [l, f.regular, 10, 13, INK]),
    ...(data.address.trim() ? wrap(data.address, f.regular, 10, colW, 3) : []).map((l): [string, PDFFont, number, number, typeof INK] => [l, f.regular, 10, 13, MUTED]),
  ]
  for (const [l, font, size, step, color] of billTo) {
    text(page, l, left, by, font, size, color)
    by -= step
  }

  const dates: [string, string][] = [
    ['Invoice Date', formatInvoiceDate(data.invoiceDate)],
    ['Terms', `Due in ${data.termsDays} days`],
    ['Due Date', formatInvoiceDate(data.dueDate)],
    ['Billing Month', formatBillingMonth(data.billingMonth)],
  ]
  let dy = y
  for (const [k, v] of dates) {
    right(page, `${k}:`, rightX - 110, dy, f.regular, 10, MUTED)
    right(page, v, rightX, dy, f.regular, 10)
    dy -= 15
  }
  y = Math.min(by, dy) - 20

  // Items.
  const cols = { qty: rightX - 190, rate: rightX - 95, amount: rightX }
  page.drawRectangle({ x: left, y: y - 6, width: contentW, height: 22, color: CREAM })
  text(page, 'Item', left + 8, y, f.bold, 10)
  right(page, 'Qty', cols.qty, y, f.bold, 10)
  right(page, 'Rate', cols.rate, y, f.bold, 10)
  right(page, 'Amount', cols.amount - 8, y, f.bold, 10)
  y -= 26
  const descW = cols.qty - 60 - (left + 8)
  for (const item of data.items.slice(0, 8)) {
    const lines = wrap(item.description, f.regular, 10, descW, 2)
    lines.forEach((l, i) => text(page, l, left + 8, y - i * 13, f.regular, 10))
    right(page, String(item.quantity), cols.qty, y, f.regular, 10)
    right(page, formatPhp(item.rate), cols.rate, y, f.regular, 10)
    right(page, formatPhp(item.amount), cols.amount - 8, y, f.regular, 10)
    y -= lines.length * 13 + 8
    page.drawLine({ start: { x: left, y: y + 4 }, end: { x: rightX, y: y + 4 }, thickness: 0.5, color: LINE })
    y -= 6
  }

  // Totals.
  y -= 4
  const totals: [string, string, PDFFont][] = [
    ['Sub Total', formatPhp(data.subTotal), f.regular],
    ['Total', formatPhp(data.total), f.bold],
  ]
  for (const [k, v, font] of totals) {
    right(page, k, rightX - 110, y, font, 10)
    right(page, v, rightX - 8, y, font, 10)
    y -= 16
  }
  y -= 8
  page.drawRectangle({ x: rightX - 220, y: y - 6, width: 220, height: 22, color: CREAM })
  right(page, 'Balance Due', rightX - 110, y, f.bold, 10)
  right(page, formatPhp(data.balanceDue), rightX - 8, y, f.bold, 10)
  y -= 34

  // Notes.
  text(page, 'Notes', left, y, f.bold, 10, MUTED)
  text(page, 'Thanks for your business.', left, y - 14, f.regular, 10)
  y -= 40

  // How to pay: every account (at most 5, T26.3) in one row, each with its QR, so the page never overflows.
  const accounts = data.accounts.slice(0, 5)
  if (accounts.length) {
    const cellW = (contentW - 24) / accounts.length
    const qrSize = Math.min(80, cellW - 12)
    const cellH = qrSize + 52
    const boxH = 34 + cellH + 24
    page.drawRectangle({ x: left, y: y - boxH, width: contentW, height: boxH, borderColor: LINE, borderWidth: 1, color: rgb(1, 1, 1) })
    text(page, 'How to pay', left + 12, y - 20, f.bold, 11)
    accounts.forEach((a, i) => {
      const cx = left + 12 + i * cellW
      const top = y - 34
      const qr = qrs[i]
      if (qr) page.drawImage(qr, { x: cx, y: top - qrSize, width: qrSize, height: qrSize })
      else page.drawRectangle({ x: cx, y: top - qrSize, width: qrSize, height: qrSize, color: CREAM })
      const w = cellW - 12
      text(page, wrap(a.label, f.bold, 10, w, 1)[0] ?? '', cx, top - qrSize - 16, f.bold, 10)
      text(page, wrap(a.accountName, f.regular, 9, w, 1)[0] ?? '', cx, top - qrSize - 30, f.regular, 9)
      text(page, wrap(a.accountNumber, f.regular, 9, w, 1)[0] ?? '', cx, top - qrSize - 43, f.regular, 9)
    })
    text(page, `Use ${data.number} as the reference`, left + 12, y - boxH + 12, f.regular, 9, MUTED)
  }

  // Footer.
  page.drawLine({ start: { x: left, y: MARGIN + 14 }, end: { x: rightX, y: MARGIN + 14 }, thickness: 0.5, color: LINE })
  text(page, 'Statement of amounts; not a tax invoice.', left, MARGIN, f.regular, 8, MUTED)
  right(page, 'Page 1 of 1', rightX, MARGIN, f.regular, 8, MUTED)

  return await doc.save()
}
