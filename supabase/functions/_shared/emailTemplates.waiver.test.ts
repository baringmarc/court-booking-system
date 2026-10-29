// T11.20: the booking_created email repeats the waiver the player accepted (and no other kind does).
import { describe, expect, it } from 'vitest'
import { renderEmail, type EmailData, type EmailKind } from './emailTemplates.ts'

const data: EmailData = {
  reference_code: 'CB-7KQ2XD', venue_name: 'Claudex Courts', timezone: 'Asia/Manila', court_name: 'Badminton 1',
  sport: 'badminton', starts_at: '2030-01-07T10:00:00+00:00', ends_at: '2030-01-07T12:00:00+00:00',
  total_amount: 700, booking_fee: 0, amount_due: 700, status: 'pending_payment',
  expires_at: '2030-01-06T05:00:00+00:00', name: 'Gina Guest',
}
const site = 'https://claudex.example'
const LEAD = "You accepted the venue's waiver:"

describe('waiver in emails', () => {
  it('booking_created includes the lead-in and the text, in text and HTML', () => {
    const { text, html } = renderEmail({ kind: 'booking_created', data: { ...data, waiver_text: 'Play at your own risk.' }, site, forGuest: false })
    expect(text).toContain(LEAD)
    expect(text).toContain('Play at your own risk.')
    expect(html).toContain('Play at your own risk.')
    expect(html).toMatch(/You accepted the venue(&#39;|&#x27;|')s waiver:/)
  })

  it('escapes the waiver text in HTML', () => {
    const { html } = renderEmail({ kind: 'booking_created', data: { ...data, waiver_text: '<script>alert(1)</script> & co' }, site, forGuest: false })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp; co')
  })

  it('has no waiver lines when the text is null, missing or blank', () => {
    for (const waiver_text of [null, undefined, '']) {
      const { text, html } = renderEmail({ kind: 'booking_created', data: { ...data, waiver_text }, site, forGuest: false })
      expect(text).not.toContain('waiver')
      expect(html).not.toContain('waiver')
    }
  })

  it('no other email kind shows it', () => {
    const kinds: EmailKind[] = ['payment_confirmed', 'proof_rejected', 'booking_cancelled', 'booking_rescheduled']
    for (const kind of kinds) {
      const { text, html } = renderEmail({ kind, data: { ...data, waiver_text: 'Play at your own risk.' }, site, forGuest: false })
      expect(text).not.toContain('Play at your own risk.')
      expect(html).not.toContain('Play at your own risk.')
    }
  })
})
