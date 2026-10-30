// Booking email templates (SPEC §8, RESEARCH M8 "Templates"). Plain TypeScript with no Deno APIs, so Vitest and tsc
// check it with the app. The data is the email_outbox snapshot; the guest token is a separate argument that only the
// booking_created email accepts, so no other email can ever carry the private link.

export type EmailKind = 'booking_created' | 'payment_confirmed' | 'proof_rejected' | 'booking_cancelled' | 'booking_rescheduled'
export type BookingStatus = 'pending_payment' | 'payment_submitted' | 'confirmed' | 'expired' | 'rejected' | 'cancelled'

/** The email_outbox.data snapshot (see private.booking_email_data and the trigger). */
export type EmailData = {
  reference_code: string
  venue_name: string
  timezone: string
  court_name: string
  sport?: string
  starts_at: string
  ends_at: string
  /** The court price. */
  total_amount: number | string
  /** Plotline's booking fee and what the player pays (T11.12). Absent in emails queued before the fee. */
  booking_fee?: number | string
  amount_due?: number | string
  /** The waiver the player accepted at checkout (T11.19); only booking_created prints it. */
  waiver_text?: string | null
  status?: string
  expires_at?: string | null
  name?: string | null
  note?: string | null
  final?: boolean
  cancelled_by_venue?: boolean
  reason?: string | null
  // booking_rescheduled (private.queue_reschedule_email): the part that moved, and where it went.
  old_court_name?: string
  old_starts_at?: string
  old_ends_at?: string
  new_court_name?: string
  new_starts_at?: string
  new_ends_at?: string
  /** The booking created for the moved hours after a split; absent when the whole booking moved. */
  continuation_reference?: string | null
}

export type RenderInput = {
  kind: EmailKind
  data: EmailData
  /** Site origin for links, e.g. https://claudex-courts.vercel.app (no trailing slash). */
  site: string
  /** A guest booking (no account): links need the private token. */
  forGuest: boolean
  /** The booking's status now. booking_created is rendered from it (a guest may already have paid). */
  currentStatus?: BookingStatus
  /** For a guest's booking_created (email-guest-link) or non-final proof_rejected (send-emails). Never stored. */
  guestToken?: string | null
}

export type RenderedEmail = { subject: string; html: string; text: string }

/** A booking_created email that a later event has made pointless is dropped instead of sent. */
export function shouldSkip(kind: EmailKind, currentStatus: BookingStatus | null | undefined): boolean {
  return kind === 'booking_created' && (currentStatus === 'cancelled' || currentStatus === 'expired' || currentStatus === 'rejected')
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function money(amount: number | string) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount))
}

function dateLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-PH', { timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

function timeLabel(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-PH', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
}

function whenLabel(start: string, end: string, timeZone: string) {
  return `${dateLabel(start, timeZone)}, ${timeLabel(start, timeZone)}–${timeLabel(end, timeZone)}`
}

function firstName(name: string | null | undefined) {
  return name?.trim().split(/\s+/)[0] || 'there'
}

/** Guest links carry the token in the fragment, as in src/features/booking/guestLink.ts. */
export function bookingLink(site: string, reference: string, guestToken?: string | null) {
  const base = `${site.replace(/\/+$/, '')}/booking/${encodeURIComponent(reference)}`
  return guestToken ? `${base}#token=${encodeURIComponent(guestToken)}` : base
}

type Block = { paragraphs: string[]; facts: [string, string][]; link?: { href: string; label: string }; footer: string[] }

function content(input: RenderInput): { subject: string; block: Block } {
  const { kind, data, forGuest } = input
  const tz = data.timezone || 'Asia/Manila'
  const ref = data.reference_code
  const when = whenLabel(data.starts_at, data.ends_at, tz)
  const fee = Number(data.booking_fee ?? 0)
  const facts: [string, string][] = [
    ['Reference', ref],
    ['Court', data.court_name],
    ['When', when],
    ['Court price', money(data.total_amount)],
    ...(fee > 0 ? [['Booking fee', money(fee)] as [string, string]] : []),
    ['Total', money(data.amount_due ?? data.total_amount)],
  ]
  // The private link goes only in booking_created and in a non-final rejection (T11.30: a fresh token, so the guest can
  // upload a new proof without the original link).
  const reupload = kind === 'proof_rejected' && !data.final
  const token = (kind === 'booking_created' || reupload) && forGuest ? input.guestToken : null
  const canLink = !forGuest || !!token
  const link = canLink
    ? { href: bookingLink(input.site, ref, token), label: reupload && token ? 'Upload a new proof' : 'Open your booking' }
    : undefined
  const footer: string[] = []
  if (token) {
    footer.push('This link is your private access to the booking. Keep it safe: anyone with it can see and cancel the booking.')
  } else if (forGuest) {
    footer.push(
      'To see this booking, open the private link from your booking confirmation, or sign up or log in with this email address to find it in My bookings.',
    )
  }

  switch (kind) {
    case 'booking_created': {
      const status = input.currentStatus ?? (data.status as BookingStatus | undefined) ?? 'pending_payment'
      const waiver = data.waiver_text?.trim()
      const createdFooter = waiver ? ["You accepted the venue's waiver:", waiver, ...footer] : footer
      if (status === 'confirmed') {
        return {
          subject: `Booking ${ref} is confirmed`,
          block: { paragraphs: [`Thanks for booking with ${data.venue_name}. Your payment is in and the court is yours.`], facts, link, footer: createdFooter },
        }
      }
      if (status === 'payment_submitted') {
        return {
          subject: `Booking ${ref}: we're checking your payment`,
          block: { paragraphs: [`Thanks for booking with ${data.venue_name}. We got your proof of payment and will confirm the booking once it's checked.`], facts, link, footer: createdFooter },
        }
      }
      const due = data.expires_at ? ` by ${timeLabel(data.expires_at, tz)} on ${dateLabel(data.expires_at, tz)}` : ''
      return {
        subject: `Booking ${ref}: please pay to confirm`,
        block: {
          paragraphs: [
            `Thanks for booking with ${data.venue_name}. We're holding the court for you. Please pay${due}, online or by uploading a proof of payment, or the times will be released.`,
          ],
          facts,
          link,
          footer: createdFooter,
        },
      }
    }
    case 'payment_confirmed':
      return {
        subject: `Booking ${ref} is confirmed`,
        block: { paragraphs: [`Your payment is in and your booking at ${data.venue_name} is confirmed. See you on the court!`], facts, link, footer },
      }
    case 'proof_rejected': {
      const reason = data.note?.trim() ? [`Reason: ${data.note.trim()}`] : []
      if (data.final) {
        return {
          subject: `Booking ${ref} was not confirmed`,
          block: {
            paragraphs: [`We couldn't accept your proof of payment, so this booking was not confirmed and the times were released.`, ...reason],
            facts,
            link,
            footer,
          },
        }
      }
      const due = data.expires_at ? ` before ${timeLabel(data.expires_at, tz)} on ${dateLabel(data.expires_at, tz)}` : ''
      return {
        subject: `Booking ${ref}: please upload a new proof`,
        block: {
          paragraphs: [`We couldn't accept your proof of payment. Please upload a new one${due} to keep the booking.`, ...reason],
          facts,
          link,
          footer,
        },
      }
    }
    case 'booking_cancelled': {
      const who = data.cancelled_by_venue ? `${data.venue_name} cancelled this booking.` : 'This booking was cancelled.'
      const reason = data.reason?.trim() ? [`Reason: ${data.reason.trim()}`] : []
      return {
        subject: `Booking ${ref} was cancelled`,
        block: { paragraphs: [who, ...reason, 'If you already paid, please contact the venue.'], facts, link, footer },
      }
    }
    case 'booking_rescheduled': {
      // The snapshot's own court and time are the root booking's (shortened after a split), so this email names the
      // part that moved from its old_* and new_* fields. Guests get no private link here, like every email but
      // booking_created (the token is never stored).
      const newCourt = data.new_court_name ?? data.court_name
      const newWhen = whenLabel(data.new_starts_at ?? data.starts_at, data.new_ends_at ?? data.ends_at, tz)
      const was = data.old_starts_at && data.old_ends_at
        ? `${data.old_court_name ?? data.court_name}, ${whenLabel(data.old_starts_at, data.old_ends_at, tz)}`
        : null
      const split = data.continuation_reference?.trim()
      const reason = data.reason?.trim() ? [`Reason: ${data.reason.trim()}`] : []
      const moved: [string, string][] = [
        ['Reference', split || ref],
        ['Moved to', `${newCourt}, ${newWhen}`],
        ...(was ? [['Was', was] as [string, string]] : []),
      ]
      return {
        subject: `Booking ${ref} was moved`,
        block: {
          paragraphs: [
            split
              ? `${data.venue_name} moved the rest of your booking to a new time. The moved hours have their own reference, ${split}.`
              : `${data.venue_name} moved your booking to a new time.`,
            ...reason,
            'Please contact the venue if the new time does not work for you.',
          ],
          facts: moved,
          link,
          footer,
        },
      }
    }
  }
}

export function renderEmail(input: RenderInput): RenderedEmail {
  const { subject, block } = content(input)
  const greeting = `Hi ${firstName(input.data.name)},`
  const venue = input.data.venue_name

  const text = [
    greeting,
    '',
    ...block.paragraphs.flatMap((p) => [p, '']),
    ...block.facts.map(([k, v]) => `${k}: ${v}`),
    '',
    ...(block.link ? [`${block.link.label}: ${block.link.href}`, ''] : []),
    ...block.footer.flatMap((p) => [p, '']),
    `— ${venue}`,
  ].join('\n')

  const e = escapeHtml
  // The Plotline palette (T11.4, docs/BRAND.md): cream page, warm-white card, brown text, a sage button with an ink
  // edge. Web fonts don't load reliably in mail apps, so DM Sans and Fraunces fall back to system and Georgia.
  const sans = `'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`
  const serif = `'Fraunces',Georgia,'Times New Roman',serif`
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5efe6;font-family:${sans};color:#3b2f2a">
<div style="max-width:520px;margin:0 auto;background:#fffcf7;border:1px solid #e6d9c6;border-radius:18px;padding:24px">
<p style="margin:0 0 16px;font-family:${serif};font-size:20px;font-weight:700">${e(venue)}</p>
<p style="margin:0 0 16px">${e(greeting)}</p>
${block.paragraphs.map((p) => `<p style="margin:0 0 16px">${e(p)}</p>`).join('\n')}
<table style="border-collapse:collapse;margin:0 0 16px;width:100%;background:#e5ebdd;border-radius:12px">${block.facts
    .map(([k, v]) => `<tr><td style="padding:4px 16px 4px 12px;color:#5a4a42">${e(k)}</td><td style="padding:4px 12px 4px 0;font-weight:700">${e(v)}</td></tr>`)
    .join('')}</table>
${block.link ? `<p style="margin:0 0 16px"><a href="${e(block.link.href)}" style="display:inline-block;background:#b7c4a8;color:#3b2f2a;border:1.5px solid #4c6b3c;padding:10px 20px;border-radius:999px;font-weight:700;text-decoration:none">${e(block.link.label)}</a></p>` : ''}
${block.footer.map((p) => `<p style="margin:0 0 16px;color:#5a4a42;font-size:14px">${e(p)}</p>`).join('\n')}
<p style="margin:0;color:#5a4a42">— ${e(venue)}</p>
</div>
<p style="max-width:520px;margin:12px auto 0;text-align:center;color:#5a4a42;font-size:12px">Powered by Plotline</p>
</body></html>`

  return { subject, html, text }
}
