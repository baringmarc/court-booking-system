// T18.2: a platform admin switches a venue's online payments in the console, and the venue's booking page follows.
// Uses Claudex Courts (venueId()): the switch starts off, and afterAll restores it to on (workers: 1, serial).
import { expect, test, type Page } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import {
  E2E_PREFIX, axeBothSchemes, createPlatformAdmin, pickFirstFreeSlot, serviceClient, venueDate, venueId,
} from './support/helpers.ts'

const CONSOLE = 'http://app.localhost:5179/'

async function setSwitch(enabled: boolean) {
  await serviceClient().from('venue_settings').update({ online_payments_enabled: enabled }).eq('venue_id', await venueId()).throwOnError()
}

test.describe.serial('console online payments switch', () => {
  test.beforeAll(async () => { await setSwitch(false) })
  test.afterAll(async () => { await setSwitch(true) })

  test('turning it on shows Pay online on the booking page, turning it off hides it', async ({ page }) => {
    const id = await venueId()
    const { data: settings } = await serviceClient().from('venue_settings').select('name').eq('venue_id', id).single().throwOnError()
    const slug = 'claudex-courts'

    // A guest reserves a booking while online payments are off.
    await page.goto('/')
    await pickFirstFreeSlot(page, { date: venueDate(12), sport: 'tennis', court: 'Tennis Court' })
    await page.getByLabel('Name').fill(`${E2E_PREFIX} Switch Payer`)
    await page.getByLabel('Email').fill(`e2e-switch-${Date.now()}@example.com`)
    await page.getByRole('button', { name: 'Confirm booking' }).click()
    await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pay online with PayMongo' })).toHaveCount(0)

    // The platform admin opens the venue's panel in the console.
    const admin = await createPlatformAdmin()
    const consolePage: Page = await page.context().newPage()
    await consolePage.goto(`${CONSOLE}venues?q=${slug}&open=${id}`)
    await expect(consolePage.getByRole('heading', { name: 'Platform console' })).toBeVisible()
    await consolePage.getByLabel('Email').fill(admin.email)
    await consolePage.getByLabel('Password').fill(admin.password)
    await consolePage.getByRole('button', { name: 'Sign in' }).click()
    const card = consolePage.getByRole('dialog', { name: new RegExp(settings.name) }).or(consolePage.getByRole('region', { name: new RegExp(settings.name) }))
    await expect(card.getByText('Online payments: Off', { exact: true })).toBeVisible()

    // Turning on asks first; Cancel changes nothing.
    await card.getByRole('button', { name: 'Turn on online payments' }).click()
    const confirm = consolePage.getByRole('dialog', { name: 'Turn on online payments?' })
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('PayMongo test-mode account')
    expect(await axeBothSchemes(consolePage)).toEqual([])
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).not.toBeVisible()
    await expect(card.getByText('Online payments: Off', { exact: true })).toBeVisible()

    await card.getByRole('button', { name: 'Turn on online payments' }).click()
    await consolePage.getByRole('dialog', { name: 'Turn on online payments?' }).getByRole('button', { name: 'Turn on', exact: true }).click()
    await expect(card.getByText('Online payments: On', { exact: true })).toBeVisible()
    await expect.poll(async () => (await serviceClient().from('venue_settings').select('online_payments_enabled').eq('venue_id', id).single()).data?.online_payments_enabled).toBe(true)
    expect(await axeBothSchemes(consolePage)).toEqual([])

    await page.reload()
    await expect(page.getByRole('button', { name: 'Pay online with PayMongo' })).toBeVisible()

    // Turning off needs no confirmation.
    await card.getByRole('button', { name: 'Turn off online payments' }).click()
    await expect(card.getByText('Online payments: Off', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Pay online with PayMongo' })).toHaveCount(0)
  })
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
