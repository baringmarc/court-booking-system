// T17.27 and T17.28: guarded deletion of leads and unused venues from the console, with the real delete-unused-venue
// function, real Storage and a real Postgres. Local stack only; the function must be served locally
// (`npx supabase functions serve`, like the site-forms flows). Data is tagged E2E / e2e-. The venue and Storage
// fixtures are removed in each test's finally, in foreign-key order, and verified.
import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { drainVenueFileCleanup, storageAdapter, type CleanupStorage } from '../supabase/functions/_shared/venueCleanup.ts'
import { E2E_PREFIX, addVenueStaff, axeBothSchemes, createPlatformAdmin, createPlayer, createVenue, deleteVenue, serviceClient } from './support/helpers.ts'
import { localSupabase } from './support/local.ts'

const CONSOLE = 'http://app.localhost:5179/'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

test.describe.configure({ mode: 'serial' })

type Creds = { email: string; password: string }
type Venue = Awaited<ReturnType<typeof createVenue>>

async function signInConsole(page: Page, path: string) {
  const admin = await createPlatformAdmin()
  await page.goto(CONSOLE + path)
  await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  return admin
}

async function userClient(who: Creds) {
  const { url, publishableKey } = localSupabase()
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await client.auth.signInWithPassword(who)
  if (error) throw error
  return { client, token: data.session.access_token }
}

/** Calls the function as `who` (a signed-in user). */
async function callFunction(who: Creds, body: Record<string, unknown>) {
  const { url, publishableKey } = localSupabase()
  const { token } = await userClient(who)
  const res = await fetch(`${url}/functions/v1/delete-unused-venue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publishableKey, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as { code?: string; cleanup?: string; slug?: string } }
}

/** Every file under `prefix` in `bucket`, recursively (folders are list entries without an id). */
async function filesUnder(bucket: string, prefix: string): Promise<string[]> {
  const { data, error } = await serviceClient().storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) throw error
  const out: string[] = []
  for (const entry of data ?? []) {
    if (entry.id === null) out.push(...(await filesUnder(bucket, `${prefix}/${entry.name}`)))
    else out.push(`${prefix}/${entry.name}`)
  }
  return out
}

async function removeFiles(venueId: string) {
  for (const bucket of ['venue-media', 'payment-qr']) {
    const paths = await filesUnder(bucket, venueId)
    if (paths.length) await serviceClient().storage.from(bucket).remove(paths)
    expect(await filesUnder(bucket, venueId)).toEqual([])
  }
}

/** Real Storage fixtures: nested media and a payment QR. */
async function uploadFixtures(venueId: string) {
  const storage = serviceClient().storage
  const media = [`${venueId}/banner/e2e-banner.png`, `${venueId}/courts/e2e-court/photos/e2e-photo.png`, `${venueId}/e2e-logo.png`]
  for (const path of media) {
    const { error } = await storage.from('venue-media').upload(path, PNG, { contentType: 'image/png' })
    if (error) throw error
  }
  const { error } = await storage.from('payment-qr').upload(`${venueId}/e2e-qr.png`, PNG, { contentType: 'image/png' })
  if (error) throw error
  return { media, qr: `${venueId}/e2e-qr.png` }
}

async function venueExists(id: string) {
  return (await serviceClient().from('venues').select('id').eq('id', id).maybeSingle().throwOnError()).data !== null
}

async function target(kind: string) {
  const venue = await createVenue(kind)
  const staff = await createPlayer(`${kind}-staff`)
  await addVenueStaff(venue.id, staff.id)
  return { venue, staff }
}

const overflow = (page: Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
const venuePath = (v: Venue) => `venues?q=${encodeURIComponent(v.name)}&open=${v.id}`

test('cancel and a wrong subdomain delete nothing; the dialog is accessible', async ({ page }) => {
  const { venue } = await target('del-cancel')
  const files = await uploadFixtures(venue.id)
  try {
    await signInConsole(page, venuePath(venue))
    const panel = page.getByRole('region', { name: `Venue: ${venue.name}` })
    await panel.getByRole('button', { name: 'Delete venue' }).click()
    const dialog = page.getByRole('dialog', { name: `Delete ${venue.name}?` })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(venue.slug).first()).toBeVisible()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    expect(await axeBothSchemes(page)).toEqual([])

    const confirm = dialog.getByRole('button', { name: 'Delete venue' })
    await dialog.getByRole('textbox', { name: 'Type the subdomain to confirm' }).fill(venue.slug.slice(0, -1))
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('textbox', { name: 'Type the subdomain to confirm' }).fill(venue.slug.toUpperCase())
    await expect(confirm).toBeDisabled()

    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(panel.getByRole('button', { name: 'Delete venue' })).toBeFocused()

    // The server refuses a wrong subdomain too.
    const admin = await createPlatformAdmin()
    const wrong = await callFunction(admin, { action: 'delete', venue_id: venue.id, confirm_slug: `${venue.slug}-x` })
    expect(wrong.status).toBe(409)
    expect(wrong.body.code).toBe('confirmation_mismatch')

    expect(await venueExists(venue.id)).toBe(true)
    expect(await filesUnder('venue-media', venue.id)).toHaveLength(files.media.length)
    expect(await filesUnder('payment-qr', venue.id)).toHaveLength(1)
  } finally {
    await removeFiles(venue.id)
    await deleteVenue(venue.id)
    expect(await venueExists(venue.id)).toBe(false)
  }
})

test('venue staff are refused by the function; the demo venue and a venue with a booking are blocked', async ({ page }) => {
  const { venue, staff } = await target('del-blocked')
  const service = serviceClient()
  try {
    const staffCall = await callFunction(staff, { action: 'delete', venue_id: venue.id, confirm_slug: venue.slug })
    expect(staffCall.status).toBe(403)
    expect(staffCall.body.code).toBe('not_platform_admin')
    const staffRetry = await callFunction(staff, { action: 'retry', venue_id: venue.id })
    expect(staffRetry.status).toBe(403)
    expect(staffRetry.body.code).toBe('not_platform_admin')
    expect(await venueExists(venue.id)).toBe(true)

    const admin = await createPlatformAdmin()
    const demo = await service.from('venues').select('id').eq('slug', 'claudex-courts').single().throwOnError()
    const protectedCall = await callFunction(admin, { action: 'delete', venue_id: demo.data!.id, confirm_slug: 'claudex-courts' })
    expect(protectedCall.status).toBe(409)
    expect(protectedCall.body.code).toBe('venue_protected')
    expect(await venueExists(demo.data!.id)).toBe(true)

    const missing = await callFunction(admin, { action: 'delete', venue_id: '00000000-0000-4000-8000-000000000000', confirm_slug: 'nope-nope' })
    expect(missing.status).toBe(404)
    expect((await callFunction(admin, { action: 'delete' })).status).toBe(400)

    const court = await service.from('courts').select('id').eq('venue_id', venue.id).single().throwOnError()
    const code = `CB-${Array.from({ length: 6 }, () => 'BCDFGHJKMNPQRSTVWXYZ23456789'[Math.floor(Math.random() * 28)]).join('')}`
    await service.from('bookings').insert({
      venue_id: venue.id, reference_code: code, court_id: court.data!.id, guest_name: `${E2E_PREFIX} Blocked guest`,
      source: 'walk_in', status: 'confirmed', total_amount: 700, booking_fee: 10,
      during: '[2026-01-10T02:00:00+08:00,2026-01-10T03:00:00+08:00)',
    }).throwOnError()
    const inUse = await callFunction(admin, { action: 'delete', venue_id: venue.id, confirm_slug: venue.slug })
    expect(inUse.status).toBe(409)
    expect(inUse.body.code).toBe('venue_in_use')

    await page.goto(CONSOLE + venuePath(venue))
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.getByRole('region', { name: `Venue: ${venue.name}` }).getByRole('button', { name: 'Delete venue' }).click()
    const dialog = page.getByRole('dialog', { name: `Delete ${venue.name}?` })
    await expect(dialog.getByText(/history/i)).toBeVisible()
    await expect(dialog.getByText(/test-data cleanup/i)).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Delete venue' })).toHaveCount(0)
    await expect(dialog.getByRole('textbox')).toHaveCount(0)
    expect(await venueExists(venue.id)).toBe(true)
  } finally {
    await service.from('bookings').delete().like('guest_name', `${E2E_PREFIX} Blocked guest`)
    await deleteVenue(venue.id)
    expect(await venueExists(venue.id)).toBe(false)
  }
})

test('deleting an unused venue removes its rows and files, keeps accounts and other venues, and frees the subdomain', async ({ page }) => {
  const { venue, staff } = await target('del-ok')
  const other = await createVenue('del-keep')
  await addVenueStaff(other.id, staff.id)
  const mine = await uploadFixtures(venue.id)
  const theirs = await uploadFixtures(other.id)
  const service = serviceClient()
  let recreated: string | null = null
  try {
    const admin = await signInConsole(page, venuePath(venue))
    await page.getByRole('region', { name: `Venue: ${venue.name}` }).getByRole('button', { name: 'Delete venue' }).click()
    const dialog = page.getByRole('dialog', { name: `Delete ${venue.name}?` })
    await expect(dialog.getByText(/accounts are kept/i)).toBeVisible()
    await dialog.getByRole('textbox', { name: 'Type the subdomain to confirm' }).fill(venue.slug)
    await dialog.getByRole('button', { name: 'Delete venue' }).click()

    await expect(dialog).not.toBeVisible()
    const status = page.getByRole('status').filter({ hasText: /deleted/i })
    await expect(status).toContainText(venue.name)
    await expect(page).not.toHaveURL(/open=/)

    expect(await venueExists(venue.id)).toBe(false)
    for (const table of ['courts', 'operating_hours', 'venue_settings', 'venue_members'] as const) {
      const { count } = await service.from(table).select('*', { count: 'exact', head: true }).eq('venue_id', venue.id).throwOnError()
      expect(count, table).toBe(0)
    }
    expect(await filesUnder('venue-media', venue.id)).toEqual([])
    expect(await filesUnder('payment-qr', venue.id)).toEqual([])
    expect((await filesUnder('venue-media', other.id)).sort()).toEqual([...theirs.media].sort())
    expect(await filesUnder('payment-qr', other.id)).toEqual([theirs.qr])
    expect(mine.media.length).toBeGreaterThan(1)

    // The staff user's account and their membership of the other venue survive.
    const account = await service.auth.admin.getUserById(staff.id)
    expect(account.data.user?.email).toBe(staff.email)
    const kept = await service.from('venue_members').select('venue_id').eq('user_id', staff.id).throwOnError()
    expect(kept.data?.map((m) => m.venue_id)).toEqual([other.id])
    expect(await venueExists(other.id)).toBe(true)

    // The subdomain is free again.
    const { client } = await userClient(admin)
    const created = await client.rpc('create_venue', { p_slug: venue.slug, p_name: `${E2E_PREFIX} Again`, p_timezone: 'Asia/Manila' })
    expect(created.error).toBeNull()
    recreated = created.data
    expect(recreated).toBeTruthy()
  } finally {
    if (recreated) await deleteVenue(recreated)
    await removeFiles(venue.id)
    await removeFiles(other.id)
    if (await venueExists(venue.id)) await deleteVenue(venue.id)
    await deleteVenue(other.id)
    expect(await venueExists(other.id)).toBe(false)
  }
})

test('a pending file cleanup keeps the dialog open; Retry cleanup finishes it', async ({ page }) => {
  const { venue } = await target('del-pending')
  await uploadFixtures(venue.id)
  try {
    // Let the real function run, then report its cleanup as pending, as if Storage had failed.
    await page.route('**/functions/v1/delete-unused-venue', async (route) => {
      const request = route.request()
      if (request.method() !== 'POST' || (request.postDataJSON() as { action?: string } | null)?.action !== 'delete') return route.continue()
      const response = await route.fetch()
      const body = (await response.json()) as Record<string, unknown>
      await route.fulfill({ response, json: { ...body, cleanup: 'pending' } })
    })
    await signInConsole(page, venuePath(venue))
    await page.getByRole('region', { name: `Venue: ${venue.name}` }).getByRole('button', { name: 'Delete venue' }).click()
    const dialog = page.getByRole('dialog', { name: `Delete ${venue.name}?` })
    await dialog.getByRole('textbox', { name: 'Type the subdomain to confirm' }).fill(venue.slug)
    await dialog.getByRole('button', { name: 'Delete venue' }).click()

    await expect(dialog.getByRole('status')).toContainText(/file cleanup is pending/i)
    expect(await venueExists(venue.id)).toBe(false)
    await dialog.getByRole('button', { name: 'Retry cleanup' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: /deleted/i })).toContainText(venue.name)
    expect(await filesUnder('venue-media', venue.id)).toEqual([])
    expect(await filesUnder('payment-qr', venue.id)).toEqual([])
  } finally {
    await removeFiles(venue.id)
    if (await venueExists(venue.id)) await deleteVenue(venue.id)
  }
})

test('a Storage failure leaves the row to retry; the next drain finishes it and other venues keep their files', async () => {
  const { venue } = await target('del-inject')
  const other = await createVenue('del-inject-keep')
  await uploadFixtures(venue.id)
  const theirs = await uploadFixtures(other.id)
  const service = serviceClient()
  try {
    // Delete through the RPC alone, so the cleanup rows stay queued.
    const admin = await createPlatformAdmin()
    const { client } = await userClient(admin)
    const deleted = await client.rpc('delete_unused_venue', { p_venue_id: venue.id, p_confirm_slug: venue.slug })
    expect(deleted.error).toBeNull()
    expect(await filesUnder('venue-media', venue.id)).not.toEqual([])

    const mineOnly = <T extends { venue_id: string }>(rows: T[]) => rows.filter((r) => r.venue_id === venue.id)
    const queue = {
      async claim(limit: number) {
        const { data, error } = await service.rpc('claim_venue_file_cleanup', { p_limit: limit })
        if (error) throw error
        return mineOnly(data as unknown as { id: string; venue_id: string; bucket: string; prefix: string }[])
      },
      async finish(id: string, ok: boolean, error: string | null) {
        const res = await service.rpc('finish_venue_file_cleanup', { p_id: id, p_ok: ok, p_error: error as string })
        if (res.error) throw res.error
      },
    }
    const real = storageAdapter(service)
    let removes = 0
    const flaky: CleanupStorage = {
      list: (bucket, folder, opts) => real.list(bucket, folder, opts),
      remove: async (bucket, paths) => {
        removes += 1
        return removes === 1 ? { error: { message: 'injected failure' } } : real.remove(bucket, paths)
      },
    }

    const first = await drainVenueFileCleanup(queue, flaky)
    expect(first.failed).toHaveLength(1)
    expect(first.failed[0].error).toContain('injected failure')
    expect(first.done).toHaveLength(1)
    expect((await filesUnder('venue-media', venue.id)).length + (await filesUnder('payment-qr', venue.id)).length).toBeGreaterThan(0)

    const second = await drainVenueFileCleanup(queue, flaky)
    expect(second.done.map((r) => r.id)).toEqual(first.failed.map((r) => r.id))
    expect(second.failed).toEqual([])
    expect(await filesUnder('venue-media', venue.id)).toEqual([])
    expect(await filesUnder('payment-qr', venue.id)).toEqual([])

    const third = await drainVenueFileCleanup(queue, flaky)
    expect(third).toEqual({ done: [], failed: [] })
    expect((await filesUnder('venue-media', other.id)).sort()).toEqual([...theirs.media].sort())
    expect(await filesUnder('payment-qr', other.id)).toEqual([theirs.qr])
  } finally {
    await removeFiles(venue.id)
    await removeFiles(other.id)
    if (await venueExists(venue.id)) await deleteVenue(venue.id)
    await deleteVenue(other.id)
    expect(await venueExists(other.id)).toBe(false)
  }
})

async function post(body: Record<string, unknown>) {
  const { url, publishableKey } = localSupabase()
  const res = await fetch(`${url}/functions/v1/site-contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: (await res.json()) as { ok: boolean } }
}
const leadBody = (email: string, venueName: string) => ({
  firstName: 'Ana', lastName: 'Reyes', email, phone: '09171234567', venueName, location: 'Quezon City', courts: 3,
  consent: true, website: '', started: Date.now() - 10_000, turnstileToken: 'e2e',
})

test('deleting a lead removes only the lead; its created venue stays and the same email can submit again', async ({ page }) => {
  const tag = Date.now().toString(36)
  const email = `e2e-del-lead-${tag}@example.com`
  const name = `${E2E_PREFIX} DelLead ${tag}`
  const service = serviceClient()
  const venue = await createVenue('del-lead')
  const count = async () => (await service.from('leads').select('id', { count: 'exact', head: true }).eq('email', email).throwOnError()).count
  try {
    expect((await post(leadBody(email, name))).status).toBe(200)
    expect(await count()).toBe(1)

    await signInConsole(page, `leads?q=${encodeURIComponent(name)}`)
    await page.getByRole('main').getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: /details/i }).click()
    const panel = page.getByRole('region', { name: `Lead: ${name}` })
    await panel.getByRole('button', { name: 'Delete lead' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete lead?' })
    await expect(dialog).toContainText('Ana Reyes')
    await expect(dialog).toContainText(name)
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    expect(await axeBothSchemes(page)).toEqual([])
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    expect(await count()).toBe(1)
    await expect(panel.getByRole('button', { name: 'Delete lead' })).toBeFocused()

    await panel.getByRole('button', { name: 'Delete lead' }).click()
    await dialog.getByRole('button', { name: 'Delete lead' }).click()
    await expect(page.getByRole('status').filter({ hasText: /deleted/i })).toContainText(name)
    await expect(page).not.toHaveURL(/open=/)
    expect(await count()).toBe(0)
    expect(await venueExists(venue.id)).toBe(true)

    const again = await post(leadBody(email, name))
    expect(again.status).toBe(200)
    expect(again.body.ok).toBe(true)
    expect(await count()).toBe(1)
  } finally {
    await service.from('leads').delete().eq('email', email)
    expect(await count()).toBe(0)
    await deleteVenue(venue.id)
  }
})

test('deleting the only lead on page 2 returns to page 1', async ({ page }) => {
  const tag = Date.now().toString(36)
  const service = serviceClient()
  const now = Date.now()
  const rows = Array.from({ length: 26 }, (_, i) => ({
    first_name: 'Pat', last_name: `Person${i + 1}`, email: `e2e-del-page-${tag}-${i + 1}@example.com`, phone: '09171234567',
    venue_name: `${E2E_PREFIX} DelPage ${tag} ${String(i + 1).padStart(2, '0')}`, location: 'Makati', courts: 2, status: 'new',
    consented_at: new Date(now).toISOString(), created_at: new Date(now - i * 60_000).toISOString(),
  }))
  await service.from('leads').insert(rows).throwOnError()
  const rowsOf = () => page.getByRole('main').getByRole('listitem').filter({ hasText: `${E2E_PREFIX} DelPage ${tag}` })
  const last = `${E2E_PREFIX} DelPage ${tag} 26`
  try {
    await signInConsole(page, `leads?q=${encodeURIComponent(`${E2E_PREFIX} DelPage ${tag}`)}&page=2`)
    await expect(rowsOf()).toHaveCount(1)
    await rowsOf().getByRole('button', { name: /details/i }).click()
    await page.getByRole('region', { name: `Lead: ${last}` }).getByRole('button', { name: 'Delete lead' }).click()
    await page.getByRole('dialog', { name: 'Delete lead?' }).getByRole('button', { name: 'Delete lead' }).click()
    await expect(page).not.toHaveURL(/page=2/)
    await expect(rowsOf()).toHaveCount(25)
    await expect(page.getByText(/Page 1 of 1/)).toBeVisible()
    expect((await service.from('leads').select('id').eq('venue_name', last).throwOnError()).data).toEqual([])
  } finally {
    await service.from('leads').delete().like('venue_name', `${E2E_PREFIX} DelPage ${tag}%`)
    expect((await service.from('leads').select('id').like('venue_name', `${E2E_PREFIX} DelPage ${tag}%`).throwOnError()).data).toEqual([])
  }
})

