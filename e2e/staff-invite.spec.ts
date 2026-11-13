// T24.2: a platform admin invites a venue's staff from the console; the staff member follows the emailed link, sets a
// password and lands in the venue admin as staff. Local stack only.
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createPlatformAdmin, createVenue, deleteVenue, emailText, serviceClient } from './support/helpers.ts'

// Locally the function redirects to the first PUBLIC_SITE_URL; point the link at the venue host, keeping its token.
function onVenueHost(link: string, redirectTo: string) {
  const url = new URL(link)
  url.searchParams.set('redirect_to', redirectTo)
  return url.toString()
}

test('a platform admin invites staff and the staff member sets a password and reaches the venue admin', async ({ page }) => {
  const venue = await createVenue('staffinv')
  const service = serviceClient()
  const email = `e2e-staff-${Date.now().toString(36)}@example.com`
  try {
    const admin = await createPlatformAdmin()
    await page.goto(`http://app.localhost:5179/venues?q=${venue.slug}&open=${venue.id}`)
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    const card = page.getByRole('dialog', { name: new RegExp(venue.name) }).or(page.getByRole('region', { name: new RegExp(venue.name) }))
    await card.getByRole('button', { name: 'Invite staff' }).click()
    await card.getByLabel('Staff email').fill(email)
    await card.getByRole('button', { name: 'Send staff invite' }).click()
    await expect(card.getByRole('status')).toContainText('account setup invitation is on its way')

    const text = await emailText(email, /Set up your Plotline staff account/i)
    const link = text.match(/https?:\/\/\S+\/auth\/v1\/verify\?\S+/)?.[0]
    expect(link, 'a verify link in the staff invite email').toBeTruthy()
    const staff = await page.context().browser()!.newContext()
    try {
      const staffPage = await staff.newPage()
      await staffPage.goto(onVenueHost(link!, `${venue.url}/admin`))
      await expect(staffPage.getByRole('heading', { name: /set your password/i })).toBeVisible()
      await staffPage.getByLabel('New password').fill('Staff-pass-123')
      await staffPage.getByLabel('Confirm password').fill('Staff-pass-123')
      await staffPage.getByRole('button', { name: 'Set password' }).click()
      await expect(staffPage.getByRole('heading', { name: /set your password/i })).toBeHidden()
      await expect(staffPage).toHaveURL(/\/admin/)
    } finally {
      await staff.close()
    }

    const { data: userId } = await service.rpc('user_id_by_email', { p_email: email })
    expect(userId, 'the staff account').toBeTruthy()
    const { data: member } = await service.from('venue_members').select('role').eq('venue_id', venue.id).eq('user_id', userId!).single()
    expect(member?.role).toBe('staff')
  } finally {
    const { data: userId } = await service.rpc('user_id_by_email', { p_email: email })
    if (userId) {
      await service.from('venue_members').delete().eq('user_id', userId)
      await service.auth.admin.deleteUser(userId)
    }
    await deleteVenue(venue.id)
  }
})

// H14: keep last, after this file's own cleanup hooks.
guardLeaks()
