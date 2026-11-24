// Renders still frames at chosen times, for checking the layout by eye.
// node brag-output/keep-the-chat/stills.mjs <916|45> <outDir> <t1> <t2> ...
import { chromium } from 'playwright'
const [r, outDir, ...times] = process.argv.slice(2)
const H = r === '45' ? 1350 : 1920
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1080, height: H }, colorScheme: 'light' })
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto(`http://127.0.0.1:8765/brag-output/keep-the-chat/index.html?r=${r}`)
await page.evaluate(() => window.ready)
for (const t of times) {
  await page.evaluate((x) => window.renderAt(x), +t)
  await page.screenshot({ path: `${outDir}/${r}-${t}.png` })
}
await browser.close()
