// Validation for the submit-payment-proof Edge Function. Plain TypeScript with no Deno APIs,
// so Vitest can test it (see vitest.config.ts) and tsc type-checks it with the app.

export const MAX_PROOF_BYTES = 5 * 1024 * 1024
export const PROOF_METHODS = ['gcash', 'maya', 'bank_transfer'] as const
export type ProofMethod = (typeof PROOF_METHODS)[number]

export type ProofFileType = { ext: 'jpg' | 'png' | 'webp' | 'pdf'; mime: string }

/** Errors with a stable code, mirroring the RPC hint convention (RESEARCH "RPC conventions"). */
export class ProofError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'ProofError'
    this.code = code
    this.status = status
  }
}

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b)

/** Identifies a file by its first bytes; the browser-supplied type is never trusted. */
export function sniffFileType(bytes: Uint8Array): ProofFileType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg' }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', mime: 'image/png' }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { ext: 'webp', mime: 'image/webp' }
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { ext: 'pdf', mime: 'application/pdf' }
  return null
}

export function checkProofFile(size: number, head: Uint8Array): ProofFileType {
  if (size === 0) throw new ProofError('invalid_input', 'Please attach your proof of payment.')
  if (size > MAX_PROOF_BYTES) throw new ProofError('file_too_large', 'The file is larger than 5 MB.', 413)
  const type = sniffFileType(head)
  if (!type) throw new ProofError('invalid_file_type', 'Upload a JPG, PNG or WEBP image, or a PDF.', 415)
  return type
}

export type ProofFields = {
  referenceCode: string
  token: string | null
  method: ProofMethod
  amount: number
  referenceNumber: string | null
}

const field = (form: { get(name: string): unknown }, name: string) => {
  const value = form.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

/** Reads and validates the text fields of the multipart form. */
export function parseProofFields(form: { get(name: string): unknown }): ProofFields {
  const referenceCode = field(form, 'reference_code').toUpperCase()
  if (!/^CB-[A-HJ-NP-Z2-9]{6}$/.test(referenceCode)) {
    throw new ProofError('not_found', 'Booking not found. Check that you opened the full link from your confirmation.', 404)
  }

  const method = field(form, 'method')
  if (!(PROOF_METHODS as readonly string[]).includes(method)) {
    throw new ProofError('invalid_input', 'Choose GCash, Maya or bank transfer.')
  }

  const amountText = field(form, 'amount')
  const amount = Number(amountText)
  if (!amountText || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
    throw new ProofError('invalid_input', 'Enter the amount you paid.')
  }

  const referenceNumber = field(form, 'reference_number') || null
  if (referenceNumber && referenceNumber.length > 100) {
    throw new ProofError('invalid_input', 'The reference number is too long.')
  }

  return {
    referenceCode,
    token: field(form, 'token') || null,
    method: method as ProofMethod,
    amount: Math.round(amount * 100) / 100,
    referenceNumber,
  }
}
