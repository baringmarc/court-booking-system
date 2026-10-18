// The admin area is its own shell with its own login (SPEC §7); the public site has no way in.
import { expect, test } from '@playwright/test'
import { createAdmin, createPlayer, logInAdmin, submitAdminLogin } from './support/helpers.ts'

test('an admin deep link goes through /admin/login and back; logging out returns to the login', async ({ page }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/schedule')

  // The admin shell replaces the public header.
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'View site' })).toBeVisible()

  // Signed in as an admin, the public header still doesn't advertise the admin area.
  await page.getByRole('link', { name: 'View site' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0)

  await page.goto('/admin')
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/admin\/login$/)
  await expect(page.getByRole('heading', { name: 'Admin log in' })).toBeVisible()
  await expect(page.getByRole('button', { name: /google/i })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /sign up/i })).toHaveCount(0)
})

test('a player who signs in at /admin/login is refused', async ({ page }) => {
  const player = await createPlayer()
  await page.goto('/admin/bookings')
  await submitAdminLogin(page, player.email, player.password)

  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Admin' })).toHaveCount(0)
  await page.goto('/admin/bookings')
  await expect(page.getByRole('heading', { name: 'Admins only' })).toBeVisible()
})
