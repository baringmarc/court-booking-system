// Renders still frames at chosen times, to check the layout by eye.
// node brag-output/owner-setup/stills.mjs <outDir> <t1> <t2> ...   (serve the repo root on :8765 first)
// A time can also be a narration line id ("court3"), meaning 1.5 s into that line.
import { chromium } from '@playwright/test'
const [outDir, ...times] = process.argv.slice(2)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light' })
page.on('pageerror', (e) => console.error('pageerror', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()) })
await page.goto('http://127.0.0.1:8765/brag-output/owner-setup/index.html')
await page.waitForFunction(() => window.ready)
await page.evaluate(() => window.ready)
console.log('total', await page.evaluate(() => window.TOTAL))
for (const spec of times) {
  const t = Number.isNaN(Number(spec)) ? await page.evaluate((id) => window.timeline.lines.find((l) => l.id === id).start + 1.5, spec) : Number(spec)
  await page.evaluate((x) => window.renderAt(x), t)
  await page.screenshot({ path: `${outDir}/${spec}.png` })
}
await browser.close()
