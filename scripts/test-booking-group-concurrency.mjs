// T33.1: prove two group checkouts that name the same two courts in opposite order can't deadlock, and only one wins.
// create_booking_group takes the per-court slot locks in sorted court-id order. The race is forced: a helper session
// holds the lower court's lock, both checkouts queue behind it (T1 sends [low, high], T2 sends [high, low]), then the
// helper lets go. Locking in the order sent would deadlock here (T1 holds low and wants high, T2 holds high and wants
// low); sorted locking makes T2 wait for T1, which books both courts, and T2 is then refused with slot_unavailable.
// Invoked only by scripts/test-db.sh; never reads the linked project's connection details.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const projectId = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8')
  .match(/^project_id\s*=\s*"([^"]+)"/m)?.[1]
if (!projectId) throw new Error('Could not determine the local Supabase project id')
const container = `supabase_db_${projectId}`
// Postgres orders uuids by their bytes, which is the order of their lowercase hex text.
const [courtLow, courtHigh] = [randomUUID(), randomUUID()].sort()
const ids = {
  venue: randomUUID(),
  slug: `t33-1-race-${randomUUID().slice(0, 8)}`,
}
const start = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
start.setUTCHours(2, 0, 0, 0) // 10:00 in the fixture's Asia/Manila timezone.
const startSql = start.toISOString()
const appName = label => `plotline_t33_1_${label}`

function psql(args, { appName: name } = {}) {
  const dockerArgs = ['exec', '-i']
  if (name) dockerArgs.push('-e', `PGAPPNAME=${name}`)
  dockerArgs.push(container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', ...args)
  return spawn('docker', dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] })
}

function collect(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }))
  })
}

async function runSql(sql) {
  const child = psql(['-c', sql])
  const { code, stdout, stderr } = await collect(child)
  if (code !== 0) throw new Error(stderr || `psql exited ${code}`)
  return stdout
}

function waitForLine(child, marker) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${marker}; output: ${output}`)), 10000)
    child.stdout.setEncoding('utf8').on('data', chunk => {
      output += chunk
      if (output.includes(marker)) {
        clearTimeout(timer)
        resolve(output)
      }
    })
    child.on('error', error => { clearTimeout(timer); reject(error) })
  })
}

async function waitUntilBlocked(name) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const state = await runSql(`select coalesce(bool_or(wait_event_type = 'Lock' and wait_event = 'advisory'), false)
      from pg_stat_activity where application_name = '${name}'`)
    if (state === 't') return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`${name} did not wait on the court slot advisory lock`)
}

const lit = value => `'${value.replaceAll("'", "''")}'`
const items = courts => lit(JSON.stringify(courts.map(c => ({ court_id: c, start: startSql, slots: 1 }))))

const fixtureSql = `
begin;
insert into public.venues (id, slug, status) values (${lit(ids.venue)}, ${lit(ids.slug)}, 'active');
insert into public.venue_settings (venue_id, name, timezone) values (${lit(ids.venue)}, 'T33.1 group race', 'Asia/Manila');
insert into public.courts (id, venue_id, name, sport, default_hourly_rate) values
  (${lit(courtLow)}, ${lit(ids.venue)}, 'T33.1 race low', 'tennis', 300),
  (${lit(courtHigh)}, ${lit(ids.venue)}, 'T33.1 race high', 'tennis', 300);
insert into public.venue_open_periods (venue_id, day_of_week, start_minute, end_minute)
select ${lit(ids.venue)}, d, 360, 1200 from generate_series(0, 6) d;
update public.venue_schedule_state set schedule_v2_active = true where venue_id = ${lit(ids.venue)};
commit;`

const cleanupSql = `
delete from public.email_outbox where venue_id = ${lit(ids.venue)};
delete from public.payments where venue_id = ${lit(ids.venue)};
delete from public.bookings where venue_id = ${lit(ids.venue)};
delete from public.booking_groups where venue_id = ${lit(ids.venue)};
delete from public.courts where venue_id = ${lit(ids.venue)};
delete from public.venue_settings where venue_id = ${lit(ids.venue)};
delete from public.venues where id = ${lit(ids.venue)};`

// One group checkout as a guest, reporting its outcome as a NOTICE line: OK, HINT:<hint> or SQLSTATE:<state>.
const checkoutSql = (label, courts) => `
set role anon;
set request.jwt.claims = '{"role":"anon"}';
do $$
declare h text; s text;
begin
  perform * from public.create_booking_group(${items(courts)}::jsonb, 'T33.1 race ${label}',
    'e2e-t33-1-race-${label}@example.com', null, true);
  raise notice 'T33_${label}=OK';
exception when others then
  get stacked diagnostics h = pg_exception_hint, s = returned_sqlstate;
  raise notice 'T33_${label}=%', case when s = 'P0001' then 'HINT:' || coalesce(h, '') else 'SQLSTATE:' || s end;
end $$;`

const outcomeOf = (label, result) => result.stderr.match(new RegExp(`T33_${label}=(\\S+)`))?.[1] ?? `none (exit ${result.code}: ${result.stderr})`

let holder
try {
  await runSql(fixtureSql)

  holder = psql([], { appName: appName('holder') })
  const held = waitForLine(holder, 'T33_LOW_HELD')
  holder.stdin.write(`begin;\nselect private.lock_court_slots(${lit(courtLow)});\n\\echo T33_LOW_HELD\n`)
  await held

  const first = psql([], { appName: appName('t1') })
  const firstDone = collect(first)
  first.stdin.end(`${checkoutSql('T1', [courtLow, courtHigh])}\n\\q\n`)
  await waitUntilBlocked(appName('t1'))

  const second = psql([], { appName: appName('t2') })
  const secondDone = collect(second)
  second.stdin.end(`${checkoutSql('T2', [courtHigh, courtLow])}\n\\q\n`)
  await waitUntilBlocked(appName('t2'))

  holder.stdin.end('commit;\n\\q\n')
  await collect(holder)
  const [r1, r2] = await Promise.all([firstDone, secondDone])
  const outcomes = [outcomeOf('T1', r1), outcomeOf('T2', r2)]

  if (outcomes.some(o => o.includes('40P01'))) throw new Error(`deadlock: ${outcomes.join(', ')}`)
  if (outcomes.filter(o => o === 'OK').length !== 1 || !outcomes.includes('HINT:slot_unavailable')) {
    throw new Error(`expected one OK and one slot_unavailable, got ${outcomes.join(', ')}`)
  }
  const counts = await runSql(`select (select count(*) from public.bookings where venue_id = ${lit(ids.venue)})
    || ',' || (select count(*) from public.booking_groups where venue_id = ${lit(ids.venue)})`)
  if (counts !== '2,1') throw new Error(`expected 2 bookings in 1 group, found ${counts} (bookings,groups)`)
  console.log(`T33.1 group checkout race passed: opposite court order, no deadlock; ${outcomes.join(', ')}; one group of 2 bookings.`)
} finally {
  if (holder && holder.exitCode === null) holder.kill('SIGTERM')
  await runSql(cleanupSql)
}
