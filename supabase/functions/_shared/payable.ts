// Shared by the payment Edge Functions (submit-payment-proof, create-paymongo-checkout): who the caller is, and how
// RPC errors map to HTTP responses. Plain TypeScript with no Deno APIs, so Vitest and tsc check it with the app.
import { ProofError } from './proof.ts'

/** The verified user id, or null for a guest. Only a session the withSupabase wrapper verified counts. */
export function callerUserId(ctx: {
  authMode?: string | null
  userClaims?: { id?: string | null } | null
  jwtClaims?: { sub?: string | null } | null
}): string | null {
  if (ctx.authMode !== 'user') return null
  return ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? null
}

// RPC hint codes (RESEARCH "RPC conventions") -> HTTP status for the client.
const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  hold_expired: 409,
  invalid_state: 409,
  invalid_input: 400,
}

/** Turns an RPC error into a client-safe error: our P0001 messages pass through, anything else becomes generic. */
export function rpcError(error: { message: string; hint?: string | null }) {
  const code = error.hint && error.hint in STATUS_BY_CODE ? error.hint : 'server_error'
  const status = STATUS_BY_CODE[code] ?? 500
  return new ProofError(code, status === 500 ? 'Something went wrong. Please try again.' : error.message, status)
}

/** Booking references look like CB-XXXXXX; anything else can't match a booking. */
export function normalizeReference(value: unknown): string {
  const ref = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!/^CB-[A-HJ-NP-Z2-9]{6}$/.test(ref)) {
    throw new ProofError('not_found', 'Booking not found. Check that you opened the full link from your confirmation.', 404)
  }
  return ref
}
