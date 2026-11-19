import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
const FPS = 30, DUR = 25, N = FPS * DUR
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-i', 'brag-output/work/music.wav', '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '256k', '-t', String(DUR), 'brag-output/work/video-raw.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light' })
await page.goto('http://127.0.0.1:8765/brag-output/work/index.html')
await page.evaluate(() => window.ready)
for (let f = 0; f < N; f++) {
  await page.evaluate((t) => window.renderAt(t), f / FPS)
  const buf = await page.screenshot({ type: 'png' })
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r))
  if (f % 60 === 0) process.stdout.write(`${f} `)
}
ff.stdin.end()
await new Promise((r) => ff.on('close', r))
await browser.close()
console.log('done')
