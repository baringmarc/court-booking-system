// Contact sheet of a take: the frame shown at each given time (default: each mark + 0.6 s). Checking aid only.
// node brag-output/what-is-plotline/sheet.mjs <take> <out.png> [height] [t1 t2 …]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const [take, out, h = '700', ...times] = process.argv.slice(2)
const dir = new URL(`rec/${take}/`, import.meta.url).pathname
const k = JSON.parse(readFileSync(`${dir}take.json`, 'utf8'))
const ts = times.length ? times.map(Number) : Object.values(k.marks).map((t) => Math.min(t + 0.6, k.duration - 0.05))
const at = (t) => k.frames.filter((f) => f.t <= t).at(-1) ?? k.frames[0]
const files = ts.map((t) => `${dir}${at(t).file}`)
const inputs = files.flatMap((f) => ['-i', f])
const scaled = files.map((_, i) => `[${i}:v]scale=-2:${h}[s${i}]`).join(';')
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', `${scaled};${files.map((_, i) => `[s${i}]`).join('')}hstack=inputs=${files.length}`, out])
console.log(ts.map((t) => t.toFixed(1)).join(' '))
