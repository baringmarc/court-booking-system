// POST JSON { venue_id, email } from the platform console (T14.5). Platform admins only.
//   1. the caller (a verified session) must have a platform_admins row
//   2. the venue must exist
//   3. an email with no account gets a Supabase invite that lands on <venue site>/admin; one that already has an
//      account gets no email
//   4. either way the user becomes an owner of the venue (venue_members)
import { withSupabase } from 'npm:@supabase/server@1'
import { callerUserId } from '../_shared/payable.ts'
import { inviteOutcome, inviteRedirectTo, parseInviteBody } from '../_shared/ownerInvite.ts'

const json = (body: unknown, status = 200) => Response.json(body, { status })

export default {
  fetch: withSupabase({ auth: ['user'] }, async (req, ctx) => {
    if (req.method !== 'POST') return json({ code: 'method_not_allowed', message: 'Use POST.' }, 405)

    const callerId = callerUserId(ctx)
    const admin = ctx.supabaseAdmin
    const { data: platformAdmin } = callerId
      ? await admin.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle()
      : { data: null }
    if (!platformAdmin) return json({ code: 'not_platform_admin', message: 'Platform admins only.' }, 403)

    const parsed = parseInviteBody(await req.json().catch(() => null))
    if (!parsed.ok) return json({ code: 'invalid_input', message: 'Send a venue and a valid email.' }, 400)

    const { data: venue } = await admin.from('venues').select('id, slug').eq('id', parsed.venueId).maybeSingle()
    if (!venue) return json({ code: 'not_found', message: 'Venue not found.' }, 404)

    const redirectTo = inviteRedirectTo({
      slug: venue.slug,
      origin: null,
      rootDomain: Deno.env.get('PUBLIC_ROOT_DOMAIN'),
      allowList: Deno.env.get('PUBLIC_SITE_URL'),
    })
    if (!redirectTo) return json({ code: 'site_unavailable', message: 'No site URL is configured.' }, 503)

    const existing = await admin.rpc('user_id_by_email', { p_email: parsed.email })
    if (existing.error) {
      console.error('invite-venue-owner: lookup failed', existing.error.message)
      return json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, 500)
    }

    let userId = existing.data as string | null
    const { invite } = inviteOutcome(userId)
    if (invite) {
      const invited = await admin.auth.admin.inviteUserByEmail(parsed.email, { redirectTo })
      if (invited.error || !invited.data.user) {
        console.error('invite-venue-owner: invite failed', invited.error?.message)
        return json({ code: 'invite_failed', message: "We couldn't send the invite." }, 502)
      }
      userId = invited.data.user.id
    }

    const { error } = await admin
      .from('venue_members')
      .upsert({ venue_id: venue.id, user_id: userId!, role: 'owner' }, { onConflict: 'venue_id,user_id' })
    if (error) {
      console.error('invite-venue-owner: membership failed', error.message)
      return json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, 500)
    }
    return json({ ok: true, invited: invite })
  }),
}
