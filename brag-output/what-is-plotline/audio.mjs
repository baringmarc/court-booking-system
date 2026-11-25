// Soundtrack for video #17: the AI narration (rec/voice, from voice.py) on the shared timeline, a quiet music bed in
// F major at 100 BPM that ducks under the voice, and soft UI sounds (a ding per chat bubble in hook A, a tick per tap, a
// chime on the approval). 48 kHz stereo WAV. The instruments are the earlier videos' (keep-the-chat/audio.mjs).
//   node brag-output/what-is-plotline/audio.mjs <169|916> <A|B>   → rec/audio-<r>-<hook>.wav
import { readFileSync, writeFileSync } from 'node:fs'
import { buildTimeline } from './timeline.mjs'

const r = process.argv[2] === '916' ? '916' : '169'
const hook = process.argv[3] === 'B' ? 'B' : 'A'
const here = new URL('.', import.meta.url).pathname
const readJson = (p) => JSON.parse(readFileSync(`${here}${p}`, 'utf8'))
const TAKES = ['player', 'admin-desktop', 'admin-phone', 'setup-desktop', 'setup-phone']
const takes = Object.fromEntries(TAKES.map((t) => [t, readJson(`rec/${t}/take.json`)]))
const TL = buildTimeline({ format: r, hook, durations: readJson('rec/voice/durations.json').seconds, takes, narration: readJson('narration.json') })

const SR = 48000, DUR = TL.total, N = Math.round(SR * DUR)
const L = new Float32Array(N), R = new Float32Array(N) // music and effects
const VL = new Float32Array(N) // voice (mono)
const FX_L = new Float32Array(N), FX_R = new Float32Array(N)
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)
let seed = 1717
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1
function add(t0, len, fn, gain = 1, pan = 0, send = 0) {
  const s0 = Math.round(t0 * SR), n = Math.round(len * SR)
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4)
  for (let i = 0; i < n; i++) {
    const k = s0 + i; if (k < 0 || k >= N) continue
    const v = fn(i / SR, i)
    L[k] += v * gl; R[k] += v * gr
    if (send) { FX_L[k] += v * gl * send; FX_R[k] += v * gr * send }
  }
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d))

// ---- instruments (as in the earlier videos) ----
function kick(t0, g = 1) { let ph = 0; add(t0, 0.45, (t) => { const f = 48 + 90 * Math.exp(-t / 0.04); ph += 2 * Math.PI * f / SR; return Math.sin(ph) * env(t, 0.002, 0.16) }, 0.6 * g) }
function hat(t0, g = 1, pan = 0.25) { let prev = 0; add(t0, 0.08, (t) => { const n = rnd(); const hp = n - prev; prev = n; return hp * env(t, 0.001, 0.018) }, 0.035 * g, pan) }
function bass(t0, note, len, g = 1) {
  const f = mtof(note); let ph = 0, lp = 0
  add(t0, len, (t) => { ph += f / SR; const saw = 2 * (ph % 1) - 1; lp += 0.05 * (saw - lp); const e = Math.min(1, t / 0.01) * Math.min(1, (len - t) / 0.06); return (lp * 0.7 + Math.sin(2 * Math.PI * f * t) * 0.7) * e }, 0.16 * g)
}
function pluck(t0, note, g = 1, pan = 0, decay = 0.35, send = 0.4) {
  const f = mtof(note)
  add(t0, decay * 5, (t) => { const e = env(t, 0.003, decay); return (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.08) + 0.12 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t / 0.05)) * e }, 0.07 * g, pan, send)
}
function pad(t0, notes, len, g = 1, attack = 0.6, release = 1.2, cut = 0.02) {
  notes.forEach((m) => {
    const f = mtof(m)
    for (const det of [-0.07, 0.07]) {
      const ff = f * Math.pow(2, det / 12); let ph = 0, lp = 0
      add(t0, len + release, (t) => { ph += ff / SR; const saw = 2 * (ph % 1) - 1; lp += cut * (saw - lp); const e = Math.min(1, t / attack) * (t > len ? Math.exp(-(t - len) / (release / 3)) : 1); return lp * e }, 0.045 * g, det < 0 ? -0.45 : 0.45, 0.5)
    }
  })
}
// a generic message "ding": two quick sine notes (not any app's real sound)
function ding(t0, g = 1, pan = 0) {
  for (const [dt, m, gg] of [[0, 93, 0.8], [0.07, 98, 1]]) {
    const f = mtof(m)
    add(t0 + dt, 0.5, (t) => (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.04)) * env(t, 0.002, 0.11), 0.09 * g * gg, pan, 0.15)
  }
}
function tick(t0, g = 1) { pluck(t0, 96, 0.35 * g, 0.1, 0.04, 0.1) }
function chime(t0, g = 1) { [81, 84, 88, 93].forEach((m, i) => pluck(t0 + i * 0.06, m, 0.9 * g, (i - 1.5) * 0.15, 0.45, 0.5)) }

// ---- music: F major, 100 BPM; four chords of two bars each ----
const BEAT = 0.6, BAR = 4 * BEAT
const CHORDS = [
  { root: 41, notes: [65, 69, 72, 76] }, // Fmaj7
  { root: 38, notes: [62, 65, 69, 72] }, // Dm7
  { root: 46, notes: [62, 65, 69, 70] }, // Bbmaj7
  { root: 36, notes: [64, 67, 72, 74] }, // C(add9)
]
const hookEnd = TL.scenes.find((s) => s.id === 'hook').end
const ctaStart = TL.scenes.find((s) => s.id === 'cta').start
const lastBeat = Math.floor((DUR - 2.2) / BEAT)
for (let bar = 0; bar * BAR < DUR - 2.4; bar += 2) {
  const t0 = bar * BAR
  const c = CHORDS[(bar / 2) % 4]
  pad(t0, c.notes, 2 * BAR, t0 < hookEnd ? 0.8 : 1)
}
for (let b = 0; b <= lastBeat; b++) {
  const t = b * BEAT
  const c = CHORDS[Math.floor(b / 8) % 4]
  const drums = t >= hookEnd - 0.05 && t < ctaStart + 1.2
  if (drums && b % 2 === 0) kick(t, b % 4 === 0 ? 1 : 0.7)
  if (drums) hat(t + BEAT / 2, 0.8)
  if (t >= hookEnd - 0.05) {
    if (b % 4 === 0) bass(t, c.root, BEAT * 1.8)
    if (b % 4 === 2) bass(t, c.root + 7, BEAT * 1.5, 0.8)
  }
  // A soft arpeggio on eighths, quieter during the hook.
  const arp = [c.notes[0] + 12, c.notes[2] + 12, c.notes[1] + 12, c.notes[3] + 12]
  pluck(t, arp[(b * 2) % 4], t < hookEnd ? 0.5 : 0.7, -0.3, 0.3)
  pluck(t + BEAT / 2, arp[(b * 2 + 1) % 4], t < hookEnd ? 0.4 : 0.55, 0.3, 0.25)
}
// The last chord rings out under the outro.
pad(lastBeat * BEAT + BEAT, CHORDS[0].notes.concat([53]), 1.2, 1.1, 0.05, 1.6)
pluck(lastBeat * BEAT + BEAT, 77, 1.2, 0, 1.2, 0.6)

// ---- UI sounds ----
const hookScene = TL.scenes[0]
if (hook === 'A') {
  const s = hookScene.start + 0.35
  ;[0, 1.76, 2.66].forEach((x) => ding(s + x - 0.05, 1))
  for (let i = 0; i < 14; i++) ding(s + 3.95 + 2.5 * Math.pow(i / 14, 0.7), 0.45 + 0.25 * (i % 2), (i % 3 - 1) * 0.4)
}
for (const sc of TL.scenes.filter((x) => x.kind === 'app')) {
  for (const shot of sc.shots) {
    const take = takes[shot.take]
    for (const [name, mt] of Object.entries(take.marks)) {
      if (!name.endsWith('-tap') || mt < shot.from || mt > shot.to) continue
      const at = sc.start + shot.start + (mt - shot.from) / shot.speed
      if (at > sc.end) continue
      if (name === 'approve-tap') chime(at + 0.05)
      else tick(at)
    }
  }
}

// ---- voice: each line's WAV (16-bit PCM or float, any rate) resampled to 48 kHz at its start ----
function readWav(path) {
  const b = readFileSync(path)
  let pos = 12, fmt = null, data = null
  while (pos < b.length) {
    const id = b.toString('ascii', pos, pos + 4), size = b.readUInt32LE(pos + 4)
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(pos + 8), channels: b.readUInt16LE(pos + 10), rate: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) }
    if (id === 'data') data = b.subarray(pos + 8, pos + 8 + size)
    pos += 8 + size + (size % 2)
  }
  const step = fmt.bits / 8 * fmt.channels, n = Math.floor(data.length / step), out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = fmt.bits === 16 ? data.readInt16LE(i * step) / 32768 : data.readFloatLE(i * step)
  return { samples: out, rate: fmt.rate }
}
const speech = [] // [start, end] in seconds, for ducking
for (const line of TL.lines) {
  const { samples, rate } = readWav(`${here}rec/voice/${line.id}.wav`)
  const ratio = rate / SR, s0 = Math.round(line.start * SR), n = Math.floor(samples.length / ratio)
  for (let i = 0; i < n; i++) {
    const x = i * ratio, j = Math.floor(x), f = x - j
    const v = samples[j] * (1 - f) + (samples[j + 1] ?? 0) * f
    if (s0 + i < N) VL[s0 + i] += v
  }
  speech.push([line.start, line.start + n / SR])
}

// ---- mix: reverb on the send, the music ducked under the voice, the voice normalized, a fade at the end ----
const taps = [[1931, 0.28], [2879, 0.22], [4111, 0.17], [5279, 0.13]].map(([d, g]) => [Math.round(d * SR / 44100), g])
for (let i = 0; i < N; i++) for (const [d, g] of taps) { const k = i - d; if (k >= 0) { L[i] += FX_R[k] * g; R[i] += FX_L[k] * g } }
const duck = new Float32Array(N)
{
  // Ducked from just before a line until 0.9 s after it, so short pauses between lines stay ducked; back up over ~0.7 s.
  const target = (t) => (speech.some(([a, b]) => t >= a - 0.15 && t <= b + 0.9) ? 0.5 : 1)
  let g = 1
  for (let i = 0; i < N; i++) {
    const want = target(i / SR)
    g += (want - g) * (want < g ? 0.0006 : 0.00003) // down in ~35 ms, up in ~0.7 s
    duck[i] = g
  }
}
// The voice: levelled by its RMS while speaking (-18 dBFS), then a 5 ms look-ahead peak limiter at -3.7 dBFS, so the
// final loudness normalization in render.mjs can stay linear.
{
  let sum = 0, n = 0
  for (let i = 0; i < N; i++) if (Math.abs(VL[i]) > 0.01) { sum += VL[i] * VL[i]; n++ }
  const level = 0.126 / Math.sqrt(sum / Math.max(1, n))
  for (let i = 0; i < N; i++) VL[i] *= level
  const ceiling = 0.65, look = Math.round(0.005 * SR), rel = 1 - Math.exp(-1 / (0.08 * SR))
  const need = new Float32Array(N)
  for (let i = 0; i < N; i++) need[i] = Math.min(1, ceiling / Math.max(1e-9, Math.abs(VL[i])))
  // Sliding minimum over the look-ahead window (monotonic deque).
  const q = new Int32Array(N), gmin = new Float32Array(N)
  let head = 0, tail = 0
  for (let i = N - 1; i >= 0; i--) {
    while (tail > head && need[q[tail - 1]] >= need[i]) tail--
    q[tail++] = i
    while (q[head] > i + look) head++
    gmin[i] = need[q[head]]
  }
  let g = 1
  for (let i = 0; i < N; i++) {
    g = gmin[i] < g ? gmin[i] : g + (1 - g) * rel
    VL[i] *= g
  }
}
const vGain = 1
let mPeak = 0
for (let i = 0; i < N; i++) mPeak = Math.max(mPeak, Math.abs(L[i]), Math.abs(R[i]))
const mGain = 0.24 / (mPeak || 1) // the bed sits well under the voice even between lines
const out = Buffer.alloc(44 + N * 4)
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8); out.write('fmt ', 12)
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 4, 28)
out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40)
const fadeFrom = N - Math.round(0.6 * SR)
for (let i = 0; i < N; i++) {
  const fade = i > fadeFrom ? 1 - (i - fadeFrom) / (N - fadeFrom) : 1
  const v = VL[i] * vGain
  const l = Math.tanh((L[i] * mGain * duck[i] + v) * 1.05) * fade, rr = Math.tanh((R[i] * mGain * duck[i] + v) * 1.05) * fade
  out.writeInt16LE(Math.round(l * 32767), 44 + i * 4); out.writeInt16LE(Math.round(rr * 32767), 46 + i * 4)
}
const file = `${here}rec/audio-${r}-${hook}.wav`
writeFileSync(file, out)
console.log(`${file}: ${DUR.toFixed(2)} s, ${TL.lines.length} narration lines`)
