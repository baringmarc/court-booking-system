// T33.2: the calendar file of a booking group: one VCALENDAR with one VEVENT per court (RFC 5545), built by the new
// buildIcsEvents; buildIcs stays the one-event case.
import { describe, expect, it } from 'vitest'
import * as calendar from './calendarFile.ts'
import { bookingCalendarFile, buildIcs, type CalendarEvent } from './calendarFile.ts'
import type { EmailData, EmailKind } from './emailTemplates.ts'

// buildIcsEvents is new in T33.2; read it off the module so this file type-checks before it exists.
const buildIcsEvents = (calendar as unknown as { buildIcsEvents: (events: CalendarEvent[]) => string }).buildIcsEvents

const NOW = new Date('2026-11-21T09:30:00.000Z')

const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, '')
const lines = (ics: string) => unfold(ics).split('\r\n').filter((l) => l !== '')
const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
const octets = (s: string) => new TextEncoder().encode(s).length
/** The lines of each VEVENT, in order. */
const vevents = (ics: string): string[][] => {
  const out: string[][] = []
  let current: string[] | null = null
  for (const l of lines(ics)) {
    if (l === 'BEGIN:VEVENT') current = []
    else if (l === 'END:VEVENT') {
      if (current) out.push(current)
      current = null
    } else if (current) current.push(l)
  }
  return out
}
const propOf = (event: string[], name: string) => event.find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`))

const event1: CalendarEvent = {
  uid: 'booking-aaa@plotline.fit',
  summary: 'Pickleball at Claudex Courts',
  startsAt: '2030-01-07T10:00:00+00:00',
  endsAt: '2030-01-07T12:00:00+00:00',
  location: 'Claudex Courts',
  sequence: 0,
  stamp: NOW,
}
const event2: CalendarEvent = {
  ...event1,
  uid: 'booking-bbb@plotline.fit',
  summary: 'Tennis at Claudex Courts',
  startsAt: '2030-01-07T12:00:00+00:00',
  endsAt: '2030-01-07T13:00:00+00:00',
}

describe('buildIcsEvents', () => {
  it('is one VCALENDAR with the same header as buildIcs and one VEVENT per event, in order', () => {
    const ics = buildIcsEvents([event1, event2])
    const l = lines(ics)
    expect(l[0]).toBe('BEGIN:VCALENDAR')
    expect(l[l.length - 1]).toBe('END:VCALENDAR')
    expect(l.slice(1, 6)).toEqual(['VERSION:2.0', 'PRODID:-//Plotline//Booking//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT'])
    expect(l.filter((x) => x === 'BEGIN:VCALENDAR')).toHaveLength(1)
    expect(l.filter((x) => x === 'BEGIN:VEVENT')).toHaveLength(2)
    expect(l.filter((x) => x === 'END:VEVENT')).toHaveLength(2)
    const events = vevents(ics)
    expect(events.map((e) => propOf(e, 'UID'))).toEqual(['UID:booking-aaa@plotline.fit', 'UID:booking-bbb@plotline.fit'])
    expect(events.map((e) => propOf(e, 'DTSTART'))).toEqual(['DTSTART:20300107T100000Z', 'DTSTART:20300107T120000Z'])
    expect(events.map((e) => propOf(e, 'DTEND'))).toEqual(['DTEND:20300107T120000Z', 'DTEND:20300107T130000Z'])
    expect(events.map((e) => propOf(e, 'SUMMARY'))).toEqual(['SUMMARY:Pickleball at Claudex Courts', 'SUMMARY:Tennis at Claudex Courts'])
    for (const e of events) {
      expect(propOf(e, 'DTSTAMP')).toBe('DTSTAMP:20261121T093000Z')
      expect(e).toContain('STATUS:CONFIRMED')
      expect(e).toContain('SEQUENCE:0')
    }
  })

  it('uses CRLF line ends with no bare LF, and ends with a CRLF', () => {
    const ics = buildIcsEvents([event1, event2])
    expect(ics).toMatch(/\r\n$/)
    expect(ics).not.toMatch(/(?<!\r)\n/)
  })

  it('has no ATTENDEE, DURATION or ORGANIZER, and no VTIMEZONE', () => {
    const ics = buildIcsEvents([event1, { ...event2, description: 'Bring water' }])
    for (const word of ['ATTENDEE', 'DURATION', 'ORGANIZER', 'VTIMEZONE', 'TZID']) expect(ics).not.toContain(word)
  })

  it('folds long lines at 75 octets in every event, never inside a character', () => {
    const location = 'Court Rd, ' + 'Café Ñandú 🏸 '.repeat(15)
    const ics = buildIcsEvents([{ ...event1, location }, { ...event2, location }])
    const strict = new TextDecoder('utf-8', { fatal: true })
    for (const physical of ics.split('\r\n')) {
      expect(octets(physical)).toBeLessThanOrEqual(75)
      expect(() => strict.decode(new TextEncoder().encode(physical))).not.toThrow()
    }
    expect(ics.split('\r\n').some((x) => x.startsWith(' '))).toBe(true)
    for (const e of vevents(ics)) expect(propOf(e, 'LOCATION')).toBe(`LOCATION:${location.replace(/,/g, '\\,')}`)
  })

  it('escapes text values in every event', () => {
    const ics = buildIcsEvents([{ ...event1, summary: 'A, B; C' }, { ...event2, summary: 'D\nE' }])
    expect(vevents(ics).map((e) => propOf(e, 'SUMMARY'))).toEqual(['SUMMARY:A\\, B\\; C', 'SUMMARY:D\\nE'])
  })

  it('buildIcs(e) equals buildIcsEvents([e]), byte for byte', () => {
    expect(buildIcsEvents([event1])).toBe(buildIcs(event1))
    const long = { ...event2, description: 'Bring water, ' + 'and a towel; '.repeat(12), location: 'Court Rd, Quezon City' }
    expect(buildIcsEvents([long])).toBe(buildIcs(long))
  })
})

describe('bookingCalendarFile for a group', () => {
  const LEAD = '11111111-1111-4111-8111-111111111111'
  const SECOND = '22222222-2222-4222-8222-222222222222'
  const THIRD = '33333333-3333-4333-8333-333333333333'
  const courts = [
    { booking_id: LEAD, reference_code: 'CB-AAA111', court_name: 'Pickle 1', sport: 'pickleball', starts_at: '2030-01-07T10:00:00+00:00', ends_at: '2030-01-07T12:00:00+00:00', total_amount: 700 },
    { booking_id: SECOND, reference_code: 'CB-BBB222', court_name: 'Tennis 2', sport: 'tennis', starts_at: '2030-01-07T12:00:00+00:00', ends_at: '2030-01-07T13:00:00+00:00', total_amount: '400.00' },
  ]
  const base: EmailData = {
    reference_code: 'CB-AAA111',
    venue_name: 'Claudex Courts',
    timezone: 'Asia/Manila',
    court_name: 'Pickle 1',
    sport: 'pickleball',
    starts_at: '2030-01-07T10:00:00+00:00',
    ends_at: '2030-01-07T12:00:00+00:00',
    total_amount: 1100,
    address: 'Court Rd, Quezon City',
    name: 'Gina Guest',
  }
  // `courts` is new on EmailData in T33.2; a spread of a variable is not checked for extra keys, so this compiles before and after.
  const withCourts = (list: unknown[] | undefined, over: Partial<EmailData> = {}): EmailData => ({ ...base, ...over, ...(list ? { courts: list } : {}) }) as EmailData
  const call = (kind: EmailKind, list: unknown[] | undefined, over: Partial<EmailData> = {}) =>
    bookingCalendarFile({ kind, data: withCourts(list, over), bookingId: LEAD, now: NOW })

  for (const kind of ['payment_confirmed', 'booking_reminder'] as const) {
    describe(kind, () => {
      it('is one attachment named after the lead reference, with the calendar content type', () => {
        const file = call(kind, courts)!
        expect(file.filename).toBe('booking-CB-AAA111.ics')
        expect(file.contentType).toBe('text/calendar; charset=utf-8; method=PUBLISH')
        const ics = decode(file.contentBase64)
        expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
        expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
        expect(lines(ics).filter((x) => x === 'BEGIN:VCALENDAR')).toHaveLength(1)
      })

      it("has one VEVENT per court, UID from that court's booking id, its own UTC start and end, SEQUENCE 0", () => {
        const events = vevents(decode(call(kind, courts)!.contentBase64))
        expect(events).toHaveLength(2)
        expect(events.map((e) => propOf(e, 'UID'))).toEqual([`UID:booking-${LEAD}@plotline.fit`, `UID:booking-${SECOND}@plotline.fit`])
        expect(events.map((e) => propOf(e, 'DTSTART'))).toEqual(['DTSTART:20300107T100000Z', 'DTSTART:20300107T120000Z'])
        expect(events.map((e) => propOf(e, 'DTEND'))).toEqual(['DTEND:20300107T120000Z', 'DTEND:20300107T130000Z'])
        for (const e of events) {
          expect(propOf(e, 'SEQUENCE')).toBe('SEQUENCE:0')
          expect(propOf(e, 'DTSTAMP')).toBe('DTSTAMP:20261121T093000Z')
          expect(propOf(e, 'LOCATION')).toBe('LOCATION:Court Rd\\, Quezon City')
          expect(propOf(e, 'SUMMARY')).toContain('Claudex Courts')
        }
      })

      it('has a VEVENT for each of three courts, an early-morning and a late-night one converted to UTC', () => {
        const three = [
          { ...courts[0], starts_at: '2030-01-07T06:00:00+08:00', ends_at: '2030-01-07T07:00:00+08:00' }, // 22:00 UTC the day before
          { ...courts[1], starts_at: '2030-01-07T20:00:00+08:00', ends_at: '2030-01-07T21:00:00+08:00' },
          { booking_id: THIRD, reference_code: 'CB-CCC333', court_name: 'Tennis 3', sport: 'tennis', starts_at: '2030-01-07T21:00:00+08:00', ends_at: '2030-01-07T22:00:00+08:00', total_amount: 300 },
        ]
        const events = vevents(decode(call(kind, three)!.contentBase64))
        expect(events.map((e) => propOf(e, 'DTSTART'))).toEqual(['DTSTART:20300106T220000Z', 'DTSTART:20300107T120000Z', 'DTSTART:20300107T130000Z'])
        expect(events.map((e) => propOf(e, 'UID'))).toEqual([LEAD, SECOND, THIRD].map((id) => `UID:booking-${id}@plotline.fit`))
      })
    })
  }

  it('is the single-court file, unchanged, with no courts, an empty list or one court', () => {
    for (const kind of ['payment_confirmed', 'booking_reminder'] as const) {
      const today = call(kind, undefined)!
      expect(call(kind, [])).toEqual(today)
      expect(call(kind, [courts[0]])).toEqual(today)
      const events = vevents(decode(today.contentBase64))
      expect(events).toHaveLength(1)
      expect(propOf(events[0], 'UID')).toBe(`UID:booking-${LEAD}@plotline.fit`)
      expect(propOf(events[0], 'SUMMARY')).toBe('SUMMARY:Pickleball at Claudex Courts')
    }
  })

  it('leaves booking_rescheduled unchanged (one court), whatever courts say', () => {
    const moved: Partial<EmailData> = { new_starts_at: '2030-01-09T00:30:00+00:00', new_ends_at: '2030-01-09T01:30:00+00:00' }
    const today = call('booking_rescheduled', undefined, moved)!
    expect(call('booking_rescheduled', courts, moved)).toEqual(today)
    expect(vevents(decode(today.contentBase64))).toHaveLength(1)
  })

  it('gives booking_created, proof_rejected and booking_cancelled no file, group or not', () => {
    for (const kind of ['booking_created', 'proof_rejected', 'booking_cancelled'] as const) {
      expect(call(kind, courts)).toBeNull()
      expect(call(kind, undefined)).toBeNull()
    }
  })
})
