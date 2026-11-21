// T30.3: the booking_reminder email, the "Same time next week" link and the reminder skip rule (SPEC §8).
import { describe, expect, it } from 'vitest'
import { bookingLink, renderEmail, shouldSkip, type BookingStatus, type EmailData, type EmailKind } from './emailTemplates.ts'
import { rebookLink } from './rebookLink.ts'

const COURT = '3f1c2a9e-7b4d-4c1e-9a55-0d2e6b8f1a42'
const site = 'https://claudex.example'
const TOKEN = 'tok_SECRET-123'
const MAPS = 'https://www.google.com/maps/place/Claudex+Courts/@14.65,121.04,17z'

const data: EmailData = {
  reference_code: 'CB-7KQ2XD',
  venue_name: 'Claudex Courts',
  timezone: 'Asia/Manila',
  court_name: 'Pickle 1',
  court_id: COURT,
  slots: 2,
  sport: 'pickleball',
  starts_at: '2030-01-07T10:00:00+00:00', // 6:00 PM in Manila
  ends_at: '2030-01-07T12:00:00+00:00',
  total_amount: 700,
  booking_fee: 0,
  amount_due: 700,
  status: 'confirmed',
  name: 'Gina Guest',
  address: 'Court Rd, Quezon City',
  maps_url: MAPS,
}

const reminder = (over: Partial<EmailData> = {}, forGuest = false, extra: { guestToken?: string | null } = {}) =>
  renderEmail({ kind: 'booking_reminder', data: { ...data, ...over }, site, forGuest, ...extra })

const unescape = (s: string) => s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&')
/** Every anchor of the html as { href, label }, with HTML entities decoded. */
const anchors = (html: string) =>
  [...html.matchAll(/<a\b[^>]*?href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ href: unescape(m[1]), label: unescape(m[2]) }))
const hrefOf = (html: string, label: string) => anchors(html).find((a) => a.label === label)?.href
const textLine = (text: string, label: string) => text.split('\n').find((l) => l.startsWith(`${label}: `))?.slice(label.length + 2)

const nextWeek = rebookLink({ site, data })!

describe('booking_reminder', () => {
  it('has the subject "See you tomorrow at <venue>"', () => {
    expect(reminder().subject).toBe('See you tomorrow at Claudex Courts')
  })

  it('opens with a "See you tomorrow" paragraph that names the venue', () => {
    const { text, html } = reminder()
    const body = text.split('\n\n')[1]
    expect(body).toMatch(/See you tomorrow/i)
    expect(body).toContain('Claudex Courts')
    const paragraphs = [...html.matchAll(/<p\b[^>]*>([^<]*)<\/p>/g)].map((m) => m[1])
    expect(paragraphs.some((p) => /See you tomorrow/i.test(p) && p.includes('Claudex Courts'))).toBe(true)
  })

  it('shows Reference, Court, When (venue time) and Sport', () => {
    const { text, html } = reminder()
    expect(text).toContain('Hi Gina,')
    expect(textLine(text, 'Reference')).toBe('CB-7KQ2XD')
    expect(textLine(text, 'Court')).toBe('Pickle 1')
    expect(textLine(text, 'When')).toMatch(/^Mon, Jan 7, 2030, 6:00\s?PM–8:00\s?PM$/)
    expect(textLine(text, 'Sport')).toMatch(/^pickleball$/i)
    expect(html).toContain('Pickle 1')
  })

  it('shows the When in the venue timezone for an early-morning and a late-night start', () => {
    // 7:30 AM Mon Jan 7 in Manila is still Jan 6 in UTC.
    const early = reminder({ starts_at: '2030-01-06T23:30:00+00:00', ends_at: '2030-01-07T00:30:00+00:00' }).text
    expect(textLine(early, 'When')).toMatch(/^Mon, Jan 7, 2030, 7:30\s?AM–8:30\s?AM$/)
    // 11:00 PM Mon Jan 7 in Manila is 15:00 UTC the same day.
    const late = reminder({ starts_at: '2030-01-07T15:00:00+00:00', ends_at: '2030-01-07T16:00:00+00:00' }).text
    expect(textLine(late, 'When')).toMatch(/^Mon, Jan 7, 2030, 11:00\s?PM–12:00\s?AM$/)
  })

  it('leaves the Sport out when the snapshot has none', () => {
    expect(reminder({ sport: undefined }).text).not.toMatch(/^Sport:/m)
    expect(reminder({ sport: undefined }).html).not.toContain('>Sport<')
  })

  describe('address and Open in Maps', () => {
    it('shows the address as a fact', () => {
      const { text, html } = reminder()
      expect(textLine(text, 'Address')).toBe('Court Rd, Quezon City')
      expect(html).toContain('>Address<')
      expect(html).toContain('Court Rd, Quezon City')
    })

    it('links Open in Maps to the venue Maps URL when it is set', () => {
      const { text, html } = reminder()
      expect(hrefOf(html, 'Open in Maps')).toBe(MAPS)
      expect(textLine(text, 'Open in Maps')).toBe(MAPS)
    })

    it('uses the Maps URL even when there is no address', () => {
      const { text, html } = reminder({ address: null })
      expect(hrefOf(html, 'Open in Maps')).toBe(MAPS)
      expect(textLine(text, 'Open in Maps')).toBe(MAPS)
      expect(text).not.toMatch(/^Address:/m)
    })

    it('falls back to a Google Maps search for the address when the Maps URL is empty or missing', () => {
      const search = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Court Rd, Quezon City')}`
      for (const maps_url of ['', '   ', null, undefined]) {
        const { text, html } = reminder({ maps_url })
        expect(hrefOf(html, 'Open in Maps')).toBe(search)
        expect(textLine(text, 'Open in Maps')).toBe(search)
      }
    })

    it('has no Maps link and no Address fact with neither (an empty or blank address counts as none)', () => {
      for (const address of [null, undefined, '', '   ']) {
        for (const maps_url of [null, undefined, '', '  ']) {
          const { text, html } = reminder({ address, maps_url })
          expect(text).not.toContain('Open in Maps')
          expect(html).not.toContain('Open in Maps')
          expect(text).not.toMatch(/^Address:/m)
          expect(html).not.toContain('>Address<')
        }
      }
    })

    it('renders an old snapshot (no address, maps_url, court_id or slots keys) without those parts', () => {
      const old: EmailData = { ...data }
      delete old.address
      delete old.maps_url
      delete old.court_id
      delete old.slots
      const { subject, text, html } = renderEmail({ kind: 'booking_reminder', data: old, site, forGuest: false })
      expect(subject).toBe('See you tomorrow at Claudex Courts')
      expect(text).not.toContain('Open in Maps')
      expect(text).not.toContain('Same time next week')
      expect(html).not.toContain('Same time next week')
      expect(hrefOf(html, 'Venue info')).toBe('https://claudex.example/')
    })

    it('escapes the address and the Maps links in the HTML', () => {
      const evil = '<script>alert(1)</script> "Court" & Co'
      const { html, text } = reminder({ address: evil, maps_url: '' })
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
      expect(text).toContain(evil) // plain text carries it as written
      // The fallback link encodes the address, and the href is escaped as an attribute.
      expect(hrefOf(html, 'Open in Maps')).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(evil)}`)
      expect(html).not.toContain('href="https://www.google.com/maps/search/?api=1&query=')
      expect(html).toContain('api=1&amp;query=')
      const withAmp = reminder({ maps_url: 'https://www.google.com/maps/place/A+B/@1,2,17z?x=1&y="2"' }).html
      expect(withAmp).toContain('x=1&amp;y=&quot;2&quot;')
    })
  })

  describe('links', () => {
    it('has a Venue info link to the venue home, whatever trailing slashes the site has', () => {
      expect(hrefOf(reminder().html, 'Venue info')).toBe('https://claudex.example/')
      expect(textLine(reminder().text, 'Venue info')).toBe('https://claudex.example/')
      const trailing = renderEmail({ kind: 'booking_reminder', data, site: 'https://claudex.example//', forGuest: false })
      expect(hrefOf(trailing.html, 'Venue info')).toBe('https://claudex.example/')
    })

    it('has a Same time next week link to checkout (see rebookLink), in the HTML and the plain text', () => {
      const { html, text } = reminder()
      expect(hrefOf(html, 'Same time next week')).toBe(nextWeek)
      expect(textLine(text, 'Same time next week')).toBe(nextWeek)
      expect(html).toContain('&amp;start=2030-01-14T10%3A00%3A00.000Z')
    })

    it('leaves Same time next week out when court_id or slots is missing', () => {
      for (const over of [{ court_id: undefined }, { slots: undefined }, { court_id: undefined, slots: undefined }] as Partial<EmailData>[]) {
        const { html, text } = reminder(over)
        expect(html).not.toContain('Same time next week')
        expect(text).not.toContain('Same time next week')
      }
    })

    it("gives a player's reminder the usual Open your booking link", () => {
      const { html, text } = reminder()
      expect(hrefOf(html, 'Open your booking')).toBe(bookingLink(site, 'CB-7KQ2XD'))
      expect(textLine(text, 'Open your booking')).toBe('https://claudex.example/booking/CB-7KQ2XD')
    })
  })

  describe("a guest's reminder", () => {
    it('has no booking link and no token anywhere, even if a token is passed', () => {
      for (const extra of [{}, { guestToken: TOKEN }]) {
        const { html, text, subject } = reminder({}, true, extra)
        for (const out of [html, text, subject]) {
          expect(out).not.toContain('#token')
          expect(out).not.toContain(TOKEN)
          expect(out).not.toContain('/booking/')
        }
        expect(hrefOf(html, 'Open your booking')).toBeUndefined()
        expect(text).not.toContain('Open your booking')
      }
    })

    it('says how to find the booking, like the other guest emails', () => {
      const { html, text } = reminder({}, true)
      expect(text).toContain('To see this booking, open the private link')
      expect(html).toContain('To see this booking, open the private link')
    })

    it('still has the venue info, Maps and Same time next week links (they carry no private data)', () => {
      const { html } = reminder({}, true)
      expect(hrefOf(html, 'Venue info')).toBe('https://claudex.example/')
      expect(hrefOf(html, 'Open in Maps')).toBe(MAPS)
      expect(hrefOf(html, 'Same time next week')).toBe(nextWeek)
    })
  })

  it('keeps the house style (cream page, sage button, Powered by Plotline)', () => {
    const { html } = reminder()
    expect(html).toContain('background:#f5efe6')
    expect(html).toContain('background:#b7c4a8;color:#3b2f2a;border:1.5px solid #4c6b3c')
    expect(html).toContain('Powered by Plotline')
  })
})

describe('Same time next week in the other emails', () => {
  const OTHERS: EmailKind[] = ['booking_created', 'proof_rejected', 'booking_cancelled', 'booking_rescheduled']

  it('is in payment_confirmed, for a player and for a guest, with the same href as the reminder', () => {
    for (const forGuest of [false, true]) {
      const { html, text } = renderEmail({ kind: 'payment_confirmed', data, site, forGuest })
      expect(hrefOf(html, 'Same time next week')).toBe(nextWeek)
      expect(textLine(text, 'Same time next week')).toBe(nextWeek)
    }
  })

  it('is left out of payment_confirmed when court_id or slots is missing', () => {
    for (const over of [{ court_id: undefined }, { slots: undefined }] as Partial<EmailData>[]) {
      const { html, text } = renderEmail({ kind: 'payment_confirmed', data: { ...data, ...over }, site, forGuest: false })
      expect(html).not.toContain('Same time next week')
      expect(text).not.toContain('Same time next week')
    }
  })

  it('is never in booking_created, proof_rejected, booking_cancelled or booking_rescheduled, even with court_id and slots', () => {
    for (const kind of OTHERS) {
      for (const forGuest of [false, true]) {
        const { html, text } = renderEmail({ kind, data: { ...data, status: 'pending_payment', new_starts_at: data.starts_at, new_ends_at: data.ends_at }, site, forGuest })
        expect(html, kind).not.toContain('Same time next week')
        expect(text, kind).not.toContain('Same time next week')
      }
    }
  })

  it('keeps payment_confirmed otherwise as it was (no venue info or Maps link, same subject and booking link)', () => {
    const { subject, html, text } = renderEmail({ kind: 'payment_confirmed', data, site, forGuest: false })
    expect(subject).toBe('Booking CB-7KQ2XD is confirmed')
    expect(html).not.toContain('Open in Maps')
    expect(html).not.toContain('Venue info')
    expect(text).not.toMatch(/^Address:/m)
    expect(hrefOf(html, 'Open your booking')).toBe(bookingLink(site, 'CB-7KQ2XD'))
    // Without the new keys the email is the one it always was.
    const old: EmailData = { ...data }
    delete old.court_id
    delete old.slots
    delete old.address
    delete old.maps_url
    const before = renderEmail({ kind: 'payment_confirmed', data: old, site, forGuest: false })
    expect(before.text).not.toContain('Same time next week')
    const lines = (t: string) => t.split('\n').filter((l) => l !== '' && !l.startsWith('Same time next week'))
    expect(lines(text)).toEqual(lines(before.text))
  })
})

describe('shouldSkip for booking_reminder (T30.3)', () => {
  const STARTS = '2030-01-07T10:00:00.000Z'
  const NOT_CONFIRMED: BookingStatus[] = ['pending_payment', 'payment_submitted', 'expired', 'rejected', 'cancelled']

  it('sends a reminder for a confirmed booking, and skips it for any other status', () => {
    expect(shouldSkip('booking_reminder', 'confirmed')).toBe(false)
    for (const status of NOT_CONFIRMED) expect(shouldSkip('booking_reminder', status), status).toBe(true)
  })

  it('skips a reminder whose booking no longer starts at the snapshot time (compared as instants, not strings)', () => {
    const base = { snapshotStartsAt: STARTS, now: new Date('2030-01-06T10:00:00Z') }
    expect(shouldSkip('booking_reminder', 'confirmed', { ...base, bookingStartsAt: '2030-01-07T12:00:00.000Z' })).toBe(true)
    expect(shouldSkip('booking_reminder', 'confirmed', { ...base, bookingStartsAt: '2030-01-07T10:00:00.000Z' })).toBe(false)
    // The same instant written the way Postgres writes it.
    expect(shouldSkip('booking_reminder', 'confirmed', { ...base, snapshotStartsAt: '2030-01-07T02:00:00+00:00', bookingStartsAt: '2030-01-07T02:00:00.000Z' })).toBe(false)
    expect(shouldSkip('booking_reminder', 'confirmed', { ...base, snapshotStartsAt: STARTS, bookingStartsAt: '2030-01-07T18:00:00+08:00' })).toBe(false)
  })

  it('does not compare the time when the booking start is missing', () => {
    expect(shouldSkip('booking_reminder', 'confirmed', { snapshotStartsAt: STARTS, bookingStartsAt: null })).toBe(false)
    expect(shouldSkip('booking_reminder', 'confirmed', { snapshotStartsAt: STARTS })).toBe(false)
  })

  it('skips a reminder once the booking has started (now at or after the snapshot start)', () => {
    const check = (now: string) => ({ snapshotStartsAt: STARTS, bookingStartsAt: STARTS, now: new Date(now) })
    expect(shouldSkip('booking_reminder', 'confirmed', check('2030-01-06T10:00:00.000Z'))).toBe(false)
    expect(shouldSkip('booking_reminder', 'confirmed', check('2030-01-07T09:59:59.999Z'))).toBe(false)
    expect(shouldSkip('booking_reminder', 'confirmed', check('2030-01-07T10:00:00.000Z'))).toBe(true)
    expect(shouldSkip('booking_reminder', 'confirmed', check('2030-01-07T11:00:00.000Z'))).toBe(true)
  })

  it('does not check the clock without a now', () => {
    expect(shouldSkip('booking_reminder', 'confirmed', { snapshotStartsAt: STARTS, bookingStartsAt: STARTS })).toBe(false)
  })

  it('still skips a cancelled booking whatever the check says', () => {
    expect(shouldSkip('booking_reminder', 'cancelled', { snapshotStartsAt: STARTS, bookingStartsAt: STARTS, now: new Date('2030-01-06T10:00:00Z') })).toBe(true)
  })

  it('leaves booking_created as it was, and never skips another kind by status or by the check', () => {
    expect(shouldSkip('booking_created', 'cancelled')).toBe(true)
    expect(shouldSkip('booking_created', 'expired')).toBe(true)
    expect(shouldSkip('booking_created', 'rejected')).toBe(true)
    expect(shouldSkip('booking_created', 'confirmed')).toBe(false)
    expect(shouldSkip('booking_created', 'pending_payment')).toBe(false)
    const late = { snapshotStartsAt: STARTS, bookingStartsAt: '2030-01-08T10:00:00.000Z', now: new Date('2030-01-09T00:00:00Z') }
    expect(shouldSkip('booking_created', 'confirmed', late)).toBe(false)
    for (const kind of ['payment_confirmed', 'proof_rejected', 'booking_cancelled', 'booking_rescheduled'] as EmailKind[]) {
      for (const status of ['confirmed', 'cancelled', 'expired'] as BookingStatus[]) {
        expect(shouldSkip(kind, status), `${kind} ${status}`).toBe(false)
        expect(shouldSkip(kind, status, late), `${kind} ${status} with a check`).toBe(false)
      }
    }
  })
})
