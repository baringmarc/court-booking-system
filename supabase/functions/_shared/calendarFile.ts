// The .ics calendar file on booking emails (T30.3, SPEC §8; RESEARCH "Calendar file (T30.3)"). Plain TypeScript with
// no Deno APIs, so Vitest and tsc check it with the app. One VEVENT, METHOD:PUBLISH (no ATTENDEE: nobody is invited,
// RFC 5546), UTC times (so no VTIMEZONE), and a stable UID per booking, so a reschedule's file updates the event the
// confirmation added (a higher SEQUENCE, RFC 5545 §3.8.7.4).
import type { EmailAttachment } from './email.ts'
import type { EmailData, EmailKind } from './emailTemplates.ts'

export type CalendarEvent = {
  uid: string
  summary: string
  startsAt: string
  endsAt: string
  location: string
  description?: string
  sequence: number
  stamp: Date
}

/** 20300107T100000Z */
function utc(value: string | Date): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
}

/** TEXT escaping (RFC 5545 §3.3.11): backslash, semicolon, comma, and every newline as \n. */
function text(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
}

const encoder = new TextEncoder()

/** Folds a content line to at most 75 octets per physical line (CRLF + one space), never inside a character. */
function fold(line: string): string {
  const out: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = encoder.encode(char).length
    // A continuation line starts with a space, which counts toward its 75 octets.
    if (size + bytes > 75) {
      out.push(current)
      current = ' '
      size = 1
    }
    current += char
    size += bytes
  }
  out.push(current)
  return out.join('\r\n')
}

function eventLines(event: CalendarEvent): string[] {
  return [
    'BEGIN:VEVENT',
    `UID:${text(event.uid)}`,
    `DTSTAMP:${utc(event.stamp)}`,
    `DTSTART:${utc(event.startsAt)}`,
    `DTEND:${utc(event.endsAt)}`,
    `SEQUENCE:${Math.max(0, Math.floor(event.sequence))}`,
    `SUMMARY:${text(event.summary)}`,
    `LOCATION:${text(event.location)}`,
    ...(event.description !== undefined ? [`DESCRIPTION:${text(event.description)}`] : []),
    'STATUS:CONFIRMED',
    'END:VEVENT',
  ]
}

/** One calendar with a VEVENT per event: a booking group's courts (T33.2). */
export function buildIcsEvents(events: CalendarEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Plotline//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events.flatMap(eventLines),
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function buildIcs(event: CalendarEvent): string {
  return buildIcsEvents([event])
}

const SEQUENCE_EPOCH = Date.UTC(2026, 0, 1)
const KINDS: EmailKind[] = ['payment_confirmed', 'booking_reminder', 'booking_rescheduled']

function base64(value: string): string {
  let binary = ''
  for (const byte of encoder.encode(value)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * The file for one booking email, or null for a kind without one. The confirmation and the reminder carry the event
 * at SEQUENCE 0; a reschedule carries the new range with a SEQUENCE of whole minutes since 2026-01-01, so each later
 * move is newer. A split reschedule gets none: the original event keeps its first part and the moved hours are a
 * booking of their own, which one update can't express.
 */
export function bookingCalendarFile({ kind, data, bookingId, now }: { kind: EmailKind; data: EmailData; bookingId: string; now: Date }): EmailAttachment | null {
  if (!KINDS.includes(kind)) return null
  const moved = kind === 'booking_rescheduled'
  if (moved && data.continuation_reference?.trim()) return null
  const summary = (sport: string | undefined) => {
    const s = sport?.trim()
    return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)} at ${data.venue_name}` : `Booking at ${data.venue_name}`
  }
  const location = data.address?.trim() || data.venue_name
  // A booking group's confirmation and reminder (T33.2): one event per court, each with its own booking's UID, so a
  // later reschedule of one court updates its own event. A reschedule is always one court.
  const courts = !moved && data.courts && data.courts.length >= 2 ? data.courts : null
  const ics = courts
    ? buildIcsEvents(courts.map((c) => ({
        uid: `booking-${c.booking_id}@plotline.fit`,
        summary: summary(c.sport ?? data.sport),
        startsAt: c.starts_at,
        endsAt: c.ends_at,
        location,
        sequence: 0,
        stamp: now,
      })))
    : buildIcs({
        uid: `booking-${bookingId}@plotline.fit`,
        summary: summary(data.sport),
        startsAt: (moved && data.new_starts_at) || data.starts_at,
        endsAt: (moved && data.new_ends_at) || data.ends_at,
        location,
        sequence: moved ? Math.floor((now.getTime() - SEQUENCE_EPOCH) / 60000) : 0,
        stamp: now,
      })
  return {
    filename: `booking-${data.reference_code}.ics`,
    contentBase64: base64(ics),
    contentType: 'text/calendar; charset=utf-8; method=PUBLISH',
  }
}
