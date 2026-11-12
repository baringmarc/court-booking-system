// POST JSON { venue_id, email, role? } from the platform console (T14.5, T17.25, T24.1). Platform admins only.
// `role` is 'owner' (the default) or 'staff'.
//   1. the caller (a verified session) must have a platform_admins row
//   2. the venue must exist
//   3. by account state: no account gets an account-setup invitation; an account that was invited but never set a
//      password gets a fresh access link; any other account gets a welcome email with the venue's sign-in URL and no
//      password reset. Links come from generateLink and always redirect to the venue's own admin area.
//   4. the user becomes a member of the venue with the requested role (venue_members, an idempotent upsert) before
//      anything is sent, so a retry after a failed send never adds a second row; owner wins, so a staff invite never
//      demotes an owner and an owner invite promotes staff (mergeMemberRole)
//   5. the function sends the email itself (Plotline identity, support reply-to, the owner PDF attached to owner emails
//      when it can be fetched, its download link always; staff emails link it only). A failed send is a 502, never ok.
// Links and tokens are never logged or returned.
import { withSupabase } from 'npm:@supabase/server@1'
import { callerUserId } from '../_shared/payable.ts'
import { emailTransport, fromFor, sendEmail, type EmailAttachment } from '../_shared/email.ts'
import {
  OWNER_GUIDE_FILE, OWNER_SUPPORT_EMAIL, inviteRedirectTo, ownerEmail, ownerGuideSource, ownerGuideUrl, ownerLinkAction, parseInviteBody,
  mergeMemberRole, type MemberRole,
} from '../_shared/ownerInvite.ts'
import * as Sentry from 'npm:@sentry/deno@10.76.2'
import { withSentry } from '../_shared/sentry.ts'

const json = (body: unknown, status = 200) => Response.json(body, { status })
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** The owner PDF as an attachment, or null (the email still carries the download link). */
async function guideAttachment(source: string): Promise<EmailAttachment | null> {
  try {
    const res = await fetch(source, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      console.error('invite-venue-owner: guide fetch returned', res.status)
      return null
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    const isPdf = bytes.length > 4 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-'
    if (!isPdf || bytes.length > MAX_ATTACHMENT_BYTES) {
      console.error('invite-venue-owner: guide is not a PDF or is too large', bytes.length)
      return null
    }
    return { filename: OWNER_GUIDE_FILE, contentBase64: encodeBase64(bytes), contentType: 'application/pdf' }
  } catch (e) {
    console.error('invite-venue-owner: guide fetch failed', e instanceof Error ? e.message : String(e))
    return null
  }
}

export default {
  fetch: withSupabase({ auth: ['user'] }, withSentry('invite-venue-owner', async (req, ctx) => {
    if (req.method !== 'POST') return json({ code: 'method_not_allowed', message: 'Use POST.' }, 405)

    const callerId = callerUserId(ctx)
    const admin = ctx.supabaseAdmin
    const { data: platformAdmin } = callerId
      ? await admin.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle()
      : { data: null }
    if (!platformAdmin) return json({ code: 'not_platform_admin', message: 'Platform admins only.' }, 403)

    const parsed = parseInviteBody(await req.json().catch(() => null))
    if (!parsed.ok) return json({ code: 'invalid_input', message: 'Send a venue and a valid email.' }, 400)

    const { data: venue } = await admin.from('venues').select('id, slug, status').eq('id', parsed.venueId).maybeSingle()
    if (!venue) return json({ code: 'not_found', message: 'Venue not found.' }, 404)

    const rootDomain = Deno.env.get('PUBLIC_ROOT_DOMAIN')
    const redirectTo = inviteRedirectTo({ slug: venue.slug, origin: null, rootDomain, allowList: Deno.env.get('PUBLIC_SITE_URL') })
    if (!redirectTo) return json({ code: 'site_unavailable', message: 'No site URL is configured.' }, 503)
    const siteBase = redirectTo.replace(/\/admin$/, '')

    const resendKey = Deno.env.get('RESEND_API_KEY')
    const mailpitUrl = Deno.env.get('MAILPIT_URL')
    const transport = emailTransport({ transport: Deno.env.get('EMAIL_TRANSPORT'), resendKey, mailpitUrl, supabaseUrl: Deno.env.get('SUPABASE_URL') })
    if (transport !== 'resend' && transport !== 'mailpit') {
      console.error('invite-venue-owner: email transport is', transport)
      return json({ code: 'email_unavailable', message: 'Email sending is not configured.' }, 503)
    }

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

    // A new account is created by its invite link; a retry after a later failure finds it invited and sends a fresh link.
    let link: string | undefined
    if (action !== 'welcome') {
      const generated = await admin.auth.admin.generateLink(
        action === 'invite'
          ? { type: 'invite', email: parsed.email, options: { redirectTo } }
          : { type: 'magiclink', email: parsed.email, options: { redirectTo } },
      )
      link = generated.data?.properties?.action_link
      if (generated.error || !link || !generated.data.user) {
        console.error('invite-venue-owner: link failed', generated.error?.message)
        return json({ code: 'invite_failed', message: "We couldn't create the sign-in link." }, 502)
      }
      userId = generated.data.user.id
    }

    const current = await admin
      .from('venue_members').select('role').eq('venue_id', venue.id).eq('user_id', userId!).maybeSingle()
    if (current.error) {
      console.error('invite-venue-owner: membership lookup failed', current.error.message)
      return json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, 500)
    }
    const role = mergeMemberRole((current.data?.role as MemberRole | undefined) ?? null, parsed.role)
    const { error } = await admin
      .from('venue_members')
      .upsert({ venue_id: venue.id, user_id: userId!, role }, { onConflict: 'venue_id,user_id' })
    if (error) {
      console.error('invite-venue-owner: membership failed', error.message)
      return json({ code: 'server_error', message: 'Something went wrong. Please try again.' }, 500)
    }

    const { data: settings } = await admin.from('venue_settings').select('name').eq('venue_id', venue.id).maybeSingle()
    const guideUrl = ownerGuideUrl(siteBase)
    const attachment = role === 'staff' ? null : await guideAttachment(ownerGuideSource(siteBase, Deno.env.get('OWNER_GUIDE_URL')))
    const mail = ownerEmail({
      kind: action,
      venueName: settings?.name ?? '',
      venueUrl: redirectTo,
      link,
      guideUrl,
      venueAddress: rootDomain ? `${venue.slug}.${rootDomain}` : venue.slug,
      venueStatus: venue.status,
      role,
    })
    const sent = await sendEmail(
      fetch,
      transport,
      { from: fromFor('Plotline', Deno.env.get('EMAIL_FROM')), resendKey, mailpitUrl },
      { to: parsed.email, ...mail, replyTo: OWNER_SUPPORT_EMAIL, attachments: attachment ? [attachment] : undefined },
      `${role}-${action}-${venue.id}-${userId}-${Date.now()}`,
    )
    if (!sent.ok) {
      console.error('invite-venue-owner: send failed', sent.error)
      return json({ code: 'invite_failed', message: "We couldn't send the email. Try again." }, 502)
    }
    return json({ ok: true, invited: action === 'invite', sent: action, role })
  }, Sentry)),
}
