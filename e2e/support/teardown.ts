// Removes everything the E2E run created in the LOCAL database: tagged bookings (payments cascade),
// their proof files, and the e2e-* users.
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

  const { data: users } = await service.auth.admin.listUsers({ perPage: 1000 })
  for (const user of users?.users ?? []) {
    if (user.email?.startsWith('e2e-')) await service.auth.admin.deleteUser(user.id)
  }
}
