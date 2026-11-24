// Renders the video frame by frame and muxes it with music.wav.
// Serve the repo root first: python3 -m http.server 8765 --bind 127.0.0.1
// node brag-output/messenger-chaos/render.mjs <916|45>
import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const r = process.argv[2] === '45' ? '45' : '916'
const H = r === '45' ? 1350 : 1920
const dir = fileURLToPath(new URL('.', import.meta.url))
const outFile = `${dir}messenger-chaos-${r === '45' ? '4x5' : '9x16'}.mp4`
const FPS = 30, DUR = 25, N = FPS * DUR
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-i', `${dir}music.wav`, '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '256k', '-t', String(DUR), outFile], { stdio: ['pipe', 'inherit', 'inherit'] })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1080, height: H }, colorScheme: 'light' })
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto(`http://127.0.0.1:8765/brag-output/messenger-chaos/index.html?r=${r}`)
await page.evaluate(() => window.ready)
for (let f = 0; f < N; f++) {
  await page.evaluate((t) => window.renderAt(t), f / FPS)
  const buf = await page.screenshot({ type: 'png' })
  if (!ff.stdin.write(buf)) await new Promise((res) => ff.stdin.once('drain', res))
  if (f % 150 === 0) process.stdout.write(`${f} `)
}
ff.stdin.end()
await new Promise((res) => ff.on('close', res))
await browser.close()
console.log('done', outFile)
