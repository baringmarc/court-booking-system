// T32.1: a venue made through create_venue is on schedule v2 from the start. Its owner sets an 11 PM close in
// Weekly Hours & Rates and players see the 10 PM - 11 PM slot on /book, with no manual activation (the other schedule
// specs flip venue_schedule_state by hand; this one must not). Own E2E venue, removed in `finally`.
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { E2E_PREFIX, createPlatformAdmin, createPlayer, deleteVenue, serviceClient, submitAdminLogin, venueDate } from './support/helpers.ts'
import { localSupabase } from './support/local.ts'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

test('a new venue owner saves an 11 PM close and players can book the 10 PM slot, without any activation', async ({ page }) => {
  const service = serviceClient()
  const slug = `e2e-newv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
  const name = `${E2E_PREFIX} New Venue ${slug.slice(-4)}`
  const court = `${E2E_PREFIX} New Venue Court`
  const url = `http://${slug}.localhost:5179`
  const date = venueDate(10)
  const [y, m, d] = date.split('-').map(Number)
  const day = DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const owner = await createPlayer('newv-owner')
  const platform = await createPlatformAdmin()
  let venueId: string | undefined
  try {
    // The console's create step: the create_venue RPC, as a platform admin.
    const { url: apiUrl, publishableKey } = localSupabase()
    const client = createClient(apiUrl, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const signIn = await client.auth.signInWithPassword({ email: platform.email, password: platform.password })
    if (signIn.error) throw signIn.error
    const created = await client.rpc('create_venue', { p_slug: slug, p_name: name, p_timezone: 'Asia/Manila' })
    expect(created.error).toBeNull()
    venueId = created.data as string
    // What the console does later: an owner, a court, and publishing the venue. Nothing touches the schedule.
    await service.from('venue_members').insert({ venue_id: venueId, user_id: owner.id, role: 'owner' }).throwOnError()
    await service.from('courts').insert({ venue_id: venueId, name: court, sport: 'tennis', default_hourly_rate: 700 }).throwOnError()
    await service.from('venues').update({ status: 'active' }).eq('id', venueId).throwOnError()

    const state = await service.from('venue_schedule_state').select('schedule_v2_active').eq('venue_id', venueId).single()
    expect(state.data?.schedule_v2_active).toBe(true)

    // The owner sets an 11 PM close for the day we will look at (Weekly Hours & Rates, as in weekly-hours.spec.ts).
    await page.goto(`${url}/admin/schedule`)
    await submitAdminLogin(page, owner.email, owner.password)
    await expect(page.getByRole('switch', { name: 'Monday open' })).toBeVisible()
    await page.getByRole('group', { name: day }).getByLabel(`${day} closes`).selectOption({ value: '23' })
    await page.getByRole('button', { name: 'Review & save' }).click()
    await page.getByRole('dialog', { name: 'Review changes' }).getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByRole('region', { name: 'Unsaved changes' })).toHaveCount(0)

    // Players see the 10 PM - 11 PM slot (the venue is still active; the court is named in the slot's label).
    await page.goto(`${url}/book?date=${date}&sport=tennis`)
    await expect(page.getByRole('button', { name: new RegExp(`^${court}, 9 PM – 10 PM`) })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: new RegExp(`^${court}, 10 PM – 11 PM`) })).toBeVisible()
    await expect(page.getByRole('rowheader', { name: '10 PM – 11 PM' })).toBeVisible()
  } finally {
    if (venueId) {
      await deleteVenue(venueId)
      const gone = await service.from('venues').select('id').eq('id', venueId)
      expect(gone.data).toEqual([])
    }
  }
})

guardLeaks()
