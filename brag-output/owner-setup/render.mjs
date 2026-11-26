// Renders the walkthrough frame by frame and muxes it with its soundtrack (rec/audio.wav, from audio.mjs), then writes
// the YouTube chapter list (chapters.txt) from the same timeline.
// Serve the repo root first: python3 -m http.server 8765 --bind 127.0.0.1
// node brag-output/owner-setup/render.mjs
import { chromium } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const dir = fileURLToPath(new URL('.', import.meta.url))
const audio = `${dir}rec/audio.wav`
if (!existsSync(audio)) throw new Error('Make the soundtrack first: node brag-output/owner-setup/audio.mjs')
const outFile = `${dir}owner-setup-16x9.mp4`
// Loudness: measure the soundtrack, then normalize it to about -16 LUFS (YouTube) in one linear pass.
const measured = spawnSync('ffmpeg', ['-hide_banner', '-i', audio, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
const m = JSON.parse(measured.match(/\{[^{}]*"input_i"[^{}]*\}/)[0])
const loudnorm = `loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
const FPS = 30
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light' })
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto('http://127.0.0.1:8765/brag-output/owner-setup/index.html')
await page.waitForFunction(() => window.ready)
await page.evaluate(() => window.ready)
const { total, chapters } = await page.evaluate(() => ({ total: window.TOTAL, chapters: window.timeline.chapters }))

// YouTube chapters: the first must be 0:00.
const stamp = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
writeFileSync(`${dir}chapters.txt`, ['0:00 Welcome', ...chapters.map((c) => `${stamp(c.start)} ${c.number}. ${c.title}`)].join('\n') + '\n')

const N = Math.round(total * FPS)
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
  '-i', audio, '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-af', loudnorm, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-t', String(N / FPS), outFile], { stdio: ['pipe', 'inherit', 'inherit'] })
const started = Date.now()
for (let f = 0; f < N; f++) {
  await page.evaluate((t) => window.renderAt(t), f / FPS)
  const buf = await page.screenshot({ type: 'png' })
  if (!ff.stdin.write(buf)) await new Promise((res) => ff.stdin.once('drain', res))
  if (f % 900 === 0) process.stdout.write(`${(f / FPS).toFixed(0)}s `)
}
ff.stdin.end()
await new Promise((res) => ff.on('close', res))
await browser.close()
console.log(`\ndone ${outFile} (${(N / FPS).toFixed(1)} s, rendered in ${((Date.now() - started) / 1000).toFixed(0)} s)`)
