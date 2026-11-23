import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createAdmin, logInAdmin } from './support/helpers.ts'

test('the Dashboard downloads the complete PDF available at the public guide and attachment URLs', async ({ page, request }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password)

  const link = page.getByRole('link', { name: 'Download owner manual (PDF)', exact: true })
  const stableUrl = '/guides/venue-owner-manual.pdf'
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', stableUrl)
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()])
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
  const downloaded = await readFile((await download.path())!)
  expect(downloaded.subarray(0, 5).toString('ascii')).toBe('%PDF-')
  expect(downloaded.subarray(-32).toString('ascii').trimEnd()).toMatch(/%%EOF$/)

  // The email download link must also work before an invited owner signs in.
  // The current edition (1.2, T31.3) is the stable file byte for byte.
  for (const url of [stableUrl, '/guides/venue-owner-manual-v1.2.pdf']) {
    const response = await request.get(url)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toMatch(/^application\/pdf\b/i)
    expect(downloaded.equals(await response.body())).toBe(true)
  }
  // Released editions stay available (docs/owner-manual/README.md): emails already sent link to v1.0 and v1.1.
  for (const file of ['v1.0', 'v1.1']) {
    const older = await request.get(`/guides/venue-owner-manual-${file}.pdf`)
    expect(older.status()).toBe(200)
    expect(older.headers()['content-type']).toMatch(/^application\/pdf\b/i)
    expect((await older.body()).subarray(0, 5).toString('ascii')).toBe('%PDF-')
  }
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
