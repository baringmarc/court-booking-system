// Pure helpers for `invite-venue-owner` (T14.5), kept free of Deno imports so Vitest can test them.
import { escapeHtml } from './emailTemplates.ts'
import { venueSiteBase, type VenueSiteInput } from './venueSite.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A trimmed, lowercased email, or null when it doesn't look like one. */
export function normalizeInviteEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const email = input.trim().toLowerCase()
  return email.length <= 254 && EMAIL.test(email) ? email : null
}

/** Where the invite link ends up: the venue's own admin area. */
export function inviteRedirectTo(input: VenueSiteInput): string | null {
  const base = venueSiteBase(input)
  return base ? `${base}/admin` : null
}

export type InviteBody = { ok: true; venueId: string; email: string } | { ok: false; error: 'invalid_input' }

export function parseInviteBody(body: unknown): InviteBody {
  const input = (body ?? {}) as { venue_id?: unknown; email?: unknown }
  const email = normalizeInviteEmail(input.email)
  if (typeof input.venue_id !== 'string' || !UUID.test(input.venue_id) || !email) return { ok: false, error: 'invalid_input' }
  return { ok: true, venueId: input.venue_id, email }
}

/** An email that already has an account gets the membership only, no invite email. */
export function inviteOutcome(existingUserId: string | null): { invite: boolean } {
  return { invite: existingUserId === null }
}

type OwnerAccount = { invited_at?: string | null; user_metadata?: Record<string, unknown> | null }

/** What an owner email does for the account (T17.25): set up a new account, a fresh access link, or a welcome. */
export type OwnerEmailKind = 'invite' | 'link' | 'welcome'

/**
 * What a (re)send does for an owner's account: no account gets an account-setup invitation; an account that was invited
 * but never set a password gets a fresh access link (the first may be used up, expired or never delivered); any other
 * account signs in on its own, so it gets a welcome email with the venue's sign-in URL and no password reset (T17.25).
 * The password rule matches the app's `needsPassword`.
 */
export function ownerLinkAction(user: OwnerAccount | null): OwnerEmailKind {
  if (!user) return 'invite'
  return user.invited_at && user.user_metadata?.password_set !== true ? 'link' : 'welcome'
}

export const OWNER_SUPPORT_EMAIL = 'plotline.admin1@gmail.com'
export const OWNER_FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61595759948011'
export const OWNER_MESSENGER_URL = 'https://m.me/61595759948011'
export const OWNER_GUIDE_FILE = 'venue-owner-manual-v1.0.pdf'

/** The owner PDF's download link on the venue site (T17.24). */
export function ownerGuideUrl(siteBase: string): string {
  return `${siteBase.replace(/\/+$/, '')}/guides/${OWNER_GUIDE_FILE}`
}

/** Where the function fetches the PDF to attach: OWNER_GUIDE_URL when it is an http(s) URL, else the download link. */
export function ownerGuideSource(siteBase: string, override?: string | null): string {
  const configured = override?.trim()
  return configured && /^https?:\/\/\S+$/.test(configured) ? configured : ownerGuideUrl(siteBase)
}

/** `venueAddress` is the venue's Plotline address (e.g. `forty.plotline.fit`), named so the owner knows which venue it is. */
type OwnerEmailInput = { kind: OwnerEmailKind; venueName: string; venueUrl: string; link?: string; guideUrl: string; venueAddress?: string }

const COPY: Record<OwnerEmailKind, { subject: (venue: string) => string; intro: (venue: string) => string; button: string; does: string }> = {
  invite: {
    subject: (venue) => `Set up your Plotline account for ${venue}`,
    intro: (venue) => `You've been added as the owner of ${venue} on Plotline, where you'll manage its courts, schedule, bookings and payments.`,
    button: 'Set up your account',
    does: 'The button signs you in to your new account and asks you to choose a password. It works once and expires after a while; if it stops working, ask Plotline for a new one.',
  },
  link: {
    subject: (venue) => `Your fresh Plotline access link for ${venue}`,
    intro: (venue) => `Here is a fresh access link to ${venue} on Plotline, where you manage its courts, schedule, bookings and payments.`,
    button: 'Sign in and set your password',
    does: 'The button signs you in and asks you to choose a password. It works once and expires after a while; if it stops working, ask Plotline for a new one.',
  },
  welcome: {
    subject: (venue) => `Welcome to ${venue} on Plotline`,
    intro: (venue) => `You've been added as the owner of ${venue} on Plotline, where you manage its courts, schedule, bookings and payments.`,
    button: 'Sign in to your venue',
    does: 'The button opens the venue admin sign-in page. Sign in with your usual email and password or Google account.',
  },
}

/** The branded email an owner gets for each account state (T17.25), with the guide and Plotline's support channels. */
export function ownerEmail(input: OwnerEmailInput): { subject: string; html: string; text: string } {
  const venue = input.venueName.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim() || 'your venue'
  const copy = COPY[input.kind]
  const target = input.kind === 'welcome' ? input.venueUrl : (input.link ?? '')
  const guide = `The venue owner guide (PDF) walks you through setup and daily operations. It's attached, and you can also download it here: ${input.guideUrl}`
  const help = `Need help? Reply to this email or write to ${OWNER_SUPPORT_EMAIL}. You can also reach us on Facebook (${OWNER_FACEBOOK_URL}) or Messenger (${OWNER_MESSENGER_URL}). If you'd like a call to walk through setup, contact support and we'll arrange one.`
  const address = input.venueAddress?.replace(/\s+/g, '').trim()
  const where = address ? `Your venue's Plotline address is ${address}.` : ''
  const text = [copy.intro(venue), where, `${copy.button}: ${target}`, copy.does, guide, help, 'Plotline'].filter(Boolean).join('\n\n')
  const a = (href: string, label: string) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
  const html = [
    `<p>${escapeHtml(copy.intro(venue))}</p>`,
    where ? `<p>${escapeHtml(where)}</p>` : '',
    `<p>${a(target, copy.button)}</p>`,
    `<p>${escapeHtml(copy.does)}</p>`,
    `<p>The venue owner guide (PDF) walks you through setup and daily operations. It's attached, and you can also ${a(input.guideUrl, 'download it here')} (${escapeHtml(input.guideUrl)}).</p>`,
    `<p>Need help? Reply to this email or write to ${a(`mailto:${OWNER_SUPPORT_EMAIL}`, OWNER_SUPPORT_EMAIL)}. You can also reach us on ${a(OWNER_FACEBOOK_URL, 'Facebook')} (${escapeHtml(OWNER_FACEBOOK_URL)}) or ${a(OWNER_MESSENGER_URL, 'Messenger')} (${escapeHtml(OWNER_MESSENGER_URL)}). If you'd like a call to walk through setup, contact support and we'll arrange one.</p>`,
    '<p>Plotline</p>',
  ].join('')
  return { subject: copy.subject(venue), html, text }
}
