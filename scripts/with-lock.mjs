#!/usr/bin/env node
// Runs a command while holding the local-stack lock, so two test runs never share the local database,
// port or test-results/ at the same time (the cause of the false pgTAP and "port already used" failures).
//
//   node scripts/with-lock.mjs <command> [args…]
//
// If another run holds the lock, this one waits (up to 15 minutes) and says who it's waiting for.
// A lock whose process is gone is taken over automatically.

import { spawn } from 'node:child_process'
import { mkdirSync, openSync, readFileSync, rmSync, writeSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lockPath = join(root, '.claude', 'state', 'local-stack.lock')
const WAIT_MS = 15 * 60 * 1000
const POLL_MS = 2000

const [cmd, ...args] = process.argv.slice(2)
if (!cmd) {
  console.error('Usage: node scripts/with-lock.mjs <command> [args…]')
  process.exit(2)
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e.code === 'EPERM'
  }
}

function tryAcquire() {
  mkdirSync(dirname(lockPath), { recursive: true })
  try {
    const fd = openSync(lockPath, 'wx')
    writeSync(fd, JSON.stringify({ pid: process.pid, cmd: [cmd, ...args].join(' '), since: new Date().toISOString() }))
    closeSync(fd)
    return null
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
    let holder
    try {
      holder = JSON.parse(readFileSync(lockPath, 'utf8'))
    } catch {
      return { cmd: 'unknown (lock being written)' }
    }
    if (!alive(holder.pid)) {
      rmSync(lockPath, { force: true }) // stale: its process is gone
      return tryAcquire()
    }
    return holder
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const start = Date.now()
let holder = tryAcquire()
if (holder) console.error(`[with-lock] Waiting for another run to finish: ${holder.cmd} (pid ${holder.pid}, since ${holder.since})`)
while (holder) {
  if (Date.now() - start > WAIT_MS) {
    console.error(`[with-lock] Gave up after ${WAIT_MS / 60000} minutes waiting for: ${holder.cmd}. Is it stuck? Check \`pgrep -fl "[p]laywright|[s]upabase test"\`.`)
    process.exit(1)
  }
  await sleep(POLL_MS)
  holder = tryAcquire()
}

const release = () => {
  try {
    const current = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (current.pid === process.pid) rmSync(lockPath, { force: true })
  } catch {
    // already gone
  }
}

const child = spawn(cmd, args, { cwd: process.cwd(), stdio: 'inherit', shell: process.platform === 'win32' })
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
child.on('exit', (code, signal) => {
  release()
  process.exit(code ?? (signal ? 1 : 0))
})
child.on('error', (e) => {
  release()
  console.error(`[with-lock] ${e.message}`)
  process.exit(1)
})
