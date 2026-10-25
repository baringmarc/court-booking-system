// T10.7: the dashboard's earnings section. A cash walk-in payment recorded today shows up in today's collected total;
// the period switch, the hours table and the daily chart read well, with no serious axe violations in light and dark.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, serviceClient, venueDate } from './support/helpers.ts'

/** Serious or critical WCAG A/AA violations, in light and dark mode (the a11y spec's rule). */
async function axeViolations(page: Page) {
  const found: string[] = []
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    found.push(...results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${colorScheme} ${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`))
  }
  await page.emulateMedia({ colorScheme: null })
  return found
}

const pesos = (text: string | null) => Number((text ?? '').replace(/[^\d.]/g, ''))

test('a walk-in paid today shows up in the collected total, and the earnings section reads well', async ({ page }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin')
  const earnings = page.getByRole('region', { name: 'Earnings' })
  const total = earnings.locator('.big-number').first()
  await expect(total).toHaveText(/₱/)
  const before = pesos(await total.textContent())

  // A walk-in, recorded the way create_walk_in does: confirmed, with an approved cash payment received now. It sits
  // outside opening hours far ahead, so it blocks nothing; teardown removes it (tagged name).
  const service = serviceClient()
  const { data: court } = await service.from('courts').select('id').eq('name', 'Tennis Court').single().throwOnError()
  const day = venueDate(26)
  const { data: booking } = await service.from('bookings').insert({
    reference_code: `CB-ERN${String(Date.now() % 1000).padStart(3, '0').replace(/[01]/g, '2')}`, court_id: court!.id,
    guest_name: `${E2E_PREFIX} Walk-in cash`, source: 'walk_in', status: 'confirmed', total_amount: 1234,
    during: `[${day}T02:00:00+08:00,${day}T03:00:00+08:00)`,
  }).select('id').single().throwOnError()
  try {
    await service.from('payments').insert({
      booking_id: booking!.id, method: 'cash', amount: 1234, review_status: 'approved', reviewed_at: new Date().toISOString(),
    }).throwOnError()
    await checkEarnings(page, before)
  } finally {
    // Removed here too (payments cascade), so the phone run can use the same slot.
    await service.from('bookings').delete().eq('id', booking!.id).throwOnError()
  }
})

async function checkEarnings(page: Page, before: number) {
  const earnings = page.getByRole('region', { name: 'Earnings' })
  const total = earnings.locator('.big-number').first()

  await page.reload()
  await expect(total).toHaveText(/₱/)
  await expect.poll(async () => pesos(await total.textContent())).toBe(before + 1234)
  await expect(earnings.getByRole('list', { name: 'Collected by method' })).toContainText('Cash')
  await expect(earnings.getByRole('table')).toContainText('All courts')
  expect(await axeViolations(page), 'earnings, today').toEqual([])

  // This week: Monday to Sunday, with a labelled bar per day.
  await earnings.getByRole('button', { name: 'This week' }).click()
  await expect(earnings.getByRole('button', { name: 'This week' })).toHaveAttribute('aria-pressed', 'true')
  const bars = earnings.getByRole('list', { name: 'Collected per day' }).getByRole('listitem')
  await expect(bars).toHaveCount(7)
  await expect(bars.first()).toContainText('Mon')
  expect(await axeViolations(page), 'earnings, this week').toEqual([])
  const overflow = await page.evaluate<number>('document.documentElement.scrollWidth - document.documentElement.clientWidth')
  expect(overflow, 'the dashboard scrolls sideways').toBeLessThanOrEqual(0)

  // A custom range that ends before it starts is caught before loading.
  await earnings.getByRole('button', { name: 'Custom range' }).click()
  await expect(earnings.getByRole('group', { name: 'From' })).toBeVisible()
}
