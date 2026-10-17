import { describe, expect, it } from 'vitest'
import { amountMismatch, MAX_PROOF_BYTES, validateProofInput } from './proofInput'

const file = (type: string, size = 1000) => new File([new Uint8Array(size)], 'proof', { type })
const valid = { method: 'gcash', amount: '900', referenceNumber: '', file: file('image/png') }

describe('validateProofInput', () => {
  it('accepts a complete proof', () => {
    expect(validateProofInput(valid)).toEqual({})
  })

  it('requires a method, an amount and a file', () => {
    expect(validateProofInput({ method: '', amount: ' ', referenceNumber: '', file: null })).toEqual({
      method: 'Choose how you paid.',
      amount: 'Enter the amount you paid.',
      file: 'Attach a screenshot or PDF of your receipt.',
    })
  })

  it('rejects cash, bad amounts, other file types and files over 5 MB', () => {
    expect(validateProofInput({ ...valid, method: 'cash' }).method).toBeDefined()
    expect(validateProofInput({ ...valid, amount: '-1' }).amount).toBeDefined()
    expect(validateProofInput({ ...valid, file: file('image/gif') }).file).toMatch(/JPG, PNG or WEBP/)
    expect(validateProofInput({ ...valid, file: file('application/pdf', MAX_PROOF_BYTES + 1) }).file).toMatch(/5 MB/)
    expect(validateProofInput({ ...valid, referenceNumber: 'x'.repeat(101) }).referenceNumber).toBeDefined()
  })
})

describe('amountMismatch', () => {
  it('flags a valid amount that differs from the total', () => {
    expect(amountMismatch('850', 900)).toBe(true)
    expect(amountMismatch('900.00', 900)).toBe(false)
  })

  it('ignores empty or invalid input (the field error covers that)', () => {
    expect(amountMismatch('', 900)).toBe(false)
    expect(amountMismatch('abc', 900)).toBe(false)
  })
})
