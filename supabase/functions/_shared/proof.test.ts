import { describe, expect, it } from 'vitest'
import { checkProofFile, MAX_PROOF_BYTES, parseProofFields, ProofError, sniffFileType } from './proof.ts'

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16).fill(0)])
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0)
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const WEBP = bytes(...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBP'))
const PDF = bytes(...ascii('%PDF-1.7'))
const HTML = bytes(...ascii('<html><script>'))

describe('sniffFileType', () => {
  it('recognises jpg, png, webp and pdf by their magic bytes', () => {
    expect(sniffFileType(JPEG)).toEqual({ ext: 'jpg', mime: 'image/jpeg' })
    expect(sniffFileType(PNG)).toEqual({ ext: 'png', mime: 'image/png' })
    expect(sniffFileType(WEBP)).toEqual({ ext: 'webp', mime: 'image/webp' })
    expect(sniffFileType(PDF)).toEqual({ ext: 'pdf', mime: 'application/pdf' })
  })

  it('rejects other content, whatever its name or declared type', () => {
    expect(sniffFileType(HTML)).toBeNull()
    expect(sniffFileType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBeNull()
    expect(sniffFileType(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
})

describe('checkProofFile', () => {
  const codeOf = (fn: () => unknown) => {
    try {
      fn()
    } catch (e) {
      return e instanceof ProofError ? `${e.code}/${e.status}` : 'other'
    }
    return 'ok'
  }

  it('accepts a supported file up to 5 MB', () => {
    expect(checkProofFile(MAX_PROOF_BYTES, PNG)).toEqual({ ext: 'png', mime: 'image/png' })
  })

  it('rejects empty, oversized and spoofed files with distinct codes', () => {
    expect(codeOf(() => checkProofFile(0, PNG))).toBe('invalid_input/400')
    expect(codeOf(() => checkProofFile(MAX_PROOF_BYTES + 1, PNG))).toBe('file_too_large/413')
    expect(codeOf(() => checkProofFile(1000, HTML))).toBe('invalid_file_type/415')
  })
})

describe('parseProofFields', () => {
  const form = (values: Record<string, string>) => new Map(Object.entries(values))
  const valid = { reference_code: ' cb-7kq2xd ', token: 'tok', method: 'gcash', amount: '450.005', reference_number: ' 123 ' }

  it('normalises a valid form', () => {
    expect(parseProofFields(form(valid))).toEqual({
      referenceCode: 'CB-7KQ2XD',
      token: 'tok',
      method: 'gcash',
      accountId: null,
      amount: 450.01,
      referenceNumber: '123',
    })
  })

  it('takes an account id instead of a method', () => {
    const { method, ...rest } = valid
    void method
    const accountId = '3f2b8c1e-5d4a-4b6c-9e7f-0a1b2c3d4e5f'
    expect(parseProofFields(form({ ...rest, account_id: accountId }))).toMatchObject({ method: 'account', accountId })
    expect(() => parseProofFields(form({ ...rest, account_id: 'nope' }))).toThrow()
  })

  it('treats a missing token and reference number as null (signed-in players)', () => {
    const { token, reference_number, ...rest } = valid
    void token
    void reference_number
    expect(parseProofFields(form(rest))).toMatchObject({ token: null, referenceNumber: null })
  })

  it('rejects bad references, methods and amounts', () => {
    const code = (overrides: Record<string, string>) => {
      try {
        parseProofFields(form({ ...valid, ...overrides }))
        return 'ok'
      } catch (e) {
        return (e as ProofError).code
      }
    }
    expect(code({ reference_code: 'CB-0O1I00' })).toBe('not_found')
    expect(code({ method: 'cash' })).toBe('invalid_input')
    expect(code({ amount: '' })).toBe('invalid_input')
    expect(code({ amount: '-5' })).toBe('invalid_input')
    expect(code({ amount: 'abc' })).toBe('invalid_input')
    expect(code({ reference_number: 'x'.repeat(101) })).toBe('invalid_input')
  })
})
