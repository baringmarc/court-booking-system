// @vitest-environment node
// Real WebCrypto (as in Deno): jsdom doesn't provide crypto.subtle.
import { describe, expect, it } from 'vitest'
import { parseSignatureHeader, readPaidEvent, signWebhookPayload, verifyWebhookSignature } from './paymongo.ts'

const SECRET = 'whsk_test_secret'

/** HMAC-SHA256 hex computed here, independently of the module's helper. */
async function hmacHex(secret: string, message: string) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function paidEvent(overrides: { type?: string; livemode?: boolean; payments?: unknown[]; metadata?: unknown } = {}) {
  return {
    data: {
      id: 'evt_1',
      type: 'event',
      attributes: {
        type: overrides.type ?? 'checkout_session.payment.paid',
        livemode: overrides.livemode ?? false,
        data: {
          id: 'cs_1',
          type: 'checkout_session',
          attributes: {
            reference_number: 'CB-ABC234',
            metadata: overrides.metadata ?? { booking_id: 'b0000000-0000-0000-0000-000000000001' },
            payments: overrides.payments ?? [
              { id: 'pay_failed', attributes: { status: 'failed', amount: 50000, currency: 'PHP', source: { type: 'card' } } },
              { id: 'pay_1', attributes: { status: 'paid', amount: 50000, currency: 'PHP', source: { type: 'gcash' } } },
            ],
          },
        },
      },
    },
  }
}

describe('parseSignatureHeader', () => {
  it('reads t, te and li', () => {
    expect(parseSignatureHeader('t=1496734173,te=abc,li=')).toEqual({ timestamp: 1496734173, test: 'abc', live: '' })
  })

  it('refuses missing or malformed headers', () => {
    expect(parseSignatureHeader(null)).toBeNull()
    expect(parseSignatureHeader('te=abc,li=')).toBeNull()
    expect(parseSignatureHeader('t=soon,te=abc')).toBeNull()
  })
})

describe('verifyWebhookSignature', () => {
  const body = JSON.stringify(paidEvent())

  it('accepts HMAC-SHA256 of `t.rawBody` with the endpoint secret, as PayMongo documents (te)', async () => {
    const t = 1700000000
    const te = await hmacHex(SECRET, `${t}.${body}`)
    expect(await verifyWebhookSignature(body, `t=${t},te=${te},li=`, SECRET)).toBe(true)
  })

  it('round-trips with signWebhookPayload', async () => {
    expect(await verifyWebhookSignature(body, await signWebhookPayload(body, SECRET), SECRET)).toBe(true)
  })

  it('refuses a tampered body, a wrong secret or a changed timestamp', async () => {
    const header = await signWebhookPayload(body, SECRET, 1700000000)
    expect(await verifyWebhookSignature(body.replace('50000', '1'), header, SECRET)).toBe(false)
    expect(await verifyWebhookSignature(body, header, 'whsk_other')).toBe(false)
    expect(await verifyWebhookSignature(body, header.replace('t=1700000000', 't=1700000001'), SECRET)).toBe(false)
  })

  it('never accepts a live signature, a missing header or an empty secret', async () => {
    const t = 1700000000
    const sig = await hmacHex(SECRET, `${t}.${body}`)
    expect(await verifyWebhookSignature(body, `t=${t},te=,li=${sig}`, SECRET)).toBe(false)
    expect(await verifyWebhookSignature(body, null, SECRET)).toBe(false)
    expect(await verifyWebhookSignature(body, `t=${t},te=${sig},li=`, '')).toBe(false)
  })
})

describe('readPaidEvent', () => {
  it('reads the paid payment, session and booking from the signed payload', () => {
    expect(readPaidEvent(paidEvent())).toEqual({
      paid: { eventId: 'evt_1', checkoutId: 'cs_1', paymentId: 'pay_1', amountCentavos: 50000, currency: 'PHP', source: 'gcash', bookingId: 'b0000000-0000-0000-0000-000000000001' },
    })
  })

  it('ignores other event types and live events', () => {
    expect(readPaidEvent(paidEvent({ type: 'payment.paid' }))).toEqual({ ignore: 'event_type' })
    expect(readPaidEvent(paidEvent({ livemode: true }))).toEqual({ ignore: 'livemode' })
  })

  it('ignores events without a usable paid payment', () => {
    expect(readPaidEvent(paidEvent({ payments: [] }))).toEqual({ ignore: 'no_paid_payment' })
    expect(readPaidEvent(paidEvent({ payments: [{ id: 'pay_1', attributes: { status: 'paid', amount: '500' } }] })))
      .toEqual({ ignore: 'no_paid_payment' })
    expect(readPaidEvent({ nope: true })).toEqual({ ignore: 'malformed' })
    expect(readPaidEvent(null)).toEqual({ ignore: 'malformed' })
  })

  it('ignores a metadata booking id that is not a uuid (it could never match, and would fail every retry)', () => {
    expect(readPaidEvent(paidEvent({ metadata: { booking_id: 'not-a-uuid' } }))).toEqual({ ignore: 'invalid_metadata' })
  })

  it('treats a missing metadata booking id as unknown, not as an error', () => {
    const read = readPaidEvent(paidEvent({ metadata: {} }))
    expect('paid' in read && read.paid.bookingId).toBeNull()
  })
})
