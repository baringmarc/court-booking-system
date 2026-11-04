import { expect, test } from '@playwright/test'
import { addVenueStaff, createPlayer, createVenue, deleteVenue, serviceClient, submitAdminLogin } from './support/helpers.ts'

const made: string[] = []
test.afterAll(async () => {
  for (const id of made) await deleteVenue(id)
})

test('a cold venue load starts with neutral HTML, then uses that venue name on public and admin pages', async ({ page, request }) => {
  const venue = await createVenue('title')
  made.push(venue.id)
  const html = await (await request.get(`${venue.url}/`)).text()
  expect(html).toMatch(/<title>Plotline<\/title>/)
  expect(html).not.toContain('<title>Claudex Courts</title>')

  await page.goto(`${venue.url}/`)
  await expect(page).toHaveTitle(venue.name)
  const staff = await createPlayer('title')
  await addVenueStaff(venue.id, staff.id)
  await page.goto(`${venue.url}/admin/login`)
  await submitAdminLogin(page, staff.email, staff.password)
  await expect(page.getByRole('navigation', { name: 'Admin' })).toBeVisible()
  await expect(page).toHaveTitle(venue.name)

  const updated = `${venue.name} Renamed`
  const { error } = await serviceClient().from('venue_settings').update({ name: updated }).eq('venue_id', venue.id)
  if (error) throw error
  await page.reload()
  await expect(page).toHaveTitle(updated)
})

test('unknown venue remains neutral, and console title is set before its lazy screen appears', async ({ page, request }) => {
  const unknown = 'http://e2e-title-unknown.localhost:5179/'
  const html = await (await request.get(unknown)).text()
  expect(html).toMatch(/<title>Plotline<\/title>/)
  await page.goto(unknown)
  await expect(page.getByRole('heading', { name: 'Venue not found' })).toBeVisible()
  await expect(page).toHaveTitle('Plotline')

  await page.goto('http://app.localhost:5179/')
  await expect(page).toHaveTitle('Plotline Admin')
  await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
})
