import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { addVenueStaff, createPlayer, createVenue, deleteVenue, submitAdminLogin } from './support/helpers.ts'

test('the venue title remains correct after staff logs out', async ({ page }) => {
  const venue = await createVenue('title-logout')
  try {
    const staff = await createPlayer('title-logout')
    await addVenueStaff(venue.id, staff.id)
    await page.goto(`${venue.url}/admin/login`)
    await submitAdminLogin(page, staff.email, staff.password)
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible()
    await expect(page).toHaveTitle(venue.name)
    await page.getByRole('button', { name: 'Account', exact: true }).click()
    await page.getByRole('button', { name: 'Log out' }).click()
    await expect(page.getByRole('heading', { name: 'Admin log in' })).toBeVisible()
    await expect(page).toHaveTitle(venue.name)
  } finally {
    await deleteVenue(venue.id)
  }
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
