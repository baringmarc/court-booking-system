// @vitest-environment node
// Builder's edge cases for T26.4: the fullest invoice keeps every line above the footer and inside the page.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import sansRegularUrl from '../invoice-pdf/assets/dm-sans-latin-400-normal.woff?inline'
import sansBoldUrl from '../invoice-pdf/assets/dm-sans-latin-700-normal.woff?inline'
import displayUrl from '../invoice-pdf/assets/fraunces-latin-600-normal.woff?inline'
import logoUrl from '../invoice-pdf/assets/logo.png?inline'
import { buildInvoicePdf, type InvoicePdfData } from './invoicePdf.ts'

const bytesOf = (url: string) => Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), (c) => c.charCodeAt(0))
const assets = { sansRegular: bytesOf(sansRegularUrl), sansBold: bytesOf(sansBoldUrl), display: bytesOf(displayUrl), logo: bytesOf(logoUrl) }

const long = (s: string) => s.repeat(4)
const fullest: InvoicePdfData = {
  number: 'A-VERY-LONG-VENUE-SLUG-NAME-1234567890-202610',
  status: 'paid',
  invoiceDate: '2026-11-03',
  termsDays: 90,
  dueDate: '2027-02-01',
  billingMonth: '2026-10-01',
  venueName: long('The Extraordinarily Long Named Badminton Courts '),
  ownerName: long('Maria Concepcion Santos Dela Cruz '),
  address: long('Unit 1204, Building Name That Goes On, Some Very Long Street, Barangay, City, Province '),
  items: Array.from({ length: 8 }, (_, i) => ({ description: long(`Booking fees at rate ${i} `), quantity: 1000 + i, rate: 9999.99, amount: 999999.99 })),
  subTotal: 7999999.92,
  total: 7999999.92,
  balanceDue: 0,
  accounts: Array.from({ length: 5 }, (_, i) => ({
    label: long(`Account ${i} `),
    accountName: long('Plotline Incorporated '),
    accountNumber: '0917 123 4567 8901 2345 6789',
    qr: null,
  })),
  supportEmail: 'support@plotline.fit',
}

describe('buildInvoicePdf layout', () => {
  it('keeps the fullest invoice on one page, every line inside the page and above the footer rule', async () => {
    const doc = await pdfjs.getDocument({ data: await buildInvoicePdf(fullest, assets), useSystemFonts: true }).promise
    expect(doc.numPages).toBe(1)
    const page = await doc.getPage(1)
    const { width, height } = page.getViewport({ scale: 1 })
    const items = (await page.getTextContent()).items.flatMap((it) => ('str' in it && it.str.trim() ? [it] : []))
    const footer = new Set(['Statement of amounts; not a tax invoice.', 'Page 1 of 1'])
    for (const it of items) {
      const [x, y] = [it.transform[4], it.transform[5]]
      expect(x, it.str).toBeGreaterThanOrEqual(40)
      expect(x + it.width, it.str).toBeLessThanOrEqual(width - 40)
      expect(y, it.str).toBeLessThanOrEqual(height - 40)
      if (!footer.has(it.str)) expect(y, it.str).toBeGreaterThan(62)
    }
  })
})
