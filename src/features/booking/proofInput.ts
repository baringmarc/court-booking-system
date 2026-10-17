// Client-side checks for the proof form. They mirror the Edge Function (supabase/functions/_shared/proof.ts),
// which is imported for the shared limits; the server still re-checks everything, including the file bytes.
import { MAX_PROOF_BYTES, PROOF_METHODS } from '../../../supabase/functions/_shared/proof.ts'

export { MAX_PROOF_BYTES }
export type ProofMethod = (typeof PROOF_METHODS)[number]

export const METHOD_LABELS: Record<ProofMethod | 'cash', string> = {
  gcash: 'GCash',
  maya: 'Maya',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
}
export const PROOF_METHOD_OPTIONS = PROOF_METHODS.map((value) => ({ value, label: METHOD_LABELS[value] }))
export const ACCEPTED_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']

export type ProofInput = { method: string; amount: string; referenceNumber: string; file: File | null }
export type ProofErrors = Partial<Record<keyof ProofInput, string>>

export function isProofMethod(value: string): value is ProofMethod {
  return (PROOF_METHODS as readonly string[]).includes(value)
}

export function validateProofInput(input: ProofInput): ProofErrors {
  const errors: ProofErrors = {}
  if (!isProofMethod(input.method)) errors.method = 'Choose how you paid.'
  const amount = Number(input.amount)
  if (!input.amount.trim() || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
    errors.amount = 'Enter the amount you paid.'
  }
  if (input.referenceNumber.trim().length > 100) errors.referenceNumber = 'Use at most 100 characters.'
  if (!input.file) errors.file = 'Attach a screenshot or PDF of your receipt.'
  else if (!ACCEPTED_PROOF_TYPES.includes(input.file.type)) errors.file = 'Upload a JPG, PNG or WEBP image, or a PDF.'
  else if (input.file.size > MAX_PROOF_BYTES) errors.file = 'The file is larger than 5 MB.'
  return errors
}

/** True when a valid entered amount differs from the booking total (shown as a warning, never a block: SPEC §5.5). */
export function amountMismatch(amount: string, total: number) {
  const value = Number(amount)
  return amount.trim() !== '' && Number.isFinite(value) && Math.abs(value - total) >= 0.005
}
