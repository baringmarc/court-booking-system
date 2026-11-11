// T18.4: with the walk-ins setting off (the default), the admin dashboard has no walk-in card.
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { axeBothSchemes, createAdmin, logInAdmin, serviceClient, venueId } from './support/helpers.ts'

test.describe.serial('walk-ins off', () => {
  test.beforeAll(async () => {
    await serviceClient().from('venue_settings').update({ walk_ins_enabled: false }).eq('venue_id', await venueId()).throwOnError()
  })

  test('the dashboard has no walk-in card while walk-ins are off', async ({ page }) => {
    const admin = await createAdmin()
    await logInAdmin(page, admin.email, admin.password)
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Proofs to review' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Walk-in' })).toHaveCount(0)
    expect(await axeBothSchemes(page)).toEqual([])
  })
})

// H14: keep last.
guardLeaks()
