// Records the app footage for the setup walkthrough on the LOCAL stack, from origin/master, with the fictional
// Dinkhaus venue: the owner opens the invite email, chooses a password and sets the venue up from an empty draft to
// published, then tours Settings and the day-to-day pages.
//   node scripts/with-lock.mjs node brag-output/owner-setup/record.mjs
// One take per chapter (rec/<chapter>/: JPEG frames and take.json). Each narration line's pictures start at the mark
// with its id, and the actions are paced to the line's voice (rec/voice/durations.json, so run voice.py first).
// Dinkhaus, its owner and everything they made are removed afterwards (checked).
import { readFileSync } from 'node:fs'
import { overlayScript, record } from './recorder.mjs'
import { REC, withStage } from './stage.mjs'
import { NAME, OWNER, addExampleBookings } from './demo-venue.mjs'
import { inboxHtml } from './inbox.mjs'

const SIZE = { maxWidth: 2560, maxHeight: 1600, quality: 86 }
const VOICE = JSON.parse(readFileSync(new URL('rec/voice/durations.json', import.meta.url), 'utf8')).seconds
const Z = 1.45 // the camera's zoom on a form field or button
const MAIL = 'https://mail.example.com/inbox'

/** Actions at a human pace, with the camera following them. */
function actor(page, rec) {
  const pause = (ms) => page.waitForTimeout(ms)
  let lineStart = 0, lineId = null
  /** Starts a narration line: its mark, and a clock for `rest`. */
  function line(id) {
    if (!(id in VOICE)) throw new Error(`No voice for ${id}`)
    rec.mark(id)
    lineId = id
    lineStart = Date.now()
  }
  /** Waits out the rest of the current line's voice (plus `extra` seconds), so the next line starts on new pictures. */
  async function rest(extra = 0.35) {
    const left = (VOICE[lineId] + extra) * 1000 - (Date.now() - lineStart)
    if (left > 0) await pause(left)
  }
  async function box(locator) {
    const b = await locator.boundingBox()
    if (!b) throw new Error(`No box for ${locator}`)
    return b
  }
  async function look(locator, s = Z) {
    await locator.evaluate((el) => {
      const r = el.getBoundingClientRect()
      if (r.top < 70 || r.bottom > innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    await pause(450)
    const b = await box(locator)
    // Never zoom past what fits the element (with a margin), and never below the whole page.
    const fit = Math.max(1, Math.min(s, 1160 / b.width, 640 / b.height))
    rec.focus(b.x + b.width / 2, b.y + b.height / 2, fit)
    return b
  }
  const wide = () => rec.focus(640, 400, 1)
  async function pointAt(locator, s = Z) {
    const b = await look(locator, s)
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 24 })
    await pause(280)
  }
  async function act(locator, s = Z) {
    await pointAt(locator, s)
    rec.tap()
    await locator.click()
  }
  async function type(locator, text, s = Z) {
    await act(locator, s)
    await locator.pressSequentially(text, { delay: 50 })
    await pause(200)
  }
  async function select(locator, label, s = Z) {
    await act(locator, s)
    await locator.selectOption({ label })
    await page.keyboard.press('Escape').catch(() => {})
    await pause(300)
  }
  async function upload(input, target, files, s = Z) {
    await pointAt(target, s)
    await input.setInputFiles(files)
  }
  async function nav(name) {
    await act(page.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name, exact: true }), 1.2)
  }
  const scrollBy = async (top) => {
    await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), top)
    await pause(700)
  }
  const toTop = async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await pause(600)
  }
  return { pause, line, rest, look, wide, pointAt, act, type, select, upload, nav, scrollBy, toTop }
}

await withStage(async (stage) => {
  const { BASE, assets } = stage
  const ctx = await stage.newContext()
  await ctx.addInitScript(overlayScript, 'mouse')
  const html = await inboxHtml({ worktree: stage.worktree, base: BASE, inviteUrl: stage.inviteUrl, venueName: NAME })
  await ctx.route(MAIL, (route) => route.fulfill({ contentType: 'text/html', body: html }))
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(400) }
  const heading = (name) => page.getByRole('heading', { name, level: 1 })

  /** Records one chapter: `body(a)` runs between the take's start and stop. */
  async function take(name, body) {
    await settle()
    const rec = await record(page, `${REC}/${name}`, SIZE)
    const a = actor(page, rec)
    a.wide()
    await body(a, rec)
    await a.pause(500)
    rec.mark('end')
    await rec.stop()
  }

  // 1. The invite email, and the click on its button.
  await page.goto(MAIL)
  await take('email', async (a) => {
    a.line('email1')
    await a.pause(600)
    await a.look(page.locator('#subject'), 1.5)
    await a.rest()
    a.line('email2')
    await a.look(page.locator('#attachment'), 1.6)
    await a.rest()
    a.line('email3')
    const button = page.getByRole('link', { name: 'Set up your account' })
    await a.pointAt(button, 1.4)
    await a.pause(1200)
    await a.look(page.getByText('This link can only be used once'), 1.4)
    await a.rest(-1.2)
    await a.act(button, 1.4)
    await heading('Set your password').waitFor()
    a.wide()
    await settle()
  })

  // 2. The password.
  await take('password', async (a) => {
    a.line('pw1')
    await a.pause(1500)
    await a.type(page.getByLabel('New password'), OWNER.password, 1.6)
    await a.type(page.getByLabel('Confirm password'), OWNER.password, 1.6)
    await a.rest()
    a.line('pw2')
    await a.look(page.getByText('Choose a password so you can log in'), 1.6)
    await a.rest(-1.0)
    await a.act(page.getByRole('button', { name: 'Set password' }), 1.6)
    await page.getByRole('heading', { name: 'Set up your venue' }).waitFor()
    a.wide()
  })

  // 3. The setup checklist.
  const checklist = page.locator('section[aria-labelledby="setup-heading"]')
  const fix = (text) => checklist.locator('.setup-row', { hasText: text }).getByRole('link', { name: 'Fix' })
  await take('checklist', async (a) => {
    a.line('check1')
    await a.pause(1300)
    await a.look(checklist, 1.15)
    await a.rest()
    a.line('check2')
    await a.look(page.getByText("Players can't book until the venue is published."), 1.5)
    await a.pause(1600)
    for (const t of ['Add at least one active court', 'Open on at least one day', 'Add a payment account']) {
      await a.pointAt(fix(t), 1.3)
      await a.pause(450)
    }
    await a.rest()
    a.line('check3')
    await a.act(fix('Add at least one active court'), 1.3)
    await heading('Courts').waitFor()
    a.wide()
    await a.rest()
  })

  // 4. Courts: the first one in full, with photos; then two more, sped up in the edit.
  async function addCourt(a, name, s = Z) {
    await a.act(page.getByRole('link', { name: 'Add court' }), s)
    await heading('Add court').waitFor()
    await a.type(page.getByLabel('Name'), name, s)
    await a.select(page.getByLabel('Sport'), 'Pickleball', s)
    await a.type(page.getByLabel('Default hourly rate'), '400', s)
  }
  await take('courts', async (a) => {
    a.line('court1')
    await a.pause(900)
    await addCourt(a, 'Court 1')
    await a.rest(0.1)
    a.line('court2')
    await a.type(page.getByLabel('Description'), 'Indoor court with LED lights.')
    await a.act(page.getByRole('button', { name: 'Create court' }))
    await heading('Court 1').waitFor()
    a.wide()
    await a.rest()
    a.line('court3')
    const photos = page.locator('section[aria-labelledby="court-photos-heading"]')
    await a.look(photos, 1.3)
    await a.upload(page.locator('#court-photos-file'), page.getByText('Add photos', { exact: true }), [assets['court-1-day.png'], assets['court-1-evening.png']], 1.3)
    await page.getByRole('button', { name: 'Remove photo 2' }).waitFor({ timeout: 30000 })
    await a.look(photos, 1.25)
    await a.rest(0.6)
    a.line('court4')
    for (const n of [2, 3]) {
      await a.act(page.getByRole('link', { name: '← All courts' }), 1.2)
      await heading('Courts').waitFor()
      await addCourt(a, `Court ${n}`, 1.25)
      await a.act(page.getByRole('button', { name: 'Create court' }), 1.25)
      await heading(`Court ${n}`).waitFor()
    }
    await a.act(page.getByRole('link', { name: '← All courts' }), 1.2)
    await heading('Courts').waitFor()
    a.wide()
    await a.pause(1800)
  })

  // 5. Opening hours, from the checklist's Fix button.
  await take('hours', async (a) => {
    a.line('hours1')
    await a.nav('Dashboard')
    await page.getByRole('heading', { name: 'Set up your venue' }).waitFor()
    await a.pause(500)
    await a.act(fix('Open on at least one day'), 1.3)
    await heading('Schedule').waitFor()
    a.wide()
    await a.rest()
    a.line('hours2')
    await a.pointAt(page.getByRole('switch', { name: 'Sunday open' }), 1.3)
    await a.pause(500)
    await a.select(page.getByLabel('Monday opens'), '7 AM', 1.5)
    await a.select(page.getByLabel('Monday closes'), '11 PM', 1.5)
    await a.rest()
    a.line('hours3')
    await a.act(page.getByRole('button', { name: 'Copy to every day' }), 1.4)
    await a.pause(900)
    await a.look(page.getByText('Week at a glance'), 1.2)
    await a.pause(900)
    await a.pointAt(page.getByRole('button', { name: 'Add a break to Monday' }), 1.4)
    await a.rest()
    a.line('hours4')
    const bar = page.getByRole('region', { name: 'Unsaved changes' })
    await a.act(bar.getByRole('button', { name: 'Review & save' }), 1.35)
    const dialog = page.getByRole('dialog', { name: 'Review changes' })
    await dialog.waitFor()
    await a.look(dialog, 1.2)
    await a.pause(1600)
    await a.act(dialog.getByRole('button', { name: 'Save changes' }), 1.3)
    await bar.waitFor({ state: 'detached' })
    a.wide()
    await a.rest()
    a.line('hours5')
    for (const tab of ['Prices', 'Promos', 'Closures']) {
      await a.act(page.getByRole('tab', { name: tab }), 1.15)
      await a.pause(1700)
    }
    await a.rest()
  })

  // 6. Payment details.
  await take('payments', async (a) => {
    a.line('pay1')
    await a.nav('Settings')
    await heading('Venue settings').waitFor()
    await a.pause(600)
    await a.act(page.getByRole('link', { name: /Payment Setup/ }), 1.2)
    await heading('Payment Setup').waitFor()
    a.wide()
    await a.rest()
    a.line('pay2')
    await a.type(page.getByLabel('Label (e.g. GCash, Maya, BPI)', { exact: true }), 'GCash')
    await a.type(page.getByLabel('Account name', { exact: true }), 'Dinkhaus Pickleball')
    await a.type(page.getByLabel('Account or mobile number'), '0917 555 0188')
    await a.rest()
    a.line('pay3')
    const qr = page.getByLabel(/^QR code/)
    await a.upload(qr, qr, assets['gcash-qr.png'])
    await a.pause(900)
    await a.act(page.getByRole('button', { name: 'Add account' }))
    await page.getByText('0917 555 0188').first().waitFor()
    await a.pause(500)
    await a.look(page.getByText('0917 555 0188').first(), 1.3)
    await a.rest()
    a.line('pay4')
    await a.act(page.getByRole('button', { name: 'Use example' }), 1.35)
    await a.pause(1200)
    await a.look(page.locator('textarea').first(), 1.3)
    await a.pause(1500)
    await a.act(page.getByRole('button', { name: 'Save instructions' }), 1.35)
    await a.pause(1500)
    await a.rest()
  })

  // 7. Publish, the sidebar QR code, and the live booking page.
  await take('publish', async (a) => {
    a.line('pub1')
    await a.nav('Dashboard')
    await page.getByRole('heading', { name: 'Set up your venue' }).waitFor()
    await a.look(checklist, 1.15)
    await a.pause(1500)
    const publish = page.getByRole('button', { name: 'Publish venue' })
    await a.act(publish, 1.3)
    await checklist.waitFor({ state: 'detached', timeout: 20000 })
    // Master keeps the availability it fetched while the venue was a draft, so "Today's courts" says the venue isn't
    // taking bookings until the page reloads (reported to the user, 2026-11-26). Reload rather than film that.
    await page.reload()
    await heading('Dashboard').waitFor()
    await settle()
    a.wide()
    await a.rest()
    a.line('pub2')
    await a.pointAt(page.getByText('Share your booking site'), 1.6)
    await a.pause(1400)
    await a.pointAt(page.getByRole('button', { name: 'Save', exact: true }).first(), 1.6)
    await a.rest(-1.2)
    await a.pointAt(page.getByRole('link', { name: 'View public site' }), 1.4)
    await a.pause(600)
    a.line('pub3')
    await page.goto(`${BASE}/`)
    await page.getByRole('heading', { name: /Dinkhaus/ }).first().waitFor()
    a.wide()
    await settle()
    await a.pause(1800)
    await a.scrollBy(520)
    await a.pause(1600)
    await a.rest()
  })

  // 8. The five settings sections (Payment Setup was chapter 6).
  await page.goto(`${BASE}/admin/settings`)
  await heading('Venue settings').waitFor()
  const back = () => page.getByRole('link', { name: '← Back to Settings' })
  const card = (title) => page.getByRole('link', { name: new RegExp(`^${title}`) })
  await take('settings', async (a) => {
    a.line('set1')
    await a.pause(1200)
    await a.pointAt(card('Payment Setup'), 1.2)
    await a.rest()
    a.line('set2')
    await a.act(card('Venue Profile'), 1.2)
    await heading('Venue Profile').waitFor()
    a.wide()
    await a.pause(500)
    await a.type(page.getByLabel('City', { exact: true }), 'Pasig', 1.4)
    await a.act(page.getByRole('button', { name: 'Save city' }), 1.4)
    await a.type(page.getByLabel('Address'), '88 Sampaguita St, Pasig City', 1.4)
    await a.act(page.getByRole('button', { name: 'Save location' }), 1.4)
    await a.look(page.getByText('Social links', { exact: true }), 1.2)
    await a.rest()
    a.line('set3')
    await a.act(back(), 1.2)
    await a.act(card('Booking Rules'), 1.2)
    await heading('Booking Rules').waitFor()
    a.wide()
    await a.pause(500)
    for (const f of ['Booking window', 'Payment hold', 'Cancellation cutoff']) {
      await a.pointAt(page.getByLabel(f), 1.35)
      await a.pause(1300)
    }
    await a.rest()
    a.line('set4')
    await a.act(back(), 1.2)
    await a.act(card('Website Appearance'), 1.2)
    await heading('Website Appearance').waitFor()
    a.wide()
    await a.pause(600)
    await a.act(page.getByRole('button', { name: 'Court Green' }), 1.25)
    await a.pause(1600)
    await a.rest()
    a.line('set5')
    const banner = page.getByLabel('Banner image')
    await a.upload(banner, banner, assets['banner.png'], 1.3)
    await a.act(page.getByRole('button', { name: 'Save banner' }), 1.3)
    await a.pause(1500)
    const logo = page.getByLabel('Logo image')
    await a.upload(logo, logo, assets['logo.png'], 1.3)
    await a.act(page.getByRole('button', { name: 'Save logo' }), 1.3)
    await a.pause(1200)
    for (const amenity of ['Restrooms (CR)', 'Parking', 'Night lights', 'Water station']) {
      await a.act(page.getByRole('checkbox', { name: amenity }), 1.35)
      await a.pause(250)
    }
    await a.rest()
    a.line('set6')
    await a.toTop()
    await a.act(back(), 1.2)
    await a.act(card('Policies & Waivers'), 1.2)
    await heading('Policies & Waivers').waitFor()
    a.wide()
    await a.pause(700)
    await a.look(page.locator('textarea').first(), 1.3)
    await a.rest(0.6)
  })

  // 9. Day to day, once example bookings have come in.
  const reference = await addExampleBookings(stage.helper, stage.venueId)
  await page.goto(`${BASE}/admin`)
  await heading('Dashboard').waitFor()
  await take('ops', async (a) => {
    a.line('ops1')
    await a.pause(1500)
    await a.look(page.getByRole('link', { name: 'Review proofs' }), 1.3)
    await a.pause(1500)
    a.wide()
    await a.scrollBy(420)
    await a.pause(1600)
    await a.toTop()
    await a.rest(0.1)
    a.line('ops2')
    await a.act(page.getByRole('link', { name: 'Review proofs' }), 1.3)
    await heading('Bookings').waitFor()
    await a.pause(700)
    await a.act(page.getByRole('button', { name: new RegExp(reference) }), 1.2)
    const approve = page.getByRole('button', { name: 'Approve and confirm' })
    await approve.waitFor()
    await page.getByText('Loading proof…').waitFor({ state: 'detached' })
    const proof = page.getByAltText('Proof of payment')
    await proof.evaluate((img) => img.complete || new Promise((r) => img.addEventListener('load', r, { once: true })))
    await a.look(proof, 1.5)
    await a.pause(2200)
    await a.act(approve, 1.5)
    const done = page.getByRole('status').filter({ hasText: `${reference} is confirmed` })
    await done.waitFor()
    await a.look(done, 1.4)
    await a.rest()
    a.line('ops3')
    a.wide()
    await a.toTop()
    await a.pointAt(page.getByLabel('Search').first(), 1.3)
    await a.pause(900)
    await a.pointAt(page.getByLabel('Status'), 1.3)
    await a.rest()
    a.line('ops4')
    await a.nav('Open Play')
    await heading('Open play').waitFor()
    a.wide()
    await a.pause(1200)
    await a.pointAt(page.getByText('New session').first(), 1.3)
    await a.rest()
    a.line('ops5')
    await a.nav('Reports')
    await heading('Statement').waitFor()
    a.wide()
    await a.pause(1500)
    await a.look(page.getByText('This month’s fees so far'), 1.35)
    await a.pause(3500)
    a.wide()
    await a.scrollBy(380)
    await a.rest()
  })
  await ctx.close()
})
