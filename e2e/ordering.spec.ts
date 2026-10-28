// T9.4, T11.5a: an admin drags a court by its ☰ handle on /admin/courts (desktop and 360px), and /book shows the
// new order, then moves it back with the keyboard. The handle's tap menu is used in venue-info.spec.ts.
import { expect, test, type Page } from '@playwright/test'
import { axeBothSchemes, createAdmin, logInAdmin, serviceClient, venueDate } from './support/helpers.ts'

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

test('an admin drags a court above another and players see the new order on /book', async ({ page }) => {
  await restoreSeedOrder()
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/courts')
  await expect(pickleballRows(page)).toHaveText(['Pickleball 1', 'Pickleball 2'])

  // The handles, and an open move menu, are accessible in both colour schemes.
  expect(await axeBothSchemes(page), 'courts list').toEqual([])
  await page.getByRole('button', { name: 'Reorder Pickleball 1' }).click()
  await expect(page.getByRole('group', { name: 'Move Pickleball 1' })).toBeVisible()
  expect(await axeBothSchemes(page), 'courts list with a menu open').toEqual([])
  await page.keyboard.press('Escape')

  // Drag Pickleball 2's handle up past Pickleball 1, in steps so the drag sensor follows.
  const handle = page.getByRole('button', { name: 'Reorder Pickleball 2' })
  const target = page.getByRole('button', { name: 'Reorder Pickleball 1' })
  const from = (await handle.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, to.y - 4, { steps: 12 })
  await page.mouse.up()
  await expect(pickleballRows(page)).toHaveText(['Pickleball 2', 'Pickleball 1'])

  // Saved: still in the new order after a reload.
  await page.reload()
  await expect(pickleballRows(page)).toHaveText(['Pickleball 2', 'Pickleball 1'])

  // Players see it.
  await page.goto(`/book?date=${venueDate(15)}&sport=pickleball`)
  await expect(page.getByRole('columnheader', { name: /^Pickleball/ })).toHaveText(['Pickleball 2', 'Pickleball 1'])

  // Back again with the keyboard: Space picks up, the arrow key moves, Space drops (saved on the drop).
  await page.goto('/admin/courts')
  await page.getByRole('button', { name: 'Reorder Pickleball 1' }).focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowUp')
  await expect(pickleballRows(page)).toHaveText(['Pickleball 1', 'Pickleball 2'])
  await page.keyboard.press('Space')
  await expect(page.getByText('Dropped Pickleball 1 at position 1 of 2.')).toBeAttached()
  await expect(pickleballRows(page)).toHaveText(['Pickleball 1', 'Pickleball 2'])
  await page.reload()
  await expect(pickleballRows(page)).toHaveText(['Pickleball 1', 'Pickleball 2'])
})
