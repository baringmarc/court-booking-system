// Removes everything the E2E run created in the LOCAL database: tagged bookings (payments cascade),
// their proof files, tagged courts with their photos, an E2E banner, tagged blackouts and open play sessions, tagged
// payment accounts with their QR codes, and the e2e-* users.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { E2E_PREFIX, serviceClient, venueId } from './helpers.ts'

/**
 * Finished file-cleanup rows of venues that no longer exist (T17.27: every console deletion leaves one per bucket).
 * The queue is in the private schema, out of the API's reach, so this goes through psql in the LOCAL db container,
 * like scripts/test-venue-deletion-concurrency.mjs. Pending and failed rows are real work and stay.
 */
function clearFinishedVenueCleanup() {
  const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
  if (!projectId) throw new Error('Could not determine the local Supabase project id')
  execFileSync('sh', ['scripts/with-docker.sh', 'docker', 'exec', `supabase_db_${projectId}`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-c',
    "delete from private.venue_file_cleanup c where c.status = 'done' and not exists (select 1 from public.venues v where v.id = c.venue_id)"],
  { stdio: 'pipe' })
}

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
  const { data: courts, error: courtsError } = await service.from('courts').select('id, venue_id').like('name', `${E2E_PREFIX}%`)
  if (courtsError) throw courtsError
  for (const { id, venue_id } of courts ?? []) {
    const folder = `${venue_id}/courts/${id}`
    const { data: files } = await service.storage.from('venue-media').list(folder)
    if (files?.length) await service.storage.from('venue-media').remove(files.map((f) => `${folder}/${f.name}`))
    const { error: deleteError } = await service.from('courts').delete().eq('id', id)
    if (deleteError) throw deleteError
  }

  // A banner left by a killed run. The spec saves the generated alt "<venue name> banner" (it skips when a banner existed
  // before, and its own finally clears it), so only a banner with exactly that alt is removed; any other banner is kept.
  const { data: settings } = await service.from('venue_settings').select('venue_id, name, banner_path, banner_alt').eq('venue_id', await venueId()).single()
  if (settings?.banner_path && settings.banner_alt === `${settings.name} banner`) {
    const { error: clearError } = await service.from('venue_settings')
      .update({ banner_path: null, banner_alt: null }).eq('venue_id', settings.venue_id)
    if (clearError) throw clearError
    await service.storage.from('venue-media').remove([settings.banner_path])
  }

  // Tagged venue info sections (T9.11h).
  const { error: infoError } = await service.from('venue_info_sections').delete().like('title', `${E2E_PREFIX}%`)
  if (infoError) throw infoError

  // Tagged blackouts (T10.3, through their reason).
  const { error: blackoutsError } = await service.from('blackouts').delete().like('reason', `${E2E_PREFIX}%`)
  if (blackoutsError) throw blackoutsError

  // Tagged open play sessions (their court rows cascade).
  const { error: sessionsError } = await service.from('open_play_sessions').delete().like('title', `${E2E_PREFIX}%`)
  if (sessionsError) throw sessionsError

  // Tagged payment accounts and their QR codes (T11.11).
  const { data: accounts } = await service.from('venue_payment_accounts').select('qr_path').like('label', `${E2E_PREFIX}%`)
  const qrPaths = (accounts ?? []).flatMap((a) => (a.qr_path ? [a.qr_path] : []))
  if (qrPaths.length) await service.storage.from('payment-qr').remove(qrPaths)
  const { error: accountsError } = await service.from('venue_payment_accounts').delete().like('label', `${E2E_PREFIX}%`)
  if (accountsError) throw accountsError

  // Tagged Plotline payment accounts (T26.5): global rows, not venue-scoped; their QR files sit in platform-billing.
  const { data: platformAccounts, error: platformReadError } = await service.from('platform_payment_accounts').select('qr_path').like('label', `${E2E_PREFIX}%`)
  if (platformReadError) throw platformReadError
  const platformQrPaths = (platformAccounts ?? []).flatMap((a) => (a.qr_path ? [a.qr_path] : []))
  if (platformQrPaths.length) {
    const { error: platformRemoveError } = await service.storage.from('platform-billing').remove(platformQrPaths)
    if (platformRemoveError) throw platformRemoveError
  }
  const { error: platformAccountsError } = await service.from('platform_payment_accounts').delete().like('label', `${E2E_PREFIX}%`)
  if (platformAccountsError) throw platformAccountsError

  // Tagged venues (T13.9). Their members cascade; the users go below.
  // Hours and settings don't cascade from `venues`; courts were removed above (tagged E2E) and bookings before that.
  const { data: e2eVenues, error: venuesError } = await service.from('venues').select('id').like('slug', 'e2e-%')
  if (venuesError) throw venuesError
  const venueIds = (e2eVenues ?? []).map((v) => v.id)
  if (venueIds.length) {
    // Billing rows reference venues without a cascade (T14.14); the charges of tagged bookings are already gone.
    for (const table of ['billing_charges', 'invoices'] as const) {
      const { error: billingError } = await service.from(table).delete().in('venue_id', venueIds)
      if (billingError) throw billingError
    }
    for (const table of ['operating_hours', 'venue_settings'] as const) {
      const { error: childError } = await service.from(table).delete().in('venue_id', venueIds)
      if (childError) throw childError
    }
    const { error: deleteVenuesError } = await service.from('venues').delete().in('id', venueIds)
    if (deleteVenuesError) throw deleteVenuesError
  }

  clearFinishedVenueCleanup()

  // Tagged leads (T14.14, through their venue name).
  const { error: leadsError } = await service.from('leads').delete().like('venue_name', `${E2E_PREFIX}%`)
  if (leadsError) throw leadsError

  const { data: users } = await service.auth.admin.listUsers({ perPage: 1000 })
  for (const user of users?.users ?? []) {
    if (user.email?.startsWith('e2e-')) await service.auth.admin.deleteUser(user.id)
  }
}
