// Pure helpers for `invite-venue-owner` (T14.5), kept free of Deno imports so Vitest can test them.
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
