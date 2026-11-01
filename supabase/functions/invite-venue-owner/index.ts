// POST JSON { venue_id, email } from the platform console (T14.5). Platform admins only.
//   1. the caller (a verified session) must have a platform_admins row
//   2. the venue must exist
//   3. an email with no account gets a Supabase invite that lands on <venue site>/admin; an account that was invited
//      but never set a password gets a fresh sign-in link by email (a resend, T14.5d); any other account gets none
//   4. either way the user becomes an owner of the venue (venue_members)
import { withSupabase } from 'npm:@supabase/server@1'
import { callerUserId } from '../_shared/payable.ts'
import { emailTransport, fromFor, sendEmail } from '../_shared/email.ts'
import { inviteRedirectTo, ownerLinkAction, ownerLinkEmail, parseInviteBody } from '../_shared/ownerInvite.ts'

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
    let account = null
    if (userId) {
      const found = await admin.auth.admin.getUserById(userId)
      if (found.error || !found.data.user) {
        console.error('invite-venue-owner: user lookup failed', found.error?.message)
        return json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, 500)
      }
      account = found.data.user
    }
    const action = ownerLinkAction(account)

    let link: string | null = null
    if (action === 'invite') {
      const invited = await admin.auth.admin.inviteUserByEmail(parsed.email, { redirectTo })
      if (invited.error || !invited.data.user) {
        console.error('invite-venue-owner: invite failed', invited.error?.message)
        return json({ code: 'invite_failed', message: "We couldn't send the invite." }, 502)
      }
      userId = invited.data.user.id
    } else if (action === 'link') {
      const generated = await admin.auth.admin.generateLink({ type: 'magiclink', email: parsed.email, options: { redirectTo } })
      link = generated.data?.properties?.action_link ?? null
      if (generated.error || !link) {
        console.error('invite-venue-owner: link failed', generated.error?.message)
        return json({ code: 'invite_failed', message: "We couldn't create a sign-in link." }, 502)
      }
    }

    const { error } = await admin
      .from('venue_members')
      .upsert({ venue_id: venue.id, user_id: userId!, role: 'owner' }, { onConflict: 'venue_id,user_id' })
    if (error) {
      console.error('invite-venue-owner: membership failed', error.message)
      return json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, 500)
    }

    if (link) {
      const resendKey = Deno.env.get('RESEND_API_KEY')
      const mailpitUrl = Deno.env.get('MAILPIT_URL')
      const transport = emailTransport({ transport: Deno.env.get('EMAIL_TRANSPORT'), resendKey, mailpitUrl, supabaseUrl: Deno.env.get('SUPABASE_URL') })
      if (transport !== 'resend' && transport !== 'mailpit') {
        console.error('invite-venue-owner: email transport is', transport)
        return json({ code: 'email_unavailable', message: 'Email sending is not configured.' }, 503)
      }
      const { data: settings } = await admin.from('venue_settings').select('name').eq('venue_id', venue.id).maybeSingle()
      const sent = await sendEmail(
        fetch,
        transport,
        { from: fromFor(settings?.name, Deno.env.get('EMAIL_FROM')), resendKey, mailpitUrl },
        { to: parsed.email, ...ownerLinkEmail({ venueName: settings?.name ?? '', link }) },
        `owner-link-${userId}-${Date.now()}`,
      )
      if (!sent.ok) {
        console.error('invite-venue-owner: send failed', sent.error)
        return json({ code: 'invite_failed', message: "We couldn't send the email." }, 502)
      }
    }
    return json({ ok: true, invited: action === 'invite', sent: action })
  }),
}
