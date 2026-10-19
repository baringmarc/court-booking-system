// A guest pays online with PayMongo: the booking page sends them to the (stubbed) hosted checkout, PayMongo's
// signed webhook confirms the booking, and the guest's private link survives the round trip. Locally,
// create-paymongo-checkout runs with PAYMONGO_MODE=stub and webhooks are signed with the local-only secret.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, pickFirstFreeSlot, serviceClient, venueDate } from './support/helpers.ts'
import { localSupabase } from './support/local.ts'

const STUB_CHECKOUT = 'https://checkout.paymongo.test/**'

function webhookSecret() {
  const line = readFileSync('supabase/functions/.env', 'utf8').split('\n').find((l) => l.startsWith('PAYMONGO_WEBHOOK_SECRET='))
  const secret = line?.split('=')[1]?.trim()
  if (!secret) throw new Error('PAYMONGO_WEBHOOK_SECRET missing from supabase/functions/.env')
  return secret
}

/** Sends a checkout_session.payment.paid event for the booking's stored session, signed like PayMongo does. */
async function sendPaidWebhook(reference: string) {
  const service = serviceClient()
  const { data: booking } = await service.from('bookings').select('id, total_amount').eq('reference_code', reference).single().throwOnError()
  const { data: checkout } = await service.from('paymongo_checkouts').select('checkout_id').eq('booking_id', booking.id).single().throwOnError()
  const stamp = `${Date.now()}`
  const body = JSON.stringify({ data: { id: `evt_e2e_${stamp}`, type: 'event', attributes: {
    type: 'checkout_session.payment.paid', livemode: false, created_at: Math.floor(Date.now() / 1000),
    data: { id: checkout.checkout_id, type: 'checkout_session', attributes: { metadata: { booking_id: booking.id }, payments: [
      { id: `pay_e2e_${stamp}`, type: 'payment', attributes: { amount: Math.round(Number(booking.total_amount) * 100), currency: 'PHP', status: 'paid', source: { type: 'gcash' } } },
    ] } },
  } } })
  const t = Math.floor(Date.now() / 1000)
  const res = await fetch(`${localSupabase().url}/functions/v1/paymongo-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Paymongo-Signature': `t=${t},te=${createHmac('sha256', webhookSecret()).update(`${t}.${body}`).digest('hex')},li=` },
    body,
  })
  expect(await res.json()).toMatchObject({ received: true, outcome: 'confirmed' })
}

async function bookAsGuest(page: Page, court: string) {
  await pickFirstFreeSlot(page, { date: venueDate(10), sport: 'pickleball', court })
  await page.getByLabel('Name').fill(`${E2E_PREFIX} Online Payer`)
  await page.getByLabel('Email').fill(`e2e-paymongo-${Date.now()}@example.com`)
  await page.getByLabel('Phone').fill('0917 000 4321')
  await page.getByRole('button', { name: 'Confirm booking' }).click()
  await expect(page.getByRole('heading', { name: 'Booking reserved' })).toBeVisible()
  const url = new URL(page.url())
  return { reference: url.pathname.split('/').pop()!, token: url.hash.replace('#token=', '') }
}

/** Clicks "Pay online" and lands on the stubbed PayMongo page (the checkout URL comes from the Edge Function). */
async function goToStubCheckout(page: Page) {
  await page.route(STUB_CHECKOUT, (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Fake PayMongo checkout</h1>' }))
  await page.getByRole('button', { name: 'Pay online with PayMongo' }).click()
  await expect(page.getByRole('heading', { name: 'Fake PayMongo checkout' })).toBeVisible()
  expect(new URL(page.url()).host).toBe('checkout.paymongo.test')
  // The guest token never goes to PayMongo.
  expect(page.url()).not.toContain('token')
}

test('a guest pays online, the webhook confirms the booking, the private link survives the redirect, and staff see the payment', async ({ page }) => {
  const { reference, token } = await bookAsGuest(page, 'Pickleball 2')
  await goToStubCheckout(page)

  // PayMongo sends the guest back to the success URL (no token in it).
  await page.goto(`/booking/${reference}?paid=1`)
  // The token is back in the fragment, and ?paid is gone so a copied link won't replay the return.
  await expect(page).toHaveURL(new RegExp(`/booking/${reference}#token=${token}$`))
  await expect(page.getByLabel('Private booking link')).toHaveValue(new RegExp(`/booking/${reference}#token=`))
  await expect(page.getByRole('status').filter({ hasText: 'Confirming your payment' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pay online with PayMongo' })).toHaveCount(0)

  await sendPaidWebhook(reference)
  await expect(page.getByRole('status').filter({ hasText: 'Payment received. Your booking is confirmed.' })).toBeVisible()
  await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()
  await expect(page.getByText('Paid online')).toBeVisible()

  // Staff see the online payment in Admin → Bookings, with nothing to review (T7.6).
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/bookings?status=confirmed')
  const row = page.getByRole('button').filter({ hasText: reference })
  await expect(row.getByText('Paid online')).toBeVisible()
  await row.click()
  const panel = page.getByRole('region', { name: `Booking ${reference}` })
  await expect(panel.getByRole('heading', { name: 'Online payments' })).toBeVisible()
  await expect(panel.getByText(/PayMongo · GCash/)).toBeVisible()
  await expect(panel.getByText(/pay_e2e_/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Approve and confirm' })).toHaveCount(0)
})

test('a guest who cancels on PayMongo comes back to a payable booking', async ({ page }) => {
  const { reference, token } = await bookAsGuest(page, 'Pickleball 1')
  await goToStubCheckout(page)

  await page.goto(`/booking/${reference}?paid=0`)
  await expect(page).toHaveURL(new RegExp(`/booking/${reference}#token=${token}$`))
  await expect(page.getByRole('status').filter({ hasText: 'Online payment was cancelled' })).toBeVisible()
  await expect(page.getByText('Waiting for payment')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pay online with PayMongo' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Submit proof of payment' })).toBeVisible()
})
