// Admin demo video (T21.2): a short, silent, captioned screen recording of an owner running a venue, for the admin
// tour on plotline-site (its T4.2). Run: npm run tour:video. LOCAL stack only; needs ffmpeg on the PATH
// (`brew install ffmpeg`), which turns Playwright's recording into the MP4 and WebM the site serves.
//   node scripts/admin-demo-video.mjs --check   only check the committed files (present, in budget, captions match)
// It runs on the admin tour's demo data (scripts/lib/tour-demo.mjs) and removes it afterwards. The one change it
// saves to the venue itself, Sunday's closing hour, is put back and checked.
// The scenes and captions below are also listed in docs/demo-script.md ("Admin demo (scripted)"): keep them the same.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUT = 'docs/admin-tour'
const SITE_OUT = '../plotline-site/public/admin-tour'
const PORT = 5190
const SIZE = { width: 1280, height: 720 }
const FILES = { mp4: 'admin-demo.mp4', webm: 'admin-demo.webm', poster: 'admin-demo-poster.jpg', captions: 'admin-demo.vtt' }
/** Largest size in bytes for each video file: small enough for a landing page, far under Cloudflare's 25 MiB per file. */
const VIDEO_BUDGET = 6_000_000
const POSTER_BUDGET = 200_000
/** The bottom of the frame the caption bar may cover; click targets are scrolled above it. */
const CAPTION_ROOM = 150
const MIN_SECONDS = 60
const MAX_SECONDS = 90

/** One caption per scene, in order. On screen in the recording and, word for word, in the WebVTT file. */
const CAPTIONS = [
  'Your day at a glance: today’s bookings, payments to check and who is next.',
  'A player sent a payment proof. Open it, check the receipt and confirm the booking.',
  'Rain or repairs? Move a booking to another court or time, and tell the player why.',
  'Change your opening hours whenever you need to. Your booking page updates right away.',
  'Prices by day and hour are yours to set, too.',
  'See what you earned, with Plotline’s booking fee shown apart from your own earnings.',
  'Your courts, your bookings, your money: all in one admin.',
]

const stamp = (seconds) => {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const pad = (n, width = 2) => String(n).padStart(width, '0')
  return `${pad(Math.floor(ms / 3_600_000))}:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`
}
const vtt = (cues) => `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.from)} --> ${stamp(c.to)}\n${c.text}\n`).join('\n')}`

const ffprobeSeconds = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim())

async function checkFiles() {
  const problems = []
  for (const [kind, file] of Object.entries(FILES)) {
    try {
      const { size } = await stat(`${OUT}/${file}`)
      const budget = kind === 'mp4' || kind === 'webm' ? VIDEO_BUDGET : kind === 'poster' ? POSTER_BUDGET : Infinity
      if (size > budget) problems.push(`${file} is ${size} bytes, over its ${budget} byte budget`)
    } catch {
      problems.push(`${file} is missing`)
    }
  }
  if (!problems.length) {
    const text = await readFile(`${OUT}/${FILES.captions}`, 'utf8')
    const cues = text.split('\n\n').slice(1).map((block) => block.trim().split('\n').slice(2).join('\n')).filter(Boolean)
    if (JSON.stringify(cues) !== JSON.stringify(CAPTIONS)) problems.push(`${FILES.captions} does not hold the script's captions, in order`)
  }
  return problems
}

if (process.argv.includes('--check')) {
  const problems = await checkFiles()
  for (const p of problems) console.error(p)
  console.log(problems.length ? 'Admin demo video: NOT OK' : 'Admin demo video: OK (files present, within budget, captions match)')
  process.exit(problems.length ? 1 : 0)
}

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
} catch {
  console.error('ffmpeg and ffprobe are needed to make the MP4 and WebM. Install them first: brew install ffmpeg')
  process.exit(1)
}

// The local-stack modules exit when the stack isn't local, so they load only after the checks above.
const { service, venueDate } = await import('./lib/local-demo.mjs')
const { withTourDemo } = await import('./lib/tour-demo.mjs')

/** Drawn into every page: a caption bar and a pointer, because a Playwright recording shows neither. */
function overlay() {
  const install = () => {
    if (document.getElementById('demo-caption')) return
    const style = document.createElement('style')
    style.textContent = `
      #demo-caption { position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 2147483646; width: max-content; max-width: 1080px;
        padding: 11px 24px; border-radius: 14px; background: rgba(38, 30, 24, 0.94); color: #fffaf2; font: 600 21px/1.35 "DM Sans", system-ui, sans-serif;
        text-align: center; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.28); pointer-events: none; }
      #demo-caption:empty { display: none; }
      #demo-pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%;
        background: rgba(196, 98, 62, 0.45); border: 2px solid #c4623e; pointer-events: none; transition: width .12s, height .12s, margin .12s, background .12s; }
      #demo-pointer.down { width: 40px; height: 40px; margin: -20px 0 0 -20px; background: rgba(196, 98, 62, 0.7); }`
    const caption = document.createElement('div')
    caption.id = 'demo-caption'
    caption.setAttribute('aria-hidden', 'true')
    caption.textContent = sessionStorage.getItem('demo-caption') ?? ''
    const pointer = document.createElement('div')
    pointer.id = 'demo-pointer'
    pointer.setAttribute('aria-hidden', 'true')
    const [x, y] = (sessionStorage.getItem('demo-pointer') ?? '640,360').split(',')
    pointer.style.transform = `translate(${x}px, ${y}px)`
    document.body.append(style, caption, pointer)
    addEventListener('mousemove', (e) => {
      pointer.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
      sessionStorage.setItem('demo-pointer', `${e.clientX},${e.clientY}`)
    }, true)
    addEventListener('mousedown', () => pointer.classList.add('down'), true)
    addEventListener('mouseup', () => setTimeout(() => pointer.classList.remove('down'), 180), true)
  }
  if (document.body) install()
  else document.addEventListener('DOMContentLoaded', install)
}

/** The venue's own weekly hours, as plain rows to compare before and after. */
async function venueHours(venueId) {
  const { data } = await service.from('venue_open_periods').select('day_of_week, start_minute, end_minute').eq('venue_id', venueId).throwOnError()
  return JSON.stringify(data.map((r) => [r.day_of_week, r.start_minute, r.end_minute]).sort())
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const work = await mkdtemp(join(tmpdir(), 'admin-demo-'))
  let raw = null
  const cues = []
  let started = 0

  await withTourDemo({ port: PORT, extras: true }, async ({ BASE, extra, newContext, signedIn }) => {
    const { data: venue } = await service.from('venues').select('id').eq('slug', 'claudex-courts').single().throwOnError()
    const hoursBefore = await venueHours(venue.id)
    // Sunday (day 0) closes when its last open period ends; the recording moves it one hour later and back.
    const sundayCloses = Math.max(...JSON.parse(hoursBefore).filter(([day]) => day === 0).map(([, , end]) => end)) / 60
    if (!Number.isInteger(sundayCloses) || sundayCloses > 23) throw new Error(`Sunday closes at ${sundayCloses}:00 here: the recording needs a Sunday that closes on the hour, at 11 PM or earlier.`)

    // Sign in off camera, so the recording opens on the dashboard.
    const login = await signedIn({ viewport: SIZE, deviceScaleFactor: 1 })
    const storageState = await login.context.storageState()
    await login.context.close()

    const context = await newContext({ viewport: SIZE, deviceScaleFactor: 1 }, { storageState, recordVideo: { dir: work, size: SIZE } })
    await context.addInitScript(overlay)
    started = Date.now()
    const page = await context.newPage()
    const pause = (ms) => page.waitForTimeout(ms)
    const now = () => (Date.now() - started) / 1000

    async function caption(index) {
      if (cues.length) cues.at(-1).to = now()
      cues.push({ from: now(), to: 0, text: CAPTIONS[index] })
      await page.evaluate((text) => {
        sessionStorage.setItem('demo-caption', text)
        const el = document.getElementById('demo-caption')
        if (el) el.textContent = text
      }, CAPTIONS[index])
    }
    /** Moves the pointer to the element at a human pace, so the viewer can follow it. */
    async function pointAt(locator) {
      await locator.scrollIntoViewIfNeeded()
      // Keep the target clear of the caption bar at the bottom of the frame.
      const placed = await locator.boundingBox()
      const low = placed.y + placed.height - (SIZE.height - CAPTION_ROOM)
      if (low > 0) await scrollBy(low + 40, 10)
      await pause(250)
      const box = await locator.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 })
      await pause(350)
    }
    async function click(locator) {
      await pointAt(locator)
      await locator.click()
    }
    async function scrollBy(pixels, steps = 24) {
      for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, pixels / steps)
        await pause(28)
      }
    }
    const nav = (name) => page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name })

    try {
      // 1. The dashboard today.
      await page.goto(`${BASE}/admin`)
      await page.getByRole('heading', { name: "Today's courts" }).waitFor()
      await page.waitForLoadState('networkidle').catch(() => {})
      await caption(0)
      await pause(3500)
      await scrollBy(620)
      await pause(3200)
      await scrollBy(-620)
      await pause(800)

      // 2. Bookings: approve a payment proof.
      await caption(1)
      await click(nav('Bookings'))
      await page.getByRole('heading', { name: 'Bookings', level: 1 }).waitFor()
      const search = page.getByRole('searchbox', { name: 'Search' })
      await click(search)
      await search.pressSequentially(extra.proof.reference_code, { delay: 70 })
      await click(page.getByRole('button', { name: 'Search', exact: true }))
      // A search with one result opens that booking by itself.
      const approve = page.getByRole('button', { name: 'Approve and confirm' })
      await approve.waitFor()
      await page.getByText('Loading proof…').waitFor({ state: 'detached' })
      await pointAt(approve)
      await pause(2600)
      await click(approve)
      await page.getByRole('status').filter({ hasText: `${extra.proof.reference_code} is confirmed` }).waitFor()
      await scrollBy(-600, 14) // back up to the confirmation message and the Confirmed badge
      await pause(2800)

      // 3. Move a booking, with a reason.
      await caption(2)
      // Tomorrow's bookings, all statuses (the booking is tomorrow: the server only moves what hasn't been played).
      await page.goto(`${BASE}/admin/bookings?status=all&date=${venueDate(1)}`)
      await click(page.getByRole('button', { name: new RegExp(extra.move.reference_code) }))
      await click(page.getByRole('button', { name: 'Reschedule' }))
      const form = page.getByRole('form', { name: 'Reschedule booking' })
      await click(form.getByRole('button', { name: 'Tomorrow' }))
      await pointAt(form.getByLabel('New court'))
      await form.getByLabel('New court').selectOption({ label: 'Pickleball 1' })
      await pause(900)
      await click(form.getByRole('group', { name: 'New start' }).locator('label').filter({ hasText: /^4 PM/ }))
      const reason = form.getByLabel('Reason for moving')
      await click(reason)
      await reason.pressSequentially('Rain: the court is wet', { delay: 55 })
      await pause(700)
      await click(form.getByRole('button', { name: 'Move booking' }))
      await page.getByRole('status').filter({ hasText: new RegExp(`${extra.move.reference_code} moved to Pickleball 1`) }).waitFor()
      await pause(2600)

      // 4. Schedule: a later closing time on Sunday, saved.
      await caption(3)
      await click(nav('Schedule'))
      await page.getByRole('switch', { name: 'Monday open' }).waitFor()
      const closes = page.getByLabel('Sunday closes')
      await pointAt(closes)
      await closes.selectOption(String(sundayCloses + 1))
      await pause(1400)
      await click(page.getByRole('button', { name: 'Review & save' }))
      const dialog = page.getByRole('dialog', { name: 'Review changes' })
      await dialog.waitFor()
      await pause(2200)
      await click(dialog.getByRole('button', { name: 'Save changes' }))
      await page.getByRole('region', { name: 'Unsaved changes' }).waitFor({ state: 'detached' })
      await pause(1500)

      // 5. Prices.
      await caption(4)
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await click(page.getByRole('tab', { name: 'Prices' }))
      await pause(2200)
      await scrollBy(360)
      await pause(2600)

      // 6. Earnings, this month.
      await caption(5)
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await click(nav('Dashboard'))
      const earnings = page.getByRole('region', { name: 'Earnings' })
      await click(earnings.getByRole('button', { name: 'This month' }))
      await earnings.getByRole('list', { name: 'Collected per day' }).waitFor()
      await pause(1200)
      await scrollBy(430)
      await pause(4200)

      // 7. The closing line.
      await caption(6)
      await scrollBy(-430)
      await pause(4200)
      cues.at(-1).to = now()
    } finally {
      const video = page.video()
      await context.close()
      raw = await video.path()

      // Put Sunday's closing hour back, off camera, and check the venue's hours are what they were.
      if ((await venueHours(venue.id)) !== hoursBefore) {
        const restore = await signedIn({ viewport: SIZE, deviceScaleFactor: 1 })
        await restore.page.goto(`${BASE}/admin/schedule`)
        await restore.page.getByRole('switch', { name: 'Monday open' }).waitFor()
        await restore.page.getByLabel('Sunday closes').selectOption(String(sundayCloses))
        await restore.page.getByRole('button', { name: 'Review & save' }).click()
        await restore.page.getByRole('dialog', { name: 'Review changes' }).getByRole('button', { name: 'Save changes' }).click()
        await restore.page.getByRole('region', { name: 'Unsaved changes' }).waitFor({ state: 'detached' })
        await restore.context.close()
      }
      if ((await venueHours(venue.id)) !== hoursBefore) {
        console.error('The venue\'s opening hours were NOT restored: set Sunday\'s closing hour back on /admin/schedule.')
        process.exitCode = 1
      } else {
        console.log('Opening hours checked: as they were before the recording.')
      }
    }
  })
  if (process.exitCode) return

  // Cut the loading frames before the first caption, then encode. Cue times move by the same amount.
  const trim = Math.max(0, cues[0].from - 0.4)
  const shifted = cues.map((c) => ({ ...c, from: c.from - trim, to: c.to - trim }))
  const input = ['-y', '-loglevel', 'error', '-ss', String(trim), '-i', raw]
  execFileSync('ffmpeg', [...input, '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-r', '25', '-movflags', '+faststart', `${OUT}/${FILES.mp4}`])
  execFileSync('ffmpeg', [...input, '-an', '-c:v', 'libvpx-vp9', '-crf', '38', '-b:v', '0', '-r', '25', '-row-mt', '1', `${OUT}/${FILES.webm}`])
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '2', '-i', `${OUT}/${FILES.mp4}`, '-frames:v', '1', '-q:v', '4', `${OUT}/${FILES.poster}`])
  await writeFile(`${OUT}/${FILES.captions}`, vtt(shifted))
  await rm(work, { recursive: true, force: true })

  const seconds = ffprobeSeconds(`${OUT}/${FILES.mp4}`)
  console.log(`Recorded ${seconds.toFixed(1)} s.`)
  const problems = await checkFiles()
  if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) problems.push(`the video is ${seconds.toFixed(1)} s, outside ${MIN_SECONDS}–${MAX_SECONDS} s`)
  for (const p of problems) console.error(p)
  if (problems.length) process.exitCode = 1
  if (existsSync('../plotline-site')) {
    await mkdir(SITE_OUT, { recursive: true })
    for (const file of Object.values(FILES)) await copyFile(`${OUT}/${file}`, `${SITE_OUT}/${file}`)
    console.log(`Copied ${Object.values(FILES).length} files to ${SITE_OUT}/`)
  } else {
    console.log('../plotline-site is not checked out: the files were not copied. Copy docs/admin-tour/admin-demo* to public/admin-tour/ there.')
  }
}

await main()
