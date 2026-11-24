// Soundtrack for "The 7 PM problem": 120 BPM, 25 s, 48 kHz stereo WAV.
// 0–8 s tense D minor groove under escalating message dings; 8.5 s everything stops (the double booking);
// 9.75 s a low hit on the zoom into the apology, a held drone; 11.5 s it opens into the launch video's warm F major groove
// for the Plotline half. v2 timeline: the sections after the clash are written in v1 times and moved with OFF. Every event sits on the beat grid.
import { writeFileSync } from 'node:fs'
const SR = 48000, DUR = 25.0, N = Math.round(SR * DUR)
const L = new Float32Array(N), R = new Float32Array(N)
const FX_L = new Float32Array(N), FX_R = new Float32Array(N)
const BEAT = 0.5
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)
let seed = 4242
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1

let OFF = 0 // seconds added to every event written below it
function add(t0, len, fn, gain = 1, pan = 0, send = 0) {
  const s0 = Math.round((t0 + OFF) * SR), n = Math.round(len * SR)
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4)
  for (let i = 0; i < n; i++) {
    const k = s0 + i; if (k < 0 || k >= N) continue
    const v = fn(i / SR, i)
    L[k] += v * gl; R[k] += v * gr
    if (send) { FX_L[k] += v * gl * send; FX_R[k] += v * gr * send }
  }
}
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d))

// ---- instruments ----
function kick(t0, g = 1) { let ph = 0; add(t0, 0.45, (t) => { const f = 48 + 90 * Math.exp(-t / 0.04); ph += 2 * Math.PI * f / SR; return Math.sin(ph) * env(t, 0.002, 0.16) }, 0.85 * g) }
function clap(t0, g = 1) { let lp = 0; add(t0, 0.3, (t) => { const n = rnd(); lp += 0.35 * (n - lp); return (n - lp) * env(t, 0.003, 0.07) }, 0.16 * g, 0.1, 0.35) }
function hat(t0, g = 1, pan = 0.25) { let prev = 0; add(t0, 0.08, (t) => { const n = rnd(); const hp = n - prev; prev = n; return hp * env(t, 0.001, 0.018) }, 0.05 * g, pan) }
function bass(t0, note, len, g = 1) {
  const f = mtof(note); let ph = 0, lp = 0
  add(t0, len, (t) => { ph += f / SR; const saw = 2 * (ph % 1) - 1; lp += 0.06 * (saw - lp); const e = Math.min(1, t / 0.006) * Math.min(1, (len - t) / 0.04); return (lp * 0.8 + Math.sin(2 * Math.PI * f * t) * 0.6) * e }, 0.22 * g)
}
function pluck(t0, note, g = 1, pan = 0, decay = 0.35, send = 0.4) {
  const f = mtof(note)
  add(t0, decay * 5, (t) => { const e = env(t, 0.003, decay); return (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.08) + 0.12 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t / 0.05)) * e }, 0.09 * g, pan, send)
}
function pad(t0, notes, len, g = 1, attack = 0.35, release = 0.6, cut = 0.025) {
  notes.forEach((m) => {
    const f = mtof(m)
    for (const det of [-0.08, 0.08]) {
      const ff = f * Math.pow(2, det / 12); let ph = 0, lp = 0
      add(t0, len + release, (t) => { ph += ff / SR; const saw = 2 * (ph % 1) - 1; lp += cut * (saw - lp); const e = Math.min(1, t / attack) * (t > len ? Math.exp(-(t - len) / (release / 3)) : 1); return lp * e }, 0.05 * g, det < 0 ? -0.45 : 0.45, 0.5)
    }
  })
}
function whoosh(tEnd, len = 0.5, g = 1) {
  let lp = 0
  add(tEnd - len, len + 0.15, (t) => { const x = Math.min(1, t / len); const c = 0.02 + 0.25 * x * x; const n = rnd(); lp += c * (n - lp); const e = t < len ? x * x : Math.exp(-(t - len) / 0.05); return lp * e }, 0.22 * g, 0, 0.4)
}
// a generic message "ding": two quick sine notes (not any app's real sound)
function ding(t0, g = 1, pan = 0, hi = 0) {
  const a = 93 + hi, b = 98 + hi // A6 → D7, in D minor
  for (const [dt, m, gg] of [[0, a, 0.8], [0.07, b, 1]]) {
    const f = mtof(m)
    add(t0 + dt, 0.5, (t) => (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.04)) * env(t, 0.002, 0.11), 0.11 * g * gg, pan, 0.15)
  }
}
// pen on paper: band-limited noise with a scratchy wobble
function scribble(t0, len = 0.28, g = 1) {
  let lp = 0, prev = 0
  add(t0, len, (t) => { const n = rnd(); lp += 0.5 * (n - lp); const hp = lp - prev; prev = lp; const wob = 0.55 + 0.45 * Math.abs(Math.sin(t * 2 * Math.PI * 11)); return hp * wob * Math.min(1, t / 0.01) * Math.min(1, (len - t) / 0.04) }, 0.5 * g, 0.15, 0.1)
}
function womp(t0) { // sad low two-note drop
  for (const [dt, m, len] of [[0, 50, 0.3], [0.25, 45, 0.7]]) { const f = mtof(m); add(t0 + dt, len, (t) => Math.sin(2 * Math.PI * f * t * (1 - 0.03 * t)) * env(t, 0.01, len / 2.5), 0.32, 0, 0.3) }
}

// ---- 0–8.5: chaos, D minor ----
const DM = [{ root: 38, pad: [57, 62, 65, 69] }, { root: 34, pad: [58, 62, 65, 70] }, { root: 43, pad: [55, 62, 67, 70] }, { root: 45, pad: [57, 61, 64, 69] }]
const dmAt = (t) => DM[Math.floor(t / 2) % 4]
for (let b = 0; b < 17; b++) { // to 8.5
  const t = b * BEAT, c = dmAt(t)
  kick(t, b < 4 ? 0.75 : 1)
  if (b >= 4 && b % 2 === 1) clap(t, 0.9)
  hat(t + 0.25, b < 4 ? 0.7 : 1, 0.3)
  if (b >= 8) { hat(t + 0.125, 0.5, -0.3); hat(t + 0.375, 0.5, -0.3) } // sixteenths as it gets busier
  bass(t, c.root, 0.2, 0.9); bass(t + 0.25, c.root, 0.18, 0.7)
}
for (let bar = 1; bar < 4; bar++) pad(bar * 2, DM[bar % 4].pad, 1.95, 0.55, 0.3, 0.3, 0.018)
pad(8.0, DM[0].pad, 0.5, 0.55, 0.05, 0.08, 0.018)
// dings: one per message, faster and faster
const DINGS = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.25, 4.5, 4.75, 5.0, 5.25, 5.5, 5.625, 5.75, 5.875]
DINGS.forEach((t, i) => ding(t, 0.85 + 0.25 * (i / DINGS.length), ((i * 7) % 5) / 5 - 0.4, i % 3 === 2 ? 2 : 0))
whoosh(6.0, 1.2, 0.7) // rising into the logbook
// logbook: pen strokes, then the red circles and a stab on "Twice."
;[6.1, 6.35, 6.6, 6.85, 7.1].forEach((t) => scribble(t, 0.28, 0.9))
scribble(7.5, 0.3, 1.1); scribble(7.62, 0.3, 1.1)
pad(7.5, [50, 57, 62, 65], 0.35, 1.1, 0.005, 0.25, 0.06); kick(7.5, 1.1)
// 8.5: the music stops. One dry ding, then the apology lands on a sad drop
ding(8.5, 1.3, 0, 0)
// 9.0: the owner is typing (soft ticks), 9.5: the apology, 9.75: the zoom hits
;[9.0, 9.125, 9.25, 9.375].forEach((t, i) => pluck(t, 74, 0.25, 0.2, 0.03, 0.05))
ding(9.5, 0.6, 0.2, -5); womp(9.5)
kick(9.75, 1.4); bass(9.75, 26, 0.9, 1.3); whoosh(9.75, 0.25, 0.5)
pad(9.75, [38, 39, 50], 1.6, 1.0, 0.05, 0.25, 0.012) // dark, slightly sour drone under the zoom
;[10.25, 10.75].forEach((t) => kick(t, 0.45)) // a slow heartbeat
ding(9.75, 0.35, -0.2, -10)
whoosh(11.5, 0.6, 0.7)

// ---- the turn opens into F major (v1 10–12, now 11.5–13) ----
OFF = 1.5
kick(10.0, 1.1); pad(10.0, [53, 57, 60, 64, 69], 1.4, 1.2, 0.05, 0.4)
pluck(10.0, 77, 0.8, 0, 0.8, 0.6); pluck(10.5, 81, 0.6, 0.2, 0.6, 0.6); pluck(11.0, 84, 0.6, -0.2, 0.8, 0.6)
for (let b = 20; b < 23; b++) { if (b % 2 === 0) kick(b * BEAT, 0.7); hat(b * BEAT + 0.25, 0.8) }
bass(10.0, 41, 1.4, 0.9)
OFF = 1
whoosh(12.0, 0.5, 0.8)

// ---- the Plotline groove (v1 12–21.5, now 13–22.5) ----
const CH = [{ root: 41, pad: [57, 60, 64, 65] }, { root: 45, pad: [57, 60, 64, 67] }, { root: 46, pad: [58, 62, 65, 69] }, { root: 48, pad: [60, 62, 64, 67] }]
const chordAt = (t) => CH[Math.floor((t - 12) / 2) % 4]
const arp = [0, 7, 12, 16, 12, 7, 4, 7]
for (let b = 24; b < 43; b++) {
  const t = b * BEAT, c = chordAt(t)
  kick(t, 1); if (b % 2 === 1) clap(t)
  hat(t + 0.25, 1, 0.3); hat(t, 0.45, -0.3)
  bass(t, c.root, 0.2, 1); bass(t + 0.25, c.root + 12, 0.18, 0.6)
}
for (let bar = 6; bar < 11; bar++) pad(bar * 2, CH[(bar - 6) % 4].pad, bar === 10 ? 1.0 : 1.95, 0.8)
for (let e = 48; e < 86; e++) { const t = e * 0.25, c = chordAt(t); pluck(t, c.root + 24 + arp[e % 8], 0.38, e % 2 ? 0.35 : -0.35, 0.16, 0.3) }
// UI sounds, on the grid and in key
pluck(12.75, 84, 0.9, 0.3, 0.12, 0.3); pluck(13.0, 86, 0.9, 0.3, 0.12, 0.3)                // two slot taps
;[0, 0.125, 0.25, 0.375].forEach((d, i) => pluck(13.25 + d, [72, 77, 81, 84][i], 0.5, 0.2, 0.15, 0.4)) // selection bar
pluck(13.75, 81, 0.9, 0.3, 0.12, 0.3)                                                        // Continue
whoosh(14.0, 0.4, 0.6)
pluck(14.75, 86, 0.9, 0.3, 0.12, 0.3); pluck(15.0, 84, 0.9, 0.3, 0.12, 0.3)                 // attach, submit
pluck(15.5, 81, 0.7, 0, 0.3, 0.5); pluck(15.75, 84, 0.6, 0, 0.3, 0.5)                        // under review
whoosh(16.0, 0.5, 0.8)
pluck(16.75, 84, 1.4, 0, 0.7, 0.7); pluck(17.0, 89, 1.2, 0, 0.9, 0.7)                        // approve → Confirmed chime
;[0, 0.125, 0.25, 0.375].forEach((d, i) => pluck(17.25 + d, [72, 77, 81, 84][i], 0.45, 0.3, 0.15, 0.4)) // player's phone
whoosh(19.0, 0.5, 0.8)
pluck(19.75, 77, 0.6, -0.2, 0.2, 0.4); pluck(20.25, 81, 0.6, 0.2, 0.2, 0.4)                  // fee lines
OFF = 0.5
whoosh(22.0, 1.0, 1.0)

// ---- final hit and ring-out (v1 22–25, now 22.5–25) ----
kick(22.0, 1.2); bass(22.0, 41, 2.6, 1.0); bass(22.0, 29, 2.6, 0.5)
pad(22.0, [53, 57, 60, 64, 67, 69], 2.2, 1.3, 0.02, 1.0)
pluck(22.0, 77, 1.0, 0, 1.2, 0.7); pluck(22.25, 81, 0.8, 0.25, 1.0, 0.7); pluck(22.5, 84, 0.8, -0.25, 1.2, 0.7); pluck(23.0, 89, 0.6, 0, 1.4, 0.8)
OFF = 0

// ---- reverb (Schroeder) ----
function reverb(input, offs) {
  const out = new Float32Array(N)
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d: d + offs, buf: new Float32Array(d + offs), i: 0, lp: 0 }))
  for (let k = 0; k < N; k++) { let s = 0; for (const c of combs) { const y = c.buf[c.i]; c.lp = y * 0.6 + c.lp * 0.4; c.buf[c.i] = input[k] + c.lp * 0.82; c.i = (c.i + 1) % c.d; s += y } out[k] = s * 0.25 }
  for (const d of [556 + offs, 441 + offs]) { const buf = new Float32Array(d); let i = 0; for (let k = 0; k < N; k++) { const b = buf[i]; const y = -out[k] + b; buf[i] = out[k] + b * 0.5; i = (i + 1) % d; out[k] = y } }
  return out
}
const rvL = reverb(FX_L, 0), rvR = reverb(FX_R, 23)

// ---- master ----
const out = Buffer.alloc(44 + N * 4)
let peak = 0
const mixL = new Float32Array(N), mixR = new Float32Array(N)
for (let k = 0; k < N; k++) {
  const t = k / SR
  const fade = t > 24.3 ? Math.max(0, (DUR - t) / 0.7) : 1
  const fin = Math.min(1, t / 0.005)
  mixL[k] = Math.tanh((L[k] + rvL[k] * 0.55) * 1.1) * fade * fin
  mixR[k] = Math.tanh((R[k] + rvR[k] * 0.55) * 1.1) * fade * fin
  peak = Math.max(peak, Math.abs(mixL[k]), Math.abs(mixR[k]))
}
const norm = 0.89 / peak
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 4, 4); out.write('WAVE', 8); out.write('fmt ', 12)
out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(SR, 24)
out.writeUInt32LE(SR * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(N * 4, 40)
for (let k = 0; k < N; k++) {
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixL[k] * norm)) * 32767), 44 + k * 4)
  out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mixR[k] * norm)) * 32767), 46 + k * 4)
}
writeFileSync(new URL('./music.wav', import.meta.url), out)
console.log('peak', peak.toFixed(3), 'norm', norm.toFixed(3))
