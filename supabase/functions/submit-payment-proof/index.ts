// POST multipart/form-data: reference_code, token? (guests), method, amount, reference_number?, file.
// Guests authenticate with the private booking token; signed-in players with their session.
// Flow (RESEARCH "Proof upload for guests"): proof_target -> upload with the secret key -> record_payment_proof,
// deleting the uploaded file if recording fails. All rules live in SQL and _shared/proof.ts.
import { withSupabase } from 'npm:@supabase/server@1'
import { checkProofFile, MAX_PROOF_BYTES, parseProofFields, ProofError } from '../_shared/proof.ts'

const BUCKET = 'payment-proofs'
// File limit plus room for the other multipart fields; checked before the body is read into memory.
const MAX_REQUEST_BYTES = MAX_PROOF_BYTES + 512 * 1024

// RPC hint codes -> HTTP status for the client.
const STATUS_BY_CODE: Record<string, number> = {
  not_found: 404,
  hold_expired: 409,
  invalid_state: 409,
  invalid_input: 400,
}

function rpcError(error: { message: string; hint?: string | null }) {
  const code = error.hint && error.hint in STATUS_BY_CODE ? error.hint : 'server_error'
  const status = STATUS_BY_CODE[code] ?? 500
  return new ProofError(code, status === 500 ? 'Something went wrong. Please try again.' : error.message, status)
}

export default {
  fetch: withSupabase({ auth: ['user', 'publishable'] }, async (req, ctx) => {
    if (req.method !== 'POST') {
      return Response.json({ code: 'method_not_allowed', message: 'Use POST.' }, { status: 405 })
    }
    try {
      if (Number(req.headers.get('content-length') ?? 0) > MAX_REQUEST_BYTES) {
        throw new ProofError('file_too_large', 'The file is larger than 5 MB.', 413)
      }
      const form = await req.formData()
      const fields = parseProofFields(form)
      const file = form.get('file')
      if (!(file instanceof File)) throw new ProofError('invalid_input', 'Please attach your proof of payment.')
      const type = checkProofFile(file.size, new Uint8Array(await file.slice(0, 16).arrayBuffer()))

      // Only a session verified by the wrapper identifies a player; guests rely on the token.
      const userId = ctx.authMode === 'user' ? (ctx.userClaims?.id ?? ctx.jwtClaims?.sub ?? null) : null
      const admin = ctx.supabaseAdmin

      const target = await admin.rpc('proof_target', {
        p_reference_code: fields.referenceCode,
        p_token: fields.token,
        p_user_id: userId,
      })
      if (target.error) throw rpcError(target.error)
      const bookingId: string | undefined = target.data?.[0]?.booking_id
      if (!bookingId) throw new ProofError('not_found', 'Booking not found.', 404)

      const path = `${bookingId}/${crypto.randomUUID()}.${type.ext}`
      const upload = await admin.storage.from(BUCKET).upload(path, file, { contentType: type.mime, upsert: false })
      if (upload.error) {
        console.error('proof upload failed', upload.error.message)
        throw new ProofError('upload_failed', 'The file could not be uploaded. Please try again.', 502)
      }

      const recorded = await admin.rpc('record_payment_proof', {
        p_booking_id: bookingId,
        p_storage_path: path,
        p_method: fields.method,
        p_amount: fields.amount,
        p_reference_number: fields.referenceNumber,
      })
      if (recorded.error) {
        const cleanup = await admin.storage.from(BUCKET).remove([path])
        if (cleanup.error) console.error('orphaned proof file, remove manually:', path, cleanup.error.message)
        throw rpcError(recorded.error)
      }

      return Response.json({ payment_id: recorded.data?.[0]?.payment_id ?? null }, { status: 201 })
    } catch (e) {
      if (e instanceof ProofError) {
        return Response.json({ code: e.code, message: e.message }, { status: e.status })
      }
      console.error('submit-payment-proof failed', e instanceof Error ? e.message : e)
      return Response.json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, { status: 500 })
    }
  }),
}
