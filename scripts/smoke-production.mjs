// Smoke test for the PRODUCTION site (T8.6). Run: npm run smoke:prod [-- <base url>] [-- --links-only]
// 1. Deep links (/book, /admin/login, /booking/…) must return the SPA (vercel.json rewrite).
// 2. A real browser books as a guest through the UI and uploads a proof of payment, which exercises the
//    create_booking RPC, the submit-payment-proof Edge Function, Storage and CORS from the real origin.
// It writes ONE real booking to the production database, tagged "E2E Smoke" with Resend's test address
// delivered+smoke-…@resend.dev, which is accepted and marked delivered without a bounce (example.com bounces now that
// production sends through Resend, T11.26).
// It prints the reference and private link so an admin can review the proof; cancel it afterwards.
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const BASE = (args.find((a) => a.startsWith('http')) ?? 'https://court-booking-system-ashen.vercel.app').replace(/\/$/, '')
const LINKS_ONLY = args.includes('--links-only')
const DAYS_AHEAD = 20

let failed = false
function check(ok, label) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failed = true
}

for (const path of ['/', '/book', '/admin/login', '/booking/CB-SMOKE0', '/me/bookings']) {
  const res = await fetch(BASE + path)
  const html = await res.text()
  check(res.status === 200 && html.includes('<div id="root">'), `GET ${path} → ${res.status}, serves the SPA`)
}

if (!LINKS_ONLY) {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  try {
    // Start at / and navigate inside the app, so this part works even before the rewrite is live.
    await page.goto(BASE + '/')
    await page.getByRole('link', { name: 'Book now' }).click()
    // Step forward with "Next day": both the old date input page and the M10 DatePicker (T10.3) have it.
    // The app's own "today" is the operating day, so read the date it landed on from the URL.
    for (let i = 0; i < DAYS_AHEAD; i++) await page.getByRole('button', { name: 'Next day' }).click()
    await page.waitForURL(/date=\d{4}-\d{2}-\d{2}/)
    const date = new URL(page.url()).searchParams.get('date')
    const slot = page.getByRole('button', { name: /, .*₱/ }).first()
    await slot.waitFor({ timeout: 20_000 })
    const slotName = await slot.getAttribute('aria-label')
    await slot.click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByLabel('Name').fill('E2E Smoke')
    await page.getByLabel('Email').fill(`delivered+smoke-${Date.now()}@resend.dev`)
    // "Phone" until T11.18 is on production, then "Mobile number (optional)".
    await page.getByLabel(/^(Phone|Mobile number)/).fill('0917 000 0000')
    await page.getByRole('button', { name: 'Confirm booking' }).click()
    await page.getByRole('heading', { name: 'Booking reserved' }).waitFor({ timeout: 20_000 })
    check(/\/booking\/CB-[A-Z0-9]{6}#token=/.test(page.url()), `guest booked ${slotName} on ${date}`)
    const link = page.url()

    await page.getByLabel('Paid with').selectOption('gcash')
    await page.getByLabel(/Receipt screenshot/).setInputFiles({
      name: 'receipt.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'),
    })
    await page.getByRole('button', { name: 'Submit proof of payment' }).click()
    await page.getByText(/We're checking your payment/).waitFor({ timeout: 20_000 })
    check(true, 'proof of payment uploaded (Edge Function + Storage)')
    console.log(`\nReference: ${new URL(link).pathname.split('/').pop()}\nPrivate link: ${link}`)
  } catch (error) {
    check(false, `guest booking flow: ${error.message.split('\n')[0]}`)
  } finally {
    await browser.close()
  }
}

process.exit(failed ? 1 : 0)
