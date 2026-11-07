// T17.26: prove delete_unused_venue and concurrent writes serialize on separate local DB sessions.
//   1. delete first, then a booking   -> the booking waits on the venue/court locks, then fails; the venue is gone.
//   2. booking first, then the delete -> the delete waits, then sees the booking and refuses (venue_in_use).
//   3. delete first, then a config write (a new court) -> the write waits, then fails its foreign key.
// Invoked only by scripts/test-db.sh; never reads the linked project's connection details.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const projectId = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  .match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
if (!projectId) throw new Error('Could not determine the local Supabase project id')
const container = `supabase_db_${projectId}`
const tag = randomUUID().slice(0, 8)
const admin = randomUUID()
const scenarios = ['delete-booking', 'booking-delete', 'delete-config'].map((name) => ({
  name, venue: randomUUID(), court: randomUUID(), slug: `t17-26-${name}-${tag}`.slice(0, 40),
  guest: `T17.26 deletion race ${name} ${tag}`,
}))
const bookingStart = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
bookingStart.setUTCHours(2, 0, 0, 0) // 10:00 in the fixtures' Asia/Manila timezone.
const bookingStartSql = bookingStart.toISOString()

const lit = (value) => `'${value.replaceAll("'", "''")}'`
function psql(args = [], appName) {
  const dockerArgs = ['exec', '-i']
  if (appName) dockerArgs.push('-e', `PGAPPNAME=${appName}`)
  dockerArgs.push(container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', ...args)
  return spawn('docker', dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
}
function finish(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (c) => { stdout += c })
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve({ stdout: stdout.trim(), stderr: stderr.trim() }) : reject(new Error(stderr.trim() || `psql exited ${code}`)))
  })
}
const runSql = async (sql) => (await finish(psql(['-c', sql]))).stdout
function waitForLine(child, marker) {
  return new Promise((resolve, reject) => {
    let output = ''
    let errors = ''
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${marker}; output: ${output}; stderr: ${errors}`)), 10000)
    child.stdout.setEncoding('utf8').on('data', (c) => { output += c; if (output.includes(marker)) { clearTimeout(timer); resolve(output) } })
    child.stderr.setEncoding('utf8').on('data', (c) => { errors += c })
    child.on('close', (code) => { if (!output.includes(marker)) { clearTimeout(timer); reject(new Error(`psql exited ${code} before ${marker}; stderr: ${errors}`)) } })
  })
}
async function waitUntilBlocked(appName, what) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const state = await runSql(`select coalesce(bool_or(wait_event_type = 'Lock'), false) from pg_stat_activity where application_name = ${lit(appName)}`)
    if (state === 't') return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`${what} did not wait on the other transaction's lock`)
}

const adminSql = `
insert into auth.users (id, email) values (${lit(admin)}, ${lit(`t17-26-admin-${tag}@example.test`)});
insert into public.platform_admins (user_id) values (${lit(admin)});`
const fixtureSql = (s) => `
begin;
insert into public.venues (id, slug, status) values (${lit(s.venue)}, ${lit(s.slug)}, 'active');
insert into public.venue_settings (venue_id, name, timezone) values (${lit(s.venue)}, 'T17.26 deletion race', 'Asia/Manila');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values (${lit(s.court)}, ${lit(s.venue)}, 'T17.26 race court', 'tennis', 300);
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select ${lit(s.venue)}, d, '06:00', '22:00' from generate_series(0, 6) d;
commit;`
const cleanupSql = (s) => `
delete from public.email_outbox where booking_id in (select id from public.bookings where court_id = ${lit(s.court)});
delete from public.payments where booking_id in (select id from public.bookings where court_id = ${lit(s.court)});
delete from public.booking_changes where booking_id in (select id from public.bookings where court_id = ${lit(s.court)});
delete from public.bookings where court_id = ${lit(s.court)};
delete from public.courts where venue_id = ${lit(s.venue)};
delete from public.venue_open_periods where venue_id = ${lit(s.venue)};
delete from public.operating_hours where venue_id = ${lit(s.venue)};
delete from public.venue_settings where venue_id = ${lit(s.venue)};
delete from public.venues where id = ${lit(s.venue)};
delete from private.venue_file_cleanup where venue_id = ${lit(s.venue)};`
const asAdmin = `select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: admin, role: 'authenticated' }))}, true);`
const deleteCall = (s) => `${asAdmin}\nselect public.delete_unused_venue(${lit(s.venue)}, ${lit(s.slug)});`
const bookingCall = (s) => `select public.create_booking(${lit(s.court)}, ${lit(bookingStartSql)}::timestamptz, 1, ${lit(s.guest)}, ${lit(`${s.slug}@example.test`)}, '09171234567', true);`
const venueExists = (s) => runSql(`select count(*) from public.venues where id = ${lit(s.venue)}`)
const countBookings = (s) => runSql(`select count(*) from public.bookings where guest_name = ${lit(s.guest)}`)
const queued = (s) => runSql(`select count(*) from private.venue_file_cleanup where venue_id = ${lit(s.venue)}`)

// The delete holds its locks; `write` runs on a second session, must wait on them, and then fails.
async function deleteFirst(s, write, label) {
  const del = psql()
  const held = waitForLine(del, 'T17_DELETE_HELD')
  del.stdin.write(`begin;\n${deleteCall(s)}\n\\echo T17_DELETE_HELD\n`)
  await held
  const appName = `plotline_t17_26_${label}_${tag}`
  const writer = psql([], appName)
  const writeDone = finish(writer).then(() => 'accepted', (e) => `refused: ${e.message}`)
  writer.stdin.end(`${write}\n\\q\n`)
  try { await waitUntilBlocked(appName, label) } finally { del.stdin.write('commit;\n\\q\n') }
  await finish(del)
  const outcome = await writeDone
  if (outcome === 'accepted') throw new Error(`${s.name}: the ${label} committed into a venue that was being deleted`)
  if ((await venueExists(s)) !== '0') throw new Error(`${s.name}: the venue was not deleted`)
  if ((await queued(s)) !== '2') throw new Error(`${s.name}: expected the two file cleanup rows`)
}

async function bookingFirst(s) {
  const booking = psql()
  const held = waitForLine(booking, 'T17_BOOKING_HELD')
  booking.stdin.write(`begin;\n${bookingCall(s)}\n\\echo T17_BOOKING_HELD\n`)
  await held
  const appName = `plotline_t17_26_delete_${tag}`
  const del = psql([], appName)
  const deleteDone = finish(del).then(() => 'deleted', (e) => (/venue_in_use|booking or billing history/i.test(e.message) ? 'venue_in_use' : `error: ${e.message}`))
  del.stdin.end(`begin;\n${deleteCall(s)}\ncommit;\n\\q\n`)
  try { await waitUntilBlocked(appName, 'the delete') } finally { booking.stdin.write('commit;\n\\q\n') }
  await finish(booking)
  const outcome = await deleteDone
  if (outcome !== 'venue_in_use') throw new Error(`booking-first: expected venue_in_use after the booking committed, got ${outcome}`)
  if ((await venueExists(s)) !== '1' || (await countBookings(s)) !== '1') throw new Error('booking-first: the venue or its booking was lost')
  if ((await queued(s)) !== '0') throw new Error('booking-first: a refused delete queued file cleanup')
}

try {
  await runSql(adminSql)
  for (const s of scenarios) await runSql(fixtureSql(s))
  await deleteFirst(scenarios[0], bookingCall(scenarios[0]), 'booking')
  if ((await countBookings(scenarios[0])) !== '0') throw new Error('delete-first: a booking survived the deletion')
  await bookingFirst(scenarios[1])
  await deleteFirst(scenarios[2], `insert into public.courts (venue_id, name, sport, default_hourly_rate) values (${lit(scenarios[2].venue)}, 'T17.26 late court', 'tennis', 300);`, 'court insert')
  console.log('T17.26 deletion race passed: deletion and concurrent bookings or config writes serialize, in both orders.')
} finally {
  for (const s of scenarios) await runSql(cleanupSql(s)).catch((e) => console.error(`cleanup failed for ${s.slug}: ${e.message}`))
  await runSql(`delete from public.platform_admins where user_id = ${lit(admin)}; delete from auth.users where id = ${lit(admin)};`)
    .catch((e) => console.error(`admin cleanup failed: ${e.message}`))
}
