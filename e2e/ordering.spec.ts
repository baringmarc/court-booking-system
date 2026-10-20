// T9.4: an admin reorders courts with the arrows on /admin/courts, and /book shows the new order.
import { expect, test, type Page } from '@playwright/test'
import { createAdmin, logInAdmin, serviceClient, venueDate } from './support/helpers.ts'

const SEED_ORDER = [{ name: 'Pickleball 1', sort_order: 1 }, { name: 'Pickleball 2', sort_order: 2 }]

async function restoreSeedOrder() {
  for (const { name, sort_order } of SEED_ORDER) {
    const { error } = await serviceClient().from('courts').update({ sort_order }).eq('name', name)
    if (error) throw error
  }
}

const pickleballRows = (page: Page) =>
  page.getByRole('region', { name: 'Pickleball' }).getByRole('listitem').locator('strong')

test.afterEach(restoreSeedOrder)

test('an admin moves a court up and players see the new order on /book', async ({ page }) => {
  await restoreSeedOrder()
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/courts')

  await expect(pickleballRows(page)).toHaveText(['Pickleball 1', 'Pickleball 2'])
  await expect(page.getByRole('button', { name: 'Move Pickleball 1 up' })).toBeDisabled()
  await page.getByRole('button', { name: 'Move Pickleball 2 up' }).click()
  await expect(pickleballRows(page)).toHaveText(['Pickleball 2', 'Pickleball 1'])
  await expect(page.getByRole('button', { name: 'Move Pickleball 2 down' })).toBeFocused()

  // Saved: still in the new order after a reload.
  await page.reload()
  await expect(pickleballRows(page)).toHaveText(['Pickleball 2', 'Pickleball 1'])

  await page.goto(`/book?date=${venueDate(15)}&sport=pickleball`)
  await expect(page.getByRole('columnheader', { name: /^Pickleball/ })).toHaveText(['Pickleball 2', 'Pickleball 1'])
})
