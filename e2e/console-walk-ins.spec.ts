// T18.4: a platform admin switches a venue's walk-ins in the console. Uses Claudex Courts; afterAll restores it to off.
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { axeBothSchemes, createPlatformAdmin, serviceClient, venueId } from './support/helpers.ts'

const CONSOLE = 'http://app.localhost:5179/'

async function setSwitch(enabled: boolean) {
  await serviceClient().from('venue_settings').update({ walk_ins_enabled: enabled }).eq('venue_id', await venueId()).throwOnError()
}
async function dbValue(id: string) {
  return (await serviceClient().from('venue_settings').select('walk_ins_enabled').eq('venue_id', id).single()).data?.walk_ins_enabled
}

test.describe.serial('console walk-ins switch', () => {
  test.beforeAll(async () => { await setSwitch(false) })
  test.afterAll(async () => { await setSwitch(false) })

  test('turning it on and off saves immediately and the database follows', async ({ page }) => {
    const id = await venueId()
    const { data: settings } = await serviceClient().from('venue_settings').select('name').eq('venue_id', id).single().throwOnError()
    const admin = await createPlatformAdmin()
    await page.goto(`${CONSOLE}venues?q=claudex-courts&open=${id}`)
    await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    const card = page.getByRole('dialog', { name: new RegExp(settings.name) }).or(page.getByRole('region', { name: new RegExp(settings.name) }))
    await expect(card.getByText('Walk-ins: Off', { exact: true })).toBeVisible()

    await card.getByRole('button', { name: 'Turn on walk-ins' }).click()
    await expect(card.getByText('Walk-ins: On', { exact: true })).toBeVisible()
    await expect.poll(() => dbValue(id)).toBe(true)
    expect(await axeBothSchemes(page)).toEqual([])

    await card.getByRole('button', { name: 'Turn off walk-ins' }).click()
    await expect(card.getByText('Walk-ins: Off', { exact: true })).toBeVisible()
    await expect.poll(() => dbValue(id)).toBe(false)
  })
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
