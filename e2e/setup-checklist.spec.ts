// T17.34: the dashboard setup checklist of a draft venue: where-to-fix lines, Fix links, the required-items count and
// the Done / To do status in text. Own E2E venue (deleted afterwards). Desktop and 360px, axe in both color schemes.
import { expect, test } from '@playwright/test'
import { addVenueStaff, axeBothSchemes, createPlayer, createVenue, deleteVenue, serviceClient } from './support/helpers.ts'

type E2EVenue = Awaited<ReturnType<typeof createVenue>>
let venue: E2EVenue | undefined

test.beforeEach(async () => {
  venue = await createVenue('setup-list')
  await serviceClient().from('venues').update({ status: 'draft' }).eq('id', venue.id).throwOnError()
})

test.afterEach(async () => {
  if (venue) await deleteVenue(venue.id)
  venue = undefined
})

test('a draft venue dashboard lists what is left, where to fix it and links there (T17.34)', async ({ page }) => {
  const player = await createPlayer('setup-list')
  await addVenueStaff(venue!.id, player.id)
  await page.goto(`${venue!.url}/admin`)
  // A draft venue is invisible to anon, so its host shows the "Staff sign in" form first (VenueProvider).
  await expect(page.getByRole('heading', { name: 'Staff sign in' })).toBeVisible()
  await page.getByLabel('Email').fill(player.email)
  await page.getByLabel('Password').fill(player.password)
  await page.getByRole('button', { name: 'Sign in' }).click()

  const checklist = page.getByRole('region', { name: 'Set up your venue' })
  await expect(checklist).toBeVisible()
  // Court, price and hours exist; payment account, instructions and photos are still open: 3 of the 5 required are done.
  await expect(checklist.getByText('3 of 5 done')).toBeVisible()

  const instructions = checklist.getByRole('listitem').filter({ hasText: 'Add payment instructions' })
  await expect(instructions.getByText('To do')).toBeAttached()
  await expect(instructions.getByText('Settings → Payments')).toBeVisible()
  await expect(instructions.getByRole('link', { name: /fix/i })).toHaveAttribute('href', '/admin/settings/payments')

  const photos = checklist.getByRole('listitem').filter({ hasText: 'photos' })
  await expect(photos.getByText('Optional')).toBeVisible()
  await expect(photos.getByText('Courts page')).toBeVisible()
  await expect(photos.getByRole('link', { name: /fix/i })).toHaveAttribute('href', '/admin/courts')

  const done = checklist.getByRole('listitem').filter({ hasText: 'Open on at least one day' })
  await expect(done.getByText('Done')).toBeAttached()
  await expect(done.getByRole('link')).toHaveCount(0)
  await expect(done.getByText('Schedule → Opening hours')).toHaveCount(0)

  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow, 'the dashboard scrolls sideways').toBeLessThanOrEqual(0)
  expect(await axeBothSchemes(page)).toEqual([])

  await instructions.getByRole('link', { name: /fix/i }).click()
  await expect(page).toHaveURL(/\/admin\/settings\/payments/)
})
