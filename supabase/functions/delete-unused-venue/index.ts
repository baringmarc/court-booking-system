// POST JSON from the platform console (T17.27). Platform admins only.
//   { action: 'delete', venue_id, confirm_slug }: runs delete_unused_venue as the caller (it re-checks platform admin,
//     the typed slug, protection and every history table, and queues the venue's Storage prefixes in the same
//     transaction), then drains the file-cleanup queue through the Storage API.
//   { action: 'retry', venue_id }: drains the queue again (failed rows are retried); touches no table rows.
// Replies { venue_id, cleanup: 'done' | 'pending' }; `pending` means some of this venue's files are not confirmed
// removed yet, so the console must not report the deletion as finished. The slug is free once the delete commits:
// files live under the venue id, never the slug.
import { withSupabase } from 'npm:@supabase/server@1'
import { callerUserId } from '../_shared/payable.ts'
import { drainVenueFileCleanup, storageAdapter, venueFilesLeft, type ClaimedCleanup, type CleanupQueue } from '../_shared/venueCleanup.ts'
import * as Sentry from 'npm:@sentry/deno@10.76.2'
import { withSentry } from '../_shared/sentry.ts'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUS_BY_HINT: Record<string, number> = {
  not_platform_admin: 403, venue_not_found: 404, confirmation_mismatch: 409, venue_protected: 409, venue_in_use: 409,
}

type Body = { action: 'delete'; venueId: string; confirmSlug: string } | { action: 'retry'; venueId: string }

function parseBody(raw: unknown): Body | null {
  if (!raw || typeof raw !== 'object') return null
  const b = raw as Record<string, unknown>
  if (typeof b.venue_id !== 'string' || !UUID.test(b.venue_id)) return null
  if (b.action === 'retry') return { action: 'retry', venueId: b.venue_id }
  if (b.action === 'delete' && typeof b.confirm_slug === 'string' && b.confirm_slug !== '') {
    return { action: 'delete', venueId: b.venue_id, confirmSlug: b.confirm_slug }
  }
  return null
}

export default {
  fetch: withSupabase({ auth: ['user'] }, withSentry('delete-unused-venue', async (req, ctx) => {
    if (req.method !== 'POST') return json({ code: 'method_not_allowed', message: 'Use POST.' }, 405)

    const callerId = callerUserId(ctx)
    const admin = ctx.supabaseAdmin
    const { data: platformAdmin } = callerId
      ? await admin.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle()
      : { data: null }
    if (!platformAdmin) return json({ code: 'not_platform_admin', message: 'Platform admins only.' }, 403)

    const body = parseBody(await req.json().catch(() => null))
    if (!body) return json({ code: 'invalid_input', message: 'Send an action and a venue.' }, 400)

    if (body.action === 'delete') {
      // As the caller, so the RPC's own platform-admin check (auth.uid()) applies.
      const { error } = await ctx.supabase.rpc('delete_unused_venue', { p_venue_id: body.venueId, p_confirm_slug: body.confirmSlug })
      if (error) {
        const status = error.hint ? STATUS_BY_HINT[error.hint] : undefined
        if (status) return json({ code: error.hint, message: error.message }, status)
        console.error('delete-unused-venue: delete failed', error.message)
        return json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, 500)
      }
    }

    const queue: CleanupQueue = {
      async claim(limit) {
        const { data, error } = await admin.rpc('claim_venue_file_cleanup', { p_limit: limit })
        if (error) throw new Error(`claim: ${error.message}`)
        return (Array.isArray(data) ? data : []) as ClaimedCleanup[]
      },
      async finish(id, ok, message) {
        const { error } = await admin.rpc('finish_venue_file_cleanup', { p_id: id, p_ok: ok, p_error: message ?? '' })
        if (error) throw new Error(`finish: ${error.message}`)
      },
    }

    let cleanup: 'done' | 'pending' = 'pending'
    try {
      const storage = storageAdapter(admin)
      const { failed } = await drainVenueFileCleanup(queue, storage)
      for (const row of failed) console.error('delete-unused-venue: cleanup failed', row.venue_id, row.bucket, row.error)
      // Done only when no row of this venue failed and its folders are verifiably empty in Storage, so a row held
      // by a concurrent drain, or never claimed, still reads as pending.
      const mineFailed = failed.some((r) => r.venue_id === body.venueId)
      if (!mineFailed && (await venueFilesLeft(storage, body.venueId)) === 0) cleanup = 'done'
    } catch (e) {
      console.error('delete-unused-venue: cleanup drain failed', e instanceof Error ? e.message : String(e))
    }
    return json({ venue_id: body.venueId, cleanup })
  }, Sentry)),
}
