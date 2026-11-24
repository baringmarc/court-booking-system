// Renders still frames at chosen times, to check the layout by eye.
// node brag-output/what-is-plotline/stills.mjs <169|916> <A|B> <outDir> <t1> <t2> ...   (serve the repo root on :8765 first)
import { chromium } from '@playwright/test'
const [r, hook, outDir, ...times] = process.argv.slice(2)
const size = r === '916' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: size, colorScheme: 'light' })
page.on('pageerror', (e) => console.error('pageerror', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()) })
await page.goto(`http://127.0.0.1:8765/brag-output/what-is-plotline/index.html?r=${r}&hook=${hook}`)
await page.waitForFunction(() => window.ready)
await page.evaluate(() => window.ready)
console.log('total', await page.evaluate(() => window.TOTAL))
for (const t of times) {
  await page.evaluate((x) => window.renderAt(x), +t)
  await page.screenshot({ path: `${outDir}/${r}${hook}-${t}.png` })
}
await browser.close()
