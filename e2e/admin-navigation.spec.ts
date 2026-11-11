import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createAdmin, logInAdmin } from './support/helpers.ts'

test('T17.3 seven destinations, collapse, mobile focus and Reports compatibility', async ({ page }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password)
  const trigger = page.getByRole('button', { name: 'Open navigation' })
  const mobile = await trigger.isVisible()
  if (mobile) {
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // Tab and Shift+Tab stay in the drawer, even at its boundaries.
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((node) => {
        const element = node as unknown as { contains(other: unknown): boolean; ownerDocument: { activeElement: unknown } }
        return element.contains(element.ownerDocument.activeElement)
      })).toBe(true)
    }
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Shift+Tab')
      expect(await dialog.evaluate((node) => {
        const element = node as unknown as { contains(other: unknown): boolean; ownerDocument: { activeElement: unknown } }
        return element.contains(element.ownerDocument.activeElement)
      })).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.click()
  } else {
    await page.getByRole('button', { name: 'Collapse sidebar' }).click()
    await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Reports', exact: true })).toHaveAttribute('title', 'Reports')
    await page.getByRole('button', { name: 'Expand sidebar' }).click()
  }
  const nav = page.getByRole('navigation', { name: 'Admin', exact: true })
  await expect(nav.getByRole('link')).toHaveCount(7)
  for (const label of ['Dashboard', 'Bookings', 'Schedule', 'Open Play', 'Courts', 'Reports', 'Settings']) {
    await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
  }
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  await nav.getByRole('link', { name: 'Reports', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/reports$/)
  await expect(page.getByRole('heading', { name: 'Statement', exact: true })).toBeVisible()
  if (mobile) await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('main')).toBeFocused()
  await page.goto('/admin/statement')
  await expect(page.getByRole('heading', { name: 'Statement', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Skip to main content' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('main')).toBeFocused()
  expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')).toBeLessThanOrEqual(0)
  await page.getByRole('button', { name: 'Account', exact: true }).click()
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('heading', { name: 'Admin log in' })).toBeVisible()
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
