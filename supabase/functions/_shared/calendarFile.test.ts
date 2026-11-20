// T30.3: the .ics attachment (RFC 5545, https://www.rfc-editor.org/rfc/rfc5545; RESEARCH.md "Calendar file (T30.3)").
import { describe, expect, it } from 'vitest'
import { bookingCalendarFile, buildIcs } from './calendarFile.ts'
import type { EmailData, EmailKind } from './emailTemplates.ts'

const NOW = new Date('2026-11-21T09:30:00.000Z')
const BOOKING_ID = '8d6f2f0e-5c3a-4a43-9d1b-2f1d7a9c0b11'

const unfold = (ics: string) => ics.replace(/\r\n[ \t]/g, '')
const lines = (ics: string) => unfold(ics).split('\r\n').filter((l) => l !== '')
const prop = (ics: string, name: string) => lines(ics).find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`))
const decode = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
const octets = (s: string) => new TextEncoder().encode(s).length

const event = {
  uid: 'booking-abc@plotline.fit',
  summary: 'Pickleball at Claudex Courts',
  startsAt: '2030-01-07T10:00:00+00:00',
  endsAt: '2030-01-07T12:00:00+00:00',
  location: 'Claudex Courts',
  sequence: 0,
  stamp: NOW,
}

describe('buildIcs', () => {
  it('is a CRLF-delimited VCALENDAR with one VEVENT, METHOD:PUBLISH and the required properties', () => {
    const ics = buildIcs(event)
    expect(ics).toMatch(/\r\n$/)
    expect(ics).not.toMatch(/(?<!\r)\n/) // no bare LF
    const l = lines(ics)
    expect(l[0]).toBe('BEGIN:VCALENDAR')
    expect(l[l.length - 1]).toBe('END:VCALENDAR')
    expect(l).toContain('VERSION:2.0')
    expect(l).toContain('PRODID:-//Plotline//Booking//EN')
    expect(l).toContain('CALSCALE:GREGORIAN')
    expect(l).toContain('METHOD:PUBLISH')
    expect(l.filter((x) => x === 'BEGIN:VEVENT')).toHaveLength(1)
    expect(l.filter((x) => x === 'END:VEVENT')).toHaveLength(1)
    expect(l.indexOf('BEGIN:VEVENT')).toBeLessThan(l.indexOf('END:VEVENT'))
    expect(l).toContain('UID:booking-abc@plotline.fit')
    expect(l).toContain('STATUS:CONFIRMED')
    expect(l).toContain('SEQUENCE:0')
    expect(l).toContain('SUMMARY:Pickleball at Claudex Courts')
    expect(l).toContain('LOCATION:Claudex Courts')
  })

  it('writes DTSTAMP, DTSTART and DTEND as UTC basic-format times (no TZID, no VTIMEZONE)', () => {
    const ics = buildIcs(event)
    expect(prop(ics, 'DTSTAMP')).toBe('DTSTAMP:20261121T093000Z')
    expect(prop(ics, 'DTSTART')).toBe('DTSTART:20300107T100000Z')
    expect(prop(ics, 'DTEND')).toBe('DTEND:20300107T120000Z')
    expect(ics).not.toContain('TZID')
    expect(ics).not.toContain('VTIMEZONE')
  })

  it('converts any offset to UTC, across a date line (7:30 AM and 11:30 PM in Manila)', () => {
    const early = buildIcs({ ...event, startsAt: '2030-01-07T07:30:00+08:00', endsAt: '2030-01-07T08:30:00+08:00' })
    expect(prop(early, 'DTSTART')).toBe('DTSTART:20300106T233000Z')
    expect(prop(early, 'DTEND')).toBe('DTEND:20300107T003000Z')
    const late = buildIcs({ ...event, startsAt: '2030-01-07T23:30:00+08:00', endsAt: '2030-01-08T00:30:00+08:00' })
    expect(prop(late, 'DTSTART')).toBe('DTSTART:20300107T153000Z')
    expect(prop(late, 'DTEND')).toBe('DTEND:20300107T163000Z')
  })

  it('has no ATTENDEE, DURATION or ORGANIZER', () => {
    const ics = buildIcs({ ...event, description: 'x' })
    expect(ics).not.toContain('ATTENDEE')
    expect(ics).not.toContain('DURATION')
    expect(ics).not.toContain('ORGANIZER')
  })

  it('writes the sequence it is given', () => {
    expect(prop(buildIcs({ ...event, sequence: 482901 }), 'SEQUENCE')).toBe('SEQUENCE:482901')
  })

  it('writes DESCRIPTION only when given', () => {
    expect(prop(buildIcs(event), 'DESCRIPTION')).toBeUndefined()
    expect(prop(buildIcs({ ...event, description: 'Bring water' }), 'DESCRIPTION')).toBe('DESCRIPTION:Bring water')
  })

  it('escapes backslash, semicolon, comma and newlines in text values', () => {
    const ics = buildIcs({ ...event, summary: 'A, B; C\\D', location: 'Line 1\nLine 2\r\nLine 3', description: 'one\ntwo' })
    expect(prop(ics, 'SUMMARY')).toBe('SUMMARY:A\\, B\\; C\\\\D')
    expect(prop(ics, 'LOCATION')).toBe('LOCATION:Line 1\\nLine 2\\nLine 3')
    expect(prop(ics, 'DESCRIPTION')).toBe('DESCRIPTION:one\\ntwo')
    // After escaping there is no raw newline inside a content line: every physical line is one property.
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true)
  })

  it('does not let a value inject a property line', () => {
    const ics = buildIcs({ ...event, summary: 'Hi\r\nATTENDEE:mailto:evil@example.com' })
    expect(ics.split('\r\n').some((l) => l.startsWith('ATTENDEE'))).toBe(false)
    expect(prop(ics, 'SUMMARY')).toBe('SUMMARY:Hi\\nATTENDEE:mailto:evil@example.com')
  })

  it('folds lines longer than 75 octets with CRLF + one space, and unfolding restores the value', () => {
    const location = 'Court Rd, ' + 'Barangay Sampaguita '.repeat(12)
    const ics = buildIcs({ ...event, location })
    const physical = ics.split('\r\n')
    expect(physical.every((l) => octets(l) <= 75)).toBe(true)
    expect(physical.some((l) => l.startsWith(' '))).toBe(true)
    expect(prop(ics, 'LOCATION')).toBe(`LOCATION:${location.replace(/,/g, '\\,')}`)
  })

  it('never folds inside a multi-byte character', () => {
    // Every position from the start of the value is tried by varying the length of a one-octet prefix.
    for (let pad = 0; pad < 8; pad++) {
      const location = 'x'.repeat(pad) + 'Café Ñandú 🏸 '.repeat(15)
      const ics = buildIcs({ ...event, location })
      const physical = ics.split('\r\n')
      const strict = new TextDecoder('utf-8', { fatal: true })
      for (const l of physical) {
        expect(octets(l)).toBeLessThanOrEqual(75)
        expect(() => strict.decode(new TextEncoder().encode(l))).not.toThrow()
        expect(l).not.toContain('�')
      }
      expect(prop(ics, 'LOCATION')).toBe(`LOCATION:${location}`)
    }
  })

  it('does not fold a short line', () => {
    expect(buildIcs(event).split('\r\n').filter((l) => l.startsWith(' '))).toHaveLength(0)
  })
})

describe('bookingCalendarFile', () => {
  const data: EmailData = {
    reference_code: 'CB-7KQ2XD',
    venue_name: 'Claudex Courts',
    timezone: 'Asia/Manila',
    court_name: 'Pickle 1',
    sport: 'pickleball',
    starts_at: '2030-01-07T10:00:00+00:00',
    ends_at: '2030-01-07T12:00:00+00:00',
    total_amount: 700,
    address: 'Court Rd, Quezon City',
    name: 'Gina Guest',
  }
  const call = (kind: EmailKind, over: Partial<EmailData> = {}, now = NOW) =>
    bookingCalendarFile({ kind, data: { ...data, ...over }, bookingId: BOOKING_ID, now })
  const text = (kind: EmailKind, over: Partial<EmailData> = {}, now = NOW) => decode(call(kind, over, now)!.contentBase64)

  it('attaches a file only to payment_confirmed, booking_reminder and booking_rescheduled', () => {
    expect(call('payment_confirmed')).not.toBeNull()
    expect(call('booking_reminder')).not.toBeNull()
    expect(call('booking_rescheduled')).not.toBeNull()
    expect(call('booking_created')).toBeNull()
    expect(call('proof_rejected')).toBeNull()
    expect(call('booking_cancelled')).toBeNull()
  })

  it('names the file after the reference, with the calendar content type and a base64 UTF-8 body', () => {
    const file = call('payment_confirmed')!
    expect(file.filename).toBe('booking-CB-7KQ2XD.ics')
    expect(file.contentType).toBe('text/calendar; charset=utf-8; method=PUBLISH')
    const ics = decode(file.contentBase64)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).toContain('METHOD:PUBLISH')
  })

  it('builds the confirmation from the booking: UID from the booking id, UTC times, SEQUENCE 0, DTSTAMP now', () => {
    const ics = text('payment_confirmed')
    expect(prop(ics, 'UID')).toBe(`UID:booking-${BOOKING_ID}@plotline.fit`)
    expect(prop(ics, 'DTSTART')).toBe('DTSTART:20300107T100000Z')
    expect(prop(ics, 'DTEND')).toBe('DTEND:20300107T120000Z')
    expect(prop(ics, 'SEQUENCE')).toBe('SEQUENCE:0')
    expect(prop(ics, 'DTSTAMP')).toBe('DTSTAMP:20261121T093000Z')
    expect(prop(ics, 'SUMMARY')).toBe('SUMMARY:Pickleball at Claudex Courts')
  })

  it('uses the address as the location (escaped), else the venue name', () => {
    expect(prop(text('payment_confirmed'), 'LOCATION')).toBe('LOCATION:Court Rd\\, Quezon City')
    expect(prop(text('payment_confirmed', { address: null }), 'LOCATION')).toBe('LOCATION:Claudex Courts')
    expect(prop(text('payment_confirmed', { address: '   ' }), 'LOCATION')).toBe('LOCATION:Claudex Courts')
    expect(prop(text('payment_confirmed', { address: undefined }), 'LOCATION')).toBe('LOCATION:Claudex Courts')
  })

  it('titles a booking without a sport "Booking at <venue>"', () => {
    expect(prop(text('payment_confirmed', { sport: undefined }), 'SUMMARY')).toBe('SUMMARY:Booking at Claudex Courts')
  })

  it('keeps the same UID for every kind of one booking, and uses the booking id, not the reference', () => {
    const uids = (['payment_confirmed', 'booking_reminder', 'booking_rescheduled'] as EmailKind[]).map((k) => prop(text(k), 'UID'))
    expect(new Set(uids).size).toBe(1)
    expect(uids[0]).not.toContain('CB-7KQ2XD')
    const other = bookingCalendarFile({ kind: 'payment_confirmed', data, bookingId: 'ffffffff-0000-4000-8000-000000000001', now: NOW })!
    expect(prop(decode(other.contentBase64), 'UID')).not.toBe(uids[0])
  })

  it('gives the reminder the same event and sequence as the confirmation', () => {
    const ics = text('booking_reminder')
    expect(prop(ics, 'DTSTART')).toBe('DTSTART:20300107T100000Z')
    expect(prop(ics, 'DTEND')).toBe('DTEND:20300107T120000Z')
    expect(prop(ics, 'SEQUENCE')).toBe('SEQUENCE:0')
    expect(call('booking_reminder')!.filename).toBe('booking-CB-7KQ2XD.ics')
  })

  describe('booking_rescheduled', () => {
    const moved: Partial<EmailData> = { new_starts_at: '2030-01-09T00:30:00+00:00', new_ends_at: '2030-01-09T01:30:00+00:00' }

    it('is the updated event: the new range, the same UID, and a SEQUENCE of whole minutes since 2026-01-01', () => {
      const ics = text('booking_rescheduled', moved)
      expect(prop(ics, 'DTSTART')).toBe('DTSTART:20300109T003000Z')
      expect(prop(ics, 'DTEND')).toBe('DTEND:20300109T013000Z')
      expect(prop(ics, 'UID')).toBe(`UID:booking-${BOOKING_ID}@plotline.fit`)
      const minutes = Math.round((NOW.getTime() - Date.UTC(2026, 0, 1)) / 60000)
      expect(prop(ics, 'SEQUENCE')).toBe(`SEQUENCE:${minutes}`)
      expect(minutes).toBeGreaterThan(0)
    })

    it('raises the SEQUENCE for a later reschedule (a minute apart is enough)', () => {
      const seq = (now: Date) => Number(prop(text('booking_rescheduled', moved, now), 'SEQUENCE')!.split(':')[1])
      const first = seq(NOW)
      const second = seq(new Date(NOW.getTime() + 60_000))
      expect(second).toBeGreaterThan(first)
      expect(second - first).toBe(1)
    })

    it('falls back to starts_at and ends_at when the new range is missing', () => {
      const ics = text('booking_rescheduled')
      expect(prop(ics, 'DTSTART')).toBe('DTSTART:20300107T100000Z')
      expect(prop(ics, 'DTEND')).toBe('DTEND:20300107T120000Z')
    })

    it('has no file when the booking was split (a continuation reference is set)', () => {
      expect(call('booking_rescheduled', { ...moved, continuation_reference: 'CB-9ZZZZ2' })).toBeNull()
    })

    it('still has a file when the continuation reference is null or absent', () => {
      expect(call('booking_rescheduled', { ...moved, continuation_reference: null })).not.toBeNull()
      expect(call('booking_rescheduled', moved)).not.toBeNull()
    })
  })
})
