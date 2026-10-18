// Removes everything the E2E run created in the LOCAL database: tagged bookings (payments cascade),
// their proof files, tagged courts with their photos, an E2E banner, and the e2e-* users.
import { E2E_PREFIX, serviceClient } from './helpers.ts'

export default async function teardown() {
  const service = serviceClient()

  const { data: bookings, error } = await service
    .from('bookings')
    .select('id')
    .or(`guest_name.like.${E2E_PREFIX}*,guest_email.like.e2e-*`)
  if (error) throw error
  const ids = (bookings ?? []).map((b) => b.id)

  for (const id of ids) {
    const { data: files } = await service.storage.from('payment-proofs').list(id)
    if (files?.length) await service.storage.from('payment-proofs').remove(files.map((f) => `${id}/${f.name}`))
  }
  if (ids.length) {
    const { error: deleteError } = await service.from('bookings').delete().in('id', ids)
    if (deleteError) throw deleteError
  }

  // Tagged courts and their photos. Files go through the Storage API (a SQL delete would orphan them).
  const { data: courts, error: courtsError } = await service.from('courts').select('id').like('name', `${E2E_PREFIX}%`)
  if (courtsError) throw courtsError
  for (const { id } of courts ?? []) {
    const { data: files } = await service.storage.from('venue-media').list(`courts/${id}`)
    if (files?.length) await service.storage.from('venue-media').remove(files.map((f) => `courts/${id}/${f.name}`))
    const { error: deleteError } = await service.from('courts').delete().eq('id', id)
    if (deleteError) throw deleteError
  }

  // A banner left by a failed run (tagged through its alt text); a developer's own banner is kept.
  const { data: settings } = await service.from('venue_settings').select('banner_path, banner_alt').single()
  if (settings?.banner_path && settings.banner_alt?.startsWith(E2E_PREFIX)) {
    const { error: clearError } = await service.from('venue_settings')
      .update({ banner_path: null, banner_alt: null }).eq('id', true)
    if (clearError) throw clearError
    await service.storage.from('venue-media').remove([settings.banner_path])
  }

  const { data: users } = await service.auth.admin.listUsers({ perPage: 1000 })
  for (const user of users?.users ?? []) {
    if (user.email?.startsWith('e2e-')) await service.auth.admin.deleteUser(user.id)
  }
}
