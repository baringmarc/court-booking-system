// T26.7: an owner follows the invoice email's VIEW INVOICE link (`<venue>/admin/reports?invoice=<id>`), signs in, lands on
// that invoice with its Details open, and downloads the PDF from the invoice-pdf function (served by `npx supabase start`
// with supabase/functions/.env, as for the T26.6 console spec). Local stack only; the venue is e2e-*, cleaned in FK order.
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import { guardLeaks } from './support/leaks.ts'
import { E2E_PREFIX, PASSWORD, axeBothSchemes, createPlayer, createVenue, deleteVenue, serviceClient, submitAdminLogin } from './support/helpers.ts'

test('an owner follows the invoice email link, sees the invoice open and downloads its PDF', async ({ page }) => {
  const venue = await createVenue('invlink')
  const service = serviceClient()
  const tag = Date.now().toString(36)
  const accountLabel = `${E2E_PREFIX} Link ${tag}`
  const owner = await createPlayer('invoice-link-owner')
  let invoiceId: string | undefined
  try {
    // The PDF needs at least one Plotline payment account; add a tagged one unless Plotline already lists 5 locally.
    const { count } = await service.from('platform_payment_accounts').select('id', { count: 'exact', head: true })
    if ((count ?? 0) === 0) {
      await service.from('platform_payment_accounts').insert({ label: accountLabel, account_name: 'Plotline Inc.', account_number: '0917 000 5555' }).throwOnError()
    }
    await service.from('venue_members').insert({ venue_id: venue.id, user_id: owner.id, role: 'owner' }).throwOnError()
    const { data: court } = await service.from('courts').select('id').eq('venue_id', venue.id).single().throwOnError()
    const month = '2026-01-01'
    const { data: invoice } = await service.from('invoices').insert({
      venue_id: venue.id, billing_month: month, status: 'sent', sent_at: '2026-02-01T00:00:00+08:00',
    }).select('id').single().throwOnError()
    invoiceId = invoice!.id
    const { data: booking } = await service.from('bookings').insert({
      venue_id: venue.id, reference_code: 'CB-LNK234', court_id: court!.id, guest_name: `${E2E_PREFIX} Invoice link guest`,
      source: 'walk_in', status: 'confirmed', total_amount: 700, booking_fee: 10,
      during: '[2026-01-10T02:00:00+08:00,2026-01-10T03:00:00+08:00)',
    }).select('id').single().throwOnError()
    await service.from('billing_charges').insert({
      venue_id: venue.id, booking_id: booking!.id, invoice_id: invoiceId, billing_month: month, kind: 'booking_fee', amount: 10,
    }).throwOnError()

    // The email's link, opened signed out: sign in, and the guard brings us back to the same path and query.
    // (logInAdmin goes to the default venue; this invoice belongs to the e2e venue's own host, so it is done inline.)
    const path = `/admin/reports?invoice=${invoiceId}`
    await page.goto(venue.url + path)
    await submitAdminLogin(page, owner.email, PASSWORD)
    await expect(page.getByRole('main')).toBeVisible()
    await expect.poll(() => {
      const url = new URL(page.url())
      return url.pathname + url.search
    }).toBe(path)

    const history = page.getByRole('region', { name: /invoice history/i })
    const row = history.getByRole('listitem').filter({ hasText: 'January 2026' })
    await expect(row).toBeVisible()
    await expect(row.getByRole('button', { name: /details/i })).toHaveAttribute('aria-expanded', 'true')
    await expect(row).toContainText(/venue cancellations credited/i)
    await expect(row).toBeInViewport()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      row.getByRole('button', { name: 'Download PDF', exact: true }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i)
    const file = await download.path()
    expect(fs.statSync(file).size, 'downloaded PDF is not empty').toBeGreaterThan(0)
    expect(fs.readFileSync(file).subarray(0, 4).toString(), 'it is a PDF').toBe('%PDF')
    await expect(row.getByRole('alert')).toHaveCount(0)

    expect(await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth'), 'invoice link overflow').toBeLessThanOrEqual(0)
    expect(await axeBothSchemes(page), 'invoice link axe').toEqual([])
  } finally {
    // Foreign-key order: invoice_sends, charges (cascade from the booking), bookings, invoices, the account, members, venue, user.
    if (invoiceId) await service.from('invoice_sends').delete().eq('invoice_id', invoiceId)
    await service.from('bookings').delete().eq('venue_id', venue.id)
    await service.from('invoices').delete().eq('venue_id', venue.id)
    await service.from('platform_payment_accounts').delete().eq('label', accountLabel)
    await service.from('venue_members').delete().eq('venue_id', venue.id)
    if (invoiceId) {
      expect((await service.from('invoices').select('id').eq('id', invoiceId).throwOnError()).data, 'invoice removed').toEqual([])
    }
    expect((await service.from('platform_payment_accounts').select('id').eq('label', accountLabel).throwOnError()).data, 'account removed').toEqual([])
    await deleteVenue(venue.id)
    await service.auth.admin.deleteUser(owner.id)
    expect((await service.from('venues').select('id').eq('id', venue.id).throwOnError()).data, 'venue removed').toEqual([])
  }
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
