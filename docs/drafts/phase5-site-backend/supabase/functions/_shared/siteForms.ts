// Validation for the marketing site's forms (plotline-site), shared by the `site-contact` and `site-review`
// Edge Functions. This is the original: plotline-site keeps an EXACT copy at src/lib/siteForms.ts for instant
// form feedback (docs/PLATFORM.md §4). Change it here first, then copy it over unchanged.
//
// Pure TypeScript with no Deno or browser imports, so Vitest can test it. The CHECK constraints in the
// site_leads_and_reviews migration are the last line; keep these limits in step with them.

export const MIN_FILL_MS = 3_000
export const MAX_COURTS = 50

export type ContactPayload = {
  firstName: string
  lastName: string
  email: string
  phone: string
  venueName: string
  location: string
  courts: number
  facebook: string
  message: string
  /** Agrees to be contacted and to the privacy notice. */
  consent: boolean
  /** Honeypot: hidden from people, so a filled value means a bot. */
  website: string
  /** When the visitor first touched the form (ms since epoch). */
  started: number
  /** Cloudflare Turnstile token; checked by the Edge Function, not here. */
  turnstileToken?: string
}

export type Contact = Omit<ContactPayload, 'consent' | 'website' | 'started' | 'turnstileToken'>

export type ReviewPayload = {
  name: string
  venue: string
  quote: string
  role: 'player' | 'owner'
  rating: number
  consent: boolean
  website: string
  started: number
}

export type Review = Pick<ReviewPayload, 'name' | 'venue' | 'quote' | 'role' | 'rating'>

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

type Raw = Record<string, unknown>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Philippine mobile numbers: 09XXXXXXXXX or +639XXXXXXXXX, spaces and dashes allowed.
const PH_MOBILE_RE = /^(\+?63|0)9\d{9}$/

function str(raw: Raw, key: string): string {
  const v = raw[key]
  return typeof v === 'string' ? v.trim() : ''
}

function bool(raw: Raw, key: string): boolean {
  return raw[key] === true
}

function asRaw(input: unknown): Raw | null {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Raw) : null
}

export function normalizePhone(phone: string): string {
  return phone.replace(/[\s-]/g, '')
}

/** True when a submission looks automated: honeypot filled, or sent too fast after first touch. */
export function isLikelyBot(input: unknown, now: number): boolean {
  const raw = asRaw(input)
  if (!raw) return true
  if (str(raw, 'website') !== '') return true
  const started = raw.started
  if (typeof started !== 'number' || !Number.isFinite(started) || started <= 0) return true
  return now - started < MIN_FILL_MS
}

export function validateContact(input: unknown): Result<Contact> {
  const raw = asRaw(input)
  if (!raw) return { ok: false, error: 'Invalid request.' }

  const firstName = str(raw, 'firstName')
  const lastName = str(raw, 'lastName')
  const email = str(raw, 'email').toLowerCase()
  const phone = normalizePhone(str(raw, 'phone'))
  const venueName = str(raw, 'venueName')
  const location = str(raw, 'location')
  const courts = Number(raw.courts)
  const facebook = str(raw, 'facebook')
  const message = str(raw, 'message')

  if (!firstName || !lastName) return { ok: false, error: 'Please enter your first and last name.' }
  if (firstName.length > 60 || lastName.length > 60) return { ok: false, error: 'Your name is too long.' }
  if (!EMAIL_RE.test(email) || email.length > 254) return { ok: false, error: 'Please enter a valid email address.' }
  if (!PH_MOBILE_RE.test(phone)) return { ok: false, error: 'Please enter a mobile number like 0917 123 4567.' }
  if (venueName.length < 2 || venueName.length > 80) return { ok: false, error: 'Please enter your venue name.' }
  if (location.length < 2 || location.length > 120) return { ok: false, error: 'Please enter your city or town.' }
  if (!Number.isInteger(courts) || courts < 1 || courts > MAX_COURTS) {
    return { ok: false, error: 'Please choose how many courts you have.' }
  }
  if (facebook.length > 200) return { ok: false, error: 'The Facebook link is too long.' }
  if (message.length > 1000) return { ok: false, error: 'Your message is too long (1000 characters at most).' }
  if (!bool(raw, 'consent')) return { ok: false, error: 'Please agree to be contacted so we can reply.' }

  return { ok: true, value: { firstName, lastName, email, phone, venueName, location, courts, facebook, message } }
}

export function validateReview(input: unknown): Result<Review> {
  const raw = asRaw(input)
  if (!raw) return { ok: false, error: 'Invalid request.' }

  const name = str(raw, 'name')
  const venue = str(raw, 'venue')
  const quote = str(raw, 'quote')
  const role = raw.role === 'owner' ? 'owner' : raw.role === 'player' ? 'player' : null
  const rating = Number(raw.rating)

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: 'Please pick a star rating.' }
  if (!name || name.length > 60) return { ok: false, error: 'Please enter your name.' }
  if (!role) return { ok: false, error: 'Please choose player or owner.' }
  if (venue.length > 80) return { ok: false, error: 'The venue name is too long.' }
  if (quote.length < 10) return { ok: false, error: 'Please write a few words (10 characters at least).' }
  if (quote.length > 400) return { ok: false, error: 'Your review is too long (400 characters at most).' }
  if (!bool(raw, 'consent')) return { ok: false, error: 'Please allow us to show your review.' }

  return { ok: true, value: { name, venue, quote, role, rating } }
}
