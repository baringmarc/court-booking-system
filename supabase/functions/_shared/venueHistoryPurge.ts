// The separately reviewed production test-data cleanup (T17.29). A reviewed manifest lists, per venue, the exact
// history rows to remove; purgeSql re-checks them against the database and removes them in one transaction, after
// which the venue is an unused venue that the console's guarded Delete venue (T17.26/T17.27) removes with its files.
// One-off tooling, not a purge API: scripts/purge-venue-history.mjs runs it, scripts/test-venue-history-purge.mjs
// rehearses it locally. Keep the syntax erasable (Node imports this file directly).
import type { CleanupStorage } from './venueCleanup.ts'

export type PurgeVenue = {
  venue_id: string
  slug: string
  bookings: string[]
  payments: string[]
  charges: string[]
  open_play_sessions: string[]
  counts: { booking_changes: number; email_outbox: number; guest_link_tokens: number; paymongo_checkouts: number; open_play_courts: number }
  proof_files: string[]
}

export type PurgeManifest = { project_ref: string; venues: PurgeVenue[] }

export const PROOF_BUCKET = 'payment-proofs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9-]{3,40}$/ // venues_slug_format
const COUNT_KEYS = ['booking_changes', 'email_outbox', 'guest_link_tokens', 'paymongo_checkouts', 'open_play_courts'] as const
const ID_LISTS = ['bookings', 'payments', 'charges', 'open_play_sessions'] as const
const PAGE = 100

function fail(message: string): never {
  throw new Error(`Invalid manifest: ${message}`)
}

/** Checks the manifest's shape and that every proof file is `<booking id>/<file>` of a booking that venue lists. */
export function validateManifest(input: unknown): PurgeManifest {
  if (typeof input !== 'object' || input === null) fail('not an object')
  const m = input as Record<string, unknown>
  if (typeof m.project_ref !== 'string' || m.project_ref.trim() === '') fail('project_ref is missing')
  if (!Array.isArray(m.venues) || m.venues.length === 0) fail('no venues')
  const seen = new Set<string>()
  for (const raw of m.venues as unknown[]) {
    if (typeof raw !== 'object' || raw === null) fail('a venue is not an object')
    const v = raw as Record<string, unknown>
    if (typeof v.venue_id !== 'string' || !UUID.test(v.venue_id)) fail(`venue id ${String(v.venue_id)} is not a uuid`)
    if (seen.has(v.venue_id)) fail(`venue ${v.venue_id} is listed twice`)
    seen.add(v.venue_id)
    if (typeof v.slug !== 'string' || !SLUG.test(v.slug)) fail(`venue ${v.venue_id} has an invalid slug`)
    for (const key of ID_LISTS) {
      const list = v[key]
      if (!Array.isArray(list) || !list.every((x) => typeof x === 'string' && UUID.test(x))) fail(`venue ${v.slug}: ${key} must be a list of uuids`)
    }
    const counts = v.counts as Record<string, unknown> | null
    if (typeof counts !== 'object' || counts === null) fail(`venue ${v.slug}: counts are missing`)
    for (const key of COUNT_KEYS) {
      const n = counts[key]
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) fail(`venue ${v.slug}: count ${key} must be a whole number`)
    }
    const bookings = new Set(v.bookings as string[])
    if (!Array.isArray(v.proof_files)) fail(`venue ${v.slug}: proof_files must be a list`)
    for (const path of v.proof_files as unknown[]) {
      const parts = typeof path === 'string' ? path.split('/') : []
      const [folder, name] = parts
      if (parts.length !== 2 || !UUID.test(folder) || !name || name === '.' || name === '..') fail(`venue ${v.slug}: proof file ${String(path)} is not <booking id>/<file>`)
      if (!bookings.has(folder)) fail(`venue ${v.slug}: proof file ${path} belongs to a booking it does not list`)
    }
  }
  return input as PurgeManifest
}

const lit = (value: string) => `'${value.replaceAll("'", "''")}'`
const idArray = (ids: string[]) => `array[${ids.map(lit).join(', ')}]::text[]`
/** The sorted text ids of a query, compared with the sorted manifest list. */
const sameSet = (query: string, ids: string[]) =>
  `(select coalesce(array_agg(x order by x), '{}') from (${query}) q(x)) is not distinct from (select coalesce(array_agg(x order by x), '{}') from unnest(${idArray(ids)}) u(x))`

function venueChecks(v: PurgeVenue): string {
  const id = `${lit(v.venue_id)}::uuid`
  const mismatch = (what: string) => `raise exception 'Venue ${v.slug}: ${what} differ from the manifest.' using errcode = 'P0001', hint = 'manifest_mismatch';`
  const sets: [string, string, string[]][] = [
    ['bookings', `select id::text from public.bookings where venue_id = ${id}`, v.bookings],
    ['payments', `select id::text from public.payments where venue_id = ${id}`, v.payments],
    ['billing charges', `select id::text from public.billing_charges where venue_id = ${id}`, v.charges],
    ['open play sessions', `select id::text from public.open_play_sessions where venue_id = ${id}`, v.open_play_sessions],
    ['proof files', `select storage_path from public.payments where venue_id = ${id} and storage_path is not null`, v.proof_files],
  ]
  const counts = COUNT_KEYS.map((key) => `
  if (select count(*) from public.${key} where venue_id = ${id}) <> ${v.counts[key]} then
    ${mismatch(key.replaceAll('_', ' '))}
  end if;`).join('')
  return `
  -- ${v.slug}: lock the venue (new bookings, sessions and config wait, then see the outcome) and its courts.
  select slug, protected into v_slug, v_protected from public.venues where id = ${id} for update;
  if not found then
    raise exception 'Venue ${v.venue_id} not found.' using errcode = 'P0001', hint = 'venue_not_found';
  end if;
  if v_slug is distinct from ${lit(v.slug)} then
    raise exception 'Venue ${v.venue_id} is not ${v.slug}.' using errcode = 'P0001', hint = 'venue_slug_mismatch';
  end if;
  if v_protected then
    raise exception 'Venue ${v.slug} is protected.' using errcode = 'P0001', hint = 'venue_protected';
  end if;
  perform 1 from public.courts where venue_id = ${id} for update;
  if exists (select 1 from public.invoices where venue_id = ${id})
     or exists (select 1 from public.billing_charges where venue_id = ${id} and invoice_id is not null) then
    raise exception 'Venue ${v.slug} has invoiced charges.' using errcode = 'P0001', hint = 'invoiced_charge';
  end if;${sets.map(([what, query, ids]) => `
  if not (${sameSet(query, ids)}) then
    ${mismatch(what)}
  end if;`).join('')}${counts}`
}

function venueDeletes(v: PurgeVenue): string {
  const id = `${lit(v.venue_id)}::uuid`
  return `
  -- ${v.slug}: open play (its courts cascade), then bookings, a moved booking before the one it moved from.
  -- Payments, checkouts, emails, changes, guest tokens and billing charges cascade from their booking.
  delete from public.open_play_sessions where venue_id = ${id};
  loop
    delete from public.bookings b where b.venue_id = ${id} and b.parent_booking_id is not null
      and not exists (select 1 from public.bookings c where c.parent_booking_id = b.id);
    exit when not found;
  end loop;
  delete from public.bookings where venue_id = ${id};
  if jsonb_array_length(private.venue_deletion_blockers(false, private.venue_dependency_counts(${id}))) > 0 then
    raise exception 'Venue ${v.slug} still has history after the cleanup.' using errcode = 'P0001', hint = 'purge_incomplete';
  end if;
  raise notice 'T17.29 removed the history of % (%)', ${lit(v.slug)}, ${lit(v.venue_id)};`
}

/** One `do` block (supabase db query runs a single statement): every check for every venue, then the deletes. Any failure rolls all of it back. */
export function purgeSql(m: PurgeManifest): string {
  validateManifest(m)
  return `do $$
declare
  v_slug text;
  v_protected boolean;
begin${m.venues.map(venueChecks).join('\n')}
${m.venues.map(venueDeletes).join('\n')}
end;
$$;
`
}

const BACKUP_TABLES = ['bookings', 'payments', 'paymongo_checkouts', 'billing_charges', 'booking_changes', 'email_outbox',
  'guest_link_tokens', 'open_play_sessions', 'open_play_courts'] as const

/** One select whose single `backup` column holds every row purgeSql would remove, per venue. */
export function backupSql(m: PurgeManifest): string {
  validateManifest(m)
  const venue = (v: PurgeVenue) => {
    const id = `${lit(v.venue_id)}::uuid`
    const tables = BACKUP_TABLES.map((t) => `${lit(t)}, (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.${t} r where r.venue_id = ${id})`)
    return `jsonb_build_object(${lit('venue_id')}, ${lit(v.venue_id)}, ${lit('slug')}, ${lit(v.slug)}, ${lit('manifest')}, ${lit(JSON.stringify(v))}::jsonb, ${tables.join(', ')})`
  }
  return `select jsonb_build_object('project_ref', ${lit(m.project_ref)}, 'taken_at', now(), 'venues', jsonb_build_array(${m.venues.map(venue).join(', ')})) as backup`
}

/** Removes the manifest's proof files through the Storage API, only once no payments row references any of them; throws unless they are gone. */
export async function removeProofFiles(
  storage: CleanupStorage, m: PurgeManifest, isReferenced: (path: string) => Promise<boolean>,
): Promise<{ removed: string[] }> {
  const paths = m.venues.flatMap((v) => v.proof_files)
  for (const path of paths) {
    if (await isReferenced(path)) throw new Error(`${PROOF_BUCKET}/${path} is still referenced by a payment; run the purge first`)
  }
  if (paths.length === 0) return { removed: [] }
  const { error } = await storage.remove(PROOF_BUCKET, paths)
  if (error) throw new Error(`remove from ${PROOF_BUCKET}: ${error.message}`)
  for (const folder of new Set(paths.map((p) => p.split('/')[0]))) {
    const names = new Set<string>()
    for (let offset = 0; ; offset += PAGE) {
      const { data, error: listError } = await storage.list(PROOF_BUCKET, folder, { limit: PAGE, offset })
      if (listError) throw new Error(`list ${PROOF_BUCKET}/${folder}: ${listError.message}`)
      for (const entry of data ?? []) names.add(`${folder}/${entry.name}`)
      if ((data ?? []).length < PAGE) break
    }
    const left = paths.filter((p) => names.has(p))
    if (left.length > 0) throw new Error(`still in ${PROOF_BUCKET}: ${left.join(', ')}`)
  }
  return { removed: paths }
}
