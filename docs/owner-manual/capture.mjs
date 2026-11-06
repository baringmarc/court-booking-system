// Capture only a fresh throwaway venue. Never use the repo's hosted .env for photography.
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, chromium } from '@playwright/test'
import { createServer } from 'vite'
import { localSupabase } from '../../e2e/support/local.ts'
import { serviceClient, createPlayer, createVenue, deleteVenue, addVenueStaff, venueDate } from '../../e2e/support/helpers.ts'

const local = localSupabase()
process.env.VITE_SUPABASE_URL = local.url
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = local.publishableKey
const dir = fileURLToPath(new URL('./screens/', import.meta.url))
await mkdir(dir, { recursive: true })
const service = serviceClient()
const port = 5198
const server = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' })
await server.listen()
let browser, venue, user, proofPath
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 600, height: 860 }, deviceScaleFactor: 2, colorScheme: 'light', timezoneId: 'Asia/Manila' })
  page.setDefaultTimeout(12000)
  venue = await createVenue('manual')
  user = await createPlayer('manual')
  await addVenueStaff(venue.id, user.id)
  await service.from('venues').update({ status: 'draft' }).eq('id', venue.id).throwOnError()
  await service.from('venue_settings').update({ name: 'Garden Courts' }).eq('venue_id', venue.id).throwOnError()
  await service.from('courts').delete().eq('venue_id', venue.id).throwOnError()
  // Exercise the release-target scheduler only in the isolated fixture.
  await service.from('venue_schedule_state').update({ schedule_v2_active: true }).eq('venue_id', venue.id).select().single().throwOnError()

  const visit = (path) => page.goto(`http://${venue.slug}.localhost:${port}/admin${path}`)
  const region = (name) => page.getByRole('region', { name, exact: true })
  const button = (name) => page.getByRole('button', { name, exact: true })
  async function shot(name, element) {
    await element.waitFor()
    await page.evaluate(() => document.fonts.ready)
    await element.screenshot({ path: dir + name + '.png', animations: 'disabled' })
    console.log('Captured', name)
  }
  await visit('')
  await shot('sign-in', page.locator('form').filter({ has: button('Sign in') }))
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password').fill(user.password)
  await button('Sign in').click()
  await expect(region('Set up your venue')).toContainText('Publish venue')
  await visit('/courts/new')
  await page.getByLabel('Name', { exact: true }).fill('Garden Court 1')
  await page.getByLabel('Sport').selectOption('pickleball')
  await page.getByLabel('Default hourly rate').fill('400')
  await shot('court', page.locator('form').filter({ has: button('Create court') }))
  await button('Create court').click()
  await expect(page.getByRole('heading', { name: 'Garden Court 1' })).toBeVisible()
  await visit('')
  await expect(region('Set up your venue')).toContainText('3 of 5 done')
  await shot('checklist', region('Set up your venue'))
  await visit('/schedule')
  const monday = page.locator('fieldset.hours-day-row').first()
  await monday.getByRole('button', { name: /Add a break/ }).click()
  await shot('hours', monday)
  await page.getByRole('tab', { name: 'Prices' }).click()
  await page.getByLabel('Override price').fill('450')
  await button('Apply rate').click()
  await shot('prices', page.getByRole('region', { name: /override rates/ }))
  await button('Review & save').click()
  await expect(page.getByText('No existing reservations are affected')).toBeVisible()
  await shot('review', page.getByRole('dialog', { name: 'Review changes' }))
  await button('Save changes').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(region('Unsaved changes')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Closures' }).click()
  await button('Tomorrow').click()
  await button('Maintenance').click()
  await expect(page.getByLabel('Closure summary')).toContainText('No bookings or open play')
  await shot('closure', page.getByLabel('Closure summary'))
  await visit('/settings/payments')
  const account = page.getByRole('form', { name: 'New payment account' })
  await account.getByLabel(/^Label/).fill('Demo transfer')
  await account.getByLabel('Account name').fill('Garden Courts')
  await account.getByLabel('Account or mobile number').fill('0000000000')
  await shot('payment', account.locator('.form-grid'))
  await account.getByRole('button', { name: 'Add account' }).click()
  await expect(page.getByRole('button', { name: 'Edit Demo transfer' })).toBeVisible()
  await button('Use example').click()
  await button('Save instructions').click()
  await expect(page.getByRole('form', { name: 'Payment instructions' })).toContainText('Saved')
  await visit('')
  await expect(region('Set up your venue')).toContainText('5 of 5 done')
  await button('Publish venue').click()
  await expect(region('Set up your venue')).toHaveCount(0)
  await expect.poll(async () => (await service.from('venues').select('status').eq('id', venue.id).single().throwOnError()).data.status).toBe('active')

  const { data: court } = await service.from('courts').select('id').eq('venue_id', venue.id).single().throwOnError()
  const day = venueDate(3)
  const { data: booking } = await service.from('bookings').insert({
    venue_id: venue.id, court_id: court.id, guest_name: 'Demo Player', status: 'payment_submitted',
    reference_code: 'CB-GARDEN', during: `[${day}T14:00+08:00,${day}T15:00+08:00)`, total_amount: 400, booking_fee: 10,
  }).select('id').single().throwOnError()
  const receipt = await browser.newPage({ viewport: { width: 380, height: 115 } })
  await receipt.setContent('<body style="font:16px sans-serif;color:#3b2f2a;padding:8px"><b>Demo transfer</b><p>Garden Courts · PHP 400.00</p>Sample reference GC-2468</body>')
  proofPath = booking.id + '/demo.png'
  const upload = await service.storage.from('payment-proofs').upload(proofPath, await receipt.screenshot(), { contentType: 'image/png' })
  if (upload.error) throw upload.error
  await receipt.close()
  await service.from('payments').insert({ venue_id: venue.id, booking_id: booking.id, method: 'bank_transfer',
    amount: 400, reference_number: 'GC-2468', storage_path: proofPath }).throwOnError()
  await visit('/bookings')
  await page.getByRole('button', { name: /CB-GARDEN/ }).click()
  await expect(page.getByAltText('Proof of payment')).toBeVisible()
  await shot('proof', page.getByRole('heading', { name: 'Proof waiting for review' }).locator('..'))
  await button('Approve and confirm').click()
  await expect(page.getByRole('status').filter({ hasText: /confirmed/i })).toBeVisible()
  await visit('')
  await expect(page.getByRole('list', { name: 'Revenue split' })).toContainText('₱400')
  await shot('earnings', page.getByRole('list', { name: 'Revenue split' }))
  // Give the statement a current-month example even when the local DB clock differs from the browser's.
  const { data: charges } = await service.from('billing_charges').select('id').eq('booking_id', booking.id).throwOnError()
  if (!charges.length) {
    await service.from('billing_charges').insert({ venue_id: venue.id, booking_id: booking.id,
      billing_month: venueDate(0).slice(0, 7) + '-01', kind: 'booking_fee', amount: 10 }).throwOnError()
  }
  await visit('/reports')
  await expect(region('This month’s fees so far')).toContainText('booking fee')
  await shot('statement', region('This month’s fees so far'))
  await visit('/open-play')
  await page.getByLabel(/Garden Court 1/).check()
  await page.getByLabel('Title').fill('Saturday social')
  await shot('open-play', page.getByRole('form', { name: 'Open play session' }).locator('fieldset').first())
} finally {
  try {
    if (proofPath) {
      const { error } = await service.storage.from('payment-proofs').remove([proofPath])
      if (error) throw error
    }
    if (venue) {
      for (const table of ['bookings', 'venue_payment_accounts']) {
        await service.from(table).delete().eq('venue_id', venue.id).throwOnError()
      }
      await deleteVenue(venue.id)
      await expect((await service.from('venues').select('id').eq('id', venue.id).throwOnError()).data).toEqual([])
    }
  } finally {
    try {
      if (user) {
        const { error } = await service.auth.admin.deleteUser(user.id)
        if (error) throw error
      }
    } finally {
      await browser?.close()
      await server.close()
    }
  }
}
