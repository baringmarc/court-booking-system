// T17.30: the marketing site's "Venues already booking online" section follows the console's showcase approval.
// The site (../plotline-site) runs as a second web server on :5180 against the local stack; it reads the public_venues
// feed in the browser, so a reload is enough (no rebuild). The test deletes its own e2e-* venue in a finally (other specs read venue_settings with .single(), so it must not outlive the test).
import { expect, test } from '@playwright/test'
import { axeBothSchemes, createPlatformAdmin, createVenue, deleteVenue } from './support/helpers.ts'

const SITE = 'http://127.0.0.1:5180/'
const CONSOLE = 'http://app.localhost:5179/'

test('approving a venue in the console puts it on the marketing site, and removing it takes it off', async ({ page }) => {
  const venue = await createVenue('showcase')
  try {
    const venues = page.locator('#venues')

    await page.goto(SITE)
    await expect(venues).toBeVisible()
    await expect(venues.getByText(venue.name)).toHaveCount(0)

    const admin = await createPlatformAdmin()
    await page.goto(`${CONSOLE}venues?q=${venue.slug}&open=${venue.id}`)
    await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    const panel = page.getByRole('dialog', { name: new RegExp(venue.name) }).or(page.getByRole('region', { name: new RegExp(venue.name) }))
    await panel.getByRole('button', { name: 'Approve showcase' }).click()
    await expect(panel.getByText('Showcase: Approved', { exact: true })).toBeVisible()
    expect(await axeBothSchemes(page)).toEqual([])

    await page.goto(SITE)
    await expect(venues.getByRole('heading', { name: 'Venues already booking online' })).toBeVisible()
    const card = venues.locator('.vcard').filter({ hasText: venue.name })
    await expect(card).toBeVisible()
    await expect(card.getByRole('link', { name: 'Book a court' })).toHaveAttribute('href', `https://${venue.slug}.plotline.fit`)

    await page.goto(`${CONSOLE}venues?q=${venue.slug}&open=${venue.id}`)
    await panel.getByRole('button', { name: 'Remove from showcase' }).click()
    await expect(panel.getByText('Showcase: Not approved', { exact: true })).toBeVisible()

    await page.goto(SITE)
    await expect(venues.getByText(venue.name)).toHaveCount(0)
    await expect(venues.getByRole('link', { name: 'Open the demo' })).toBeVisible()
  } finally {
    await deleteVenue(venue.id)
  }
})
