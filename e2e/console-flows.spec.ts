// The platform console's two journeys (SPEC §10 2026-11-01, T14.14): lead → venue → invite → publish → showcase, and
// an invoice from draft to paid that the venue sees on its statement. Local stack only; teardown removes e2e-* venues,
// their invoices and charges, and E2E-tagged leads.
import { expect, test, type Page } from '@playwright/test'
import {
  E2E_PREFIX, PASSWORD, axeBothSchemes, createPlatformAdmin, createPlayer, createVenue, addVenueStaff, deleteVenue, serviceClient,
} from './support/helpers.ts'
import { localSupabase } from './support/local.ts'
import { createClient } from '@supabase/supabase-js'

const CONSOLE = 'http://app.localhost:5179/'

async function signInConsole(page: Page) {
  const admin = await createPlatformAdmin()
  await page.goto(CONSOLE)
  await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible()
  await page.getByLabel('Email').fill(admin.email)
  await page.getByLabel('Password').fill(admin.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText(`Signed in as ${admin.email}`)).toBeVisible()
  return admin
}

test('a lead becomes a published, showcased venue', async ({ page }) => {
  const tag = Date.now().toString(36)
  const slug = `e2e-flow-${tag}`
  const venueName = `${E2E_PREFIX} Flow ${tag}`
  const ownerEmail = `e2e-owner-${tag}@example.com`
  const service = serviceClient()
  await service.from('leads').insert({
    first_name: 'Ana', last_name: 'Reyes', email: ownerEmail, phone: '09171234567', venue_name: venueName,
    location: 'Makati', courts: 2, consented_at: new Date().toISOString(),
  }).throwOnError()

  try {
    await signInConsole(page)
    const lead = page.getByRole('listitem').filter({ hasText: venueName })
    await lead.getByRole('button', { name: 'Create venue' }).click()
    await lead.getByLabel('Subdomain').fill(slug)
    await lead.getByRole('button', { name: 'Create venue and invite owner' }).click()
    await expect(lead.getByRole('status')).toContainText(`${slug}.plotline.fit`)

    // A draft venue, its owner invited and the lead marked won.
    const { data: venue } = await service.from('venues').select('id, status').eq('slug', slug).single().throwOnError()
    expect(venue!.status).toBe('draft')
    const { data: ownerId } = await service.rpc('user_id_by_email', { p_email: ownerEmail }).throwOnError()
    const { data: member } = await service.from('venue_members').select('role').eq('venue_id', venue!.id).eq('user_id', ownerId!).single().throwOnError()
    expect(member!.role).toBe('owner')
    const { data: won } = await service.from('leads').select('status').eq('email', ownerEmail).single().throwOnError()
    expect(won!.status).toBe('won')
    await service.auth.admin.updateUserById(ownerId!, { password: PASSWORD, email_confirm: true, user_metadata: { password_set: true } })

    // The owner finishes setup. Account details and player instructions remain independent publication requirements.
    await service.from('courts').insert({ venue_id: venue!.id, name: `${E2E_PREFIX} Flow Court`, sport: 'tennis', default_hourly_rate: 600 }).throwOnError()
    await service.from('venue_payment_accounts').insert({ venue_id: venue!.id, label: `${E2E_PREFIX} GCash`, account_name: 'Ana Reyes', account_number: '0917 000 1111' }).throwOnError()
    const owner = await page.context().browser()!.newContext()
    const ownerPage = await owner.newPage()
    try {
      await ownerPage.goto(`http://${slug}.localhost:5179/admin/login`)
      // A draft venue is invisible to anon, so its host shows the "Staff sign in" form first (VenueProvider).
      await expect(ownerPage.getByRole('heading', { name: 'Staff sign in' })).toBeVisible()
      await ownerPage.getByLabel('Email').fill(ownerEmail)
      await ownerPage.getByLabel('Password').fill(PASSWORD)
      await ownerPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(ownerPage.getByRole('heading', { name: 'Set up your venue' })).toBeVisible()
      const accountRow = ownerPage.getByRole('listitem').filter({ hasText: 'Add a payment account with an account number' })
      const instructionsRow = ownerPage.getByRole('listitem').filter({ hasText: 'Add payment instructions' })
      await expect(accountRow.getByText('Done')).toBeVisible()
      await expect(instructionsRow.getByText('To do')).toBeVisible()
      await expect(ownerPage.getByRole('button', { name: 'Publish venue' })).toBeDisabled()

      await ownerPage.goto(`http://${slug}.localhost:5179/admin/settings/payments`)
      const instructions = ownerPage.getByRole('textbox', { name: /shown to players/i })
      await ownerPage.getByRole('button', { name: 'Use example' }).click()
      await expect(instructions).not.toHaveValue('')
      expect((await service.from('venue_settings').select('payment_instructions').eq('venue_id', venue!.id).single().throwOnError()).data!.payment_instructions).toBe('')
      await ownerPage.getByRole('button', { name: 'Save instructions' }).click()
      await expect(ownerPage.getByText('Saved')).toBeVisible()
      await expect.poll(async () => (await service.from('venue_settings').select('payment_instructions').eq('venue_id', venue!.id).single()).data?.payment_instructions)
        .not.toBe('')

      await ownerPage.goto(`http://${slug}.localhost:5179/admin`)
      await expect(ownerPage.getByRole('listitem').filter({ hasText: 'Add payment instructions' }).getByText('Done')).toBeVisible()
      await ownerPage.getByRole('button', { name: 'Publish venue' }).click()
      await expect(ownerPage.getByRole('heading', { name: 'Set up your venue' })).toHaveCount(0)

      // The venue can still save its city, but platform approval controls public listing.
      const { url, publishableKey } = localSupabase()
      const anon = createClient(url, publishableKey, { auth: { persistSession: false } })
      expect((await anon.from('public_venues').select('slug').eq('slug', slug)).data).toHaveLength(0)
      await ownerPage.goto(`http://${slug}.localhost:5179/admin/settings/venue`)
      await expect(ownerPage.getByLabel('List this venue on the Plotline website')).toHaveCount(0)
      await ownerPage.getByLabel('City').fill('Makati')
      await ownerPage.getByRole('button', { name: 'Save city' }).click()
      await expect(ownerPage.getByText('Saved')).toBeVisible()
      await ownerPage.reload()
      await expect(ownerPage.getByLabel('City')).toHaveValue('Makati')
      expect(await axeBothSchemes(ownerPage)).toEqual([])

      // An owner cannot call the platform action or reach its console controls.
      const ownerClient = createClient(url, publishableKey, { auth: { persistSession: false } })
      await ownerClient.auth.signInWithPassword({ email: ownerEmail, password: PASSWORD })
      const denied = await ownerClient.rpc('set_venue_showcase_approval', { p_venue_id: venue!.id, p_approved: true })
      expect(denied.error?.hint).toBe('not_platform_admin')
      await ownerPage.goto(CONSOLE)
      await ownerPage.getByLabel('Email').fill(ownerEmail)
      await ownerPage.getByLabel('Password').fill(PASSWORD)
      await ownerPage.getByRole('button', { name: 'Sign in' }).click()
      await expect(ownerPage.getByRole('heading', { name: 'Platform admins only' })).toBeVisible()
      await expect(ownerPage.getByRole('button', { name: 'Approve showcase' })).toHaveCount(0)

      // Platform staff approve in the console; the public read and reload reflect the saved decision.
      await page.reload()
      const venueCard = page.getByRole('region', { name: 'Venues', exact: true }).getByRole('listitem').filter({ hasText: slug })
      await expect(venueCard.getByText('Showcase: Not approved', { exact: true })).toBeVisible()
      await venueCard.getByRole('button', { name: 'Approve showcase' }).click()
      await expect(venueCard.getByText('Showcase: Approved', { exact: true })).toBeVisible()
      await expect.poll(async () => (await anon.from('public_venues').select('slug, city').eq('slug', slug)).data)
        .toEqual([{ slug, city: 'Makati' }])
      await page.reload()
      await expect(venueCard.getByText('Showcase: Approved', { exact: true })).toBeVisible()
      await expect(venueCard.getByRole('button', { name: 'Resend invite' })).toBeVisible()
      expect(await axeBothSchemes(page, '[aria-labelledby="venues-heading"]')).toEqual([])

      page.once('dialog', (dialog) => dialog.accept())
      await venueCard.getByRole('button', { name: 'Suspend', exact: true }).click()
      await expect(venueCard.getByRole('button', { name: 'Reactivate', exact: true })).toBeVisible()
      await expect.poll(async () => (await anon.from('public_venues').select('slug').eq('slug', slug)).data).toEqual([])
      await venueCard.getByRole('button', { name: 'Reactivate', exact: true }).click()
      await expect(venueCard.getByRole('button', { name: 'Suspend', exact: true })).toBeVisible()
      await expect.poll(async () => (await anon.from('public_venues').select('slug').eq('slug', slug)).data).toEqual([{ slug }])

      await venueCard.getByRole('button', { name: 'Remove from showcase' }).click()
      await expect(venueCard.getByText('Showcase: Not approved', { exact: true })).toBeVisible()
      await expect.poll(async () => (await anon.from('public_venues').select('slug').eq('slug', slug)).data).toEqual([])
      await page.reload()
      await expect(venueCard.getByText('Showcase: Not approved', { exact: true })).toBeVisible()

    } finally {
      await owner.close()
    }

    // The console lists the venue as active.
    await page.reload()
    await expect(page.getByRole('listitem').filter({ hasText: slug }).getByText(`${slug} · active`)).toBeVisible()
  } finally {
    // Other specs read venue_settings with .single(), so this venue must not outlive the test.
    const { data: created } = await service.from('venues').select('id').eq('slug', slug).maybeSingle()
    if (created) {
      await service.from('venue_payment_accounts').delete().eq('venue_id', created.id)
      await deleteVenue(created.id)
      expect((await service.from('venues').select('id').eq('id', created.id).throwOnError()).data).toEqual([])
    }
    await service.from('leads').delete().eq('venue_name', venueName).throwOnError()
    expect((await service.from('leads').select('id').eq('venue_name', venueName).throwOnError()).data).toEqual([])
  }
})

test('an invoice goes from draft to sent to paid, and the venue sees it on its statement', async ({ page }) => {
  const venue = await createVenue('invoice')
  try {
    const service = serviceClient()
    const { data: court } = await service.from('courts').select('id').eq('venue_id', venue.id).single().throwOnError()
    const month = '2026-01-01'
    const { data: invoice } = await service.from('invoices').insert({ venue_id: venue.id, billing_month: month }).select('id').single().throwOnError()
    const { data: booking } = await service.from('bookings').insert({
      venue_id: venue.id, reference_code: 'CB-BCD222', court_id: court!.id, guest_name: `${E2E_PREFIX} Invoice guest`,
      source: 'walk_in', status: 'confirmed', total_amount: 700, booking_fee: 10,
      during: '[2026-01-10T02:00:00+08:00,2026-01-10T03:00:00+08:00)',
    }).select('id').single().throwOnError()
    await service.from('billing_charges').insert({
      venue_id: venue.id, booking_id: booking!.id, invoice_id: invoice!.id, billing_month: month, kind: 'booking_fee', amount: 10,
    }).throwOnError()

    await signInConsole(page)
    const card = page.getByRole('region', { name: 'Invoices' }).getByRole('listitem').filter({ hasText: venue.name })
    await expect(card).toContainText('draft')
    await card.getByRole('button', { name: 'Review' }).click()
    const detail = page.getByRole('article', { name: /^Invoice / })
    await expect(detail).toContainText('CB-BCD222')
    await expect(detail).toContainText('₱10.00')
    await detail.getByRole('button', { name: 'Mark as sent' }).click()
    await expect(detail).toContainText('sent')
    await detail.getByLabel('Payment method').fill('GCash')
    await detail.getByLabel('Reference').fill('E2E-REF-1')
    await detail.getByRole('button', { name: 'Mark as paid' }).click()
    await expect(detail).toContainText('paid by GCash (E2E-REF-1)')

    // The venue's own statement lists it, for staff of that venue only.
    const staff = await createPlayer('invoice-staff')
    await addVenueStaff(venue.id, staff.id)
    const other = await page.context().browser()!.newContext()
    const staffPage = await other.newPage()
    try {
      await staffPage.goto(`${venue.url}/admin/login`)
      await expect(staffPage.getByRole('heading', { name: 'Admin log in' })).toBeVisible()
      await staffPage.getByLabel('Email').fill(staff.email)
      await staffPage.getByLabel('Password').fill(staff.password)
      await staffPage.getByRole('button', { name: 'Log in' }).click()
      await expect(staffPage.getByRole('button', { name: 'Account', exact: true })).toBeVisible()
      const openNavigation = staffPage.getByRole('button', { name: 'Open navigation' })
      if (await openNavigation.isVisible()) await openNavigation.click()
      await staffPage.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Reports', exact: true }).click()
      await expect(staffPage.getByRole('heading', { name: 'Past invoices' })).toBeVisible()
      await expect(staffPage.getByText(/January 2026 · paid · ₱10/)).toBeVisible()
    } finally {
      await other.close()
    }
  } finally {
    // Charges go with the booking; the invoice and the venue are removed explicitly.
    const service = serviceClient()
    await service.from('bookings').delete().eq('venue_id', venue.id)
    await service.from('invoices').delete().eq('venue_id', venue.id)
    await deleteVenue(venue.id)
  }
})
