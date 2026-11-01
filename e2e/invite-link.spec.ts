// An invited owner opens the emailed link and is signed in, then asked to set a password (T14.5c). The link is a real
// implicit-flow invite (the session arrives in the URL hash), which the PKCE client used to reject. Local stack only.
import { expect, test } from '@playwright/test'
import { createVenue, deleteVenue, serviceClient } from './support/helpers.ts'

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
