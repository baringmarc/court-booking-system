// Renders the video frame by frame and muxes it with its soundtrack (rec/audio-<r>-<hook>.wav, from audio.mjs).
// Serve the repo root first: python3 -m http.server 8765 --bind 127.0.0.1
// node brag-output/what-is-plotline/render.mjs <169|916> <A|B>
import { chromium } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const r = process.argv[2] === '916' ? '916' : '169'
const hook = process.argv[3] === 'B' ? 'B' : 'A'
const size = r === '916' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }
const dir = fileURLToPath(new URL('.', import.meta.url))
const audio = `${dir}rec/audio-${r}-${hook}.wav`
if (!existsSync(audio)) throw new Error(`Make the soundtrack first: node brag-output/what-is-plotline/audio.mjs ${r} ${hook}`)
// Hook A was chosen (2026-11-25), so its files carry no suffix; hook B renders keep theirs.
const outFile = `${dir}what-is-plotline-${r === '916' ? '9x16' : '16x9'}${hook === 'A' ? '' : '-hookB'}.mp4`
// Loudness: measure the soundtrack, then normalize it to about -15 LUFS (social video) in one linear pass.
const measured = spawnSync('ffmpeg', ['-hide_banner', '-i', audio, '-af', 'loudnorm=I=-15:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' }).stderr
const m = JSON.parse(measured.match(/\{[^{}]*"input_i"[^{}]*\}/)[0])
const loudnorm = `loudnorm=I=-15:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
const FPS = 30
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: size, colorScheme: 'light' })
page.on('pageerror', (e) => console.error('pageerror', e.message))
await page.goto(`http://127.0.0.1:8765/brag-output/what-is-plotline/index.html?r=${r}&hook=${hook}`)
await page.waitForFunction(() => window.ready)
await page.evaluate(() => window.ready)
const total = await page.evaluate(() => window.TOTAL)
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
  if (f % 300 === 0) process.stdout.write(`${(f / FPS).toFixed(0)}s `)
}
ff.stdin.end()
await new Promise((res) => ff.on('close', res))
await browser.close()
console.log(`\ndone ${outFile} (${(N / FPS).toFixed(1)} s, rendered in ${((Date.now() - started) / 1000).toFixed(0)} s)`)
