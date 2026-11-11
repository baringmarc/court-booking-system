// T17.22: the Reports / Statement page. Amount due counts sent invoices only; this month's accrual is shown apart; the
// selected month's totals come from the whole month; charges and invoice history page; a charge opens its booking.
// Local stack only; the venue is e2e-*, its bookings (charges cascade) and invoices are removed in FK order.
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { addVenueStaff, axeBothSchemes, createPlayer, createVenue, deleteVenue, E2E_PREFIX, serviceClient } from './support/helpers.ts'

/** First day of the month `back` months before now, as YYYY-MM-01 plus the English label the page shows. */
function monthAgo(back: number) {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
  const iso = d.toISOString().slice(0, 10)
  const label = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)
  return { iso, label, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

const LETTERS = 'ABCDEFGH'
/** A valid, unique booking reference: CB-STMT + two letters (the alphabet has no I, O, 0 or 1). */
const refOf = (i: number) => `CB-STMT${LETTERS[i >> 3]}${LETTERS[i & 7]}`

test('the statement separates what is due from what is accruing, pages its charges and opens a booking', async ({ page }) => {
  const venue = await createVenue('statement')
  const service = serviceClient()
  try {
    const { data: court } = await service.from('courts').select('id').eq('venue_id', venue.id).single().throwOnError()
    const target = monthAgo(1)
    const pad = (n: number) => String(n).padStart(2, '0')

    async function booking(ref: string, year: number, month: number, day: number) {
      const { data } = await service.from('bookings').insert({
        venue_id: venue.id, reference_code: ref, court_id: court!.id, guest_name: `${E2E_PREFIX} Statement guest`,
        source: 'walk_in', status: 'confirmed', total_amount: 700, booking_fee: 10,
        during: `[${year}-${pad(month)}-${pad(day)}T10:00:00+08:00,${year}-${pad(month)}-${pad(day)}T11:00:00+08:00)`,
      }).select('id').single().throwOnError()
      return data!.id
    }
    async function invoiceWithCharge(back: number, status: 'draft' | 'sent' | 'paid', amount: number, ref: string) {
      const m = monthAgo(back)
      const sentAt = monthAgo(back - 1).iso + 'T00:00:00+08:00'
      const { data: inv } = await service.from('invoices').insert({
        venue_id: venue.id, billing_month: m.iso, status,
        sent_at: status === 'draft' ? null : sentAt,
        paid_at: status === 'paid' ? sentAt : null, paid_method: status === 'paid' ? 'GCash' : null,
      }).select('id').single().throwOnError()
      const bookingId = await booking(ref, m.year, m.month, 5)
      await service.from('billing_charges').insert({
        venue_id: venue.id, booking_id: bookingId, invoice_id: inv!.id, billing_month: m.iso, kind: 'booking_fee', amount,
      }).throwOnError()
    }
    // Sent (overdue, 30), draft (70) and paid (50) invoices from older months.
    await invoiceWithCharge(4, 'sent', 30, 'CB-STMTSN')
    await invoiceWithCharge(3, 'draft', 70, 'CB-STMTDR')
    await invoiceWithCharge(5, 'paid', 50, 'CB-STMTPD')

    // 26 fees (2 pages) and one credit in the target month: fees 260, credited 10, total 250.
    const ids: string[] = []
    for (let i = 0; i < 26; i++) ids.push(await booking(refOf(i), target.year, target.month, i + 1))
    await service.from('billing_charges').insert(ids.map((id) => ({
      venue_id: venue.id, booking_id: id, billing_month: target.iso, kind: 'booking_fee' as const, amount: 10,
    }))).throwOnError()
    await service.from('billing_charges').insert({
      venue_id: venue.id, booking_id: ids[0], billing_month: target.iso, kind: 'adjustment', amount: -10,
    }).throwOnError()

    const staff = await createPlayer('statement-staff')
    await addVenueStaff(venue.id, staff.id)
    await page.goto(`${venue.url}/admin/login`)
    await page.getByLabel('Email').fill(staff.email)
    await page.getByLabel('Password').fill(staff.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible()
    await page.goto(`${venue.url}/admin/reports`)
    await expect(page.getByRole('heading', { level: 1, name: 'Statement' })).toBeVisible()

    // Amount due: the sent invoice only, flagged overdue; the draft and paid ones are not in it.
    const due = page.getByRole('region', { name: /amount due/i })
    await expect(due).toContainText('₱30.00')
    await expect(due).toContainText(/overdue/i)
    await expect(due).not.toContainText('₱70.00')
    await expect(due).not.toContainText('₱50.00')
    await expect(page.getByRole('region', { name: /this month.s fees so far/i })).toBeVisible()

    // Invoice history lists all three statuses; details expand.
    const history = page.getByRole('region', { name: /invoice history/i })
    await expect(history.getByRole('listitem')).toHaveCount(3)
    await expect(history).toContainText(/draft/i)
    await expect(history).toContainText(/paid/i)
    const sentRow = history.getByRole('listitem').filter({ hasText: monthAgo(4).label })
    const details = sentRow.getByRole('button', { name: /details/i })
    await details.click()
    await expect(details).toHaveAttribute('aria-expanded', 'true')
    await expect(sentRow).toContainText(/venue cancellations credited/i)

    // Month change: the target month's totals are the whole month, not one page.
    await page.getByLabel('Month', { exact: true }).selectOption({ label: target.label })
    const totals = page.getByRole('region', { name: new RegExp(target.label) })
    await expect(totals).toContainText('₱260.00')
    await expect(totals).toContainText('₱10.00')
    await expect(totals).toContainText('₱250.00')
    await expect(page).toHaveURL(new RegExp(`month=${target.iso}`))
    await expect(page.getByText(/Showing 1[–-]25 of 27/)).toBeVisible()
    await expect(totals).toContainText('₱250.00')

    // Page 2 shows the remaining charges; totals do not shrink to the page.
    await page.getByRole('navigation', { name: 'Charges pages' }).getByRole('button', { name: /next/i }).click()
    await expect(page.getByText(/Showing 26[–-]27 of 27/)).toBeVisible()
    await expect(page).toHaveURL(/page=2/)
    await expect(totals).toContainText('₱250.00')

    // Search by booking reference narrows the list and resets the page.
    await page.getByLabel('Search booking reference').fill(refOf(3))
    await expect(page.getByRole('link', { name: refOf(3) })).toBeVisible()
    await expect(page.getByRole('link', { name: refOf(4) })).toHaveCount(0)
    await expect(page).not.toHaveURL(/page=2/)

    // A charge opens its booking on the bookings page.
    await page.getByRole('link', { name: refOf(3) }).click()
    await expect(page).toHaveURL(/\/admin\/bookings\?.*booking=/)
    await expect(page.getByText(refOf(3)).first()).toBeVisible()

    // Accessible, and no sideways scroll at 360px.
    await page.goto(`${venue.url}/admin/reports?month=${target.iso}`)
    await expect(page.getByRole('region', { name: /amount due/i })).toBeVisible()
    await expect(page.getByText(/Showing 1[–-]25 of 27/)).toBeVisible()
    expect(await axeBothSchemes(page)).toEqual([])
    const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    expect(overflow, 'statement scrolls sideways').toBeLessThanOrEqual(0)
  } finally {
    // Charges go with their bookings; then the invoices and the venue.
    await service.from('bookings').delete().eq('venue_id', venue.id)
    await service.from('invoices').delete().eq('venue_id', venue.id)
    await deleteVenue(venue.id)
    const { count } = await service.from('venues').select('id', { count: 'exact', head: true }).eq('id', venue.id)
    expect(count, 'the e2e venue was removed').toBe(0)
  }
})

test('a venue with no charges and no invoices says so', async ({ page }) => {
  const venue = await createVenue('statement-empty')
  try {
    const staff = await createPlayer('statement-empty-staff')
    await addVenueStaff(venue.id, staff.id)
    await page.goto(`${venue.url}/admin/login`)
    await page.getByLabel('Email').fill(staff.email)
    await page.getByLabel('Password').fill(staff.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible()
    await page.goto(`${venue.url}/admin/reports`)
    await expect(page.getByRole('region', { name: /amount due/i })).toContainText(/nothing (is )?due|no amount due|no invoices? due/i)
    await expect(page.getByText(/no charges/i)).toBeVisible()
    await expect(page.getByText(/no invoices yet/i)).toBeVisible()
  } finally {
    await deleteVenue(venue.id)
  }
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
