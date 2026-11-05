// T17.17: prove schedule activation and booking creation serialize on separate local DB sessions. Whichever gets the court
// locks first decides which schedule version validates the booking:
//   1. activation first  -> the booking waits, then is checked against schedule v2 (closed all week) and is rejected;
//   2. booking first     -> activation waits, then runs; the booking was validated against the legacy hours and is kept.
// Invoked only by scripts/test-db.sh; never reads the linked project's connection details.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const projectId = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  .match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
if (!projectId) throw new Error('Could not determine the local Supabase project id')
const container = `supabase_db_${projectId}`
const tag = randomUUID().slice(0, 8)
const scenarios = ['activation-first', 'booking-first'].map((name) => ({
  name, venue: randomUUID(), user: randomUUID(), court: randomUUID(), slug: `t17-17-${name}-${tag}`.slice(0, 40),
  guest: `T17.17 cutover race ${name} ${tag}`,
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

const fixtureSql = (s) => `
begin;
insert into auth.users (id, email) values (${lit(s.user)}, ${lit(`${s.slug}@example.test`)});
insert into public.venues (id, slug, status) values (${lit(s.venue)}, ${lit(s.slug)}, 'active');
insert into public.venue_settings (venue_id, name, timezone) values (${lit(s.venue)}, 'T17.17 cutover race', 'Asia/Manila');
insert into public.venue_members (venue_id, user_id, role) values (${lit(s.venue)}, ${lit(s.user)}, 'owner');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values (${lit(s.court)}, ${lit(s.venue)}, 'T17.17 race court', 'tennis', 300);
insert into public.operating_hours (venue_id, day_of_week, open_time, close_time)
select ${lit(s.venue)}, d, '06:00', '22:00' from generate_series(0, 6) d;
-- Schedule v2 is deliberately closed all week, so the version that validates the booking is visible in the outcome.
delete from public.venue_open_periods where venue_id = ${lit(s.venue)};
commit;`
const cleanupSql = (s) => `
delete from public.email_outbox where booking_id in (select id from public.bookings where court_id = ${lit(s.court)});
delete from public.payments where booking_id in (select id from public.bookings where court_id = ${lit(s.court)});
delete from public.booking_changes where booking_id in (select id from public.bookings where court_id = ${lit(s.court)});
delete from public.bookings where court_id = ${lit(s.court)};
delete from public.courts where id = ${lit(s.court)};
delete from public.venue_members where venue_id = ${lit(s.venue)};
delete from public.operating_hours where venue_id = ${lit(s.venue)};
delete from public.venue_settings where venue_id = ${lit(s.venue)};
delete from public.venues where id = ${lit(s.venue)};
delete from auth.users where id = ${lit(s.user)};`
const bookingCall = (s) => `select public.create_booking(${lit(s.court)}, ${lit(bookingStartSql)}::timestamptz, 1, ${lit(s.guest)}, ${lit(`${s.slug}@example.test`)}, '09171234567', true);`
const countBookings = (s) => runSql(`select count(*) from public.bookings where guest_name = ${lit(s.guest)}`)
const isActive = (s) => runSql(`select schedule_v2_active from public.venue_schedule_state where venue_id = ${lit(s.venue)}`)

async function activationFirst(s) {
  const activation = psql()
  const held = waitForLine(activation, 'T17_ACTIVATION_HELD')
  activation.stdin.write(`begin;\nselect private.activate_schedule_v2(${lit(s.venue)});\n\\echo T17_ACTIVATION_HELD\n`)
  await held
  const appName = `plotline_t17_17_booking_${tag}`
  const booking = psql([], appName)
  // The booking is rejected after it gets the lock, because activation has made the closed v2 schedule current.
  const bookingDone = finish(booking).then(() => 'accepted', (e) => (/outside_hours|outside opening hours/i.test(e.message) ? 'outside_hours' : `error: ${e.message}`))
  booking.stdin.end(`${bookingCall(s)}\n\\q\n`)
  try { await waitUntilBlocked(appName, 'the booking') } finally { activation.stdin.write('commit;\n\\q\n') }
  await finish(activation)
  const outcome = await bookingDone
  if (outcome !== 'outside_hours') throw new Error(`activation-first: expected the booking to be rejected against schedule v2, got ${outcome}`)
  if ((await countBookings(s)) !== '0') throw new Error('activation-first: a booking committed against a schedule version that activation had replaced')
  if ((await isActive(s)) !== 't') throw new Error('activation-first: activation did not commit')
}

async function bookingFirst(s) {
  const booking = psql()
  const held = waitForLine(booking, 'T17_BOOKING_HELD')
  booking.stdin.write(`begin;\n${bookingCall(s)}\n\\echo T17_BOOKING_HELD\n`)
  await held
  const appName = `plotline_t17_17_activation_${tag}`
  const activation = psql([], appName)
  const activationDone = finish(activation)
  activation.stdin.end(`select private.activate_schedule_v2(${lit(s.venue)});\n\\q\n`)
  try { await waitUntilBlocked(appName, 'activation') } finally { booking.stdin.write('commit;\n\\q\n') }
  await finish(booking)
  await activationDone
  if ((await countBookings(s)) !== '1') throw new Error('booking-first: the booking checked against the legacy hours was lost')
  if ((await isActive(s)) !== 't') throw new Error('booking-first: activation did not complete after the booking')
}

try {
  for (const s of scenarios) await runSql(fixtureSql(s))
  await activationFirst(scenarios[0])
  await bookingFirst(scenarios[1])
  console.log('T17.17 cutover race passed: activation and booking creation serialize on the court locks, in both orders.')
} finally {
  for (const s of scenarios) await runSql(cleanupSql(s)).catch((e) => console.error(`cleanup failed for ${s.slug}: ${e.message}`))
}
