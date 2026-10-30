// T11.30: a guest's non-final proof_rejected email carries a fresh private link, "Upload a new proof".
import { describe, expect, it } from 'vitest'
import { renderEmail, type EmailData, type EmailKind } from './emailTemplates.ts'

const data: EmailData = {
  reference_code: 'CB-7KQ2XD',
  venue_name: 'Claudex Courts',
  timezone: 'Asia/Manila',
  court_name: 'Badminton 1',
  sport: 'badminton',
  starts_at: '2030-01-07T10:00:00+00:00',
  ends_at: '2030-01-07T12:00:00+00:00',
  total_amount: 700,
  booking_fee: 0,
  amount_due: 700,
  status: 'pending_payment',
  expires_at: '2030-01-06T05:00:00+00:00',
  name: 'Gina Guest',
  note: 'Screenshot is cut off',
}
const site = 'https://claudex.example'
const TOKEN = 'tok_SECRET-123'
const LINK = `https://claudex.example/booking/CB-7KQ2XD#token=${TOKEN}`

describe('proof_rejected re-upload link (T11.30)', () => {
  it("gives a guest's non-final rejection an 'Upload a new proof' link with the token", () => {
    const { text, html } = renderEmail({ kind: 'proof_rejected', data, site, forGuest: true, guestToken: TOKEN })
    expect(text).toContain(LINK)
    expect(text).toContain('Upload a new proof')
    expect(html).toContain(`href="${LINK}"`)
    expect(html).toContain('Upload a new proof')
    expect(text).not.toContain('Open your booking')
    expect(text).toContain('Keep it safe')
    expect(text).not.toContain('sign up or log in with this email address')
  })

  it('treats a falsy final flag as non-final', () => {
    const { text } = renderEmail({ kind: 'proof_rejected', data: { ...data, final: false }, site, forGuest: true, guestToken: TOKEN })
    expect(text).toContain(LINK)
  })

  it('gives a final rejection no token link', () => {
    const { text, html } = renderEmail({ kind: 'proof_rejected', data: { ...data, final: true }, site, forGuest: true, guestToken: TOKEN })
    expect(text).not.toContain(TOKEN)
    expect(html).not.toContain(TOKEN)
    expect(text).not.toContain('/booking/')
    expect(text).not.toContain('Upload a new proof')
  })

  it("keeps a guest's non-final rejection linkless when no token was issued", () => {
    const { text, html } = renderEmail({ kind: 'proof_rejected', data, site, forGuest: true })
    expect(text).not.toContain('/booking/')
    expect(html).not.toContain('<a ')
  })

  it("keeps a signed-in player's plain link, ignoring any token", () => {
    const { text, html } = renderEmail({ kind: 'proof_rejected', data, site, forGuest: false, guestToken: TOKEN })
    expect(text).toContain('https://claudex.example/booking/CB-7KQ2XD')
    expect(text).not.toContain(TOKEN)
    expect(html).not.toContain(TOKEN)
    expect(text).not.toContain('Upload a new proof')
    expect(text).toContain('Open your booking')
  })

  it('puts the token in no other kind for a guest', () => {
    const kinds: EmailKind[] = ['payment_confirmed', 'booking_cancelled', 'booking_rescheduled']
    for (const kind of kinds) {
      const { text, html } = renderEmail({ kind, data, site, forGuest: true, guestToken: TOKEN })
      expect(text).not.toContain(TOKEN)
      expect(html).not.toContain(TOKEN)
    }
  })
})
