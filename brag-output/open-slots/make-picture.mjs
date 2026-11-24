// Saves picture.png and caption.txt, drawn by the app's own slotsImage.ts from fictional data.
// From the repo root: npx vite --port 5199 --strictPort   then   node brag-output/open-slots/make-picture.mjs
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
const dir = new URL('.', import.meta.url)
const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto('http://localhost:5199/brag-output/open-slots/make-picture.html')
const r = await page.evaluate(() => window.result)
writeFileSync(new URL('picture.png', dir), Buffer.from(r.png, 'base64'))
writeFileSync(new URL('caption.txt', dir), r.caption + '\n')
console.log(r.file, r.dateLabel)
console.log(r.caption)
await browser.close()
