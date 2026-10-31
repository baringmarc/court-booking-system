// Two venues on one stack, each on its own subdomain (SPEC §10 2026-10-31, T13.9): players see only their venue,
// and admin rights do not cross venues.
import { expect, test } from '@playwright/test'
import { addVenueStaff, createAdmin, createPlayer, createVenue, deleteVenue, serviceClient, submitAdminLogin } from './support/helpers.ts'

type E2EVenue = Awaited<ReturnType<typeof createVenue>>
const venues: E2EVenue[] = []
// Ids of venues whose createVenue threw midway (the venue row exists but the helper never returned it).
const partialVenueIds: string[] = []

async function newVenue(kind: string) {
  try {
    const venue = await createVenue(kind)
    venues.push(venue)
    return venue
  } catch (error) {
    const { data } = await serviceClient().from('venues').select('id').like('slug', `e2e-${kind}-%`)
    for (const row of data ?? []) partialVenueIds.push(row.id)
    throw error
  }
}

test.afterAll(async () => {
  const ids = new Set([...venues.map((v) => v.id), ...partialVenueIds])
  for (const id of ids) await deleteVenue(id)
})

test('player view: each venue host lists only its own courts; an unknown subdomain is "Venue not found"', async ({ page }) => {
  const other = await newVenue('court')

  await page.goto('/book')
  await expect(page.getByText('Badminton 1').first()).toBeVisible()
  await expect(page.getByText(other.court)).toHaveCount(0)

  await page.goto(`${other.url}/book`)
  await expect(page.getByText(other.court).first()).toBeVisible()
  await expect(page.getByText('Badminton 1')).toHaveCount(0)
  await expect(page.getByText('Pickleball 1')).toHaveCount(0)

  await page.goto('http://e2e-nope-xyz.localhost:5179/')
  await expect(page.getByRole('heading', { name: 'Venue not found' })).toBeVisible()
})

test('admin isolation: a Claudex-only admin is refused on the second venue host', async ({ page }) => {
  const other = await newVenue('iso')
  const admin = await createAdmin()

  await page.goto(`${other.url}/admin/login`)
  await submitAdminLogin(page, admin.email, admin.password)

  await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: /Admins only|Venue not found/ }),
  ).toBeVisible()
  await page.goto(`${other.url}/admin/bookings`)
  await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0)
})

test('an admin of both venues gets a venue switcher linking to the other venue', async ({ page }) => {
  const other = await newVenue('both')
  const player = await createPlayer('admin')
  await addVenueStaff(other.id, player.id)
  const { data: claudex, error } = await serviceClient().from('venues').select('id').eq('slug', 'claudex-courts').single()
  if (error) throw error
  await addVenueStaff(claudex.id, player.id)

  await page.goto('/admin/login')
  await submitAdminLogin(page, player.email, player.password)
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible()

  const switcher = page.getByRole('navigation', { name: 'Venues' })
  await expect(switcher).toBeVisible()
  const link = switcher.getByRole('link', { name: other.slug })
  await expect(link).toHaveAttribute('href', `${other.url}/admin`)
  await link.click()

  // Sessions are per origin, so the other venue may ask for a login first.
  await expect(page).toHaveURL(new RegExp(`^${other.url.replace(/[.]/g, '\\.')}/admin`))
  const loginHeading = page.getByRole('heading', { name: 'Admin log in' })
  const adminNav = page.getByRole('navigation', { name: 'Admin' })
  await expect(loginHeading.or(adminNav)).toBeVisible()
  if (await loginHeading.isVisible()) {
    await submitAdminLogin(page, player.email, player.password)
  }
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible()
})
