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

/**
 * What a (re)send does for an owner's account (T14.5d): no account gets a Supabase invite; an account that was invited but
 * never set a password gets a fresh sign-in link by email (the first invite may be used up, expired or never delivered);
 * any other account (it signs in on its own) gets nothing. The password rule matches the app's `needsPassword`.
 */
export function ownerLinkAction(user: OwnerAccount | null): 'invite' | 'link' | 'none' {
  if (!user) return 'invite'
  return user.invited_at && user.user_metadata?.password_set !== true ? 'link' : 'none'
}

/** The email that carries a fresh sign-in link to an invited owner. */
export function ownerLinkEmail(input: { venueName: string; link: string }): { subject: string; html: string; text: string } {
  const venue = input.venueName.replace(/[\r\n]+/g, ' ').trim() || 'your venue'
  return {
    subject: `Your Plotline sign-in link for ${venue}`,
    text: `Open this link to sign in to ${venue} and choose a password:\n\n${input.link}\n\nThe link works once and expires after a day. If it stops working, ask Plotline to send a new one.`,
    html: `<p>Open this link to sign in to <strong>${escapeHtml(venue)}</strong> and choose a password:</p><p><a href="${escapeHtml(input.link)}">Sign in and set your password</a></p><p>The link works once and expires after a day. If it stops working, ask Plotline to send a new one.</p>`,
  }
}
