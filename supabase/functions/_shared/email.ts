// Email transport for the email Edge Functions (SPEC §8, RESEARCH M8). Plain TypeScript with no Deno APIs, so Vitest
// and tsc check it with the app. Transports: resend (real delivery, needs RESEND_API_KEY), mailpit (local stack only)
// and disabled (the hosted default for now: rows are finished as skipped).
import { shouldSkip, type BookingStatus, type EmailKind } from './emailTemplates.ts'
import { constantTimeEqual } from './paymongo.ts'

export const RESEND_API = 'https://api.resend.com/emails'
/** Local-only worker secret from supabase/functions/.env.example; refused anywhere but the local stack. */
export const LOCAL_WORKER_SECRET = 'email_worker_local_dev_only'
export const DEFAULT_FROM = 'Claudex Courts <no-reply@claudex.test>'

export type Transport = 'resend' | 'mailpit' | 'disabled' | 'unavailable'

type Env = { transport?: string | null; resendKey?: string | null; mailpitUrl?: string | null; supabaseUrl?: string | null }

const isLocal = (supabaseUrl: string | null | undefined) => typeof supabaseUrl === 'string' && supabaseUrl.startsWith('http://')

/**
 * Picks how to send. Unset means mailpit on the local stack and disabled on the hosted project. A setting that can't
 * work (resend without a key, mailpit on the hosted project, a typo) is `unavailable`: nothing is claimed, so the
 * queued emails wait until it's fixed instead of being dropped.
 */
export function emailTransport(env: Env): Transport {
  const local = isLocal(env.supabaseUrl)
  const chosen = (env.transport ?? '').trim().toLowerCase() || (local ? 'mailpit' : 'disabled')
  if (chosen === 'disabled') return 'disabled'
  if (chosen === 'resend') return env.resendKey?.trim() ? 'resend' : 'unavailable'
  if (chosen === 'mailpit') return local && env.mailpitUrl?.trim() ? 'mailpit' : 'unavailable'
  return 'unavailable'
}

export type EmailAction = { action: 'send' } | { action: 'skip'; reason: string }

/**
 * What to do with a claimed email: skip everything while the transport is disabled (the hosted default for now), skip
 * a booking_created that a later event overtook, otherwise send. Shared by send-emails and email-guest-link.
 */
export function emailAction(transport: Transport, kind: EmailKind, status: BookingStatus | null | undefined): EmailAction {
  if (transport === 'disabled') return { action: 'skip', reason: 'Email is turned off (EMAIL_TRANSPORT=disabled).' }
  if (shouldSkip(kind, status)) return { action: 'skip', reason: `Overtaken: the booking is ${status}.` }
  return { action: 'send' }
}

/** The worker secret, or null when it's missing or is the committed local value on the hosted project. */
export function workerSecret(env: { secret?: string | null; supabaseUrl?: string | null }): string | null {
  const secret = env.secret?.trim() ?? ''
  if (!secret) return null
  return isLocal(env.supabaseUrl) || secret !== LOCAL_WORKER_SECRET ? secret : null
}

export function workerAuthorized(header: string | null | undefined, secret: string): boolean {
  return typeof header === 'string' && constantTimeEqual(header, secret)
}

/** "Name <address>" or a bare address. */
export function parseFrom(value: string | null | undefined): { email: string; name: string } {
  const raw = value?.trim() || DEFAULT_FROM
  const match = raw.match(/^(.*)<([^>]+)>$/)
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() }
  return { name: '', email: raw }
}

export type OutgoingEmail = { to: string; subject: string; html: string; text: string }
export type SendResult = { ok: true; note?: string } | { ok: false; error: string }
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

/**
 * Sends one email. The idempotency key is the outbox row id: a retry after a lost response can't send twice through
 * Resend, and a 409 (the key was already used, or the same send is in flight) counts as sent.
 */
export async function sendEmail(
  fetchFn: FetchLike,
  transport: 'resend' | 'mailpit',
  config: { from?: string | null; resendKey?: string | null; mailpitUrl?: string | null },
  email: OutgoingEmail,
  idempotencyKey: string,
): Promise<SendResult> {
  const from = parseFrom(config.from)
  try {
    if (transport === 'resend') {
      const res = await fetchFn(RESEND_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.resendKey ?? ''}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: from.name ? `${from.name} <${from.email}>` : from.email,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
      })
      if (res.ok) return { ok: true }
      const detail = (await res.text().catch(() => '')).slice(0, 300)
      if (res.status === 409) return { ok: true, note: `Resend 409 (already sent with this key): ${detail}` }
      return { ok: false, error: `Resend ${res.status}: ${detail}` }
    }

    const res = await fetchFn(`${config.mailpitUrl!.replace(/\/+$/, '')}/api/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        From: { Email: from.email, Name: from.name },
        To: [{ Email: email.to }],
        Subject: email.subject,
        HTML: email.html,
        Text: email.text,
        Headers: { 'X-Outbox-Id': idempotencyKey },
      }),
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: `Mailpit ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}` }
  } catch (e) {
    return { ok: false, error: `Send failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300) }
  }
}
