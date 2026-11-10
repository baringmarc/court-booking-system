// Venue color presets (T11.7): the admin's pick reaches a signed-out player, and every preset is axe clean.
// The theme is venue-wide, so each test puts the saved one back.
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { axeBothSchemes, createAdmin, logInAdmin, serviceClient, setColorScheme, venueId } from './support/helpers.ts'

const PRESETS = ['plotline', 'court-green', 'ocean', 'plum', 'sunset', 'slate', 'midnight'] as const
let saved = 'plotline'

async function setTheme(theme: string) {
  const { error } = await serviceClient().from('venue_settings').update({ theme }).eq('venue_id', await venueId())
  if (error) throw error
}

test.beforeEach(async () => {
  const { data, error } = await serviceClient().from('venue_settings').select('theme').single()
  if (error) throw error
  saved = data.theme
})
test.afterEach(async () => setTheme(saved))

test("an admin's preset shows for a signed-out player", async ({ page, browser }) => {
  await setTheme('plotline')
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings/appearance')
  const picker = page.getByRole('group', { name: 'Website colors' })
  await expect(picker.getByRole('button', { name: 'Plotline' })).toHaveAttribute('aria-pressed', 'true')

  await picker.getByRole('button', { name: 'Ocean' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean')
  expect(await axeBothSchemes(page, '.theme-grid')).toEqual([])

  // A fresh context has nothing cached: the preset comes from venue_settings.
  const player = await browser.newContext({ colorScheme: 'light' })
  const home = await player.newPage()
  await home.goto('/')
  await expect(home.locator('html')).toHaveAttribute('data-theme', 'ocean')
  const accent = await home.evaluate<string>("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
  expect(accent.toLowerCase()).toBe('#1b6a9c')

  // The next load applies the cached preset before the app runs (no flash of the default).
  await setTheme('plum')
  await home.route('**/rest/v1/venue_settings*', (route) => new Promise(() => void route)) // settings never arrive
  await home.addInitScript(() => {
    const w = globalThis as unknown as { __themeAtParse?: string; document: { addEventListener(e: string, f: () => void): void; documentElement: { dataset: Record<string, string> } } }
    w.document.addEventListener('DOMContentLoaded', () => { w.__themeAtParse = w.document.documentElement.dataset.theme ?? 'none' })
  })
  await home.reload()
  // Read once the HTML is parsed, before the deferred app module has run: only the inline script can have set it.
  await expect.poll(() => home.evaluate<string | undefined>('globalThis.__themeAtParse')).toBe('ocean')
  await expect(home.locator('html')).toHaveAttribute('data-theme', 'ocean')
  await player.close()
})

test('an admin picks Slate, then Midnight, which is dark in both color schemes', async ({ page }) => {
  await setTheme('plotline')
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings/appearance')
  const picker = page.getByRole('group', { name: 'Website colors' })

  await picker.getByRole('button', { name: 'Slate' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'slate')
  expect(await axeBothSchemes(page, '.theme-grid')).toEqual([])

  await picker.getByRole('button', { name: 'Midnight' }).click()
  await expect(picker.getByRole('button', { name: 'Midnight' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight')
  for (const scheme of ['light', 'dark'] as const) {
    await setColorScheme(page, scheme)
    const bg = await page.evaluate<string>('getComputedStyle(document.body).backgroundColor')
    expect(bg, scheme).toBe('rgb(20, 21, 31)')
  }
  expect(await axeBothSchemes(page, '.theme-grid')).toEqual([])
})

test("the picker's cards fit the screen without sideways scrolling", async ({ page }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings/appearance')
  const grid = page.getByRole('group', { name: 'Website colors' })
  await expect(grid.getByRole('button', { name: 'Midnight' })).toBeVisible()
  const sizes = await page.evaluate<{ scroll: number; client: number }>(
    "(() => { const g = document.querySelector('.theme-grid'); return { scroll: g.scrollWidth, client: g.clientWidth } })()",
  )
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client)
  const page_ = await page.evaluate<{ scroll: number; client: number }>(
    '({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })',
  )
  expect(page_.scroll).toBeLessThanOrEqual(page_.client)
})

test('the home page is axe clean with every preset, light and dark', async ({ page }) => {
  for (const preset of PRESETS) {
    await setTheme(preset)
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    const html = page.locator('html')
    if (preset === 'plotline') await expect(html).not.toHaveAttribute('data-theme', /.+/)
    else await expect(html).toHaveAttribute('data-theme', preset)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await axeBothSchemes(page), preset).toEqual([])
  }
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
