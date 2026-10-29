// T11.23: with Plotline's online payments switch off, a guest sees only the manual way to pay and can still upload a
// proof. venue_settings.online_payments_enabled is turned off for this file and restored (workers: 1).
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { E2E_PREFIX, pickFirstFreeSlot, serviceClient, uploadProof, venueDate } from './support/helpers.ts'

test.describe.serial('online payments off', () => {
  test.beforeAll(async () => {
    await serviceClient().from('venue_settings').update({ online_payments_enabled: false }).eq('id', true).throwOnError()
  })
  test.afterAll(async () => {
    await serviceClient().from('venue_settings').update({ online_payments_enabled: true }).eq('id', true).throwOnError()
  })

  test('a guest sees no Pay online, can still upload a proof, and the page is axe clean', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Pick a court and a time, then pay with GCash, Maya or a bank transfer.')).toBeVisible()

    await pickFirstFreeSlot(page, { date: venueDate(10), sport: 'tennis', court: 'Tennis Court' })
    await page.getByLabel('Name').fill(`${E2E_PREFIX} Manual Payer`)
    await page.getByLabel('Email').fill(`e2e-manual-${Date.now()}@example.com`)
    await page.getByRole('button', { name: 'Confirm booking' }).click()
    await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()

    await expect(page.getByRole('button', { name: 'Pay online with PayMongo' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Pay online' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Or pay manually' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Submit proof of payment' })).toBeVisible()

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])

    await uploadProof(page)
  })
})
