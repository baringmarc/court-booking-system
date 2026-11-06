// Print the editable HTML with the fonts and browser already used by the app.
import { mkdir, copyFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] })
try {
  const page = await browser.newPage()
  await page.goto(new URL('manual.html', import.meta.url).href)
  await page.emulateMedia({ media: 'print' })
  const version = await page.locator('meta[name=version]').getAttribute('content')
  if (!/^\d+\.\d+$/.test(version)) throw new Error('Set the manual edition first.')
  await page.evaluate(async () => {
    await Promise.all([...document.images].map(img => img.decode()))
    await document.fonts.ready
    for (const article of document.querySelectorAll('article')) {
      const last = article.querySelector('footer').previousElementSibling
      if (last.getBoundingClientRect().bottom + 6 > article.querySelector('footer').getBoundingClientRect().top) {
        throw new Error('Text overlaps the footer on ' + article.id)
      }
    }
    for (const a of document.links) {
      if (a.hash && !document.getElementById(a.hash.slice(1))) throw new Error('Missing destination ' + a.hash)
    }
  })
  const dir = fileURLToPath(new URL('../../public/guides/', import.meta.url))
  await mkdir(dir, { recursive: true })
  const versioned = dir + 'venue-owner-manual-v' + version + '.pdf'
  await page.pdf({ path: versioned, printBackground: true, preferCSSPageSize: true, tagged: true, outline: true })
  if ((await stat(versioned)).size > 2 * 1024 * 1024) throw new Error('Compress screenshots before releasing this edition.')
  await copyFile(versioned, dir + 'venue-owner-manual.pdf')
  console.log('Built edition', version, 'with', await page.locator('article').count(), 'pages')
} finally {
  await browser.close()
}
