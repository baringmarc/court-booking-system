// Synthesizes the soundtrack: 120 BPM, F major, 22 s, 48 kHz stereo WAV. Every event sits on the beat grid from t=0.
import { writeFileSync } from 'node:fs'
const SR = 48000, DUR = 25.0, N = Math.round(SR * DUR)
const L = new Float32Array(N), R = new Float32Array(N)
const FX_L = new Float32Array(N), FX_R = new Float32Array(N) // reverb send
const BEAT = 0.5
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)
let seed = 12345
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

// ---- instruments ----
function kick(t0, g = 1) {
  let ph = 0
  add(t0, 0.45, (t) => { const f = 48 + 90 * Math.exp(-t / 0.04); ph += 2 * Math.PI * f / SR; return Math.sin(ph) * env(t, 0.002, 0.16) }, 0.85 * g)
}
function clap(t0, g = 1) {
  let lp = 0
  add(t0, 0.3, (t) => { const n = rnd(); lp += 0.35 * (n - lp); const hp = n - lp; return hp * env(t, 0.003, 0.07) }, 0.16 * g, 0.1, 0.35)
}
function hat(t0, g = 1, pan = 0.25) {
  let prev = 0
  add(t0, 0.08, (t) => { const n = rnd(); const hp = n - prev; prev = n; return hp * env(t, 0.001, 0.018) }, 0.05 * g, pan)
}
function bass(t0, note, len, g = 1) {
  const f = mtof(note); let ph = 0, lp = 0
  add(t0, len, (t) => {
    ph += f / SR; const saw = 2 * (ph % 1) - 1
    lp += 0.06 * (saw - lp)
    const e = Math.min(1, t / 0.006) * Math.min(1, (len - t) / 0.04)
    return (lp * 0.8 + Math.sin(2 * Math.PI * f * t) * 0.6) * e
  }, 0.22 * g)
}
function pluck(t0, note, g = 1, pan = 0, decay = 0.35, send = 0.4) {
  const f = mtof(note)
  add(t0, decay * 5, (t) => {
    const e = env(t, 0.003, decay)
    return (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t / 0.08) + 0.12 * Math.sin(6 * Math.PI * f * t) * Math.exp(-t / 0.05)) * e
  }, 0.09 * g, pan, send)
}
function pad(t0, notes, len, g = 1, attack = 0.35, release = 0.6) {
  notes.forEach((m, j) => {
    const f = mtof(m)
    for (const det of [-0.08, 0.08]) {
      const ff = f * Math.pow(2, det / 12); let ph = 0, lp = 0
      add(t0, len + release, (t) => {
        ph += ff / SR; const saw = 2 * (ph % 1) - 1; lp += 0.025 * (saw - lp)
        const e = Math.min(1, t / attack) * (t > len ? Math.exp(-(t - len) / (release / 3)) : 1)
        return lp * e
      }, 0.05 * g, det < 0 ? -0.45 : 0.45, 0.5)
    }
  })
}
function whoosh(tEnd, len = 0.5, g = 1) {
  let lp = 0
  add(tEnd - len, len + 0.15, (t) => {
    const x = Math.min(1, t / len); const c = 0.02 + 0.25 * x * x
    const n = rnd(); lp += c * (n - lp)
    const e = t < len ? x * x : Math.exp(-(t - len) / 0.05)
    return lp * e
  }, 0.22 * g, 0, 0.4)
}
function tick(t0, note) { pluck(t0, note, 0.55, (note % 5) / 5 - 0.4, 0.09, 0.25) }

// ---- arrangement ----
// F major: F=65 (F4). Chords per bar (2 s): Fmaj7, Am7, Bbmaj7, C(add9)
const CH = [ { root: 41, pad: [57, 60, 64, 65] }, { root: 45, pad: [57, 60, 64, 67] }, { root: 46, pad: [58, 62, 65, 69] }, { root: 48, pad: [60, 62, 64, 67] } ]
const chordAt = (t) => CH[Math.floor(t / 2) % 4]
const pent = [65, 67, 69, 72, 74, 77, 79, 81] // F major pentatonic

// Hook 0–3: kick on every beat, short bass, ticks on slot flips (1.5 → 2.875, eighth notes)
for (let b = 0; b < 6; b++) { kick(b * BEAT, 0.8); bass(b * BEAT, chordAt(b * BEAT).root, 0.22, 0.8) }
for (let i = 0; i < 14; i++) tick(1.5 + i * 0.125, pent[i % pent.length] + (i >= 8 ? 0 : 0))
whoosh(3.0, 0.75, 1.1)

// Reveal 3–6: impact, pad opens, sparse hats, half-time kick
kick(3.0, 1.1); pad(3.0, [53, 57, 60, 64, 69], 2.9, 1.2, 0.05, 0.4)
pluck(3.0, 77, 0.8, 0, 0.8, 0.6); pluck(3.5, 81, 0.6, 0.2, 0.6, 0.6); pluck(4.0, 84, 0.6, -0.2, 0.8, 0.6)
for (let b = 6; b < 12; b++) { if (b % 2 === 0) kick(b * BEAT, 0.7); hat(b * BEAT + 0.25, 0.8) }
bass(3.0, 41, 1.9, 0.9); bass(5.0, 48, 0.9, 0.9)
whoosh(6.0, 0.5, 0.9)

// Groove 6–18.5
const arp = [0, 7, 12, 16, 12, 7, 4, 7]
for (let b = 12; b < 43; b++) {
  const t = b * BEAT, c = chordAt(t)
  kick(t, 1)
  if (b % 2 === 1) clap(t)
  hat(t + 0.25, 1, 0.3); hat(t, 0.45, -0.3)
  bass(t, c.root, 0.2, 1); bass(t + 0.25, c.root + 12, 0.18, 0.6)
}
for (let bar = 3; bar < 11; bar++) pad(bar * 2, CH[bar % 4].pad, bar === 10 ? 1.5 : 1.95, 0.8)
for (let e = 24; e < 86; e++) { // arpeggio 8ths, 6.0 → 21.5, quiet under the UI sounds
  const t = e * 0.25, c = chordAt(t); pluck(t, c.root + 24 + arp[e % 8], 0.38, e % 2 ? 0.35 : -0.35, 0.16, 0.3)
}
// UI sounds, on the grid and in key
pluck(7.0, 84, 0.9, 0.3, 0.12, 0.3); pluck(7.5, 86, 0.9, 0.3, 0.12, 0.3)          // taps
;[0, 0.125, 0.25, 0.375].forEach((d, i) => pluck(8.0 + d, [72, 77, 81, 84][i], 0.5, 0.2, 0.15, 0.4)) // bar lifts
pluck(9.5, 81, 0.9, 0.3, 0.12, 0.3)                                                  // continue
whoosh(11.0, 0.5, 0.8)
;[11.5, 11.75, 12.0, 12.25].forEach((t, i) => pluck(t, [77, 79, 81, 84][i], 0.45, -0.3, 0.14, 0.35)) // chips
pluck(12.0, 86, 0.9, 0.3, 0.12, 0.3)                       // receipt attached (tap)
pluck(12.5, 84, 0.9, 0.3, 0.12, 0.3)                       // submit proof (tap)
pluck(13.0, 81, 0.7, 0, 0.3, 0.5); pluck(13.25, 84, 0.6, 0, 0.3, 0.5) // under review: soft two-note
whoosh(14.5, 0.5, 0.8)
pluck(15.5, 84, 1.4, 0, 0.7, 0.7); pluck(15.75, 89, 1.2, 0, 0.9, 0.7) // approve → confirmed chime (C6, F6)
;[0, 0.125, 0.25, 0.375].forEach((d, i) => pluck(15.875 + d, [72, 77, 81, 84][i], 0.45, 0.3, 0.15, 0.4)) // player phone slides in
whoosh(18.0, 0.5, 0.8)
;[18.5, 18.75, 19.0].forEach((t, i) => pluck(t, [72, 76, 79][i], 0.6, -0.2, 0.14, 0.35)) // split rows
whoosh(21.5, 1.0, 1.0)

// Outro 21.5–25: final hit and ring-out
kick(21.5, 1.2); bass(21.5, 41, 2.6, 1.0); bass(21.5, 29, 2.6, 0.5)
pad(21.5, [53, 57, 60, 64, 67, 69], 2.4, 1.3, 0.02, 1.2)
pluck(21.5, 77, 1.0, 0, 1.2, 0.7); pluck(21.75, 81, 0.8, 0.25, 1.0, 0.7); pluck(22.0, 84, 0.8, -0.25, 1.2, 0.7); pluck(22.5, 89, 0.6, 0, 1.4, 0.8)

// ---- reverb (Schroeder: 4 combs + 2 allpasses per side) ----
function reverb(input, offs) {
  const out = new Float32Array(N)
  const combs = [1557, 1617, 1491, 1422].map((d) => ({ d: d + offs, buf: new Float32Array(d + offs), i: 0, lp: 0 }))
  for (let k = 0; k < N; k++) {
    let s = 0
    for (const c of combs) { const y = c.buf[c.i]; c.lp = y * 0.6 + c.lp * 0.4; c.buf[c.i] = input[k] + c.lp * 0.82; c.i = (c.i + 1) % c.d; s += y }
    out[k] = s * 0.25
  }
  for (const d of [556 + offs, 441 + offs]) {
    const buf = new Float32Array(d); let i = 0
    for (let k = 0; k < N; k++) { const b = buf[i]; const y = -out[k] + b; buf[i] = out[k] + b * 0.5; i = (i + 1) % d; out[k] = y }
  }
  return out
}
const rvL = reverb(FX_L, 0), rvR = reverb(FX_R, 23)

// ---- master: sum, gentle fade-out, soft clip, normalize ----
const out = Buffer.alloc(44 + N * 4)
let peak = 0
const mixL = new Float32Array(N), mixR = new Float32Array(N)
for (let k = 0; k < N; k++) {
  const t = k / SR
  const fade = t > 24.2 ? Math.max(0, (DUR - t) / 0.8) : 1
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
