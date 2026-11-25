// Records the app footage for video #17 on the LOCAL stack, from origin/master, with the fictional Dinkhaus venue.
//   PLOTLINE_MASTER_WORKTREE=<dir> node scripts/with-lock.mjs node brag-output/what-is-plotline/record.mjs
// Takes (rec/<take>/: JPEG frames and take.json with frame times and marks):
//   setup-desktop, setup-phone   the dashboard's setup checklist, before the venue is finished
//   player                       a guest books Court 1 tomorrow 7–9 PM on a phone, pays and uploads the receipt
//   admin-desktop, admin-phone   the owner approves that receipt, records a walk-in, then hours, prices, a move, earnings,
//                                open slots
// Dinkhaus and everything it made are removed afterwards (checked), and the platform booking fee is put back.
import { writeFile } from 'node:fs/promises'
import { overlayScript, record } from './recorder.mjs'
import { DESKTOP, PHONE, REC, withStage } from './stage.mjs'
import { GUEST_TAG, rebookPlayer, receiptHtml } from './demo-venue.mjs'

const SIZE = { phone: { maxWidth: 780, maxHeight: 1520 }, desktop: { maxWidth: 2560, maxHeight: 1600, quality: 86 } }
const PLAYER = { name: 'Carlo Dizon', email: `carlo.dizon${GUEST_TAG}`, phone: '0917 555 0142', courtName: 'Court 1', hour: 19, slots: 2 }
const only = process.argv.slice(2) // optional take names, to re-record some of them

/** Actions at a human pace: the desktop moves its pointer to the target, the phone scrolls it into view and taps. */
function actor(page, kind) {
  const pause = (ms) => page.waitForTimeout(ms)
  async function reveal(locator, block = 'center') {
    await locator.evaluate((el, b) => el.scrollIntoView({ block: b, behavior: 'smooth' }), block)
    await pause(650)
  }
  async function pointAt(locator) {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    if (kind === 'mouse') await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 26 })
    await pause(300)
  }
  async function act(locator) {
    if (kind === 'mouse') {
      await pointAt(locator)
      await locator.click()
    } else {
      await locator.tap()
    }
  }
  async function type(locator, text) {
    await act(locator)
    await locator.pressSequentially(text, { delay: 55 })
  }
  const scrollBy = async (top) => {
    await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), top)
    await pause(700)
  }
  const toTop = async () => {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    await pause(700)
  }
  return { pause, reveal, pointAt, act, type, scrollBy, toTop }
}

const wanted = (take) => !only.length || only.includes(take)

async function setupTake(stage, take, device, kind) {
  const ctx = await stage.newContext(device, { storageState: stage.ownerState })
  await ctx.addInitScript(overlayScript, kind)
  const page = await ctx.newPage()
  const a = actor(page, kind)
  await page.goto(`${stage.BASE}/admin`)
  await page.getByRole('heading', { name: 'Set up your venue' }).waitFor()
  await page.waitForLoadState('networkidle')
  const rec = await record(page, `${REC}/${take}`, SIZE[kind === 'mouse' ? 'desktop' : 'phone'])
  rec.mark('checklist')
  await a.pause(1200)
  const payment = page.getByText('Add a payment account with an account number')
  if (kind === 'mouse') await a.pointAt(payment)
  else await a.reveal(payment)
  await a.pause(3500)
  rec.mark('end')
  await rec.stop()
  await ctx.close()
}

async function playerTake(stage, receiptPath) {
  const ctx = await stage.newContext(PHONE)
  await ctx.addInitScript(overlayScript, 'touch')
  const page = await ctx.newPage()
  const a = actor(page, 'touch')
  await page.goto(`${stage.BASE}/`)
  await page.getByRole('heading', { name: /Book a court at Dinkhaus/ }).waitFor()
  await page.waitForLoadState('networkidle')
  const rec = await record(page, `${REC}/player`, SIZE.phone)

  rec.mark('home')
  await a.pause(2200)
  await a.scrollBy(520)
  await a.pause(1300)
  await a.toTop()
  await a.pause(400)
  rec.mark('book-tap')
  await a.act(page.getByRole('link', { name: 'Book now' }))
  await page.getByRole('heading', { name: 'Book a court', level: 1 }).waitFor()
  await page.waitForLoadState('networkidle')
  rec.mark('grid-today')
  await a.pause(900)
  await a.act(page.locator('.date-tile').nth(1)) // tomorrow
  const slot7 = page.getByRole('button', { name: new RegExp(`^${PLAYER.courtName}, 7 PM – 8 PM`) })
  await slot7.waitFor()
  rec.mark('grid-tomorrow')
  await a.reveal(page.getByRole('region', { name: 'Court times' }), 'start')
  // The grid scrolls inside its own box: bring the evening rows up.
  await page.getByRole('region', { name: 'Court times' }).evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }))
  await a.pause(1200)
  rec.mark('evening')
  await a.pause(700)
  await a.act(slot7)
  await a.pause(500)
  await a.act(page.getByRole('button', { name: new RegExp(`^${PLAYER.courtName}, 8 PM – 9 PM`) }))
  rec.mark('selected')
  await a.pause(2200)
  await a.act(page.getByRole('button', { name: 'Continue' }))
  await page.getByRole('heading', { name: 'Checkout' }).waitFor()
  rec.mark('checkout')
  await a.pause(1000)
  await a.type(page.getByLabel('Name'), PLAYER.name)
  await a.type(page.getByLabel('Email'), PLAYER.email)
  const waiver = page.getByRole('checkbox')
  await a.reveal(waiver)
  await a.act(waiver)
  await a.pause(500)
  const reserve = page.getByRole('button', { name: 'Reserve and continue to payment' })
  await a.reveal(reserve)
  rec.mark('reserve-tap')
  await a.act(reserve)
  await page.getByRole('heading', { name: 'Booking reserved' }).waitFor()
  await page.waitForLoadState('networkidle')
  rec.mark('reserved')
  await a.pause(1500)
  const qr = page.locator('img[width="220"]').first()
  await a.reveal(qr)
  rec.mark('qr')
  await a.pause(2200)
  const file = page.getByLabel(/Receipt screenshot/)
  await a.reveal(file)
  await a.pause(500)
  await file.setInputFiles(receiptPath)
  await page.getByAltText('Preview of your receipt').waitFor()
  await a.reveal(page.getByAltText('Preview of your receipt'))
  rec.mark('attached')
  await a.pause(1000)
  const submit = page.getByRole('button', { name: 'Submit proof of payment' })
  await a.reveal(submit)
  rec.mark('submit-tap')
  await a.act(submit)
  await page.getByText(/The venue checks payments by hand/).waitFor()
  await a.reveal(page.getByText(/The venue checks payments by hand/))
  rec.mark('review')
  await a.pause(2500)
  await a.toTop()
  rec.mark('top')
  await a.pause(1800)
  rec.mark('end')
  await rec.stop()
  const reference = new URL(page.url()).pathname.split('/').pop()
  await ctx.close()
  return reference
}

async function adminTake(stage, take, device, kind, { reference, toMove, tomorrow, moveTo, walkIn }) {
  const ctx = await stage.newContext(device, { storageState: stage.ownerState })
  await ctx.addInitScript(overlayScript, kind)
  const page = await ctx.newPage()
  const a = actor(page, kind)
  await page.goto(`${stage.BASE}/admin`)
  await page.getByRole('heading', { name: "Today's courts" }).waitFor()
  await page.waitForLoadState('networkidle')
  const rec = await record(page, `${REC}/${take}`, SIZE[kind === 'mouse' ? 'desktop' : 'phone'])

  // The dashboard, then the proof the player just sent.
  rec.mark('dashboard')
  await a.pause(3200)
  const review = page.getByRole('link', { name: 'Review proofs' })
  rec.mark('review-tap')
  await a.act(review)
  await page.getByRole('heading', { name: 'Bookings', level: 1 }).waitFor()
  await a.pause(900)
  await a.act(page.getByRole('button', { name: new RegExp(reference) }))
  const approve = page.getByRole('button', { name: 'Approve and confirm' })
  await approve.waitFor()
  await page.getByText('Loading proof…').waitFor({ state: 'detached' })
  const proofImage = page.getByAltText('Proof of payment')
  await proofImage.evaluate((img) => img.complete || new Promise((r) => img.addEventListener('load', r, { once: true })))
  await a.reveal(proofImage)
  rec.mark('proof')
  await a.pause(1800)
  if (kind === 'mouse') await a.pointAt(approve)
  else await a.reveal(approve)
  await a.pause(900)
  rec.mark('approve-tap')
  await a.act(approve)
  const done = page.getByRole('status').filter({ hasText: `${reference} is confirmed` })
  await done.waitFor()
  await a.reveal(done, 'start')
  rec.mark('confirmed')
  await a.pause(2600)

  // A walk-in, recorded from the dashboard: the amount is the court price, with no booking fee.
  await page.goto(`${stage.BASE}/admin`)
  await page.getByRole('heading', { name: "Today's courts" }).waitFor()
  await page.waitForLoadState('networkidle')
  rec.mark('walkin')
  await a.pause(800)
  const open = page.getByRole('button', { name: '+ Walk-in' })
  if (kind !== 'mouse') await a.reveal(open)
  rec.mark('walkin-tap')
  await a.act(open)
  const walkInForm = page.getByRole('form', { name: 'Walk-in booking' })
  await walkInForm.waitFor()
  await page.waitForLoadState('networkidle')
  rec.mark('walkin-form')
  const walkInCourt = walkInForm.getByLabel('Court')
  if (kind === 'mouse') await a.pointAt(walkInCourt)
  else await a.reveal(walkInCourt)
  await walkInCourt.selectOption({ label: walkIn.court })
  await a.pause(500)
  const start = walkInForm.getByLabel('Start')
  const labels = await start.locator('option').allTextContents()
  const pick = walkIn.starts.find((l) => labels.includes(l)) ?? labels[1]
  if (kind === 'mouse') await a.pointAt(start)
  await start.selectOption({ label: pick })
  await a.pause(500)
  await a.type(walkInForm.getByLabel('Customer name'), walkIn.name)
  await a.pause(400)
  const amount = walkInForm.getByLabel('Amount received')
  if (kind === 'mouse') await a.pointAt(amount)
  else await a.reveal(amount)
  await a.pause(1200)
  const recordButton = walkInForm.getByRole('button', { name: 'Record walk-in' })
  if (kind !== 'mouse') await a.reveal(recordButton)
  rec.mark('record-tap')
  await a.act(recordButton)
  const recorded = page.getByRole('status').filter({ hasText: /Walk-in .* recorded and confirmed/ })
  await recorded.waitFor()
  await a.reveal(recorded)
  rec.mark('walkin-done')
  await a.pause(2200)

  // Hours and prices.
  await page.goto(`${stage.BASE}/admin/schedule`)
  await page.getByRole('switch', { name: 'Monday open' }).waitFor()
  await page.waitForLoadState('networkidle')
  rec.mark('schedule')
  await a.pause(1500)
  await a.reveal(page.getByRole('switch', { name: 'Monday open' }))
  await a.pause(1200)
  await a.toTop()
  await a.act(page.getByRole('tab', { name: 'Prices' }))
  rec.mark('prices')
  await a.pause(2600)

  // Move a booking, with a reason.
  await page.goto(`${stage.BASE}/admin/bookings?status=all&date=${tomorrow}`)
  await page.getByRole('heading', { name: 'Bookings', level: 1 }).waitFor()
  await page.waitForLoadState('networkidle')
  rec.mark('bookings')
  await a.act(page.getByRole('button', { name: new RegExp(toMove.reference_code) }))
  await a.act(page.getByRole('button', { name: 'Reschedule' }))
  const form = page.getByRole('form', { name: 'Reschedule booking' })
  await form.waitFor()
  rec.mark('move')
  await a.act(form.getByRole('button', { name: 'Tomorrow' }))
  const court = form.getByLabel('New court')
  if (kind === 'mouse') await a.pointAt(court)
  else await a.reveal(court)
  await court.selectOption({ label: 'Court 2' })
  await a.pause(700)
  await a.act(form.getByRole('group', { name: 'New start' }).locator('label').filter({ hasText: new RegExp(`^${moveTo} PM`) }))
  await a.type(form.getByLabel('Reason for moving'), 'Rain: Court 1 is wet')
  await a.pause(500)
  const moveButton = form.getByRole('button', { name: 'Move booking' })
  if (kind !== 'mouse') await a.reveal(moveButton)
  await a.act(moveButton)
  const moved = page.getByRole('status').filter({ hasText: new RegExp(`${toMove.reference_code} moved to Court 2`) })
  await moved.waitFor()
  await a.reveal(moved, 'start')
  rec.mark('moved')
  await a.pause(2000)

  // This month's earnings.
  await page.goto(`${stage.BASE}/admin`)
  const earnings = page.getByRole('region', { name: 'Earnings' })
  await earnings.waitFor()
  await page.waitForLoadState('networkidle')
  await earnings.evaluate((el) => el.scrollIntoView({ block: 'start', behavior: 'instant' }))
  await a.pause(400)
  rec.mark('earnings')
  const month = earnings.getByRole('button', { name: 'This month' })
  for (let i = 0; i < 3 && (await month.getAttribute('aria-pressed')) !== 'true'; i++) {
    await a.act(month)
    await a.pause(400)
  }
  if ((await month.getAttribute('aria-pressed')) !== 'true') throw new Error('"This month" did not get selected')
  await earnings.getByRole('list', { name: 'Collected per day' }).waitFor()
  await page.waitForLoadState('networkidle')
  rec.mark('month')
  await a.pause(1500)
  await a.scrollBy(kind === 'mouse' ? 380 : 520)
  await a.pause(2200)

  // The daily open-slots picture.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await a.pause(500)
  const post = page.getByRole('button', { name: 'Post open slots' })
  if (kind !== 'mouse') await a.reveal(post)
  rec.mark('slots-tap')
  await a.act(post)
  const dialog = page.getByRole('dialog')
  const download = dialog.getByRole('button', { name: 'Download picture' })
  await download.waitFor()
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('dialog button')].find((x) => x.textContent === 'Download picture')
    return b && !b.disabled
  })
  rec.mark('slots')
  await a.pause(2600)
  if (kind !== 'mouse') await a.reveal(download)
  const downloaded = page.waitForEvent('download')
  await a.act(download)
  await downloaded
  rec.mark('downloaded')
  await a.pause(1500)
  rec.mark('end')
  await rec.stop()
  await ctx.close()
}

await withStage({
  beforeFinish: async (stage) => {
    if (wanted('setup-desktop')) await setupTake(stage, 'setup-desktop', DESKTOP, 'mouse')
    if (wanted('setup-phone')) await setupTake(stage, 'setup-phone', PHONE, 'touch')
  },
  run: async (stage) => {
    const { tomorrow, toMove } = stage.data
    const receipt = await stage.helper.setViewportSize({ width: 540, height: 900 })
      .then(() => stage.helper.setContent(`<body style="margin:0">${receiptHtml(810, '5521 008 734', 'Today, 1:42 AM')}</body>`))
      .then(() => stage.helper.screenshot({ type: 'png' }))
    const receiptPath = `${REC}/receipt.png`
    await writeFile(receiptPath, receipt)

    let reference = null
    if (wanted('player')) reference = await playerTake(stage, receiptPath)
    const player = { ...PLAYER, day: tomorrow, receipt }
    if (wanted('admin-desktop')) {
      if (!reference) reference = (await rebookPlayer(stage.helper, stage.venueId, player)).reference_code
      await adminTake(stage, 'admin-desktop', DESKTOP, 'mouse', {
        reference, toMove: toMove[0], tomorrow, moveTo: 3, walkIn: { court: 'Court 2', starts: ['6 PM', '7 PM', '5 PM'], name: 'Joey Santos' },
      })
      reference = null
    }
    if (wanted('admin-phone')) {
      // The desktop take approved the player's booking: a fresh one, same court, time and receipt, for the phone take.
      if (!reference) reference = (await rebookPlayer(stage.helper, stage.venueId, player, { replace: true })).reference_code
      await adminTake(stage, 'admin-phone', PHONE, 'touch', {
        reference, toMove: toMove[1], tomorrow, moveTo: 1, walkIn: { court: 'Court 3', starts: ['7 PM', '8 PM', '6 PM'], name: 'Joey Santos' },
      })
    }
    console.log(`Recorded from origin/master at ${stage.commit}.`)
  },
})
