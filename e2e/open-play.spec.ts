// T9.11d: an admin registers an open play session; a guest sees "Open play" on /book, reads the details and
// can't book it; deleting the session frees the slots. Runs the T9.11c RPCs and get_availability end to end.
import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { createAdmin, E2E_PREFIX, logInAdmin, pickDate, serviceClient, venueDate, setColorScheme } from './support/helpers.ts'

const date = venueDate(22)

/** Serious or critical WCAG A/AA violations, in light and dark mode (the a11y spec's rule). */
async function axeViolations(page: Page) {
  const found: string[] = []
  for (const colorScheme of ['light', 'dark'] as const) {
    await setColorScheme(page, colorScheme)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    found.push(...results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${colorScheme} ${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`))
  }
  await page.emulateMedia({ colorScheme: null })
  return found
}

// The session blocks real slots: remove it even when the test fails (global teardown is the backstop).
test.afterEach(async () => {
  const { error } = await serviceClient().from('open_play_sessions').delete().like('title', `${E2E_PREFIX}%`)
  if (error) throw error
})

test('an admin adds open play, a guest sees its details and cannot book it, and deleting it frees the slots', async ({ page, browser }) => {
  const admin = await createAdmin()
  await logInAdmin(page, admin.email, admin.password, '/admin/open-play')
  const title = `${E2E_PREFIX} Open play ${Date.now()}`

  const form = page.getByRole('form', { name: 'Open play session' })
  await form.getByRole('checkbox', { name: /Badminton 3/ }).check()
  // Date, start hour and length through the pickers (T10.3), all by role.
  await pickDate(page, form, 'Date', date)
  await form.getByRole('group', { name: 'Starts' }).getByRole('radio', { name: '10 AM', exact: true }).check()
  await form.getByRole('group', { name: 'How long' }).getByRole('radio', { name: '2 hrs', exact: true }).check()
  await form.getByLabel('Title').fill(title)
  await form.getByLabel('Details').fill('All levels welcome.\nBring water.')
  await form.getByLabel('Link 1 label').fill('RSVP')
  await form.getByLabel('Link 1 address').fill('https://forms.gle/e2e-open-play')
  await form.getByRole('button', { name: 'Add session' }).click()
  const listed = page.getByRole('listitem').filter({ hasText: title })
  await expect(listed).toBeVisible()
  await expect(listed).toContainText('Badminton 3')
  await expect(listed).toContainText('10 AM – 12 PM')

  // A guest on the same device size.
  const guestContext = await browser.newContext({ ...test.info().project.use })
  const guest = await guestContext.newPage()
  await guest.goto(`/book?date=${date}&sport=badminton`)
  // The session's two hours are one merged cell (T10.5).
  const slot = guest.getByRole('button', { name: 'Badminton 3, 10 AM – 12 PM, Open play' })
  await expect(slot).toBeVisible()
  await expect(slot).toContainText('10 AM – 12 PM')
  await expect(guest.getByRole('button', { name: /^Badminton 3, 11 AM – 12 PM/ })).toHaveCount(0)
  await expect(slot).not.toHaveAttribute('aria-pressed', /.*/)
  expect(await axeViolations(guest), 'the grid with open play slots').toEqual([])

  // Details in a modal dialog; Escape closes it and focus returns to the slot. Nothing gets selected.
  await slot.click()
  const dialog = guest.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('10 AM – 12 PM')
  await expect(dialog).toContainText('Badminton 3')
  await expect(dialog).toContainText('Bring water.')
  const rsvp = dialog.getByRole('link', { name: 'RSVP (opens in a new tab)' })
  await expect(rsvp).toHaveAttribute('href', 'https://forms.gle/e2e-open-play')
  await expect(rsvp).toHaveAttribute('rel', 'noopener noreferrer')
  expect(await axeViolations(guest), 'the open play dialog').toEqual([])
  await guest.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(slot).toBeFocused()
  await expect(guest.getByRole('button', { name: 'Continue' })).toHaveCount(0)

  // Deleting the session frees the slots.
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: `Delete ${title}` }).click()
  await expect(listed).toHaveCount(0)
  await guest.reload()
  await expect(guest.getByRole('button', { name: /^Badminton 3, 10 AM – 11 AM, ₱/ })).toBeEnabled()
  await guestContext.close()
})
