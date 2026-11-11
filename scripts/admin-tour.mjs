// Admin tour screenshots (T21.1): real pictures of the admin pages for plotline-site's admin tour (its T4.1).
// Run: npm run tour:shots. LOCAL stack only (`npx supabase start`); it starts its own Vite dev server.
//   npm run tour:shots              capture, then copy to ../plotline-site/public/admin-tour/ when that repo is checked out
//   node scripts/admin-tour.mjs --check   only check that the committed files exist and fit the size budget
// For the run it adds synthetic demo data (made-up names, e2e-tour-… emails, a ₱10 booking fee, generated court
// illustrations, never third-party photos), and afterwards removes all of it and checks that it is gone.
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { withTourDemo } from './lib/tour-demo.mjs'

const OUT = 'docs/admin-tour'
const SITE_OUT = '../plotline-site/public/admin-tour'
const PORT = 5189

/** The files plotline-site relies on. Names are stable; `budget` is the largest size in bytes a landing page can afford. */
const DESKTOP_BUDGET = 230_000
const PHONE_BUDGET = 260_000
const FILES = [
  ...['dashboard', 'earnings', 'bookings', 'schedule', 'open-play', 'courts', 'reports', 'settings'].map((name) => `${name}-desktop.png`),
  ...['dashboard', 'bookings'].map((name) => `${name}-phone.png`),
]
const budgetOf = (file) => (file.endsWith('-phone.png') ? PHONE_BUDGET : DESKTOP_BUDGET)

async function checkFiles(dir = OUT) {
  const problems = []
  for (const file of FILES) {
    try {
      const { size } = await stat(`${dir}/${file}`)
      if (size > budgetOf(file)) problems.push(`${file} is ${size} bytes, over its ${budgetOf(file)} byte budget`)
    } catch {
      problems.push(`${file} is missing`)
    }
  }
  return problems
}

if (process.argv.includes('--check')) {
  const problems = await checkFiles()
  for (const p of problems) console.error(p)
  console.log(problems.length ? 'Admin tour files: NOT OK' : `Admin tour files: OK (${FILES.length} files within budget)`)
  process.exit(problems.length ? 1 : 0)
}

const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }
const PHONE = { viewport: { width: 360, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

async function main() {
  await mkdir(OUT, { recursive: true })
  await withTourDemo({ port: PORT }, async ({ BASE, today, firstBooking, proofBooking, signedIn, top, scrollTo }) => {
    const shoot = async (page, file) => {
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.screenshot({ path: `${OUT}/${file}` })
      console.log(`  ${file}`)
    }
    const desktop = await signedIn(DESKTOP)
    const page = desktop.page
    console.log('desktop:')
    await top(page)
    await shoot(page, 'dashboard-desktop.png')
    const earnings = page.getByRole('region', { name: 'Earnings' })
    await earnings.getByRole('button', { name: 'This month' }).click()
    await earnings.getByRole('list', { name: 'Collected per day' }).waitFor()
    await scrollTo(earnings)
    await shoot(page, 'earnings-desktop.png')

    await page.goto(`${BASE}/admin/bookings?status=all&date=${today}`)
    await page.getByRole('button', { name: new RegExp(proofBooking.reference_code) }).click()
    await page.getByRole('button', { name: /Approve/ }).first().waitFor()
    // The list from its first row down, so the proof, its receipt and the Approve button are all in view.
    await scrollTo(page.getByRole('button', { name: new RegExp(firstBooking.reference_code) }), 12)
    await shoot(page, 'bookings-desktop.png')

    await page.goto(`${BASE}/admin/schedule`)
    await page.getByRole('heading', { name: 'Schedule' }).waitFor()
    await scrollTo(page.getByRole('heading', { name: 'Week at a glance' }), 24)
    await shoot(page, 'schedule-desktop.png')

    await page.goto(`${BASE}/admin/open-play`)
    await page.getByText('Open play: all levels').first().waitFor()
    await scrollTo(page.getByRole('heading', { name: 'Upcoming sessions' }), 80)
    await shoot(page, 'open-play-desktop.png')

    await page.goto(`${BASE}/admin/courts`)
    await page.getByRole('heading', { name: 'Courts', level: 1 }).waitFor()
    await shoot(page, 'courts-desktop.png')

    await page.goto(`${BASE}/admin/reports`)
    await page.getByRole('heading', { name: 'Statement' }).waitFor()
    await shoot(page, 'reports-desktop.png')

    await page.goto(`${BASE}/admin/settings`)
    await page.getByRole('heading', { name: 'Venue settings' }).waitFor()
    await shoot(page, 'settings-desktop.png')
    await desktop.context.close()

    const phone = await signedIn(PHONE)
    console.log('phone:')
    await top(phone.page)
    await shoot(phone.page, 'dashboard-phone.png')
    await phone.page.goto(`${BASE}/admin/bookings?status=all&date=${today}`)
    await phone.page.getByRole('button', { name: new RegExp(proofBooking.reference_code) }).click()
    await phone.page.getByRole('button', { name: /Approve/ }).first().waitFor()
    // From the booking's own card (its reference and status), below the phone's sticky header.
    await scrollTo(phone.page.locator('.card', { has: phone.page.getByRole('heading', { name: 'Proof waiting for review' }) }).first(), 72)
    await shoot(phone.page, 'bookings-phone.png')
    await phone.context.close()
  })

  const problems = await checkFiles()
  for (const p of problems) console.error(p)
  if (problems.length) process.exitCode = 1
  if (existsSync('../plotline-site')) {
    await mkdir(SITE_OUT, { recursive: true })
    for (const file of await readdir(OUT)) if (FILES.includes(file)) await copyFile(`${OUT}/${file}`, `${SITE_OUT}/${file}`)
    console.log(`Copied ${FILES.length} files to ${SITE_OUT}/`)
  } else {
    console.log('../plotline-site is not checked out: the files were not copied. Copy docs/admin-tour/*.png to public/admin-tour/ there.')
  }
}

await main()
