// T17.29: rehearse the production test-data cleanup (supabase/functions/_shared/venueHistoryPurge.ts) on the LOCAL
// database with a fixture shaped like production: a target venue with an owner, an approved proof payment, a pending
// payment, a billing charge, a rescheduled child booking, queued emails, guest-link tokens and an open play session,
// plus a survivor venue sharing a player, a protected venue and a platform admin.
//   a. a manifest missing a booking                       -> manifest_mismatch, nothing deleted
//   b. a booking added after the manifest was taken       -> manifest_mismatch, nothing deleted
//   c. a wrong slug                                       -> venue_slug_mismatch
//   d. a protected venue in the manifest                  -> venue_protected, the other venue's history survives too
//   e. an invoiced charge, or any invoice                 -> invoiced_charge
//   f. backupSql returns every row about to be removed
//   g. the right manifest removes the listed history and nothing else; then the venue is deletable and
//      delete_unused_venue works and queues its venue-media and payment-qr cleanup.
// Invoked only by scripts/test-db.sh (only Postgres is up there, so Storage is covered by the unit tests).
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { backupSql, purgeSql, validateManifest } from '../supabase/functions/_shared/venueHistoryPurge.ts'

const projectId = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  .match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
if (!projectId) throw new Error('Could not determine the local Supabase project id')
const container = `supabase_db_${projectId}`
const tag = randomUUID().slice(0, 8)

const id = () => randomUUID()
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const code = () => `CB-${Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('')}`

const owner = id(), player = id(), admin = id()
const V = { target: id(), survivor: id(), protectedV: id() }
const slug = { target: `t17-29-tgt-${tag}`, survivor: `t17-29-sur-${tag}`, protectedV: `t17-29-prot-${tag}` }
const C = { t1: id(), t2: id(), s1: id(), p1: id() }
const B = { b1: id(), b2: id(), child: id(), survivor: id(), protectedB: id() }
const P = { approved: id(), pending: id() }
const SESSION = id()
const proofPath = `${B.b1}/proof-${tag}.png`
const day = (n, hour) => {
  const d = new Date(Date.now() + n * 24 * 60 * 60 * 1000)
  d.setUTCHours(hour, 0, 0, 0)
  return d
}
const range = (n, hour) => `tstzrange(${lit(day(n, hour).toISOString())}, ${lit(day(n, hour + 1).toISOString())})`

function psqlRun(sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'],
      { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c })
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c })
    child.on('error', reject)
    child.on('close', (status) => status === 0
      ? resolve(stdout.trim())
      : reject(new Error(stderr.trim() || `psql exited ${status}`)))
    child.stdin.end(`${sql}\n`)
  })
}
const check = (condition, message) => { if (!condition) throw new Error(message) }
const same = (actual, expected, message) => check(actual === expected, `${message}: expected ${expected}, got ${actual}`)

const fixtureSql = `
begin;
insert into auth.users (id, email) values
  (${lit(owner)}, ${lit(`t17-29-owner-${tag}@example.test`)}),
  (${lit(player)}, ${lit(`t17-29-player-${tag}@example.test`)}),
  (${lit(admin)}, ${lit(`t17-29-admin-${tag}@example.test`)});
insert into public.platform_admins (user_id) values (${lit(admin)});
insert into public.venues (id, slug, status) values
  (${lit(V.target)}, ${lit(slug.target)}, 'active'),
  (${lit(V.survivor)}, ${lit(slug.survivor)}, 'active'),
  (${lit(V.protectedV)}, ${lit(slug.protectedV)}, 'active');
update public.venues set protected = true where id = ${lit(V.protectedV)};
insert into public.venue_settings (venue_id, name, timezone)
select v, 'T17.29 purge fixture', 'Asia/Manila' from unnest(array[${lit(V.target)}, ${lit(V.survivor)}, ${lit(V.protectedV)}]::uuid[]) v;
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select v, d, '06:00', '22:00' from unnest(array[${lit(V.target)}, ${lit(V.survivor)}, ${lit(V.protectedV)}]::uuid[]) v, generate_series(0, 6) d;
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  (${lit(C.t1)}, ${lit(V.target)}, 'T17.29 court 1', 'tennis', 300),
  (${lit(C.t2)}, ${lit(V.target)}, 'T17.29 court 2', 'tennis', 300),
  (${lit(C.s1)}, ${lit(V.survivor)}, 'T17.29 survivor court', 'tennis', 300),
  (${lit(C.p1)}, ${lit(V.protectedV)}, 'T17.29 protected court', 'tennis', 300);
insert into public.venue_members (venue_id, user_id, role) values (${lit(V.target)}, ${lit(owner)}, 'owner');

insert into public.bookings (id, venue_id, court_id, user_id, guest_name, guest_email, reference_code, total_amount, during, status) values
  (${lit(B.b1)}, ${lit(V.target)}, ${lit(C.t1)}, ${lit(owner)}, 'T17.29 owner booking', ${lit(`t17-29-owner-${tag}@example.test`)}, ${lit(code())}, 300, ${range(5, 2)}, 'confirmed'),
  (${lit(B.b2)}, ${lit(V.target)}, ${lit(C.t1)}, ${lit(player)}, 'T17.29 player booking', ${lit(`t17-29-player-${tag}@example.test`)}, ${lit(code())}, 300, ${range(6, 2)}, 'payment_submitted'),
  (${lit(B.survivor)}, ${lit(V.survivor)}, ${lit(C.s1)}, ${lit(player)}, 'T17.29 survivor booking', ${lit(`t17-29-player-${tag}@example.test`)}, ${lit(code())}, 300, ${range(5, 2)}, 'confirmed'),
  (${lit(B.protectedB)}, ${lit(V.protectedV)}, ${lit(C.p1)}, null, 'T17.29 protected booking', ${lit(`t17-29-prot-${tag}@example.test`)}, ${lit(code())}, 300, ${range(5, 2)}, 'confirmed');
-- the rescheduled child references its parent
insert into public.bookings (id, venue_id, court_id, user_id, guest_name, guest_email, reference_code, total_amount, during, status, parent_booking_id, source) values
  (${lit(B.child)}, ${lit(V.target)}, ${lit(C.t2)}, ${lit(owner)}, 'T17.29 rescheduled child', ${lit(`t17-29-owner-${tag}@example.test`)}, ${lit(code())}, 0, ${range(7, 2)}, 'confirmed', ${lit(B.b1)}, 'moved');

insert into public.payments (id, booking_id, method, amount, reference_number, storage_path, review_status, reviewed_at) values
  (${lit(P.approved)}, ${lit(B.b1)}, 'gcash', 300, ${lit(`T1729${tag}`)}, ${lit(proofPath)}, 'approved', now());
insert into public.payments (id, booking_id, method, amount, reference_number) values
  (${lit(P.pending)}, ${lit(B.b2)}, 'gcash', 300, ${lit(`T1729P${tag}`)});
insert into public.paymongo_checkouts (booking_id, checkout_id, checkout_url, amount_centavos) values
  (${lit(B.b2)}, ${lit(`cs_t1729${tag}`)}, 'https://example.test/checkout', 30000);
-- bookings_bill may already have charged the confirmed booking; make sure a fee exists for the owner's booking
insert into public.billing_charges (venue_id, booking_id, kind, amount, billing_month)
select ${lit(V.target)}, ${lit(B.b1)}, 'booking_fee', 10, date_trunc('month', now())::date
where not exists (select 1 from public.billing_charges where booking_id = ${lit(B.b1)});
insert into public.booking_changes (booking_id, old_court_id, old_during, new_court_id, new_during, reason) values
  (${lit(B.b1)}, ${lit(C.t1)}, ${range(4, 2)}, ${lit(C.t1)}, ${range(5, 2)}, 'T17.29 rescheduled');
insert into public.email_outbox (booking_id, kind, to_email, for_guest, data) values
  (${lit(B.b2)}, 'booking_created', ${lit(`t17-29-player-${tag}@example.test`)}, true, '{}'::jsonb) on conflict do nothing;
insert into public.email_outbox (booking_id, kind, to_email, for_guest, data, status, sent_at) values
  (${lit(B.b1)}, 'payment_confirmed', ${lit(`t17-29-owner-${tag}@example.test`)}, true, '{}'::jsonb, 'sent', now()) on conflict do nothing;
insert into public.guest_link_tokens (booking_id, token_hash) values
  (${lit(B.b2)}, sha256(convert_to(${lit(`t17-29-token-${tag}`)}, 'UTF8')));
insert into public.open_play_sessions (id, venue_id, title, starts_at, ends_at) values
  (${lit(SESSION)}, ${lit(V.target)}, 'T17.29 open play', ${lit(day(8, 2).toISOString())}, ${lit(day(8, 4).toISOString())});
insert into public.open_play_courts (session_id, court_id, venue_id, during) values
  (${lit(SESSION)}, ${lit(C.t1)}, ${lit(V.target)}, tstzrange(${lit(day(8, 2).toISOString())}, ${lit(day(8, 4).toISOString())})),
  (${lit(SESSION)}, ${lit(C.t2)}, ${lit(V.target)}, tstzrange(${lit(day(8, 2).toISOString())}, ${lit(day(8, 4).toISOString())}));
commit;`

const venueIds = Object.values(V).map(lit).join(', ')
const cleanupSql = `
delete from public.open_play_sessions where venue_id in (${venueIds});
delete from public.bookings where venue_id in (${venueIds});
delete from public.invoices where venue_id in (${venueIds});
delete from public.courts where venue_id in (${venueIds});
delete from public.venue_open_periods where venue_id in (${venueIds});
delete from public.operating_hours where venue_id in (${venueIds});
delete from public.venue_members where venue_id in (${venueIds});
delete from public.venue_settings where venue_id in (${venueIds});
delete from public.venues where id in (${venueIds});
delete from private.venue_file_cleanup where venue_id in (${venueIds});
delete from public.platform_admins where user_id = ${lit(admin)};
delete from auth.users where id in (${lit(owner)}, ${lit(player)}, ${lit(admin)});`

const VENUE_TABLES = ['bookings', 'payments', 'paymongo_checkouts', 'billing_charges', 'booking_changes', 'email_outbox',
  'guest_link_tokens', 'open_play_sessions', 'open_play_courts', 'courts', 'venue_members', 'invoices']
const snapshotSql = `select coalesce(string_agg(t || ':' || v || ':' || n, ';' order by t, v), '') from (
  ${VENUE_TABLES.map((t) => `select '${t}' as t, venue_id::text as v, count(*) as n from public.${t} where venue_id in (${venueIds}) group by venue_id`).join('\n  union all\n  ')}
  union all select 'venues', id::text, 1 from public.venues where id in (${venueIds})
) x`
const snapshot = () => psqlRun(snapshotSql)
const countOf = async (sql) => Number(await psqlRun(sql))

// What a real inventory reads: the venue's actual rows, as a manifest.
async function inventory(venueId) {
  const ids = (table) => `coalesce((select json_agg(id order by id) from public.${table} where venue_id = v.id), '[]')`
  const n = (table) => `(select count(*) from public.${table} where venue_id = v.id)`
  const out = await psqlRun(`select json_build_object(
    'venue_id', v.id, 'slug', v.slug,
    'bookings', ${ids('bookings')}, 'payments', ${ids('payments')}, 'charges', ${ids('billing_charges')},
    'open_play_sessions', ${ids('open_play_sessions')},
    'counts', json_build_object('booking_changes', ${n('booking_changes')}, 'email_outbox', ${n('email_outbox')},
      'guest_link_tokens', ${n('guest_link_tokens')}, 'paymongo_checkouts', ${n('paymongo_checkouts')}, 'open_play_courts', ${n('open_play_courts')}),
    'proof_files', coalesce((select json_agg(storage_path order by storage_path) from public.payments where venue_id = v.id and storage_path is not null), '[]'))
    from public.venues v where v.id = ${lit(venueId)}`)
  return JSON.parse(out)
}
const manifestOf = (...venues) => ({ project_ref: 'local-rehearsal', venues })

async function expectRefusal(label, sql, hint) {
  const before = await snapshot()
  let error = null
  try { await psqlRun(sql) } catch (e) { error = e }
  check(error, `${label}: the cleanup ran but must be refused with ${hint}`)
  check(error.message.includes(hint), `${label}: expected hint ${hint}, got: ${error.message}`)
  same(await snapshot(), before, `${label}: a refused cleanup changed the data`)
}

async function asPlatformAdmin(sql) {
  const out = await psqlRun(`begin;
select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: admin, role: 'authenticated' }))}, true);
${sql}
commit;`)
  return out.split('\n').filter((l) => l && l !== 'COMMIT' && l !== 'BEGIN').pop()
}

try {
  await psqlRun(fixtureSql)
  const target = await inventory(V.target)
  check(target.bookings.length === 3 && target.payments.length === 2 && target.charges.length >= 1, 'fixture: expected 3 bookings, 2 payments and a charge')
  check(target.counts.open_play_courts === 2 && target.counts.guest_link_tokens === 1 && target.counts.paymongo_checkouts === 1, 'fixture: open play, token or checkout counts are wrong')
  check(target.counts.email_outbox >= 2 && target.counts.booking_changes >= 1, 'fixture: expected queued emails and a booking change')
  same(JSON.stringify(target.proof_files), JSON.stringify([proofPath]), 'fixture: proof files')
  const manifest = validateManifest(manifestOf(target))
  const baseline = await snapshot()

  // the preview refuses this venue while it has history
  const blocked = JSON.parse(await asPlatformAdmin(`select public.venue_deletion_preview(${lit(V.target)})::text;`))
  check(blocked.deletable === false && blocked.blockers.includes('bookings'), 'the venue must be blocked before the cleanup')

  // a. a manifest missing one booking id
  await expectRefusal('a. missing booking', purgeSql({ ...manifest, venues: [{ ...target, bookings: target.bookings.filter((b) => b !== B.b2) }] }), 'manifest_mismatch')

  // b. an extra booking inserted after the manifest was taken
  const extra = id()
  await psqlRun(`insert into public.bookings (id, venue_id, court_id, guest_name, reference_code, total_amount, during, status)
    values (${lit(extra)}, ${lit(V.target)}, ${lit(C.t2)}, 'T17.29 late booking', ${lit(code())}, 100, ${range(9, 5)}, 'cancelled')`)
  const withExtra = await snapshot()
  await expectRefusal('b. extra booking', purgeSql(manifest), 'manifest_mismatch')
  same(await snapshot(), withExtra, 'b. the extra booking must still exist')
  await psqlRun(`delete from public.bookings where id = ${lit(extra)}`)
  same(await snapshot(), baseline, 'b. fixture restored')

  // a count that differs is a mismatch too; so are proof files that differ
  await expectRefusal('count mismatch', purgeSql({ ...manifest, venues: [{ ...target, counts: { ...target.counts, email_outbox: target.counts.email_outbox + 1 } }] }), 'manifest_mismatch')
  await expectRefusal('proof mismatch', purgeSql({ ...manifest, venues: [{ ...target, proof_files: [] }] }), 'manifest_mismatch')

  // c. wrong slug; unknown venue
  await expectRefusal('c. wrong slug', purgeSql({ ...manifest, venues: [{ ...target, slug: 'not-this-venue' }] }), 'venue_slug_mismatch')
  await expectRefusal('c. unknown venue', purgeSql({ ...manifest, venues: [{ ...target, venue_id: id() }] }), 'venue_not_found')

  // d. a protected venue: refused, and the whole block rolls back, so the valid target venue before it survives
  const prot = await inventory(V.protectedV)
  await expectRefusal('d. protected', purgeSql(manifestOf(target, prot)), 'venue_protected')

  // e. an invoiced charge, then a venue with an invoice but no linked charge
  const invoice = id()
  await psqlRun(`insert into public.invoices (id, venue_id, billing_month) values (${lit(invoice)}, ${lit(V.target)}, date_trunc('month', now())::date);
    update public.billing_charges set invoice_id = ${lit(invoice)} where id = ${lit(target.charges[0])};`)
  await expectRefusal('e. invoiced charge', purgeSql(manifest), 'invoiced_charge')
  await psqlRun(`update public.billing_charges set invoice_id = null where id = ${lit(target.charges[0])};`)
  await expectRefusal('e. venue with an invoice', purgeSql(manifest), 'invoiced_charge')
  await psqlRun(`delete from public.invoices where id = ${lit(invoice)}`)
  same(await snapshot(), baseline, 'e. fixture restored')

  // f. backupSql: one row, every row about to be removed, nothing from other venues, no change
  const backupRows = (await psqlRun(backupSql(manifest))).split('\n').filter(Boolean)
  same(backupRows.length, 1, 'f. backupSql must return exactly one row')
  const flat = JSON.stringify(JSON.parse(backupRows[0]))
  const otherIds = await psqlRun(`select string_agg(id::text, ',') from (
    select id from public.booking_changes where venue_id = ${lit(V.target)} union all select id from public.email_outbox where venue_id = ${lit(V.target)}) x`)
  const wanted = [
    ...target.bookings, ...target.payments, ...target.charges, SESSION, proofPath, 'T17.29 owner booking', 'T17.29 player booking',
    'T17.29 rescheduled child', `cs_t1729${tag}`, 'T17.29 rescheduled', 'T17.29 open play', ...otherIds.split(','),
  ]
  for (const w of wanted) check(flat.includes(w), `f. the backup is missing ${w}`)
  for (const unwanted of [B.survivor, B.protectedB, V.survivor, 'T17.29 survivor booking']) check(!flat.includes(unwanted), `f. the backup holds another venue's data: ${unwanted}`)
  same(await snapshot(), baseline, 'f. backupSql must not change data')

  // g. the right manifest
  const users = `${lit(owner)}, ${lit(player)}, ${lit(admin)}`
  const authBefore = await countOf(`select count(*) from auth.users where id in (${users})`)
  const profilesBefore = await countOf(`select count(*) from public.profiles where id in (${users})`)
  const others = `select (select count(*) from public.bookings where venue_id = ${lit(V.survivor)}) || ':' || (select count(*) from public.bookings where venue_id = ${lit(V.protectedV)})`
  const othersBefore = await psqlRun(others)
  const queueBefore = await countOf(`select count(*) from private.venue_file_cleanup where venue_id = ${lit(V.target)}`)
  await psqlRun(purgeSql(manifest))
  for (const t of ['bookings', 'payments', 'paymongo_checkouts', 'billing_charges', 'booking_changes', 'email_outbox', 'guest_link_tokens', 'open_play_sessions', 'open_play_courts']) {
    same(await countOf(`select count(*) from public.${t} where venue_id = ${lit(V.target)}`), 0, `g. ${t} left after the cleanup`)
  }
  same(await countOf(`select count(*) from public.bookings where id in (${[B.b1, B.b2, B.child].map(lit).join(', ')})`), 0, 'g. listed bookings left')
  same(await countOf(`select count(*) from public.venues where id = ${lit(V.target)}`), 1, 'g. the venue must be kept')
  same(await countOf(`select count(*) from public.courts where venue_id = ${lit(V.target)}`), 2, 'g. the courts must be kept')
  same(await countOf(`select count(*) from public.venue_members where venue_id = ${lit(V.target)} and user_id = ${lit(owner)}`), 1, 'g. the owner membership must be kept')
  same(await countOf(`select count(*) from auth.users where id in (${users})`), authBefore, 'g. auth users must be kept')
  same(await countOf(`select count(*) from public.profiles where id in (${users})`), profilesBefore, 'g. profiles must be kept')
  same(await psqlRun(others), othersBefore, 'g. other venues must be untouched')
  same(await countOf(`select count(*) from public.bookings where id = ${lit(B.survivor)} and user_id = ${lit(player)}`), 1, "g. the shared player's other booking must survive")
  same(await countOf(`select count(*) from private.venue_file_cleanup where venue_id = ${lit(V.target)}`), queueBefore, 'g. the purge must not queue venue file cleanup')

  // then the venue is an unused venue: the guarded deletion accepts it and queues its file cleanup
  const preview = JSON.parse(await asPlatformAdmin(`select public.venue_deletion_preview(${lit(V.target)})::text;`))
  same(preview.deletable, true, `g. the venue must be deletable after the cleanup (blockers ${JSON.stringify(preview.blockers)})`)
  await asPlatformAdmin(`select public.delete_unused_venue(${lit(V.target)}, ${lit(slug.target)})::text;`)
  same(await countOf(`select count(*) from public.venues where id = ${lit(V.target)}`), 0, 'g. delete_unused_venue must remove the venue')
  same(await psqlRun(`select string_agg(bucket || '=' || prefix, ',' order by bucket) from private.venue_file_cleanup where venue_id = ${lit(V.target)} and status = 'pending'`),
    `payment-qr=${V.target}/,venue-media=${V.target}/`, 'g. the queued file cleanup rows')
  same(await countOf(`select count(*) from auth.users where id in (${users})`), authBefore, 'g. auth users must survive the venue deletion')
  same(await countOf(`select count(*) from public.bookings where id = ${lit(B.survivor)}`), 1, 'g. the survivor booking must survive the venue deletion')

  console.log('T17.29 venue history purge passed: refusals change nothing, the backup is complete, the cleanup is exact and the venue is then deletable.')
} finally {
  await psqlRun(cleanupSql).catch((e) => console.error(`cleanup failed: ${e.message}`))
}
