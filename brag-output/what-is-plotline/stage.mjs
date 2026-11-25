// The stage for the recording: the app served from an origin/master worktree (only deployed code is filmed), the
// Dinkhaus venue around a run, and browser contexts for the phone and the desktop. Run from the repo root, inside
// `node scripts/with-lock.mjs …` so no test run shares the local stack meanwhile.
import { execFileSync } from 'node:child_process'
import { existsSync, symlinkSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { env } from '../../scripts/lib/local-demo.mjs'
import { SLUG, createVenue, finishVenue, removeVenue } from './demo-venue.mjs'

export const PORT = 5191
// The recording browser maps the venue's production address to the local dev server (Chrome's host resolver rules,
// HTTPS with a throwaway self-signed certificate it is told to accept), so every address the app prints (the booking
// link, the open-slots caption) reads as it does in production. Nothing outside that browser is affected.
export const HOST = `${SLUG}.plotline.fit`
export const BASE = `https://${HOST}`
export const TZ = 'Asia/Manila'
// 390 × 760 plus the frame's status bar and address bar in index.html make an iPhone-shaped 390 × 844 screen.
export const PHONE = { viewport: { width: 390, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
export const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }
const here = new URL('.', import.meta.url).pathname
export const REC = `${here}rec`

/** A detached worktree at origin/master (fetched first), sharing the repo's node_modules. */
function masterWorktree() {
  const root = resolve(here, '../..')
  const dir = process.env.PLOTLINE_MASTER_WORKTREE ?? join(process.env.TMPDIR ?? tmpdir(), 'plotline-master')
  execFileSync('git', ['fetch', '-q', 'origin', 'master'], { cwd: root })
  if (!existsSync(dir)) execFileSync('git', ['worktree', 'add', '-q', '--detach', dir, 'origin/master'], { cwd: root })
  execFileSync('git', ['checkout', '-q', '--detach', 'origin/master'], { cwd: dir })
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: dir, encoding: 'utf8' }).trim()
  if (dirty) throw new Error(`The master worktree ${dir} has local changes:\n${dirty}`)
  if (!existsSync(join(dir, 'node_modules'))) symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'))
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  return { dir, commit }
}

/** Serves master, makes Dinkhaus (draft, then finished after `beforeFinish`), runs `run`, and always removes it all. */
export async function withStage({ beforeFinish, run }) {
  await mkdir(REC, { recursive: true })
  const { dir, commit } = masterWorktree()
  console.log(`Serving origin/master at ${commit} from ${dir}`)
  process.env.VITE_SUPABASE_URL = env.API_URL
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = env.PUBLISHABLE_KEY
  const tls = `${REC}/tls`
  if (!existsSync(`${tls}/cert.pem`)) {
    await mkdir(tls, { recursive: true })
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${tls}/key.pem`, '-out', `${tls}/cert.pem`, '-days', '365',
      '-subj', `/CN=${HOST}`, '-addext', `subjectAltName=DNS:${HOST}`], { stdio: 'ignore' })
  }
  const https = { key: await readFile(`${tls}/key.pem`), cert: await readFile(`${tls}/cert.pem`) }
  const server = await createServer({
    root: dir, configFile: join(dir, 'vite.config.ts'), logLevel: 'error',
    server: { port: PORT, strictPort: true, host: '127.0.0.1', https, allowedHosts: [HOST], fs: { allow: [dir, resolve(here, '../../node_modules')] } },
  })
  await server.listen()
  // Chrome's screencast sends frames at CSS-pixel size unless the whole browser runs at a device scale factor, so the
  // recording browser gets the flag (2×, matching both devices). Images for the venue are drawn in a plain browser,
  // at 1×, so the uploads stay within the buckets' size limits.
  const browser = await chromium.launch({ args: ['--force-device-scale-factor=2', `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${PORT}`] })
  const drawing = await chromium.launch()
  const helper = await drawing.newPage()
  let cleaned = false
  async function cleanup() {
    if (cleaned) return
    cleaned = true
    try {
      const left = await removeVenue()
      if (left.length) {
        console.error(`Cleanup left: ${left.join(', ')}`)
        process.exitCode = 1
      } else console.log('Cleanup checked: Dinkhaus and its data are gone, the booking fee is back.')
    } finally {
      await browser.close().catch(() => {})
      await drawing.close().catch(() => {})
      await server.close().catch(() => {})
    }
  }
  process.once('SIGINT', () => {
    console.error('Interrupted: removing Dinkhaus…')
    cleanup().finally(() => process.exit(130))
  })
  try {
    const { venueId, owner } = await createVenue(helper)
    const newContext = (device, options = {}) => browser.newContext({ ...device, timezoneId: TZ, locale: 'en-PH', colorScheme: 'light', ignoreHTTPSErrors: true, ...options })
    async function signIn(device) {
      const context = await newContext(device)
      const page = await context.newPage()
      // A draft venue is invisible until its staff sign in, so /admin shows "Staff sign in" (VenueProvider).
      await page.goto(`${BASE}/admin`)
      await page.getByLabel('Email').fill(owner.email)
      await page.getByLabel('Password').fill(owner.password)
      await page.getByRole('button', { name: /^(Log in|Sign in)$/ }).click()
      await page.getByRole('navigation', { name: 'Admin' }).waitFor()
      const state = await context.storageState()
      await context.close()
      return state
    }
    const ownerState = await signIn(DESKTOP)
    const stage = { BASE, venueId, owner, ownerState, helper, newContext, commit }
    if (beforeFinish) await beforeFinish(stage)
    stage.data = await finishVenue(helper, venueId)
    await run(stage)
  } finally {
    await cleanup()
  }
}
