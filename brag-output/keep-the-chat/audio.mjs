// Soundtrack for "Keep the chat" (video #13): 120 BPM, 20 s, 48 kHz stereo WAV.
// 0–3 s a calm F major bed under two message dings ("That's okay", not #1's chaos); 3 s the launch video's groove;
// chat and UI sounds on the beat grid. The instruments are the same as the earlier videos' audio.mjs.
import { writeFileSync } from 'node:fs'
const SR = 48000, DUR = 20.0, N = Math.round(SR * DUR)
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


// a coin: bright inharmonic partials with a quick shimmer (lands on the venue)
function coin(t0, g = 1, pan = 0) {
  for (const [dt, f] of [[0, 2093], [0.06, 2637]]) {
    add(t0 + dt, 0.6, (t) => (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t / 0.03) + 0.3 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t / 0.015)) * env(t, 0.001, 0.12), 0.07 * g, pan, 0.3)
  }
}
function tick(t0, note, g = 1, pan = 0) { pluck(t0, note, 0.22 * g, pan, 0.05, 0.15) }

// a short typing tick for the owner's typing indicator
function key(t0, g = 1) {
  let lp = 0, prev = 0
  add(t0, 0.03, (t) => { const n = rnd(); lp += 0.6 * (n - lp); const hp = lp - prev; prev = lp; return hp * env(t, 0.0008, 0.006) }, 0.6 * g, ((t0 * 37) % 1) * 0.4 - 0.2, 0.05)
}
// a sent message: a quick upward swoop
function sent(t0, g = 1) { let ph = 0; add(t0, 0.18, (t) => { const f = 900 + 1800 * (t / 0.18); ph += 2 * Math.PI * f / SR; return Math.sin(ph) * env(t, 0.004, 0.05) }, 0.06 * g, 0.2, 0.2) }

// ---- 0–3: the hook. Calm F major, a ding for each player message ----
pad(0, [53, 57, 60, 65], 2.9, 0.75, 0.4, 0.3, 0.014)
bass(0, 41, 2.9, 0.55)
for (let b = 0; b < 6; b++) hat(b * BEAT, 0.7, b % 2 ? 0.35 : -0.35)
ding(0.5, 1, -0.2, -2); ding(1.2, 0.9, 0.2, -2)            // two player messages (in key: G6 → C7)
pluck(1.7, 77, 0.6, 0, 0.5, 0.6); pluck(1.95, 81, 0.6, 0.2, 0.7, 0.6) // "That's okay."
whoosh(3.0, 0.6, 0.8)

// ---- 3–15.5: Plotline, the warm F major groove from the launch video ----
const T = 3
const CH = [{ root: 41, pad: [57, 60, 64, 65] }, { root: 45, pad: [57, 60, 64, 67] }, { root: 46, pad: [58, 62, 65, 69] }, { root: 48, pad: [60, 62, 64, 67] }]
const chordAt = (t) => CH[Math.floor((t - T) / 2) % 4]
const arp = [0, 7, 12, 16, 12, 7, 4, 7]
kick(T, 1.2); pluck(T, 77, 0.8, 0, 0.6, 0.6)
for (let b = 6; b < 31; b++) {
  const t = b * BEAT, c = chordAt(t)
  kick(t, 1); if (b % 2 === 1) clap(t)
  hat(t + 0.25, 1, 0.3); hat(t, 0.45, -0.3)
  bass(t, c.root, 0.2, 1); bass(t + 0.25, c.root + 12, 0.18, 0.6)
}
for (let i = 0; i < 7; i++) { const t = T + i * 2; pad(t, chordAt(t).pad, i === 6 ? 0.6 : 1.95, 0.8) }
for (let e = 12; e < 62; e++) { const t = e * 0.25, c = chordAt(t); pluck(t, c.root + 24 + arp[e % 8], 0.3, e % 2 ? 0.35 : -0.35, 0.16, 0.3) }
// the reply
for (let i = 0; i < 9; i++) key(3.42 + i * 0.06, 0.8)                                  // the owner types
sent(3.95)                                                                              // "Check and book here po"
sent(4.5, 1.1)                                                                          // the link
;[0, 0.125, 0.25].forEach((d, i) => pluck(4.75 + d, [81, 84, 89][i], 0.5, 0.2, 0.18, 0.5)) // its preview card
pluck(6.35, 84, 0.9, 0.3, 0.12, 0.3)                                                    // tap the link
whoosh(7.0, 0.5, 0.8)
// book and pay
pluck(7.45, 65, 0.6, 0.3, 0.3, 0.3)                                                     // Court 2 at 7 PM: taken
pluck(8.0, 84, 0.9, 0.3, 0.12, 0.3); whoosh(8.15, 0.25, 0.35)                          // pick Court 1, the bar
pluck(8.65, 86, 0.9, 0.3, 0.12, 0.3); whoosh(9.0, 0.3, 0.4)                            // Continue
pluck(9.75, 84, 0.8, 0.3, 0.12, 0.3); pluck(10.1, 86, 0.8, 0.3, 0.12, 0.3)            // attach, submit
pluck(10.6, 81, 0.6, -0.2, 0.3, 0.5); pluck(10.85, 77, 0.5, 0.2, 0.4, 0.5)           // under review
whoosh(12.0, 0.5, 0.8)
// approve, then the player's happy reply
;[0, 0.08, 0.16, 0.24].forEach((d, i) => pluck(12.75 + d, [77, 81, 84, 89][i], 0.7, 0.1 * i, 0.3, 0.6)) // Confirmed
whoosh(13.3, 0.4, 0.4)
ding(14.0, 1.1, -0.1, -2); pluck(14.25, 89, 0.6, 0, 0.6, 0.7)                          // "Confirmed na po!"
whoosh(15.5, 0.45, 0.8)

// ---- 15.5–17.5: the fee ----
kick(15.5, 1.2); bass(15.5, 41, 1.9, 0.9); bass(15.5, 29, 1.9, 0.4)
pad(15.5, [53, 57, 60, 64, 67], 1.8, 1.1, 0.05, 0.5)
pluck(15.5, 77, 0.9, 0, 0.6, 0.6); pluck(15.75, 81, 0.6, 0.2, 0.5, 0.6); pluck(16.0, 84, 0.7, -0.2, 0.7, 0.6)
for (let b = 31; b < 35; b++) { const t = b * BEAT; hat(t + 0.25, 0.8, 0.3); if (b % 2 === 1) clap(t, 0.7) }
pluck(16.1, 86, 0.4, 0.3, 0.2, 0.4); pluck(16.5, 89, 0.4, -0.3, 0.2, 0.4)
whoosh(17.5, 0.4, 0.8)

// ---- 17.5–20: final hit and ring-out ----
kick(17.5, 1.2); bass(17.5, 41, 2.3, 1.0); bass(17.5, 29, 2.3, 0.5)
pad(17.5, [53, 57, 60, 64, 67, 69], 1.9, 1.3, 0.02, 0.8)
pluck(18.0, 77, 1.0, 0, 1.0, 0.7); pluck(18.2, 81, 0.8, 0.25, 0.9, 0.7); pluck(18.5, 84, 0.8, -0.25, 1.0, 0.7); pluck(18.9, 89, 0.6, 0, 1.1, 0.8)

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
  const fade = t > 19.3 ? Math.max(0, (DUR - t) / 0.7) : 1
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
