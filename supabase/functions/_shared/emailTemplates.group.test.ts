// T33.2: the group emails. A grouped booking sends ONE email per event, for the lead, listing every court and its own time
// (SPEC §8; email_outbox.data.courts, T33.2). Without `courts`, or with one court, the email is exactly today's.
import { describe, expect, it } from 'vitest'
import { renderEmail, type BookingStatus, type EmailData, type EmailKind } from './emailTemplates.ts'

const site = 'https://claudex.example'
const TOKEN = 'tok_SECRET-123'

// The exported GroupCourt type is { booking_id, reference_code, court_name, sport?, starts_at, ends_at, total_amount }.
type Court = {
  booking_id: string
  reference_code: string
  court_name: string
  sport?: string
  starts_at: string
  ends_at: string
  total_amount: number | string
}

const PICKLE: Court = {
  booking_id: '11111111-1111-4111-8111-111111111111',
  reference_code: 'CB-AAA111',
  court_name: 'Pickle 1',
  sport: 'pickleball',
  starts_at: '2030-01-07T10:00:00+00:00', // 6:00 PM in Manila
  ends_at: '2030-01-07T12:00:00+00:00', // 8:00 PM
  total_amount: 700,
}
const TENNIS: Court = {
  booking_id: '22222222-2222-4222-8222-222222222222',
  reference_code: 'CB-BBB222',
  court_name: 'Tennis 2',
  sport: 'tennis',
  starts_at: '2030-01-07T12:00:00+00:00', // 8:00 PM
  ends_at: '2030-01-07T13:00:00+00:00', // 9:00 PM
  total_amount: '400.00',
}

// What the trigger stores for a group's lead: the lead's keys, the group's sums.
const single: EmailData = {
  reference_code: 'CB-AAA111',
  venue_name: 'Claudex Courts',
  timezone: 'Asia/Manila',
  court_name: 'Pickle 1',
  sport: 'pickleball',
  starts_at: PICKLE.starts_at,
  ends_at: PICKLE.ends_at,
  total_amount: 700,
  booking_fee: 10,
  amount_due: 710,
  status: 'pending_payment',
  expires_at: '2030-01-06T05:45:00+00:00',
  name: 'Gina Guest',
  address: 'Court Rd, Quezon City',
  maps_url: 'https://maps.example/claudex',
}
const groupData = (courts: Court[] | undefined, over: Record<string, unknown> = {}) => ({
  ...single,
  total_amount: 1100,
  booking_fee: 10,
  amount_due: 1110,
  ...(courts ? { courts } : {}),
  ...over,
})

const W1 = /^Mon, Jan 7, 2030, 6:00\s?PM–8:00\s?PM$/
const W2 = /^Mon, Jan 7, 2030, 8:00\s?PM–9:00\s?PM$/

const unescape = (s: string) => s.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&')
/** The html fact table as [label, value] rows, entities decoded. */
const htmlFacts = (html: string): [string, string][] =>
  [...html.matchAll(/<tr><td[^>]*>([^<]*)<\/td><td[^>]*>([^<]*)<\/td><\/tr>/g)].map((m) => [unescape(m[1]), unescape(m[2])])
/** The fact lines of the text email ("Label: value"): from the Reference line to the first blank line. */
const textFacts = (text: string): [string, string][] => {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.startsWith('Reference: '))
  const end = lines.indexOf('', start)
  return lines.slice(start, end === -1 ? undefined : end).map((l) => [l.slice(0, l.indexOf(': ')), l.slice(l.indexOf(': ') + 2)] as [string, string])
}
const value = (facts: [string, string][], label: string) => facts.find(([k]) => k === label)?.[1]
const labels = (facts: [string, string][]) => facts.map(([k]) => k)
const anchors = (html: string) =>
  [...html.matchAll(/<a\b[^>]*?href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((m) => ({ href: unescape(m[1]), label: unescape(m[2]) }))

type Case = { kind: EmailKind; subject: string; extra: Record<string, unknown>; status?: BookingStatus }
const CASES: Case[] = [
  { kind: 'booking_created', subject: 'Booking CB-AAA111: please pay to confirm', extra: {} },
  { kind: 'payment_confirmed', subject: 'Booking CB-AAA111 is confirmed', extra: { status: 'confirmed' } },
  { kind: 'proof_rejected', subject: 'Booking CB-AAA111: please upload a new proof', extra: { note: 'Blurry', final: false } },
  { kind: 'booking_cancelled', subject: 'Booking CB-AAA111 was cancelled', extra: { status: 'cancelled', cancelled_by_venue: true, reason: 'Court flooded' } },
  { kind: 'booking_reminder', subject: 'See you tomorrow at Claudex Courts', extra: { status: 'confirmed' } },
]

const render = (c: Case, courts: Court[] | undefined, forGuest: boolean, guestToken?: string | null) =>
  renderEmail({ kind: c.kind, data: groupData(courts, c.extra), site, forGuest, guestToken })

describe.each(CASES)('group $kind', (c) => {
  for (const forGuest of [true, false]) {
    const who = forGuest ? 'a guest' : 'a signed-in player'

    it(`keeps today's subject (the lead's reference) for ${who}`, () => {
      expect(render(c, [PICKLE, TENNIS], forGuest, TOKEN).subject).toBe(c.subject)
      expect(render(c, [PICKLE, TENNIS], forGuest, TOKEN).subject).toBe(render(c, undefined, forGuest, TOKEN).subject)
    })

    it(`lists every court with its own time in the text, one fact row per court, for ${who}`, () => {
      const facts = textFacts(render(c, [PICKLE, TENNIS], forGuest, TOKEN).text)
      expect(value(facts, 'Reference')).toBe('CB-AAA111')
      expect(value(facts, 'Pickle 1')).toMatch(W1)
      expect(value(facts, 'Tennis 2')).toMatch(W2)
      expect(labels(facts).indexOf('Pickle 1')).toBeLessThan(labels(facts).indexOf('Tennis 2'))
      expect(labels(facts)).not.toContain('Court')
      expect(labels(facts)).not.toContain('When')
    })

    it(`lists every court with its own time in the html, one fact row per court, for ${who}`, () => {
      const facts = htmlFacts(render(c, [PICKLE, TENNIS], forGuest, TOKEN).html)
      expect(value(facts, 'Reference')).toBe('CB-AAA111')
      expect(value(facts, 'Pickle 1')).toMatch(W1)
      expect(value(facts, 'Tennis 2')).toMatch(W2)
      expect(labels(facts).indexOf('Pickle 1')).toBeLessThan(labels(facts).indexOf('Tennis 2'))
      expect(labels(facts)).not.toContain('Court')
      expect(labels(facts)).not.toContain('When')
    })
  }

  it('is byte-identical to today with no courts, an empty list or one court', () => {
    const today = render(c, undefined, true, TOKEN)
    expect(render(c, [], true, TOKEN)).toEqual(today)
    expect(render(c, [PICKLE], true, TOKEN)).toEqual(today)
    const todayPlayer = render(c, undefined, false)
    expect(render(c, [], false)).toEqual(todayPlayer)
    expect(render(c, [PICKLE], false)).toEqual(todayPlayer)
    // and today's email still has its single Court and When rows
    expect(labels(textFacts(today.text))).toEqual(expect.arrayContaining(['Court', 'When']))
  })
})

describe('group money (every kind with a total)', () => {
  for (const c of CASES.filter((x) => x.kind !== 'booking_reminder')) {
    it(`${c.kind}: Court price and Booking fee from the sums, Total from amount_due, in the order court rows, price, fee, total`, () => {
      for (const out of [render(c, [PICKLE, TENNIS], false), render(c, [PICKLE, TENNIS], true, TOKEN)]) {
        for (const facts of [textFacts(out.text), htmlFacts(out.html)]) {
          expect(value(facts, 'Court price')).toMatch(/₱1,100\.00/)
          expect(value(facts, 'Booking fee')).toMatch(/₱10\.00/)
          expect(value(facts, 'Total')).toMatch(/₱1,110\.00/)
          expect(labels(facts)).toEqual(['Reference', 'Pickle 1', 'Tennis 2', 'Court price', 'Booking fee', 'Total'])
        }
      }
    })
  }

  it('leaves the Booking fee row out when the group paid no fee, and Total is then the court prices', () => {
    const out = renderEmail({ kind: 'payment_confirmed', data: groupData([PICKLE, TENNIS], { booking_fee: 0, amount_due: 1100 }), site, forGuest: false })
    const facts = textFacts(out.text)
    expect(labels(facts)).toEqual(['Reference', 'Pickle 1', 'Tennis 2', 'Court price', 'Total'])
    expect(value(facts, 'Total')).toMatch(/₱1,100\.00/)
  })

  it('does not print a Total on the reminder (as today)', () => {
    const out = render(CASES[4], [PICKLE, TENNIS], false)
    expect(labels(textFacts(out.text))).not.toContain('Total')
  })
})

describe('group court rows', () => {
  it("shows each court's time in the venue timezone for an early-morning and a late-night court", () => {
    // 6:00 AM Mon Jan 7 in Manila is 22:00 UTC on Jan 6; 9:00 PM Mon Jan 7 in Manila is 13:00 UTC the same day.
    const early: Court = { ...PICKLE, court_name: 'Early', starts_at: '2030-01-06T22:00:00+00:00', ends_at: '2030-01-06T23:00:00+00:00' }
    const late: Court = { ...TENNIS, court_name: 'Late', starts_at: '2030-01-07T13:00:00+00:00', ends_at: '2030-01-07T14:00:00+00:00' }
    const facts = textFacts(renderEmail({ kind: 'payment_confirmed', data: groupData([early, late], { status: 'confirmed' }), site, forGuest: false }).text)
    expect(value(facts, 'Early')).toMatch(/^Mon, Jan 7, 2030, 6:00\s?AM–7:00\s?AM$/)
    expect(value(facts, 'Late')).toMatch(/^Mon, Jan 7, 2030, 9:00\s?PM–10:00\s?PM$/)
  })

  it("uses the venue timezone, not the server's (a venue in Honolulu)", () => {
    const facts = textFacts(
      renderEmail({ kind: 'payment_confirmed', data: groupData([PICKLE, TENNIS], { timezone: 'Pacific/Honolulu', status: 'confirmed' }), site, forGuest: false }).text,
    )
    // 10:00 UTC on Jan 7 is 12:00 AM on Jan 7 in Honolulu (UTC-10)
    expect(value(facts, 'Pickle 1')).toMatch(/^Mon, Jan 7, 2030, 12:00\s?AM–2:00\s?AM$/)
  })

  it('lists three courts, and two bookings on the same court as two rows', () => {
    const second: Court = { ...PICKLE, booking_id: '33333333-3333-4333-8333-333333333333', reference_code: 'CB-CCC333', starts_at: '2030-01-07T12:00:00+00:00', ends_at: '2030-01-07T13:00:00+00:00' }
    const out = renderEmail({ kind: 'payment_confirmed', data: groupData([PICKLE, second, TENNIS], { status: 'confirmed' }), site, forGuest: false })
    expect(out.text.split('\n').filter((l) => l.startsWith('Pickle 1: '))).toHaveLength(2)
    expect(htmlFacts(out.html).filter(([k]) => k === 'Pickle 1')).toHaveLength(2)
    expect(out.text.split('\n').filter((l) => l.startsWith('Tennis 2: '))).toHaveLength(1)
  })

  it('escapes a court name in the html and leaves the text as typed', () => {
    const evil: Court = { ...TENNIS, court_name: 'Court <b>"A"</b> & Co' }
    const out = renderEmail({ kind: 'booking_created', data: groupData([PICKLE, evil]), site, forGuest: false })
    expect(out.html).toContain('Court &lt;b&gt;&quot;A&quot;&lt;/b&gt; &amp; Co')
    expect(out.html).not.toContain('<b>"A"</b>')
    expect(out.text).toContain('Court <b>"A"</b> & Co: ')
  })

  it('keeps the booking_created paragraph and status copy of today', () => {
    const today = render(CASES[0], undefined, false)
    const group = render(CASES[0], [PICKLE, TENNIS], false)
    const paragraphs = (text: string) => text.split('\n\n').slice(0, 2)
    expect(paragraphs(group.text)).toEqual(paragraphs(today.text))
  })

  it('shows the cancellation reason and who cancelled, as today', () => {
    const out = render(CASES[3], [PICKLE, TENNIS], false)
    expect(out.text).toContain('Claudex Courts cancelled this booking.')
    expect(out.text).toContain('Reason: Court flooded')
  })

  it('shows the rejection note, as today', () => {
    expect(render(CASES[2], [PICKLE, TENNIS], false).text).toContain('Reason: Blurry')
    expect(renderEmail({ kind: 'proof_rejected', data: groupData([PICKLE, TENNIS], { note: 'Wrong amount', final: true }), site, forGuest: false }).text).toContain(
      'Reason: Wrong amount',
    )
  })
})

describe('group emails keep the private-link rules', () => {
  it("booking_created for a guest carries the token link to the lead's reference, in the button and nowhere else", () => {
    const out = render(CASES[0], [PICKLE, TENNIS], true, TOKEN)
    const open = anchors(out.html).find((a) => a.label === 'Open your booking')
    expect(open?.href).toBe(`${site}/booking/CB-AAA111#token=${encodeURIComponent(TOKEN)}`)
    expect(out.text).toContain(`Open your booking: ${site}/booking/CB-AAA111#token=${encodeURIComponent(TOKEN)}`)
    expect(out.text).toContain('private access')
  })

  it("booking_created for a signed-in player links to the lead's booking without a token", () => {
    const out = render(CASES[0], [PICKLE, TENNIS], false, TOKEN)
    expect(anchors(out.html).find((a) => a.label === 'Open your booking')?.href).toBe(`${site}/booking/CB-AAA111`)
    expect(out.html).not.toContain(TOKEN)
    expect(out.text).not.toContain(TOKEN)
  })

  it("a guest's non-final proof_rejected carries the new token (Upload a new proof)", () => {
    const out = render(CASES[2], [PICKLE, TENNIS], true, TOKEN)
    expect(anchors(out.html).find((a) => a.label === 'Upload a new proof')?.href).toBe(`${site}/booking/CB-AAA111#token=${encodeURIComponent(TOKEN)}`)
  })

  it('a final proof_rejected has no token and no link for a guest', () => {
    const out = renderEmail({ kind: 'proof_rejected', data: groupData([PICKLE, TENNIS], { note: 'No', final: true }), site, forGuest: true, guestToken: TOKEN })
    expect(out.subject).toBe('Booking CB-AAA111 was not confirmed')
    expect(out.html).not.toContain(TOKEN)
    expect(out.text).not.toContain(TOKEN)
    expect(anchors(out.html).some((a) => a.label === 'Open your booking' || a.label === 'Upload a new proof')).toBe(false)
  })

  for (const kind of ['payment_confirmed', 'booking_cancelled', 'booking_reminder'] as const) {
    it(`${kind} never carries the token for a guest, even when one is passed, and has no booking button`, () => {
      const c = CASES.find((x) => x.kind === kind)!
      const out = render(c, [PICKLE, TENNIS], true, TOKEN)
      expect(out.html).not.toContain(TOKEN)
      expect(out.text).not.toContain(TOKEN)
      expect(anchors(out.html).some((a) => a.label === 'Open your booking')).toBe(false)
      expect(out.text).toContain('private link from your booking confirmation')
    })

    it(`${kind} links a signed-in player to the lead's booking page`, () => {
      const c = CASES.find((x) => x.kind === kind)!
      const out = render(c, [PICKLE, TENNIS], false)
      expect(anchors(out.html).find((a) => a.label === 'Open your booking')?.href).toBe(`${site}/booking/CB-AAA111`)
    })
  }
})
