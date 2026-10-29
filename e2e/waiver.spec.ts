// T11.20: the venue waiver. With a waiver set, a guest must tick the box to book; the booking page and the
// booking email show the text. The local venue_settings.waiver_text is set for this flow and restored (workers: 1).
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { E2E_PREFIX, emailText, pickFirstFreeSlot, serviceClient, venueDate } from './support/helpers.ts'

const WAIVER = 'E2E waiver: you play at your own risk & you bring your own water.'

test.describe.serial('waiver', () => {
  test.beforeAll(async () => {
    await serviceClient().from('venue_settings').update({ waiver_text: WAIVER }).eq('id', true).throwOnError()
  })
  test.afterAll(async () => {
    await serviceClient().from('venue_settings').update({ waiver_text: '' }).eq('id', true).throwOnError()
  })

  test('a guest must accept the waiver, then sees it on the booking page and in the email', async ({ page }) => {
    await pickFirstFreeSlot(page, { date: venueDate(10), sport: 'pickleball', court: 'Pickleball 1' })
    const email = `e2e-waiver-${Date.now()}@example.com`
    await page.getByLabel('Name').fill(`${E2E_PREFIX} Waiver Guest`)
    await page.getByLabel('Email').fill(email)

    await expect(page.getByRole('heading', { name: 'Waiver' })).toBeVisible()
    await expect(page.getByText(WAIVER)).toBeVisible()
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
    const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    expect(overflow).toBeLessThanOrEqual(0)

    // Unticked: refused with a message, nothing booked.
    await page.getByRole('button', { name: 'Confirm booking' }).click()
    await expect(page.getByText('Tick the box to accept the waiver.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Booking reserved' })).toHaveCount(0)

    await page.getByRole('checkbox', { name: 'I have read and accept the waiver' }).check()
    await page.getByRole('button', { name: 'Confirm booking' }).click()
    await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()

    await expect(page.getByRole('heading', { name: 'Waiver you accepted' })).toBeVisible()
    await expect(page.getByText(WAIVER)).toBeVisible()
    const reference = new URL(page.url()).pathname.split('/').pop()!
    const { data } = await serviceClient().from('bookings').select('waiver_text, waiver_accepted_at')
      .eq('reference_code', reference).single().throwOnError()
    expect(data.waiver_text).toBe(WAIVER)
    expect(data.waiver_accepted_at).not.toBeNull()

    const mail = await emailText(email, new RegExp(`^Booking ${reference}`))
    expect(mail).toContain("You accepted the venue's waiver:")
    expect(mail).toContain(WAIVER)
  })
})
