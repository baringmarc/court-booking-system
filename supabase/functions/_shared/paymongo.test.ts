import { describe, expect, it } from 'vitest'
import {
  checkAmountPayable,
  checkoutMode,
  checkoutRequestBody,
  isTestSecretKey,
  MIN_CHECKOUT_CENTAVOS,
  parseCheckoutResponse,
  returnBase,
  stubCheckoutSession,
  toCentavos,
} from './paymongo.ts'
import { ProofError } from './proof.ts'

describe('toCentavos', () => {
  it('converts PHP amounts to integer centavos without float drift', () => {
    expect(toCentavos(500)).toBe(50000)
    expect(toCentavos('1500.50')).toBe(150050)
    expect(toCentavos(1234.56)).toBe(123456)
    expect(toCentavos(0.1 + 0.2)).toBe(30)
  })

  it('refuses negative or non-numeric amounts', () => {
    expect(() => toCentavos(-1)).toThrow()
    expect(() => toCentavos('abc')).toThrow()
  })
})

describe('checkAmountPayable', () => {
  it('refuses totals below the online minimum, including free bookings', () => {
    expect(() => checkAmountPayable(0)).toThrow(ProofError)
    expect(() => checkAmountPayable(MIN_CHECKOUT_CENTAVOS - 1)).toThrow('can\'t be paid online')
    expect(() => checkAmountPayable(MIN_CHECKOUT_CENTAVOS)).not.toThrow()
  })
})

describe('isTestSecretKey', () => {
  it('accepts only test keys', () => {
    expect(isTestSecretKey('sk_test_abc')).toBe(true)
    expect(isTestSecretKey('sk_live_abc')).toBe(false)
    expect(isTestSecretKey('')).toBe(false)
    expect(isTestSecretKey(undefined)).toBe(false)
  })
})

describe('returnBase', () => {
  const sites = 'http://localhost:5173, http://127.0.0.1:5179/'

  it("uses the request's origin only when it's allowed", () => {
    expect(returnBase('http://127.0.0.1:5179', sites)).toBe('http://127.0.0.1:5179')
    expect(returnBase('http://localhost:5173/', sites)).toBe('http://localhost:5173')
  })

  it('falls back to the first configured site for unknown or missing origins (no open redirect)', () => {
    expect(returnBase('https://evil.example', sites)).toBe('http://localhost:5173')
    expect(returnBase(null, sites)).toBe('http://localhost:5173')
  })

  it('is null when nothing valid is configured', () => {
    expect(returnBase('http://localhost:5173', undefined)).toBeNull()
    expect(returnBase('http://localhost:5173', 'not a url, javascript:alert(1)')).toBeNull()
  })
})

describe('checkoutRequestBody', () => {
  const body = checkoutRequestBody({ bookingId: 'b-1', referenceCode: 'CB-ABC234', amountCentavos: 90000, base: 'https://courts.example' })
  const attrs = body.data.attributes

  it('charges the stored total in centavos as one PHP line item', () => {
    expect(attrs.line_items).toEqual([{ name: 'Court booking CB-ABC234', amount: 90000, currency: 'PHP', quantity: 1 }])
  })

  it('offers GCash, Maya, card and QR Ph', () => {
    expect(attrs.payment_method_types).toEqual(['gcash', 'paymaya', 'card', 'qrph'])
  })

  it('links back to the booking page and maps the session to the booking', () => {
    expect(attrs.success_url).toBe('https://courts.example/booking/CB-ABC234?paid=1')
    expect(attrs.cancel_url).toBe('https://courts.example/booking/CB-ABC234?paid=0')
    expect(attrs.reference_number).toBe('CB-ABC234')
    expect(attrs.metadata).toEqual({ booking_id: 'b-1' })
  })

  it('never carries a guest token', () => {
    expect(JSON.stringify(body)).not.toMatch(/token/i)
  })
})

describe('parseCheckoutResponse', () => {
  it('reads the session id and checkout URL', () => {
    expect(parseCheckoutResponse({ data: { id: 'cs_123', attributes: { checkout_url: 'https://checkout.paymongo.com/x' } } }))
      .toEqual({ id: 'cs_123', checkoutUrl: 'https://checkout.paymongo.com/x' })
  })

  it('refuses unexpected responses', () => {
    expect(() => parseCheckoutResponse(null)).toThrow()
    expect(() => parseCheckoutResponse({ data: { id: 'pi_1', attributes: { checkout_url: 'https://x' } } })).toThrow()
    expect(() => parseCheckoutResponse({ data: { id: 'cs_1', attributes: { checkout_url: 'http://x' } } })).toThrow()
  })
})

describe('stubCheckoutSession', () => {
  it('builds a fake session the database accepts (cs_ id, https URL)', () => {
    expect(stubCheckoutSession('abc')).toEqual({ id: 'cs_stub_abc', checkoutUrl: 'https://checkout.paymongo.test/stub/cs_stub_abc' })
  })
})

describe('checkoutMode', () => {
  const local = 'http://kong:8000'
  const hosted = 'https://abcd.supabase.co'

  it('uses the real test-mode API whenever a test key is set, even with stub mode on', () => {
    expect(checkoutMode({ secretKey: 'sk_test_x', mode: 'stub', supabaseUrl: local })).toBe('live_api')
    expect(checkoutMode({ secretKey: 'sk_test_x', supabaseUrl: hosted })).toBe('live_api')
  })

  it('stubs only when asked to on the local stack', () => {
    expect(checkoutMode({ mode: 'stub', supabaseUrl: local })).toBe('stub')
    expect(checkoutMode({ mode: 'stub', supabaseUrl: hosted })).toBe('unavailable')
    expect(checkoutMode({ mode: 'stub' })).toBe('unavailable')
  })

  it('is unavailable without a test key (a live key counts as none)', () => {
    expect(checkoutMode({ supabaseUrl: local })).toBe('unavailable')
    expect(checkoutMode({ secretKey: 'sk_live_x', supabaseUrl: local })).toBe('unavailable')
  })
})
