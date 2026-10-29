// Payment accounts and QR codes (T11.11): an admin adds an account with a QR code in /admin/settings, and a guest
// sees it, scannable and downloadable, while paying. The account and its file are removed after the test.
import { expect, test } from '@playwright/test'
import { axeBothSchemes, createAdmin, E2E_PREFIX, logInAdmin, pickFirstFreeSlot, receiptPng, serviceClient, venueDate } from './support/helpers.ts'

const LABEL = `${E2E_PREFIX} GCash`

async function removeTaggedAccounts() {
  const service = serviceClient()
  const { data } = await service.from('venue_payment_accounts').select('id, qr_path').like('label', `${E2E_PREFIX}%`).throwOnError()
  const paths = (data ?? []).flatMap((a) => (a.qr_path ? [a.qr_path] : []))
  if (paths.length) await service.storage.from('payment-qr').remove(paths)
  await service.from('venue_payment_accounts').delete().like('label', `${E2E_PREFIX}%`).throwOnError()
}

test.afterEach(removeTaggedAccounts)

test('an admin adds a payment account with a QR code, and a guest sees it while paying', async ({ page, browser }) => {
  const { count } = await serviceClient().from('venue_payment_accounts').select('id', { count: 'exact', head: true })
  test.skip((count ?? 0) >= 10, 'the local venue already lists 10 payment accounts')

  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/settings')
  const form = page.getByRole('form', { name: 'New payment account' })
  await form.getByLabel(/^Label/).fill(LABEL)
  await form.getByLabel('Account name').fill('Claudex Courts')
  await form.getByLabel('Account or mobile number').fill('0917 000 1111')
  await form.getByLabel(/^QR code/).setInputFiles(receiptPng())
  await expect(form.getByRole('img', { name: `QR code for ${LABEL}` })).toBeVisible()
  await form.getByRole('button', { name: 'Add account' }).click()
  const list = page.getByRole('list', { name: 'Payment accounts in order' })
  await expect(list.getByText(LABEL, { exact: true })).toBeVisible()

  // Stored as a fresh <uuid>.png in the payment-qr bucket (re-encoded in the browser).
  const { data: row } = await serviceClient().from('venue_payment_accounts').select('qr_path').eq('label', LABEL).single().throwOnError()
  expect(row!.qr_path).toMatch(/^[0-9a-f-]{36}\.png$/)

  // A guest books (signed out, same device size) and pays.
  const guest = await browser.newContext({ ...test.info().project.use })
  const pay = await guest.newPage()
  await pickFirstFreeSlot(pay, { date: venueDate(9), sport: 'pickleball', court: 'Pickleball 2' })
  await pay.getByLabel('Name').fill(`${E2E_PREFIX} QR Guest`)
  await pay.getByLabel('Email').fill(`e2e-qr-${Date.now()}@example.com`)
  await pay.getByLabel('Mobile number (optional)').fill('0917 000 2222')
  await pay.getByRole('button', { name: 'Confirm booking' }).click()
  const section = pay.getByRole('region', { name: /Pay within/ })
  const account = section.getByRole('article', { name: LABEL })
  await expect(account.getByText('0917 000 1111')).toBeVisible()
  const qr = account.getByRole('img', { name: `QR code for ${LABEL}` })
  await expect(qr).toBeVisible()
  // Lazy: wait until it has actually loaded and decoded (a broken file never gets a natural width).
  await expect.poll(() => qr.evaluate((img: { complete: boolean; naturalWidth: number }) => img.complete && img.naturalWidth > 0)).toBe(true)
  const download = account.getByRole('link', { name: 'Download QR' })
  await expect(download).toHaveAttribute('href', /\/storage\/v1\/object\/public\/payment-qr\/[0-9a-f-]{36}\.png\?download=/)
  const response = await guest.request.get((await download.getAttribute('href'))!)
  expect(response.status()).toBe(200)
  expect(response.headers()['content-disposition']).toMatch(/attachment/)

  // The QR fits a 360px phone: nothing scrolls sideways.
  expect(await pay.evaluate<boolean>('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
  const box = await qr.boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual((pay.viewportSize()?.width ?? 1280))

  await account.getByRole('button', { name: `Show the ${LABEL} QR code full size` }).click()
  await expect(pay.getByRole('dialog', { name: `${LABEL} QR code` })).toBeVisible()
  await pay.keyboard.press('Escape')
  expect(await axeBothSchemes(pay, '.payment-accounts')).toEqual([])
  await guest.close()

  expect(await axeBothSchemes(page, '[aria-labelledby="payment-accounts-heading"]')).toEqual([])
})
