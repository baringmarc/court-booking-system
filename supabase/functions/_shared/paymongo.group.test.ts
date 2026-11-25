// T33.2: the hosted checkout of a booking group: one session for the group total, one line item per court, then the one booking
// fee. The single-booking body (checkoutRequestBody) is covered, unchanged, in paymongo.test.ts.
import { describe, expect, it } from 'vitest'
import * as paymongo from './paymongo.ts'
import { checkoutRequestBody } from './paymongo.ts'

type GroupCheckoutInput = {
  leadBookingId: string
  referenceCode: string
  courts: { label: string; centavos: number }[]
  feeCentavos: number
  base: string
}
// groupCheckoutRequestBody is new in T33.2; read it off the module so this file type-checks before it exists.
const groupCheckoutRequestBody = (paymongo as unknown as { groupCheckoutRequestBody: (input: GroupCheckoutInput) => ReturnType<typeof checkoutRequestBody> })
  .groupCheckoutRequestBody

const LEAD = '11111111-1111-4111-8111-111111111111'
const input: GroupCheckoutInput = {
  leadBookingId: LEAD,
  referenceCode: 'CB-AAA111',
  courts: [
    { label: 'Pickle 1, Mon Jan 7, 6:00 PM–8:00 PM', centavos: 70000 },
    { label: 'Tennis 2, Mon Jan 7, 8:00 PM–9:00 PM', centavos: 40000 },
  ],
  feeCentavos: 1000,
  base: 'https://courts.example',
}

describe('groupCheckoutRequestBody', () => {
  const attrsOf = () => groupCheckoutRequestBody(input).data.attributes

  it('has one PHP line item per court, in order, then one Booking fee line', () => {
    expect(attrsOf().line_items).toEqual([
      { name: 'Pickle 1, Mon Jan 7, 6:00 PM–8:00 PM', amount: 70000, currency: 'PHP', quantity: 1 },
      { name: 'Tennis 2, Mon Jan 7, 8:00 PM–9:00 PM', amount: 40000, currency: 'PHP', quantity: 1 },
      { name: 'Booking fee', amount: 1000, currency: 'PHP', quantity: 1 },
    ])
  })

  it('has one line per court and no fee line at a fee of 0 (no zero-amount item)', () => {
    const noFee = groupCheckoutRequestBody({ ...input, feeCentavos: 0 }).data.attributes.line_items
    expect(noFee).toHaveLength(2)
    expect(noFee.map((item) => item.name)).not.toContain('Booking fee')
  })

  it('has three court lines for three courts, in the order given', () => {
    const courts = [...input.courts, { label: 'Court 3', centavos: 30050 }]
    const items = groupCheckoutRequestBody({ ...input, courts }).data.attributes.line_items
    expect(items.map((item) => item.name)).toEqual([...courts.map((c) => c.label), 'Booking fee'])
  })

  it('line items add up to the group total (the court prices plus the one fee), so PayMongo charges what the webhook expects', () => {
    const courts = [
      { label: 'A', centavos: 123456 },
      { label: 'B', centavos: 7 },
      { label: 'C', centavos: 99999 },
    ]
    const body = groupCheckoutRequestBody({ ...input, courts, feeCentavos: 1050 })
    const charged = body.data.attributes.line_items.reduce((sum, item) => sum + item.amount * item.quantity, 0)
    expect(charged).toBe(123456 + 7 + 99999 + 1050)
    const first = groupCheckoutRequestBody(input).data.attributes.line_items.reduce((sum, item) => sum + item.amount * item.quantity, 0)
    expect(first).toBe(70000 + 40000 + 1000)
  })

  it("maps the session to the lead booking and links back to the lead's booking page", () => {
    const attrs = attrsOf()
    expect(attrs.metadata).toEqual({ booking_id: LEAD })
    expect(attrs.success_url).toBe('https://courts.example/booking/CB-AAA111?paid=1')
    expect(attrs.cancel_url).toBe('https://courts.example/booking/CB-AAA111?paid=0')
    expect(attrs.reference_number).toBe('CB-AAA111')
    expect(attrs.description).toBe('Court booking CB-AAA111')
  })

  it('encodes the reference in the return links', () => {
    const body = groupCheckoutRequestBody({ ...input, referenceCode: 'CB A/1' }).data.attributes
    expect(body.success_url).toBe('https://courts.example/booking/CB%20A%2F1?paid=1')
    expect(body.cancel_url).toBe('https://courts.example/booking/CB%20A%2F1?paid=0')
  })

  it('has the same shape and options as the single-booking body', () => {
    const single = checkoutRequestBody({ bookingId: LEAD, referenceCode: 'CB-AAA111', courtCentavos: 110000, feeCentavos: 1000, base: 'https://courts.example' })
    const group = groupCheckoutRequestBody(input)
    expect(Object.keys(group)).toEqual(Object.keys(single))
    expect(Object.keys(group.data)).toEqual(Object.keys(single.data))
    expect(Object.keys(group.data.attributes).sort()).toEqual(Object.keys(single.data.attributes).sort())
    const attrs = attrsOf()
    expect(attrs.payment_method_types).toEqual(['gcash', 'paymaya', 'card', 'qrph'])
    expect(attrs.send_email_receipt).toBe(true)
  })

  it('never carries a guest token', () => {
    expect(JSON.stringify(groupCheckoutRequestBody(input))).not.toMatch(/token/i)
  })
})

describe('checkoutRequestBody is unchanged by groups', () => {
  it('still builds one court line and the fee line for a single booking', () => {
    const body = checkoutRequestBody({ bookingId: 'b-1', referenceCode: 'CB-ABC234', courtCentavos: 35000, feeCentavos: 1000, base: 'https://courts.example' })
    expect(body.data.attributes.line_items).toEqual([
      { name: 'Court booking CB-ABC234', amount: 35000, currency: 'PHP', quantity: 1 },
      { name: 'Booking fee', amount: 1000, currency: 'PHP', quantity: 1 },
    ])
    expect(body.data.attributes.metadata).toEqual({ booking_id: 'b-1' })
  })
})
