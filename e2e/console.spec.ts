// The platform console lives on app.<domain> and is for platform admins only (SPEC §10 2026-10-31, T13.9).
// T17.19: it is routed (/leads, /venues, /invoices, /reviews) with a sidebar, or a Menu drawer on a phone.
import { expect, test, type Page } from '@playwright/test'
import { createPlatformAdmin, createPlayer } from './support/helpers.ts'

const CONSOLE = 'http://app.localhost:5179/'

async function signIn(page: Page, email: string, password: string, path = '') {
  await page.goto(CONSOLE + path)
  await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** The navigation to use: the open drawer on a phone, the page itself on a desktop. */
async function navigation(page: Page) {
  const menu = page.getByRole('button', { name: 'Menu' })
  if (await menu.isVisible()) {
    await menu.click()
    return page.getByRole('dialog')
  }
  return page
}

test('a platform admin signs in to the Platform console and lands on Leads', async ({ page }) => {
  const admin = await createPlatformAdmin()
  await signIn(page, admin.email, admin.password)
  await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible()
  await expect(page).toHaveURL(/\/leads$/)
  const scope = await navigation(page)
  await expect(scope.getByText(`Signed in as ${admin.email}`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Platform admins only' })).toHaveCount(0)
})

test('the sidebar or drawer reaches every section, marks the current one and keeps focus sensible', async ({ page }) => {
  const admin = await createPlatformAdmin()
  await signIn(page, admin.email, admin.password)
  await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible()
  for (const [name, path] of [['Venues', 'venues'], ['Invoices', 'invoices'], ['Reviews', 'reviews'], ['Leads', 'leads']] as const) {
    const scope = await navigation(page)
    const link = scope.getByRole('navigation', { name: 'Console' }).getByRole('link', { name, exact: true })
    await link.click()
    await expect(page).toHaveURL(new RegExp(`/${path}$`))
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const current = (await navigation(page)).getByRole('navigation', { name: 'Console' }).getByRole('link', { name, exact: true })
    await expect(current).toHaveAttribute('aria-current', 'page')
    if (await page.getByRole('button', { name: 'Menu' }).isVisible()) await page.keyboard.press('Escape')
  }
  // Escape closes the drawer and returns focus to Menu.
  const menu = page.getByRole('button', { name: 'Menu' })
  if (await menu.isVisible()) {
    await menu.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(menu).toBeFocused()
  }
})

test('direct URLs open their own section, "/" and unknown paths go to Leads, and a reload keeps the section', async ({ page }) => {
  const admin = await createPlatformAdmin()
  await signIn(page, admin.email, admin.password, 'invoices')
  await expect(page.getByRole('heading', { level: 1, name: 'Invoices' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Invoices' })).toBeVisible()
  await page.goto(`${CONSOLE}reviews`)
  await expect(page.getByRole('heading', { level: 1, name: 'Reviews' })).toBeVisible()
  await page.goto(CONSOLE)
  await expect(page).toHaveURL(/\/leads$/)
  await page.goto(`${CONSOLE}no/such/page`)
  await expect(page).toHaveURL(/\/leads$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible()
})

test('a plain player is told "Platform admins only"', async ({ page }) => {
  const player = await createPlayer()
  await signIn(page, player.email, player.password)
  await expect(page.getByRole('heading', { name: 'Platform admins only' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Console' })).toHaveCount(0)
})
