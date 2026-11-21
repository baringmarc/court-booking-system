import { chromium } from 'playwright'
const times = process.argv.slice(2).map(Number)
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light' })
await page.goto('http://127.0.0.1:8765/brag-output/work/index.html')
await page.evaluate(() => window.ready)
for (const t of times) {
  await page.evaluate((t) => window.renderAt(t), t)
  await page.screenshot({ path: `brag-output/work/still-${t.toFixed(2)}.png` })
}
await browser.close()
