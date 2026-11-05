// T17.11: prove schedule saves serialize with booking validation on separate local DB sessions.
// Invoked only by scripts/test-db.sh; never reads the linked project's connection details.
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const projectId = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  .match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
if (!projectId) throw new Error('Could not determine the local Supabase project id')
const container = `supabase_db_${projectId}`
const ids = {
  venue: randomUUID(),
  user: randomUUID(),
  court: randomUUID(),
  slug: `t17-11-race-${randomUUID().slice(0, 8)}`,
}
const bookingName = `T17.11 schedule race ${ids.slug}`
const bookingStart = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
bookingStart.setUTCHours(2, 0, 0, 0) // 10:00 in the fixture's Asia/Manila timezone.
const bookingStartSql = bookingStart.toISOString()

function psql(args, { appName, input } = {}) {
  const dockerArgs = ['exec', '-i']
  if (appName) dockerArgs.push('-e', `PGAPPNAME=${appName}`)
  dockerArgs.push(container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', ...args)
  return spawn('docker', dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function runSql(sql) {
  return new Promise((resolve, reject) => {
    const child = psql(['-c', sql])
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `psql exited ${code}`)))
  })
}

function waitForLine(child, marker) {
  return new Promise((resolve, reject) => {
    let output = ''
    let errors = ''
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${marker}; output: ${output}; stderr: ${errors}`)), 10000)
    child.stdout.setEncoding('utf8').on('data', chunk => {
      output += chunk
      if (output.includes(marker)) {
        clearTimeout(timer)
        resolve(output)
      }
    })
    child.stderr.setEncoding('utf8').on('data', chunk => { errors += chunk })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('close', code => {
      if (!output.includes(marker)) {
        clearTimeout(timer)
        reject(new Error(`psql exited ${code} before ${marker}; stderr: ${errors}`))
      }
    })
  })
}

function finish(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr.trim() || `psql exited ${code}`)))
  })
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`
}

const fixtureSql = `
begin;
insert into auth.users (id, email) values (${sqlLiteral(ids.user)}, ${sqlLiteral(`${ids.slug}@example.test`)});
insert into public.venues (id, slug, status) values (${sqlLiteral(ids.venue)}, ${sqlLiteral(ids.slug)}, 'active');
insert into public.venue_settings (venue_id, name, timezone)
values (${sqlLiteral(ids.venue)}, 'T17.11 schedule race', 'Asia/Manila');
insert into public.venue_members (venue_id, user_id, role)
values (${sqlLiteral(ids.venue)}, ${sqlLiteral(ids.user)}, 'owner');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate)
values (${sqlLiteral(ids.court)}, ${sqlLiteral(ids.venue)}, 'T17.11 race court', 'tennis', 300);
insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
select ${sqlLiteral(ids.venue)}, d, 360, 1200 from generate_series(0, 6) d;
update public.venue_schedule_state set schedule_v2_active = true where venue_id = ${sqlLiteral(ids.venue)};
commit;`

const cleanupSql = `
delete from public.email_outbox where booking_id in (select id from public.bookings where court_id = ${sqlLiteral(ids.court)});
delete from public.payments where booking_id in (select id from public.bookings where court_id = ${sqlLiteral(ids.court)});
delete from public.booking_changes where booking_id in (select id from public.bookings where court_id = ${sqlLiteral(ids.court)});
delete from public.bookings where court_id = ${sqlLiteral(ids.court)};
delete from public.courts where id = ${sqlLiteral(ids.court)};
delete from public.venue_members where venue_id = ${sqlLiteral(ids.venue)};
delete from public.venue_settings where venue_id = ${sqlLiteral(ids.venue)};
delete from public.venues where id = ${sqlLiteral(ids.venue)};
delete from auth.users where id = ${sqlLiteral(ids.user)};`

const scheduleSql = `
begin;
set local role authenticated;
set local request.jwt.claims = ${sqlLiteral(JSON.stringify({ sub: ids.user, role: 'authenticated' }))};
select public.save_schedule(${sqlLiteral(ids.venue)}, 0, '{"venue_periods":[]}');
\\echo T17_SCHEDULE_SAVED
`

const bookingSql = `
do $$
declare h text;
begin
  begin
    perform * from public.create_booking(${sqlLiteral(ids.court)}, ${sqlLiteral(bookingStartSql)}::timestamptz,
      1, ${sqlLiteral(bookingName)}, ${sqlLiteral(`${ids.slug}@example.test`)}, '09171234567');
    raise exception 'booking unexpectedly accepted against the closed schedule';
  exception when sqlstate 'P0001' then
    get stacked diagnostics h = pg_exception_hint;
    if h <> 'outside_hours' then raise exception 'expected outside_hours, received %', coalesce(h, '<no hint>'); end if;
    raise notice 'T17_BOOKING_REJECTED_OUTSIDE_HOURS';
  end;
end $$;`

let scheduleSession
try {
  await runSql(fixtureSql)
  scheduleSession = psql([], { input: undefined })
  const scheduleReady = waitForLine(scheduleSession, 'T17_SCHEDULE_SAVED')
  scheduleSession.stdin.write(`${scheduleSql}\n`)
  await scheduleReady

  const bookingSession = psql([], { appName: 'plotline_t17_11_booking_race' })
  const bookingDone = finish(bookingSession)
  bookingSession.stdin.end(`${bookingSql}\n\\q\n`)

  let blocked = false
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !blocked) {
    const waitState = await runSql(`select coalesce(wait_event_type = 'Lock' and wait_event = 'advisory', false)
      from pg_stat_activity where application_name = 'plotline_t17_11_booking_race'`)
    blocked = waitState === 't'
    if (!blocked) await new Promise(resolve => setTimeout(resolve, 50))
  }
  if (!blocked) {
    scheduleSession.stdin.write('commit;\\q\n')
    await finish(scheduleSession)
    await bookingDone
    throw new Error('booking did not wait on the schedule transaction advisory lock')
  }

  scheduleSession.stdin.write('commit;\\q\n')
  await finish(scheduleSession)
  await bookingDone
  const bookingCount = await runSql(`select count(*) from public.bookings where guest_name = ${sqlLiteral(bookingName)}`)
  if (bookingCount !== '0') throw new Error('booking committed using a schedule version that the save closed')
  console.log('T17.11 multi-connection race passed: booking waited for save_schedule, then saw the complete closed schedule.')
} finally {
  if (scheduleSession && scheduleSession.exitCode === null) scheduleSession.kill('SIGTERM')
  await runSql(cleanupSql)
}
