import { describe, expect, it } from 'vitest'
import { invoiceEmail, invoiceLinks, type InvoiceEmailInput } from './invoiceEmail.ts'

const ID = '3f2b8c1e-9d4a-4c55-8a1b-0123456789ab'
const input: InvoiceEmailInput = {
  number: 'CLAUDEX-COURTS-202610',
  status: 'draft',
  recipientName: 'Maria Santos',
  amount: 1234.5,
  invoiceDate: '2026-11-03',
  dueDate: '2026-11-10',
  viewUrl: `https://claudex-courts.plotline.fit/admin/reports?invoice=${ID}`,
  logoUrl: 'https://claudex-courts.plotline.fit/brand/plotline-logo.png',
  supportEmail: 'support@plotline.fit',
}
const INTRO =
  'Thank you for your business. Your invoice is attached as a PDF, and you can view it any time from the link below. Pay by GCash or bank transfer using the details in the invoice.'

describe('invoiceLinks', () => {
  it('builds the view and logo URLs from the base', () => {
    expect(invoiceLinks('https://claudex-courts.plotline.fit', 'claudex-courts', ID)).toEqual({
      viewUrl: `https://claudex-courts.plotline.fit/admin/reports?invoice=${ID}`,
      logoUrl: 'https://claudex-courts.plotline.fit/brand/plotline-logo.png',
    })
  })
  it('tolerates a trailing slash on the base', () => {
    expect(invoiceLinks('https://claudex-courts.plotline.fit/', 'claudex-courts', ID)).toEqual({
      viewUrl: `https://claudex-courts.plotline.fit/admin/reports?invoice=${ID}`,
      logoUrl: 'https://claudex-courts.plotline.fit/brand/plotline-logo.png',
    })
  })
})

describe('invoiceEmail', () => {
  it('has the subject Invoice <number> from Plotline', () => {
    expect(invoiceEmail(input).subject).toBe('Invoice CLAUDEX-COURTS-202610 from Plotline')
  })

  describe.each(['html', 'text'] as const)('%s body', (kind) => {
    const body = invoiceEmail(input)[kind]
    it.each([
      ['title', 'Invoice CLAUDEX-COURTS-202610'],
      ['greeting', 'Dear Maria Santos,'],
      ['intro', INTRO],
      ['amount label', 'INVOICE AMOUNT'],
      ['amount', 'PHP 1,234.50'],
      ['view link label', 'VIEW INVOICE'],
      ['sign-off', 'Regards,'],
      ['team', 'The Plotline team'],
      ['support email', 'support@plotline.fit'],
      ['view url', input.viewUrl],
    ])('contains the %s', (_n, s) => {
      expect(body).toContain(s)
    })
    it('shows the invoice and due dates readably', () => {
      expect(body).toMatch(/Nov/)
      expect(body).toContain('2026')
      expect(body).toMatch(/\b3\b|\b03\b/)
      expect(body).toMatch(/\b10\b/)
    })
    it('never mentions Zoho or paying online', () => {
      expect(body).not.toMatch(/zoho/i)
      expect(body).not.toMatch(/pay online/i)
    })
  })

  it('html has the logo image with a non-empty alt', () => {
    const { html } = invoiceEmail(input)
    const img = html.match(/<img\b[^>]*>/i)?.[0] ?? ''
    expect(img).toContain(`src="${input.logoUrl}"`)
    expect(img).toMatch(/alt="[^"]+"/)
  })
  it('html links VIEW INVOICE to the view url', () => {
    const { html } = invoiceEmail(input)
    expect(html).toMatch(new RegExp(`<a\\b[^>]*href="${input.viewUrl.replace(/[?.]/g, '\\$&')}"[^>]*>[\\s\\S]*?VIEW INVOICE`, 'i'))
  })
  it('html escapes the recipient name', () => {
    const { html } = invoiceEmail({ ...input, recipientName: '<b>&"' })
    expect(html).not.toContain('<b>&"')
    expect(html).toContain('Dear &lt;b&gt;&amp;&quot;,')
  })
  it('text has no HTML tags', () => {
    expect(invoiceEmail(input).text).not.toMatch(/<[a-z/][^>]*>/i)
  })
  it('works for a sent invoice (resend)', () => {
    const r = invoiceEmail({ ...input, status: 'sent' })
    expect(r.subject).toBe('Invoice CLAUDEX-COURTS-202610 from Plotline')
    expect(r.text).toContain(input.viewUrl)
  })
})
