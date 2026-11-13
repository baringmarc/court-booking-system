// @vitest-environment node
import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import sansRegularUrl from '../invoice-pdf/assets/dm-sans-latin-400-normal.woff?inline'
import sansBoldUrl from '../invoice-pdf/assets/dm-sans-latin-700-normal.woff?inline'
import displayUrl from '../invoice-pdf/assets/fraunces-latin-600-normal.woff?inline'
import logoUrl from '../invoice-pdf/assets/logo.png?inline'
import {
  buildInvoicePdf,
  formatPhp,
  type InvoicePdfAssets,
  type InvoicePdfData,
} from './invoicePdf.ts'

// `?inline` gives a base64 data URL, so no Node types are needed to read the binary assets.
const fromDataUrl = (url: string) => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0))
const assets: InvoicePdfAssets = {
  sansRegular: fromDataUrl(sansRegularUrl),
  sansBold: fromDataUrl(sansBoldUrl),
  display: fromDataUrl(displayUrl),
  logo: fromDataUrl(logoUrl),
}

/** zlib stream made of stored (uncompressed) blocks: valid, and needs no compressor. */
function zlibStored(raw: Uint8Array): Uint8Array {
  let a = 1
  let b = 0
  for (const x of raw) {
    a = (a + x) % 65521
    b = (b + a) % 65521
  }
  const out = new Uint8Array(2 + 5 + raw.length + 4)
  out.set([0x78, 0x01, 0x01, raw.length & 255, raw.length >> 8, ~raw.length & 255, (~raw.length >> 8) & 255], 0)
  out.set(raw, 7)
  new DataView(out.buffer).setUint32(7 + raw.length, ((b << 16) | a) >>> 0)
  return out
}

function crc32(buf: Uint8Array): number {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}
/** A valid 8x8 opaque RGB PNG. */
function tinyPng(): Uint8Array {
  const w = 8
  const raw = new Uint8Array((1 + w * 3) * w)
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) raw.set([(x + y) % 2 ? 0 : 255, 0, 0], y * (1 + w * 3) + 1 + x * 3)
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, w)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const data: InvoicePdfData = {
  number: 'CLAUDEX-COURTS-202610',
  status: 'sent',
  invoiceDate: '2026-11-03',
  termsDays: 7,
  dueDate: '2026-11-10',
  billingMonth: '2026-10-01',
  venueName: 'Claudex Courts',
  ownerName: 'Maria Santos',
  address: '12 Rizal Avenue, Quezon City',
  items: [{ description: 'Booking fees, October 2026 (61 bookings)', quantity: 61, rate: 10, amount: 610 }],
  subTotal: 610,
  total: 610,
  balanceDue: 610,
  accounts: [
    { label: 'GCash', accountName: 'Plotline Inc', accountNumber: '0917 123 4567', qr: null },
    { label: 'BDO Savings', accountName: 'Plotline Inc', accountNumber: '0011 2233 4455', qr: null },
  ],
  supportEmail: 'support@plotline.fit',
}

async function textOf(bytes: Uint8Array): Promise<{ pages: number; text: string }> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise
  const parts: string[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent()
    for (const it of tc.items) if ('str' in it) parts.push(it.str)
  }
  return { pages: doc.numPages, text: parts.join(' ') }
}
/** Whitespace-insensitive containment, so item splitting in the extractor does not matter. */
const squash = (s: string) => s.replace(/\s+/g, '')
const has = (text: string, s: string) => squash(text).includes(squash(s))
const render = async (over: Partial<InvoicePdfData> = {}) => {
  const bytes = await buildInvoicePdf({ ...data, ...over }, assets)
  return { bytes, ...(await textOf(bytes)) }
}

describe('formatPhp', () => {
  it.each([
    [0, 'PHP 0.00'],
    [1234.5, 'PHP 1,234.50'],
    [-10, '-PHP 10.00'],
    [1000000, 'PHP 1,000,000.00'],
    [10, 'PHP 10.00'],
  ])('formats %d as %s', (n, s) => {
    expect(formatPhp(n)).toBe(s)
  })
})

describe('buildInvoicePdf', () => {
  it('produces a parseable one-page PDF', async () => {
    const { bytes } = await render()
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe('%PDF-')
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })

  it('stays on one page with a folded fee row, a credit and two accounts with QR images', async () => {
    const png = tinyPng()
    const { bytes, pages } = await render({
      items: [
        { description: 'Booking fees, October 2026 (61 bookings)', quantity: 61, rate: 10, amount: 610 },
        { description: 'Credit for refunded booking', quantity: 1, rate: -10, amount: -10 },
      ],
      subTotal: 600,
      total: 600,
      balanceDue: 600,
      accounts: [
        { ...data.accounts[0], qr: { bytes: png, kind: 'png' } },
        { ...data.accounts[1], qr: { bytes: png, kind: 'png' } },
      ],
    })
    expect(pages).toBe(1)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })

  it('shows the document fields', async () => {
    const { text } = await render()
    for (const s of [
      'INVOICE',
      'CLAUDEX-COURTS-202610',
      'Plotline',
      'support@plotline.fit',
      'Balance Due',
      'PHP 610.00',
      'Bill To',
      'Claudex Courts',
      'Maria Santos',
      '12 Rizal Avenue, Quezon City',
      'Invoice Date',
      'Terms',
      'Due in 7 days',
      'Due Date',
      'Sub Total',
      'Total',
      'Thanks for your business.',
      'Statement of amounts; not a tax invoice.',
    ])
      expect(has(text, s), s).toBe(true)
  })

  it('shows the item with quantity, rate and amount', async () => {
    const { text } = await render()
    expect(has(text, 'Booking fees, October 2026 (61 bookings)')).toBe(true)
    expect(has(text, '61')).toBe(true)
    expect(has(text, 'PHP 10.00')).toBe(true)
    expect(has(text, 'PHP 610.00')).toBe(true)
  })

  it('shows a credit as a negative amount', async () => {
    const { text } = await render({
      items: [
        ...data.items,
        { description: 'Credit for refunded booking', quantity: 1, rate: -10, amount: -10 },
      ],
      subTotal: 600,
      total: 600,
      balanceDue: 600,
    })
    expect(has(text, 'Credit for refunded booking')).toBe(true)
    expect(has(text, '-PHP 10.00')).toBe(true)
    expect(has(text, 'PHP 600.00')).toBe(true)
  })

  it('uses termsDays in the terms', async () => {
    const { text } = await render({ termsDays: 15 })
    expect(has(text, 'Due in 15 days')).toBe(true)
    expect(has(text, 'Due in 7 days')).toBe(false)
  })

  it('shows dates readably, not as raw ISO', async () => {
    const { text } = await render()
    expect(text).toMatch(/Nov/)
    expect(text).toContain('2026')
    expect(has(text, '2026-11-03')).toBe(false)
    expect(has(text, '2026-11-10')).toBe(false)
  })

  it('shows each account label, name and number, and the reference line', async () => {
    const { text } = await render()
    for (const s of ['GCash', 'BDO Savings', 'Plotline Inc', '0917 123 4567', '0011 2233 4455'])
      expect(has(text, s), s).toBe(true)
    expect(has(text, 'Use CLAUDEX-COURTS-202610 as the reference')).toBe(true)
  })

  it('shows a page number', async () => {
    const { text } = await render()
    expect(squash(text)).toMatch(/Page1of1|1\/1/)
  })

  it('never mentions Zoho or paying online', async () => {
    const { text } = await render()
    expect(text).not.toMatch(/zoho/i)
    expect(text).not.toMatch(/pay online/i)
  })

  it('builds when the owner is null and the address is empty', async () => {
    const { text, pages } = await render({ ownerName: null, address: '' })
    expect(pages).toBe(1)
    expect(has(text, 'Claudex Courts')).toBe(true)
    expect(has(text, 'Bill To')).toBe(true)
  })

  it('draft shows DRAFT and not PAID', async () => {
    const { text } = await render({ status: 'draft' })
    expect(text).toContain('DRAFT')
    expect(text).not.toContain('PAID')
  })
  it('sent shows neither DRAFT nor PAID', async () => {
    const { text } = await render({ status: 'sent' })
    expect(text).not.toContain('DRAFT')
    expect(text).not.toContain('PAID')
  })
  it('paid shows PAID and a zero balance due', async () => {
    const { text } = await render({ status: 'paid', balanceDue: 0 })
    expect(text).toContain('PAID')
    expect(text).not.toContain('DRAFT')
    expect(has(text, 'PHP 0.00')).toBe(true)
  })

  it('still builds without accounts, and shows no payment reference line', async () => {
    const { text, pages } = await render({ status: 'draft', accounts: [] })
    expect(pages).toBe(1)
    expect(has(text, 'as the reference')).toBe(false)
  })

  it('builds with a very long venue name and address', async () => {
    const { bytes, pages } = await render({
      venueName: 'The Extraordinarily Long Named Badminton and Pickleball Courts of Greater Metro Manila '.repeat(3),
      address: 'Unit 1204, Building Name That Goes On And On, Some Very Long Street Name, Barangay Something, City, Province '.repeat(3),
    })
    expect(pages).toBe(1)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
})
