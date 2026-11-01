// POST /functions/v1/site-contact: a venue owner's contact form on the marketing site (plotline-site).
// Contract: docs/PLATFORM.md §4. Validates the form (the same rules plotline-site shows in the browser), drops
// bots quietly, checks Turnstile, then stores a lead. No auth account is created: we follow up and set the
// venue up together (SAAS-PLAN §1).
// After the lead is stored, LEAD_ALERT_TO (comma-separated addresses) is emailed about it (best-effort, T15.3).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { isLikelyBot, validateContact } from '../_shared/siteForms.ts'
import { emailTransport } from '../_shared/email.ts'
import { sendLeadAlert } from '../_shared/leadAlert.ts'
import { json, preflight, readJson, verifyTurnstile } from '../_shared/siteHttp.ts'

Deno.serve(async (req) => {
  const early = preflight(req)
  if (early) return early

  const body = await readJson(req)

  // Answer bots exactly like a success, so they learn nothing.
  if (isLikelyBot(body, Date.now())) return json(req, { ok: true })

  const result = validateContact(body)
  if (!result.ok) return json(req, result, 400)

  const human = await verifyTurnstile((body as { turnstileToken?: unknown }).turnstileToken, req)
  if (human === 'unconfigured') {
    console.error('site-contact: TURNSTILE_SECRET_KEY is not set on a hosted project')
    return json(req, { ok: false, error: 'The contact form is unavailable right now. Please message us instead.' }, 503)
  }
  if (!human) {
    return json(req, { ok: false, error: 'We could not check that you are human. Please try again.' }, 403)
  }

  const c = result.value
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: stored, error } = await admin.from('leads').insert({
    first_name: c.firstName,
    last_name: c.lastName,
    email: c.email,
    phone: c.phone,
    venue_name: c.venueName,
    location: c.location,
    courts: c.courts,
    facebook: c.facebook || null,
    message: c.message || null,
    consented_at: new Date().toISOString(),
  }).select('id').single()

  if (error) {
    console.error('site-contact: insert failed', error.code, error.message)
    return json(req, { ok: false, error: 'We could not send your message. Please try again.' }, 500)
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  const mailpitUrl = Deno.env.get('MAILPIT_URL')
  await sendLeadAlert({
    lead: { id: stored.id, ...c },
    to: Deno.env.get('LEAD_ALERT_TO'),
    transport: emailTransport({ transport: Deno.env.get('EMAIL_TRANSPORT'), resendKey, mailpitUrl, supabaseUrl: Deno.env.get('SUPABASE_URL') }),
    config: { from: Deno.env.get('EMAIL_FROM'), resendKey, mailpitUrl },
    fetchFn: fetch,
    log: console.error,
  })
  return json(req, { ok: true })
})
