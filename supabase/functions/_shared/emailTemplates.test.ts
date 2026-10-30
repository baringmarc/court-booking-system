import { describe, expect, it } from 'vitest'
import { bookingLink, escapeHtml, renderEmail, shouldSkip, type EmailData, type EmailKind } from './emailTemplates.ts'

const data: EmailData = {
  reference_code: 'CB-7KQ2XD',
  venue_name: 'Claudex Courts',
  timezone: 'Asia/Manila',
  court_name: 'Badminton 1',
  sport: 'badminton',
  starts_at: '2030-01-07T10:00:00+00:00', // 6:00 PM in Manila
  ends_at: '2030-01-07T12:00:00+00:00',
  total_amount: 700,
  booking_fee: 0,
  amount_due: 700,
  status: 'pending_payment',
  expires_at: '2030-01-06T05:00:00+00:00',
  name: 'Gina Guest',
}
const site = 'https://claudex.example'
const TOKEN = 'tok_SECRET-123'
const KINDS: EmailKind[] = ['booking_created', 'payment_confirmed', 'proof_rejected', 'booking_cancelled', 'booking_rescheduled']

describe('renderEmail', () => {
  it('shows the booking facts in the venue timezone and currency', () => {
    const { subject, text, html } = renderEmail({ kind: 'booking_created', data, site, forGuest: false })
    expect(subject).toBe('Booking CB-7KQ2XD: please pay to confirm')
    expect(text).toContain('Hi Gina,')
    expect(text).toContain('Court: Badminton 1')
    expect(text).toMatch(/When: Mon, Jan 7, 2030, 6:00\s?PM–8:00\s?PM/)
    expect(text).toContain('Total: ₱700.00')
    expect(text).toMatch(/Please pay by 1:00\s?PM on Sun, Jan 6, 2030/)
    expect(html).toContain('Badminton 1')
  })

  it('uses the Plotline palette with web-safe font fallbacks, headed by the venue (T11.4)', () => {
    for (const kind of KINDS) {
      const { html } = renderEmail({ kind, data, site, forGuest: false })
      expect(html).toContain('background:#f5efe6') // cream page
      expect(html).toContain('color:#3b2f2a') // brown text
      expect(html).toContain("Georgia,'Times New Roman',serif")
      expect(html).toContain('Arial,sans-serif')
      expect(html).toContain('background:#b7c4a8;color:#3b2f2a;border:1.5px solid #4c6b3c') // the sage button
      expect(html).toMatch(/font-weight:700">Claudex Courts<\/p>/)
      expect(html).toContain('Powered by Plotline')
      expect(html).not.toContain('#0f7a55') // the old green
    }
  })

  it("links a player's emails to the booking page, which needs their session", () => {
    for (const kind of KINDS) {
      const { text } = renderEmail({ kind, data, site, forGuest: false })
      expect(text).toContain('Open your booking: https://claudex.example/booking/CB-7KQ2XD\n')
      expect(text).not.toContain('#token=')
    }
  })

  it("puts the guest's private link only in their booking_created email", () => {
    const created = renderEmail({ kind: 'booking_created', data, site, forGuest: true, guestToken: TOKEN })
    expect(created.text).toContain(`https://claudex.example/booking/CB-7KQ2XD#token=${TOKEN}`)
    expect(created.html).toContain(`#token=${TOKEN}`)
    expect(created.text).toContain('Keep it safe')

    // proof_rejected is the one other kind that carries the token (T11.30, emailTemplates.reupload.test.ts).
    for (const kind of KINDS.filter((k) => k !== 'booking_created' && k !== 'proof_rejected')) {
      const other = renderEmail({ kind, data, site, forGuest: true, guestToken: TOKEN })
      expect(other.text).not.toContain(TOKEN)
      expect(other.html).not.toContain(TOKEN)
      expect(other.text).not.toContain('/booking/')
      expect(other.text).toContain('sign up or log in with this email address')
    }
  })

  it("never links a guest's email without the token (the page would say not found)", () => {
    const { text, html } = renderEmail({ kind: 'booking_created', data, site, forGuest: true })
    expect(text).not.toContain('/booking/')
    expect(html).not.toContain('<a ')
    expect(text).toContain('open the private link from your booking confirmation')
  })

  it('renders booking_created from the status now, so a fast payer gets no stale "please pay"', () => {
    const paid = renderEmail({ kind: 'booking_created', data, site, forGuest: true, guestToken: TOKEN, currentStatus: 'confirmed' })
    expect(paid.subject).toBe('Booking CB-7KQ2XD is confirmed')
    expect(paid.text).not.toContain('Please pay')
    expect(paid.text).toContain(`#token=${TOKEN}`)

    const checking = renderEmail({ kind: 'booking_created', data, site, forGuest: false, currentStatus: 'payment_submitted' })
    expect(checking.subject).toBe("Booking CB-7KQ2XD: we're checking your payment")
  })

  it('a rejection gives the reason, and says when it was the last one', () => {
    const again = renderEmail({ kind: 'proof_rejected', data: { ...data, note: 'Blurry screenshot', final: false }, site, forGuest: false })
    expect(again.subject).toBe('Booking CB-7KQ2XD: please upload a new proof')
    expect(again.text).toContain('Reason: Blurry screenshot')
    expect(again.text).toMatch(/upload a new one before 1:00\s?PM/)

    const final = renderEmail({ kind: 'proof_rejected', data: { ...data, note: 'Wrong amount', final: true }, site, forGuest: false })
    expect(final.subject).toBe('Booking CB-7KQ2XD was not confirmed')
    expect(final.text).toContain('the times were released')
    expect(final.text).toContain('Reason: Wrong amount')
  })

  it('a cancellation says who cancelled', () => {
    const byVenue = renderEmail({ kind: 'booking_cancelled', data: { ...data, cancelled_by_venue: true, reason: 'Roof repair' }, site, forGuest: false })
    expect(byVenue.subject).toBe('Booking CB-7KQ2XD was cancelled')
    expect(byVenue.text).toContain('Claudex Courts cancelled this booking.')
    expect(byVenue.text).toContain('Reason: Roof repair')

    const byPlayer = renderEmail({ kind: 'booking_cancelled', data: { ...data, cancelled_by_venue: false, reason: null }, site, forGuest: false })
    expect(byPlayer.text).toContain('This booking was cancelled.')
    expect(byPlayer.text).not.toContain('Reason:')
  })

  it('a reschedule names the new court and time, the old ones and the reason', () => {
    const moved: EmailData = {
      ...data,
      starts_at: '2030-01-07T10:00:00+00:00', // the root, as it is after the move (unused here)
      ends_at: '2030-01-07T11:00:00+00:00',
      old_court_name: 'Badminton 1',
      old_starts_at: '2030-01-07T10:00:00+00:00', // 6 PM
      old_ends_at: '2030-01-07T12:00:00+00:00',
      new_court_name: 'Badminton 2',
      new_starts_at: '2030-01-08T08:00:00+00:00', // 4 PM next day
      new_ends_at: '2030-01-08T10:00:00+00:00',
      reason: 'Rain flooded the court',
    }
    const { subject, text, html } = renderEmail({ kind: 'booking_rescheduled', data: moved, site, forGuest: false })
    expect(subject).toBe('Booking CB-7KQ2XD was moved')
    expect(text).toContain('Claudex Courts moved your booking to a new time.')
    expect(text).toMatch(/Moved to: Badminton 2, Tue, Jan 8, 2030, 4:00\s?PM–6:00\s?PM/)
    expect(text).toMatch(/Was: Badminton 1, Mon, Jan 7, 2030, 6:00\s?PM–8:00\s?PM/)
    expect(text).toContain('Reason: Rain flooded the court')
    expect(text).toContain('Reference: CB-7KQ2XD')
    expect(text).toContain('Open your booking: https://claudex.example/booking/CB-7KQ2XD\n')
    expect(html).toContain('Badminton 2')
  })

  it('a split reschedule gives the moved part its own reference', () => {
    const { text } = renderEmail({
      kind: 'booking_rescheduled',
      data: { ...data, new_court_name: 'Badminton 2', new_starts_at: '2030-01-08T08:00:00+00:00', new_ends_at: '2030-01-08T09:00:00+00:00', continuation_reference: 'CB-MOVED1', reason: 'Rain' },
      site,
      forGuest: false,
    })
    expect(text).toContain('moved the rest of your booking')
    expect(text).toContain('The moved hours have their own reference, CB-MOVED1.')
    expect(text).toContain('Reference: CB-MOVED1')
    expect(text).not.toContain('Was:') // no old range in this snapshot
  })

  it('escapes a reschedule reason from staff in the HTML', () => {
    const { html } = renderEmail({ kind: 'booking_rescheduled', data: { ...data, reason: '<script>x</script>' }, site, forGuest: false })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
  })

  it('payment_confirmed confirms', () => {
    expect(renderEmail({ kind: 'payment_confirmed', data, site, forGuest: false }).subject).toBe('Booking CB-7KQ2XD is confirmed')
  })

  it('escapes everything that came from users in the HTML', () => {
    const evil = { ...data, name: '<script>x</script>', court_name: 'A & B "court"', note: '<img src=x onerror=1>', final: false }
    const { html } = renderEmail({ kind: 'proof_rejected', data: evil, site, forGuest: false })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('A &amp; B &quot;court&quot;')
  })

  it('greets without a name', () => {
    expect(renderEmail({ kind: 'payment_confirmed', data: { ...data, name: null }, site, forGuest: false }).text).toMatch(/^Hi there,/)
  })
})

describe('renderEmail: the booking fee split (T11.13)', () => {
  // A 7 AM Manila booking (11 PM the day before in UTC): court price 350, Plotline's fee 10, amount due 360.
  const withFee: EmailData = {
    ...data,
    starts_at: '2030-01-06T23:00:00+00:00',
    ends_at: '2030-01-07T00:00:00+00:00',
    total_amount: 350,
    booking_fee: 10,
    amount_due: 360,
  }
  const AMOUNT_KINDS: EmailKind[] = ['booking_created', 'payment_confirmed', 'proof_rejected', 'booking_cancelled']

  it('shows the court price, the booking fee and the total (amount due), in that order', () => {
    const { text } = renderEmail({ kind: 'booking_created', data: withFee, site, forGuest: false })
    expect(text).toContain('Court price: ₱350.00\nBooking fee: ₱10.00\nTotal: ₱360.00')
    expect(text).toMatch(/When: Mon, Jan 7, 2030, 7:00\s?AM–8:00\s?AM/)
  })

  it('shows the split in every email that lists the amount', () => {
    for (const kind of AMOUNT_KINDS) {
      const { text, html } = renderEmail({ kind, data: withFee, site, forGuest: false })
      expect(text, kind).toContain('Court price: ₱350.00')
      expect(text, kind).toContain('Booking fee: ₱10.00')
      expect(text, kind).toContain('Total: ₱360.00')
      expect(text, kind).not.toContain('Total: ₱350.00')
      expect(html, kind).toContain('Booking fee')
      expect(html, kind).toContain('₱360.00')
    }
  })

  it('takes the total from amount_due, not from adding numbers itself (string amounts from the snapshot)', () => {
    const { text } = renderEmail({
      kind: 'payment_confirmed',
      data: { ...withFee, total_amount: '1500.50', booking_fee: '10.00', amount_due: '1510.50' },
      site,
      forGuest: false,
    })
    expect(text).toContain('Court price: ₱1,500.50')
    expect(text).toContain('Booking fee: ₱10.00')
    expect(text).toContain('Total: ₱1,510.50')
  })

  it('leaves out the booking fee row when there is no fee (walk-ins, bookings made at a fee of 0)', () => {
    const { text, html } = renderEmail({ kind: 'booking_created', data, site, forGuest: false })
    expect(text).toContain('Court price: ₱700.00\nTotal: ₱700.00')
    expect(text).not.toContain('Booking fee')
    expect(html).not.toContain('Booking fee')
  })
})

describe('shouldSkip', () => {
  it('drops only a booking_created that a later event overtook', () => {
    for (const status of ['cancelled', 'expired', 'rejected'] as const) expect(shouldSkip('booking_created', status)).toBe(true)
    for (const status of ['pending_payment', 'payment_submitted', 'confirmed'] as const) expect(shouldSkip('booking_created', status)).toBe(false)
    expect(shouldSkip('booking_cancelled', 'cancelled')).toBe(false)
    expect(shouldSkip('proof_rejected', 'rejected')).toBe(false)
    expect(shouldSkip('booking_rescheduled', 'confirmed')).toBe(false)
  })
})

describe('helpers', () => {
  it('bookingLink matches the app guest link format', () => {
    expect(bookingLink('https://x.test/', 'CB-7KQ2XD', 'a+b/c')).toBe('https://x.test/booking/CB-7KQ2XD#token=a%2Bb%2Fc')
    expect(bookingLink('https://x.test', 'CB-7KQ2XD')).toBe('https://x.test/booking/CB-7KQ2XD')
  })

  it('escapeHtml', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})
