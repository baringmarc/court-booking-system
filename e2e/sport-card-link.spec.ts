// T22.1: a sport card on the home page links to /book with that sport's tab open (desktop and 360px).
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'

test('the Pickleball card opens /book on the Pickleball tab, and the home page is accessible', async ({ page }) => {
  await page.goto('/')
  const links = page.getByRole('link', { name: /^Book .+ courts$/ })
  await expect(links.first()).toBeVisible()
  // The first card is not Pickleball (Badminton leads), so this checks the sport is carried over.
  await expect(page.getByRole('link', { name: 'Book pickleball courts' })).toHaveAttribute('href', '/book?sport=pickleball')

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
  expect(bad, 'home').toEqual([])

  await page.getByRole('link', { name: 'Book pickleball courts' }).click()
  await expect(page).toHaveURL(/\/book\?.*sport=pickleball/)
  await expect(page.getByRole('group', { name: 'Sport' }).getByRole('button', { name: 'Pickleball' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('columnheader', { name: /^Pickleball/ })).toHaveText(['Pickleball 1', 'Pickleball 2'])
})

// H14: keep last.
guardLeaks()
