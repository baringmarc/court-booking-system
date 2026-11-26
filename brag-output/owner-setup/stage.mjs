// The stage for the recording: the app served from an origin/master worktree (only deployed code is filmed), a fresh
// Dinkhaus draft with its owner invited, and a desktop browser. Run from the repo root, inside
// `node scripts/with-lock.mjs …` so no test run shares the local stack meanwhile.
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { env } from '../../scripts/lib/local-demo.mjs'
import { SLUG, createDraft, drawAssets, removeVenue } from './demo-venue.mjs'

export const PORT = 5192
// The recording browser maps the venue's production address to the local dev server (Chrome's host resolver rules,
// HTTPS with a throwaway self-signed certificate it is told to accept), so every address the app prints reads as it
// does in production. Nothing outside that browser is affected.
export const HOST = `${SLUG}.plotline.fit`
export const BASE = `https://${HOST}`
export const TZ = 'Asia/Manila'
export const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }
const here = new URL('.', import.meta.url).pathname
export const REC = `${here}rec`

/** A detached worktree at origin/master (fetched first), with its own node_modules. */
export function masterWorktree() {
  const root = resolve(here, '../..')
  const dir = process.env.PLOTLINE_MASTER_WORKTREE ?? join(process.env.TMPDIR ?? tmpdir(), 'plotline-master')
  execFileSync('git', ['fetch', '-q', 'origin', 'master'], { cwd: root })
  if (!existsSync(dir)) execFileSync('git', ['worktree', 'add', '-q', '--detach', dir, 'origin/master'], { cwd: root })
  execFileSync('git', ['checkout', '-q', '--detach', 'origin/master'], { cwd: dir })
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: dir, encoding: 'utf8' }).trim()
  if (dirty) throw new Error(`The master worktree ${dir} has local changes:\n${dirty}`)
  // The worktree gets its own install from master's lockfile (the repo's node_modules can lag behind it: master added
  // `qrcode` in M34), redone whenever that lockfile changes.
  const modules = join(dir, 'node_modules')
  if (existsSync(modules) && lstatSync(modules).isSymbolicLink()) unlinkSync(modules)
  const lock = readFileSync(join(dir, 'package-lock.json'), 'utf8')
  const stamp = join(modules, '.owner-setup-lock')
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== lock) {
    console.log('Installing master\'s dependencies in the worktree (npm ci)…')
    execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit' })
    writeFileSync(stamp, lock)
  }
  const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim()
  return { dir, commit }
}

/** Serves master, makes the Dinkhaus draft and its invite, runs `run(stage)`, and always removes it all. */
export async function withStage(run) {
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
    server: { port: PORT, strictPort: true, host: '127.0.0.1', https, allowedHosts: [HOST], fs: { allow: [dir, realpathSync(dir), resolve(here, '../../node_modules'), here] } },
    cacheDir: join(dir, 'node_modules/.vite-owner-setup'),
  })
  await server.listen()
  // Chrome's screencast sends frames at CSS-pixel size unless the whole browser runs at a device scale factor (2×).
  // The images the owner uploads are drawn in a plain browser at 1×, so they stay within the buckets' size limits.
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
      } else console.log('Cleanup checked: Dinkhaus, its owner and its data are gone, the booking fee is back.')
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
    const assets = await drawAssets(helper)
    const { venueId, inviteUrl } = await createDraft(BASE)
    const newContext = (options = {}) => browser.newContext({ ...DESKTOP, timezoneId: TZ, locale: 'en-PH', colorScheme: 'light', ignoreHTTPSErrors: true, ...options })
    await run({ BASE, venueId, inviteUrl, assets, newContext, helper, commit, worktree: dir })
  } finally {
    await cleanup()
  }
}
