// POST JSON { invoice_id, action: 'pdf' | 'send' } (T26.4, SPEC §6). verify_jwt on; the caller's session decides.
//   pdf:  returns the invoice PDF. Platform admins get any invoice; a venue admin (a venue_members row) only a sent or
//         paid invoice of their own venue (drafts are not issued).
//   send: platform admins only. Emails every owner of the venue in one message with the PDF attached. A draft is
//         marked sent (mark_invoice_sent, as the caller) only after the email is accepted; a sent invoice is resent
//         without a status change; a paid one is refused. Every accepted email logs an invoice_sends row.
// Reads use the service role after the function's own checks (invoiceAccess). Nothing secret is logged or returned.
import { withSupabase } from 'npm:@supabase/server@1'
import * as Sentry from 'npm:@sentry/deno@10.76.2'
import { callerUserId } from '../_shared/payable.ts'
import { emailTransport, fromFor, sendEmail } from '../_shared/email.ts'
import { OWNER_SUPPORT_EMAIL, inviteRedirectTo } from '../_shared/ownerInvite.ts'
import { invoiceAccess, parseInvoiceBody, type InvoiceStatus } from '../_shared/invoiceRequest.ts'
import { imageKind, invoicePdfData, recipientName } from '../_shared/invoiceData.ts'
import { buildInvoicePdf, type InvoicePdfAccount, type InvoicePdfAssets } from '../_shared/invoicePdf.ts'
import { invoiceEmail, invoiceLinks } from '../_shared/invoiceEmail.ts'
import { withSentry } from '../_shared/sentry.ts'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const serverError = () => json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, 500)

let assetsPromise: Promise<InvoicePdfAssets> | null = null
const asset = (name: string) => Deno.readFile(new URL(`./assets/${name}`, import.meta.url))
function loadAssets(): Promise<InvoicePdfAssets> {
  assetsPromise ??= Promise.all([
    asset('dm-sans-latin-400-normal.woff'),
    asset('dm-sans-latin-700-normal.woff'),
    asset('fraunces-latin-600-normal.woff'),
    asset('logo.png'),
  ]).then(([sansRegular, sansBold, display, logo]) => ({ sansRegular, sansBold, display, logo }))
  assetsPromise.catch(() => (assetsPromise = null))
  return assetsPromise
}

const CHARGE_PAGE = 1000

type Charge = { kind: string; amount: number }
type ChargePage = { data: Charge[] | null; error: { message: string } | null }

/**
 * Every charge of the invoice, read in pages: PostgREST caps a response at `max_rows` (1000), and a short read would
 * print a wrong total.
 */
async function allCharges(page: (from: number, to: number) => PromiseLike<ChargePage>): Promise<ChargePage> {
  const rows: Charge[] = []
  for (let from = 0; ; from += CHARGE_PAGE) {
    const { data, error } = await page(from, from + CHARGE_PAGE - 1)
    if (error) return { data: null, error }
    rows.push(...(data ?? []))
    if (!data || data.length < CHARGE_PAGE) return { data: rows, error: null }
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export default {
  fetch: withSupabase({ auth: ['user'] }, withSentry('invoice-pdf', async (req, ctx) => {
    if (req.method !== 'POST') return json({ code: 'method_not_allowed', message: 'Use POST.' }, 405)
    const callerId = callerUserId(ctx)
    if (!callerId) return json({ code: 'forbidden', message: 'Sign in first.' }, 403)

    const parsed = parseInvoiceBody(await req.json().catch(() => null))
    if (!parsed.ok) return json({ code: 'invalid_input', message: 'Send an invoice and an action.' }, 400)
    const admin = ctx.supabaseAdmin

    const { data: invoice, error: invoiceError } = await admin
      .from('invoices').select('id, venue_id, billing_month, status, sent_at').eq('id', parsed.invoiceId).maybeSingle()
    if (invoiceError) {
      console.error('invoice-pdf: invoice lookup failed', invoiceError.message)
      return serverError()
    }

    const [platformAdmin, membership] = await Promise.all([
      admin.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle(),
      invoice
        ? admin.from('venue_members').select('role').eq('venue_id', invoice.venue_id).eq('user_id', callerId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])
    if (platformAdmin.error || membership.error) {
      console.error('invoice-pdf: role lookup failed', platformAdmin.error?.message ?? membership.error?.message)
      return serverError()
    }
    const isPlatformAdmin = !!platformAdmin.data
    // An unknown invoice looks the same as someone else's to anyone but a platform admin.
    if (!invoice) {
      return isPlatformAdmin
        ? json({ code: 'not_found', message: 'Invoice not found.' }, 404)
        : json({ code: 'forbidden', message: "You can't open this invoice." }, 403)
    }
    const status = invoice.status as InvoiceStatus

    const [venue, settings, pricing, owners, accounts, charges] = await Promise.all([
      admin.from('venues').select('slug').eq('id', invoice.venue_id).single(),
      admin.from('venue_settings').select('name, address, timezone').eq('venue_id', invoice.venue_id).single(),
      admin.from('platform_pricing').select('invoice_grace_days').single(),
      admin.from('venue_members').select('user_id').eq('venue_id', invoice.venue_id).eq('role', 'owner'),
      admin.from('platform_payment_accounts').select('label, account_name, account_number, qr_path').order('position'),
      allCharges((from, to) =>
        admin.from('billing_charges').select('kind, amount').eq('invoice_id', invoice.id).order('id').range(from, to)),
    ])
    const failed = [venue, settings, pricing, owners, accounts, charges].find((r) => r.error)
    if (failed) {
      console.error('invoice-pdf: read failed', failed.error?.message)
      return serverError()
    }
    const ownerIds = (owners.data ?? []).map((o) => o.user_id)

    const access = invoiceAccess({
      action: parsed.action,
      isPlatformAdmin,
      isVenueAdmin: !!membership.data,
      status,
      accountCount: accounts.data?.length ?? 0,
      ownerCount: ownerIds.length,
    })
    if (!access.ok) return json({ code: access.code, message: access.message }, access.status)

    const { data: profiles, error: profileError } = ownerIds.length
      ? await admin.from('profiles').select('id, full_name').in('id', ownerIds)
      : { data: [], error: null }
    if (profileError) {
      console.error('invoice-pdf: profile lookup failed', profileError.message)
      return serverError()
    }
    const ownerNames = ownerIds.map((id) => profiles?.find((p) => p.id === id)?.full_name ?? null)

    const pdfAccounts: InvoicePdfAccount[] = []
    for (const a of accounts.data ?? []) {
      let qr: InvoicePdfAccount['qr'] = null
      if (a.qr_path) {
        const file = await admin.storage.from('platform-billing').download(a.qr_path)
        const bytes = file.data ? new Uint8Array(await file.data.arrayBuffer()) : null
        const kind = bytes ? imageKind(bytes) : null
        if (bytes && kind) qr = { bytes, kind }
        else console.error('invoice-pdf: QR image unavailable', file.error?.message ?? 'not PNG or JPEG')
      }
      pdfAccounts.push({ label: a.label, accountName: a.account_name, accountNumber: a.account_number, qr })
    }

    const data = invoicePdfData({
      invoice: { billing_month: invoice.billing_month, status, sent_at: invoice.sent_at },
      slug: venue.data!.slug,
      venueName: settings.data!.name,
      address: settings.data!.address,
      timezone: settings.data!.timezone,
      graceDays: pricing.data!.invoice_grace_days,
      charges: charges.data ?? [],
      ownerNames,
      accounts: pdfAccounts,
      supportEmail: OWNER_SUPPORT_EMAIL,
      now: new Date(),
    })

    if (parsed.action === 'pdf') {
      const pdf = await buildInvoicePdf(data, await loadAssets())
      return new Response(pdf, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `inline; filename="${data.number}.pdf"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    // send: the invoice is issued today when it is a draft, so the PDF and email carry the sent date.
    const kind = status === 'draft' ? 'send' : 'resend'
    const issued = { ...data, status: status === 'draft' ? ('sent' as const) : data.status }

    const emails: string[] = []
    for (const id of ownerIds) {
      const found = await admin.auth.admin.getUserById(id)
      const email = found.data.user?.email?.trim().toLowerCase()
      if (found.error) console.error('invoice-pdf: owner lookup failed', found.error.message)
      if (email && !emails.includes(email)) emails.push(email)
    }
    if (!emails.length) return json({ code: 'no_recipients', message: 'This venue has no owner to send the invoice to.' }, 409)

    const siteBase = inviteRedirectTo({
      slug: venue.data!.slug, origin: null, rootDomain: Deno.env.get('PUBLIC_ROOT_DOMAIN'), allowList: Deno.env.get('PUBLIC_SITE_URL'),
    })?.replace(/\/admin$/, '')
    if (!siteBase) return json({ code: 'site_unavailable', message: 'No site URL is configured.' }, 503)

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const mailpitUrl = Deno.env.get('MAILPIT_URL')
    const transport = emailTransport({ transport: Deno.env.get('EMAIL_TRANSPORT'), resendKey, mailpitUrl, supabaseUrl: Deno.env.get('SUPABASE_URL') })
    if (transport !== 'resend' && transport !== 'mailpit') {
      console.error('invoice-pdf: email transport is', transport)
      return json({ code: 'email_unavailable', message: 'Email sending is not configured.' }, 503)
    }

    const { count: priorSends, error: countError } = await admin
      .from('invoice_sends').select('id', { count: 'exact', head: true }).eq('invoice_id', invoice.id)
    if (countError) {
      console.error('invoice-pdf: send count failed', countError.message)
      return serverError()
    }

    const pdf = await buildInvoicePdf(issued, await loadAssets())
    const links = invoiceLinks(siteBase, venue.data!.slug, invoice.id)
    const mail = invoiceEmail({
      number: data.number,
      status: 'sent',
      recipientName: recipientName(ownerNames, settings.data!.name),
      amount: data.total,
      invoiceDate: issued.invoiceDate,
      dueDate: issued.dueDate,
      viewUrl: links.viewUrl,
      logoUrl: links.logoUrl,
      supportEmail: OWNER_SUPPORT_EMAIL,
    })
    // Keyed by the send count, so a double click or a retry of the same send can't email twice through Resend.
    const sent = await sendEmail(
      fetch,
      transport,
      { from: fromFor('Plotline', Deno.env.get('EMAIL_FROM')), resendKey, mailpitUrl },
      {
        to: emails,
        ...mail,
        replyTo: OWNER_SUPPORT_EMAIL,
        attachments: [{ filename: `${data.number}.pdf`, contentBase64: encodeBase64(pdf), contentType: 'application/pdf' }],
      },
      `invoice-${invoice.id}-${priorSends ?? 0}`,
    )
    if (!sent.ok) {
      console.error('invoice-pdf: send failed', sent.error)
      Sentry.captureMessage(`invoice-pdf: send failed: ${sent.error}`, 'error')
      return json({ code: 'send_failed', message: "We couldn't send the invoice email. Nothing was changed." }, 502)
    }

    const { error: logError } = await admin.from('invoice_sends').insert({
      invoice_id: invoice.id, sent_by: callerId, recipients: emails, kind, provider_id: null,
    })
    if (logError) console.error('invoice-pdf: send log failed', logError.message)

    let finalStatus: InvoiceStatus = status
    if (status === 'draft') {
      // As the caller: mark_invoice_sent checks platform admin itself.
      const { error } = await ctx.supabase.rpc('mark_invoice_sent', { p_invoice_id: invoice.id })
      if (error) {
        console.error('invoice-pdf: mark sent failed', error.message)
        Sentry.captureMessage(`invoice-pdf: emailed but not marked sent: ${error.message}`, 'error')
        return json({ code: 'mark_failed', message: 'The email was sent, but the invoice could not be marked sent. Mark it as sent.' }, 500)
      }
      finalStatus = 'sent'
    }
    return json({ ok: true, recipients: emails, kind, status: finalStatus })
  })),
}
