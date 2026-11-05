// T17.19: scalable console lists. 30 E2E-tagged leads (more than one page of 25) on the routed Leads page, at desktop
// and 360px: paging without dropped or duplicated rows, filters, URL state and back navigation, a detail panel,
// notes that survive paging, no horizontal overflow and axe in both themes. Teardown also removes E2E-tagged leads.
import { expect, test, type Page } from '@playwright/test'
import { E2E_PREFIX, axeBothSchemes, createPlatformAdmin, serviceClient } from './support/helpers.ts'

const CONSOLE = 'http://app.localhost:5179/'
const COUNT = 30

async function signIn(page: Page, path: string) {
  const admin = await createPlatformAdmin()
  await page.goto(CONSOLE + path)
  await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

const overflow = (page: Page) => page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')

/** Seeds COUNT leads "E2E Page <tag> 01".."30", 01 newest, every fifth already "talking". */
async function seedLeads(tag: string) {
  const service = serviceClient()
  const now = Date.now()
  const rows = Array.from({ length: COUNT }, (_, i) => ({
    first_name: 'Pat', last_name: `Person${i + 1}`, email: `e2e-page-${tag}-${i + 1}@example.com`, phone: '09171234567',
    venue_name: `${E2E_PREFIX} Page ${tag} ${String(i + 1).padStart(2, '0')}`, location: 'Makati', courts: 2,
    status: (i + 1) % 5 === 0 ? 'talking' : 'new', consented_at: new Date(now).toISOString(),
    created_at: new Date(now - i * 60_000).toISOString(),
  }))
  await service.from('leads').insert(rows).throwOnError()
  return service
}

test('30 leads page as 25 + 5 with no dropped or duplicated row, and the view lives in the URL', async ({ page }) => {
  const tag = Date.now().toString(36)
  const service = await seedLeads(tag)
  const rowsOf = () => page.getByRole('main').getByRole('listitem').filter({ hasText: `${E2E_PREFIX} Page ${tag}` })
  const nameOf = async (i: number) => (await rowsOf().nth(i).innerText()).match(new RegExp(`${E2E_PREFIX} Page ${tag} \\d\\d`))![0]
  try {
    await signIn(page, `leads?q=${encodeURIComponent(`${E2E_PREFIX} Page ${tag}`)}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible()
    await expect(rowsOf()).toHaveCount(25)
    await expect(page.getByText(/Page 1 of 2/)).toBeVisible()
    await expect(page.getByText(/Showing 1\s*[–-]\s*25 of 30/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    const first: string[] = []
    for (let i = 0; i < 25; i++) first.push(await nameOf(i))

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(rowsOf()).toHaveCount(5)
    await expect(page.getByText(/Showing 26\s*[–-]\s*30 of 30/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Next' })).toBeDisabled()
    const second: string[] = []
    for (let i = 0; i < 5; i++) second.push(await nameOf(i))
    const all = [...first, ...second]
    expect(new Set(all).size).toBe(COUNT)
    expect(all).toEqual(Array.from({ length: COUNT }, (_, i) => `${E2E_PREFIX} Page ${tag} ${String(i + 1).padStart(2, '0')}`))

    // Reload shows the same page; browser back returns to page 1.
    await page.reload()
    await expect(rowsOf()).toHaveCount(5)
    await page.goBack()
    await expect(rowsOf()).toHaveCount(25)
    await expect(page.getByText(/Page 1 of 2/)).toBeVisible()
    await page.goForward()
    await expect(rowsOf()).toHaveCount(5)
  } finally {
    await service.from('leads').delete().like('venue_name', `${E2E_PREFIX} Page ${tag}%`)
    expect((await service.from('leads').select('id').like('venue_name', `${E2E_PREFIX} Page ${tag}%`).throwOnError()).data).toEqual([])
  }
})

test('a status filter narrows the list and returns to page 1; search narrows by name', async ({ page }) => {
  const tag = Date.now().toString(36)
  const service = await seedLeads(tag)
  const rowsOf = () => page.getByRole('main').getByRole('listitem').filter({ hasText: `${E2E_PREFIX} Page ${tag}` })
  try {
    await signIn(page, `leads?q=${encodeURIComponent(`${E2E_PREFIX} Page ${tag}`)}&page=2`)
    await expect(rowsOf()).toHaveCount(5)
    await page.getByLabel('Filter by status').selectOption('talking')
    await expect(rowsOf()).toHaveCount(6)
    await expect(page).not.toHaveURL(/page=2/)
    await expect(page).toHaveURL(/status=talking/)
    await page.getByLabel('Filter by status').selectOption('won')
    await expect(page.getByText('No leads with this status.')).toBeVisible()
    await page.getByLabel('Filter by status').selectOption('all')
    await page.getByLabel(/search/i).fill(`${E2E_PREFIX} Page ${tag} 07`)
    await expect(rowsOf()).toHaveCount(1)
    await expect(page).toHaveURL(/q=/)
  } finally {
    await service.from('leads').delete().like('venue_name', `${E2E_PREFIX} Page ${tag}%`)
    expect((await service.from('leads').select('id').like('venue_name', `${E2E_PREFIX} Page ${tag}%`).throwOnError()).data).toEqual([])
  }
})

test('a lead opens in a detail panel, its notes draft survives paging and saves', async ({ page }) => {
  const tag = Date.now().toString(36)
  const service = await seedLeads(tag)
  const name = `${E2E_PREFIX} Page ${tag} 01`
  const rowsOf = () => page.getByRole('main').getByRole('listitem').filter({ hasText: `${E2E_PREFIX} Page ${tag}` })
  const panel = () => page.getByRole('dialog', { name: new RegExp(name) }).or(page.getByRole('region', { name: new RegExp(name) }))
  try {
    await signIn(page, `leads?q=${encodeURIComponent(`${E2E_PREFIX} Page ${tag}`)}`)
    await expect(rowsOf()).toHaveCount(25)
    // Compact rows: no editors until a record is opened.
    await expect(page.getByLabel('Notes')).toHaveCount(0)
    await rowsOf().filter({ hasText: name }).getByRole('button', { name: /details/i }).click()
    await expect(page).toHaveURL(/open=/)
    await expect(panel().getByLabel('Notes')).toBeVisible()
    await panel().getByLabel('Notes').fill('E2E draft note')
    await panel().getByRole('button', { name: /close/i }).click()
    await expect(page.getByLabel('Notes')).toHaveCount(0)
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(rowsOf()).toHaveCount(5)
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(rowsOf()).toHaveCount(25)
    await rowsOf().filter({ hasText: name }).getByRole('button', { name: /details/i }).click()
    await expect(panel().getByLabel('Notes')).toHaveValue('E2E draft note')
    expect(await overflow(page)).toBeLessThanOrEqual(0)

    await panel().getByRole('button', { name: 'Save notes' }).click()
    await expect.poll(async () => (await service.from('leads').select('notes').eq('venue_name', name).single()).data?.notes).toBe('E2E draft note')
    await panel().getByLabel('Status').selectOption('talking')
    await expect.poll(async () => (await service.from('leads').select('status').eq('venue_name', name).single()).data?.status).toBe('talking')
    expect(await axeBothSchemes(page)).toEqual([])
  } finally {
    await service.from('leads').delete().like('venue_name', `${E2E_PREFIX} Page ${tag}%`)
    expect((await service.from('leads').select('id').like('venue_name', `${E2E_PREFIX} Page ${tag}%`).throwOnError()).data).toEqual([])
  }
})

test('every console section is accessible in both themes without horizontal overflow', async ({ page }) => {
  const tag = Date.now().toString(36)
  const service = await seedLeads(tag)
  try {
    await signIn(page, `leads?q=${encodeURIComponent(`${E2E_PREFIX} Page ${tag}`)}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible()
    for (const path of ['leads', 'venues', 'invoices', 'reviews']) {
      await page.goto(`${CONSOLE}${path}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText(/loading/i)).toHaveCount(0)
      expect(await overflow(page), `${path} horizontal overflow`).toBeLessThanOrEqual(0)
      expect(await axeBothSchemes(page), `${path} axe`).toEqual([])
    }
  } finally {
    await service.from('leads').delete().like('venue_name', `${E2E_PREFIX} Page ${tag}%`)
  }
})
