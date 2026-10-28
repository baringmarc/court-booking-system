// POST /functions/v1/site-review: a review sent from the marketing site (plotline-site).
// Contract: docs/PLATFORM.md §4. Stored unapproved; it appears on the site once an admin approves it.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { isLikelyBot, validateReview } from '../_shared/siteForms.ts'
import { json, preflight, readJson } from '../_shared/siteHttp.ts'

const THANKS = 'Thank you! Your review will appear once we have checked it.'

Deno.serve(async (req) => {
  const early = preflight(req)
  if (early) return early

  const body = await readJson(req)
  if (isLikelyBot(body, Date.now())) return json(req, { ok: true, message: THANKS })

  const result = validateReview(body)
  if (!result.ok) return json(req, result, 400)

  const r = result.value
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error } = await admin.from('reviews').insert({
    name: r.name,
    venue: r.venue || null,
    quote: r.quote,
    role: r.role,
    rating: r.rating,
    consented_at: new Date().toISOString(),
  })

  if (error) {
    console.error('site-review: insert failed', error.code, error.message)
    return json(req, { ok: false, error: 'Could not send your review. Please try again.' }, 500)
  }
  return json(req, { ok: true, message: THANKS })
})
