// The invoice email (T26.4, SPEC §8): HTML and plain text, sent by the invoice-pdf Edge Function with the PDF attached.
// Plain TypeScript with no Deno APIs, so Vitest and tsc check it with the app.
import { BUTTON_STYLE, escapeHtml } from './emailTemplates.ts'
import { formatInvoiceDate, formatPhp } from './invoiceFormat.ts'

export type InvoiceEmailInput = {
  number: string
  status: 'draft' | 'sent'
  /** The owner's full name, else the venue name. */
  recipientName: string
  amount: number
  invoiceDate: string
  dueDate: string
  viewUrl: string
  logoUrl: string
  supportEmail: string
}

/** Links built only from the venue's own site base (`venueSiteBase`), never a client value. */
export function invoiceLinks(siteBase: string, _slug: string, invoiceId: string): { viewUrl: string; logoUrl: string } {
  const base = siteBase.replace(/\/+$/, '')
  return {
    viewUrl: `${base}/admin/reports?invoice=${encodeURIComponent(invoiceId)}`,
    logoUrl: `${base}/brand/plotline-logo.png`,
  }
}

const INTRO =
  'Thank you for your business. Your invoice is attached as a PDF, and you can view it any time from the link below. Pay by GCash or bank transfer using the details in the invoice.'

export function invoiceEmail(input: InvoiceEmailInput): { subject: string; html: string; text: string } {
  const e = escapeHtml
  const amount = formatPhp(input.amount)
  const invoiceDate = formatInvoiceDate(input.invoiceDate)
  const dueDate = formatInvoiceDate(input.dueDate)
  const rows: [string, string][] = [
    ['Invoice number', input.number],
    ['Invoice date', invoiceDate],
    ['Due date', dueDate],
  ]

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f1ea;font-family:Arial,Helvetica,sans-serif;color:#3b2f2a">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px"><img src="${e(input.logoUrl)}" alt="Plotline" width="48" height="48" style="display:block;border:0"></p>
<h1 style="font-size:22px;margin:0 0 16px">Invoice ${e(input.number)}</h1>
<p>Dear ${e(input.recipientName)},</p>
<p>${e(INTRO)}</p>
<div style="background:#f6f1ea;border-radius:10px;padding:16px;margin:20px 0;text-align:center">
<p style="margin:0;font-size:12px;letter-spacing:1px;font-weight:700">INVOICE AMOUNT</p>
<p style="margin:6px 0 12px;font-size:24px;font-weight:700">${e(amount)}</p>
<table role="presentation" style="margin:0 auto;font-size:14px;text-align:left">
${rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0">${e(k)}</td><td style="padding:2px 0;font-weight:700">${e(v)}</td></tr>`).join('\n')}
</table>
<p style="margin:16px 0 0"><a href="${e(input.viewUrl)}" style="${BUTTON_STYLE}">VIEW INVOICE</a></p>
</div>
<p>Regards,<br>The Plotline team</p>
<p style="font-size:13px;color:#6b5d55">Questions? Reply to this email or write to <a href="mailto:${e(input.supportEmail)}">${e(input.supportEmail)}</a>.</p>
</div>
</body></html>`

  const text = [
    `Invoice ${input.number}`,
    '',
    `Dear ${input.recipientName},`,
    '',
    INTRO,
    '',
    `INVOICE AMOUNT: ${amount}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
    '',
    `VIEW INVOICE: ${input.viewUrl}`,
    '',
    'Regards,',
    'The Plotline team',
    '',
    `Questions? Reply to this email or write to ${input.supportEmail}.`,
  ].join('\n')

  return { subject: `Invoice ${input.number} from Plotline`, html, text }
}
