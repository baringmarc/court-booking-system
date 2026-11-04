import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { addVenueStaff, createPlayer, createVenue, deleteVenue, serviceClient, submitAdminLogin } from './support/helpers.ts'

test('T17.4 category pages preserve values, independent saves and dirty navigation at desktop and 360px', async ({ page }) => {
  const venue = await createVenue('settings')
  try {
    const admin = await createPlayer('settings-admin')
    await addVenueStaff(venue.id, admin.id)
    await page.goto(`${venue.url}/admin/settings`)
    await submitAdminLogin(page, admin.email, admin.password)
    await expect(page).toHaveURL(`${venue.url}/admin/settings`)
    const categories = [
      ['Venue Profile', 'venue'], ['Payment Setup', 'payments'], ['Booking Rules', 'booking'],
      ['Website Appearance', 'appearance'], ['Policies & Waivers', 'policies'],
    ] as const
    for (const [name, slug] of categories) {
      await expect(page.getByRole('link', { name: new RegExp(name) })).toHaveAttribute('href', `/admin/settings/${slug}`)
    }
    await page.getByRole('link', { name: /Venue Profile/ }).click()
    const nameInput = page.getByLabel('Venue name')
    await nameInput.fill(`${venue.name} Renamed`)
    await page.getByLabel('Address', { exact: true }).fill('456 E2E Court Street')
    await page.getByRole('button', { name: 'Save location' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
    await expect(nameInput).toHaveValue(`${venue.name} Renamed`)
    await page.getByRole('link', { name: /Back to Settings/ }).click()
    const warning = page.getByRole('dialog', { name: 'Unsaved changes' })
    await expect(warning).toBeVisible()
    await warning.getByRole('button', { name: 'Stay', exact: true }).click()
    await expect(nameInput).toHaveValue(`${venue.name} Renamed`)
    const profileForm = page.getByRole('textbox', { name: 'Venue name' }).locator('xpath=ancestor::form')
    await profileForm.getByRole('button', { name: /^Save / }).click()
    await expect(profileForm.getByRole('status')).toHaveText('Saved')
    await page.getByRole('link', { name: /Back to Settings/ }).click()
    await page.getByRole('link', { name: /Booking Rules/ }).click()
    const hold = page.getByLabel('Payment hold (minutes)')
    await hold.fill('90')
    await page.getByRole('button', { name: /^Save / }).click()
    await expect(page.getByRole('status')).toHaveText('Saved')
    await page.reload()
    await expect(hold).toHaveValue('90')
    await page.getByRole('link', { name: /Back to Settings/ }).click()
    await page.getByRole('link', { name: /Payment Setup/ }).click()
    await expect(page.getByRole('heading', { name: 'Payment accounts' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Online payments' })).toBeVisible()
    const instructions = page.getByRole('textbox', { name: /instructions|Shown to players/i })
    await instructions.fill('E2E payment instructions draft')
    await page.getByRole('link', { name: /Back to Settings/ }).click()
    await page.getByRole('dialog', { name: 'Unsaved changes' }).getByRole('button', { name: 'Leave', exact: true }).click()
    await page.getByRole('link', { name: /Website Appearance/ }).click()
    await page.getByRole('button', { name: 'Plum', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Plum', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('link', { name: /Back to Settings/ }).click()
    await page.getByRole('link', { name: /Policies & Waivers/ }).click()
    await expect(page.getByRole('textbox', { name: 'Waiver', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Back to Settings/ })).toBeVisible()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    expect(results.violations.filter((row) => row.impact === 'serious' || row.impact === 'critical')).toEqual([])
    expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
    const { data, error } = await serviceClient().from('venue_settings').select('name,address,payment_hold_minutes,payment_instructions,theme').eq('venue_id', venue.id).single()
    if (error) throw error
    expect(data).toMatchObject({ name: `${venue.name} Renamed`, address: '456 E2E Court Street', payment_hold_minutes: 90, payment_instructions: '', theme: 'plum' })
  } finally {
    await deleteVenue(venue.id)
  }
})
