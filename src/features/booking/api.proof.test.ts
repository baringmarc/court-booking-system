// T11.28: submit-payment-proof gets account_id when a payment account was chosen, and method only otherwise.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()
vi.mock('../../lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }))

const { submitPaymentProof } = await import('./api')

const file = new File([new Uint8Array(10)], 'r.png', { type: 'image/png' })
const base = { referenceCode: 'CB-ABC234', token: 'tok', amount: 900, referenceNumber: ' 77 ', file }
const sent = () => (invoke.mock.calls[0][1] as { body: FormData }).body

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: null, error: null })
})

describe('submitPaymentProof', () => {
  it('appends account_id and no method for a payment account', async () => {
    await submitPaymentProof({ ...base, accountId: 'a-1' })
    expect(invoke.mock.calls[0][0]).toBe('submit-payment-proof')
    const form = sent()
    expect(form.get('account_id')).toBe('a-1')
    expect(form.has('method')).toBe(false)
    expect(form.get('reference_code')).toBe('CB-ABC234')
    expect(form.get('amount')).toBe('900')
    expect(form.get('reference_number')).toBe('77')
  })

  it('appends method and no account_id on the fallback path', async () => {
    await submitPaymentProof({ ...base, method: 'gcash' })
    const form = sent()
    expect(form.get('method')).toBe('gcash')
    expect(form.has('account_id')).toBe(false)
  })
})
