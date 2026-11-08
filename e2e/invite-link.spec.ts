// An invited owner opens the emailed link and is signed in, then asked to set a password (T14.5c). The link is a real
// implicit-flow invite (the session arrives in the URL hash), which the PKCE client used to reject. Local stack only.
import { expect, test } from '@playwright/test'
import { guardLeaks } from './support/leaks.ts'
import { createPlatformAdmin, createVenue, deleteVenue, emailText, serviceClient } from './support/helpers.ts'

// Locally the function redirects to the first PUBLIC_SITE_URL (no PUBLIC_ROOT_DOMAIN); on the hosted project it is the
// venue's own subdomain. Point the link at the venue host, keeping its real token.
function onVenueHost(link: string, redirectTo: string) {
  const url = new URL(link)
  url.searchParams.set('redirect_to', redirectTo)
  return url.toString()
}

test('an invite link signs the owner in and asks for a password', async ({ page }) => {
  const venue = await createVenue('invite')
  const service = serviceClient()
  const email = `e2e-invitee-${Date.now().toString(36)}@example.com`
  try {
    const { data } = await service.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: `${venue.url}/admin` } }).then((r) => {
      if (r.error) throw r.error
      return r
    })
    await service.from('venue_members').insert({ venue_id: venue.id, user_id: data.user.id, role: 'owner' }).throwOnError()

    await page.goto(data.properties.action_link)
    await expect(page.getByRole('heading', { name: /set your password/i })).toBeVisible()
    expect(page.url()).not.toContain('access_token')
  } finally {
    const { data: userId } = await service.rpc('user_id_by_email', { p_email: email })
    if (userId) {
      await service.from('venue_members').delete().eq('user_id', userId)
      await service.auth.admin.deleteUser(userId)
    }
    await deleteVenue(venue.id)
  }
})

// T14.5d: the first invite was used up (the owner is invited but has no password), so the console re-sends a sign-in
// link; it signs the owner in and asks for a password, like the first invite would have. T17.25 renamed it a fresh
// access link.
test('a platform admin re-sends the invite and the owner signs in with the new link', async ({ page }) => {
  const venue = await createVenue('resend')
  const service = serviceClient()
  const email = `e2e-resend-${Date.now().toString(36)}@example.com`
  try {
    const invited = await service.auth.admin.inviteUserByEmail(email, { redirectTo: `${venue.url}/admin` })
    if (invited.error) throw invited.error
    await service.from('venue_members').insert({ venue_id: venue.id, user_id: invited.data.user.id, role: 'owner' }).throwOnError()

    const admin = await createPlatformAdmin()
    await page.goto(`http://app.localhost:5179/venues?q=${venue.slug}&open=${venue.id}`)
    await page.getByLabel('Email').fill(admin.email)
    await page.getByLabel('Password').fill(admin.password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    // The venue's detail panel (T17.19) stays open from the URL after signing in.
    const card = page.getByRole('dialog', { name: new RegExp(venue.name) }).or(page.getByRole('region', { name: new RegExp(venue.name) }))
    await card.getByRole('button', { name: 'Resend invite' }).click()
    await card.getByLabel('Owner email').fill(email)
    await card.getByRole('button', { name: 'Send invite' }).click()
    await expect(card.getByRole('status')).toContainText('fresh access link is on its way')

    const text = await emailText(email, /fresh Plotline access link/i)
    const link = text.match(/https?:\/\/\S+\/auth\/v1\/verify\?\S+/)?.[0]
    expect(link, 'a verify link in the resent email').toBeTruthy()
    const owner = await page.context().browser()!.newContext()
    try {
      const ownerPage = await owner.newPage()
      await ownerPage.goto(onVenueHost(link!, `${venue.url}/admin`))
      await expect(ownerPage.getByRole('heading', { name: /set your password/i })).toBeVisible()
    } finally {
      await owner.close()
    }
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
