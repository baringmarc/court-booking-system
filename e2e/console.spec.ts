// The platform console lives on app.<domain> and is for platform admins only (SPEC §10 2026-10-31, T13.9).
import { expect, test } from '@playwright/test'
import { createPlatformAdmin, createPlayer } from './support/helpers.ts'

const CONSOLE = 'http://app.localhost:5179/'

async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto(CONSOLE)
  await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

test('a platform admin signs in to the Platform console', async ({ page }) => {
  const admin = await createPlatformAdmin()
  await signIn(page, admin.email, admin.password)
  await expect(page.getByText(`Signed in as ${admin.email}`)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Platform admins only' })).toHaveCount(0)
})

test('a plain player is told "Platform admins only"', async ({ page }) => {
  const player = await createPlayer()
  await signIn(page, player.email, player.password)
  await expect(page.getByRole('heading', { name: 'Platform admins only' })).toBeVisible()
})
