// The video's timeline, shared by index.html (pictures) and audio.mjs (sound), so both cut at the same moments.
// buildTimeline() turns the scene list below, the voice durations (rec/voice/durations.json) and the recorded takes
// (rec/<take>/take.json) into absolute times: scenes, the shots inside them, narration lines and caption chunks.
// format: '169' (16:9, desktop admin) or '916' (9:16, admin on a phone). hook: 'A' or 'B'.

/** Scene list. Shot times are take marks with an optional offset ("book-tap-0.6") or seconds; speed > 1 is faster. */
export function scenes(hook) {
  return [
    { id: 'hook', kind: 'hook', lines: [{ id: `hook${hook}`, at: 0.35, caption: false }], tail: 0.75 },
    { id: 'intro', kind: 'intro', lines: [{ id: 'intro1', at: 0.3 }, { id: 'intro2', gap: 0.4 }], tail: 0.6 },
    {
      id: 'page', kind: 'app', device: 'player', kicker: 'For your players', heads: [{ text: 'Your page.' }],
      lines: [{ id: 'page', at: 0.25 }], tail: 0.2,
      shots: [{ take: 'player', from: 'home', to: 'book-tap-0.9', speed: 1.5 }],
    },
    {
      id: 'grid', kind: 'app', device: 'player', kicker: 'For your players', heads: [{ text: 'Pick a time.' }],
      lines: [{ id: 'grid', at: 0.2 }], tail: 0.2,
      shots: [{ take: 'player', from: 'book-tap-0.5', to: 'selected+1.6', speed: 1.5 }],
    },
    {
      id: 'pay', kind: 'app', device: 'player', kicker: 'For your players',
      heads: [{ text: 'Pay and upload.' }, { atLine: 'held', text: 'Held while you check.' }],
      lines: [{ id: 'pay', at: 0.2 }, { id: 'held', atMark: 'review' }], tail: 0.5,
      shots: [
        { take: 'player', from: 'checkout-0.3', to: 'reserve-tap+0.2', speed: 3 }, // ends before the next page's spinner
        { take: 'player', from: 'reserved', to: 'qr+1.2', speed: 1.4 },
        { take: 'player', from: 'attached-1.0', to: 'review+0.6', speed: 1.8 },
        { take: 'player', from: 'top+0.5', to: 'end', speed: 1 },
      ],
    },
    {
      id: 'dashboard', kind: 'app', device: 'admin', kicker: 'For you', heads: [{ text: 'Your dashboard.' }],
      lines: [{ id: 'dashboard', at: 0.3 }], tail: 0.3,
      shots: [{ take: 'admin', from: 'dashboard', to: 'review-tap-0.1', speed: 0.8 }],
      zoom: [{ at: 'dashboard+0.6', s: 1, x: 640, y: 400 }, { at: 'review-tap-0.6', s: 1.4, x: 470, y: 190 }],
    },
    {
      id: 'approve', kind: 'app', device: 'admin', kicker: 'For you', heads: [{ text: 'Approve in one tap.' }],
      lines: [{ id: 'approve', at: 0.2 }], tail: 0.4,
      shots: [
        { take: 'admin', from: 'review-tap-0.1', to: 'proof', speed: 1.6 },
        { take: 'admin', from: 'proof', to: 'confirmed+1.8', speed: 1.4 },
      ],
      zoom: [{ at: 'proof-0.6', s: 1, x: 640, y: 400 }, { at: 'proof+0.3', s: 1.65, x: 1000, y: 330 }, { at: 'approve-tap+0.4', s: 1.65, x: 1000, y: 330 },
        { at: 'confirmed+0.2', s: 1.3, x: 760, y: 250 }],
    },
    {
      // Walk-ins are shown as on for every venue: the user's plan (2026-11-25); today Plotline switches them on per venue.
      id: 'walkin', kind: 'app', device: 'admin', kicker: 'For you', heads: [{ text: 'Walk-ins, no fee.' }],
      lines: [{ id: 'walkin', at: 0.2 }], tail: 0.3,
      // The form with ₱400 stays up until the tap on Record walk-in near the end of "Walk-ins have no booking fee" (which
      // starts about 3.5 s in), in both takes; then the save and its confirmation.
      shots: [
        { take: 'admin', from: 'walkin-tap-0.4', to: 'record-tap+0.1', dur: 4.3 },
        { take: 'admin', from: 'record-tap+0.1', to: 'walkin-done+1.0', speed: 1.6 },
      ],
      zoom: [{ at: 'walkin-tap', s: 1, x: 640, y: 400 }, { at: 'walkin-form+0.3', s: 1.3, x: 757, y: 530 }, { at: 'record-tap', s: 1.3, x: 757, y: 530 },
        { at: 'walkin-done', s: 1.2, x: 700, y: 420 }],
      // Desktop only: a chip beside the amount field (page CSS px), since 16:9 has no headline over the window.
      callout: { text: 'No booking fee', x: 695, y: 670, from: 'record-tap-1.5', to: 'record-tap+1.7' },
    },
    {
      id: 'run', kind: 'app', device: 'admin', kicker: 'For you', heads: [{ text: 'Run your venue.' }],
      lines: [{ id: 'run', at: 0.2 }], tail: 0.3,
      shots: [
        // Each shot lasts as long as its phrase ("hours", "and prices", "move a booking when it rains", "see what you earned").
        { take: 'admin', from: 'schedule', to: 'schedule+2.0', dur: 1.05 },
        { take: 'admin', from: 'prices-0.2', to: 'prices+1.8', dur: 1.1 },
        { take: 'admin', from: 'move', to: 'moved+0.8', dur: 1.4 },
        { take: 'admin', from: 'month-0.3', to: 'month+3.6', speed: 1.5 },
      ],
    },
    {
      id: 'slots', kind: 'app', device: 'admin', kicker: 'For you', heads: [{ text: 'Post your open slots.' }],
      lines: [{ id: 'slots', at: 0.2 }], tail: 0.3,
      shots: [{ take: 'admin', from: 'slots-tap-0.3', to: 'downloaded+0.6', speed: 1.3 }],
      zoom: [{ at: 'slots-tap', s: 1, x: 640, y: 400 }, { at: 'slots+0.2', s: 1.4, x: 610, y: 330 }],
    },
    { id: 'fee', kind: 'fee', lines: [{ id: 'fee1', at: 0.3, caption: false }, { id: 'fee2', gap: 0.5, caption: false }], tail: 0.8 },
    {
      id: 'setup', kind: 'app', device: 'setup', kicker: 'Getting started', heads: [{ text: 'We set it up with you.' }],
      lines: [{ id: 'setup', at: 0.25 }], tail: 0.5,
      shots: [{ take: 'setup', from: 'checklist', to: 'end', speed: 1.2 }],
      zoom: [{ at: 'checklist', s: 1.05, x: 560, y: 300 }, { at: 'end', s: 1.35, x: 560, y: 290 }],
    },
    { id: 'cta', kind: 'cta', lines: [{ id: 'cta', at: 0.3, caption: false }], tail: 3.2 },
  ]
}

/** The real take behind a device name, per format. */
export const takeFor = (format, take) =>
  take === 'admin' ? (format === '916' ? 'admin-phone' : 'admin-desktop')
    : take === 'setup' ? (format === '916' ? 'setup-phone' : 'setup-desktop')
      : take

/** "book-tap-0.6" → that mark's time minus 0.6 s. */
export function markTime(take, spec) {
  if (typeof spec === 'number') return spec
  const m = spec.match(/^(.*?)(?:([+-])(\d+(?:\.\d+)?))?$/)
  const base = take.marks[m[1]]
  if (base === undefined) throw new Error(`No mark "${m[1]}" in take`)
  const off = m[2] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0
  return Math.max(0, Math.min(take.duration, base + off))
}

/** Splits a caption into chunks that fit about `max` characters, at sentence, then clause, then word boundaries. */
export function chunkCaption(text, max) {
  const out = []
  const sentences = text.match(/[^.!?:]+[.!?:]+["”’]?\s*|[^.!?:]+$/g) ?? [text]
  for (let s of sentences) {
    s = s.trim()
    while (s.length > max) {
      let cut = -1
      for (const sep of [', ', ' and ', ' ']) {
        const i = s.lastIndexOf(sep, max)
        if (i > max * 0.45) { cut = i + (sep === ', ' ? 1 : 0); break }
      }
      if (cut < 0) cut = s.lastIndexOf(' ', max)
      out.push(s.slice(0, cut).trim())
      s = s.slice(cut).trim()
    }
    if (s) {
      // Merge a short tail into the previous chunk when it fits.
      if (out.length && (out.at(-1) + ' ' + s).length <= max && s.length < 18) out[out.length - 1] += ' ' + s
      else out.push(s)
    }
  }
  return out
}

export function buildTimeline({ format, hook, durations, takes, narration }) {
  const captionText = Object.fromEntries([
    [`hook${hook}`, narration.hooks[hook].caption], ...narration.lines.map((l) => [l.id, l.caption]),
  ])
  const maxChars = format === '916' ? 54 : 66 // about two lines in 9:16, one in 16:9
  const out = { format, hook, scenes: [], lines: [], captions: [], total: 0 }
  let t = 0
  for (const spec of scenes(hook)) {
    const scene = { ...spec, start: t, shots: [], heads: [] }
    // Shots, laid end to end at their speed.
    let local = 0
    for (const s of spec.shots ?? []) {
      const name = takeFor(format, s.take)
      const take = takes[name]
      const from = markTime(take, s.from), to = markTime(take, s.to)
      const len = s.dur ?? Math.max(0.1, (to - from) / s.speed)
      const speed = s.dur ? (to - from) / s.dur : s.speed
      scene.shots.push({ take: name, from, to, speed, start: local, end: local + len })
      local += len
    }
    const shotsEnd = local
    if (spec.zoom && scene.shots.length) {
      const take = takes[scene.shots[0].take]
      scene.zoom = spec.zoom.map((z) => ({ ...z, clip: markTime(take, z.at) }))
    }
    // Narration lines.
    let cursor = 0
    const lines = []
    for (const l of spec.lines) {
      let at
      if (l.at !== undefined) at = l.at
      else if (l.atMark) {
        const shot = scene.shots.find((s) => { const mt = markTime(takes[s.take], l.atMark); return mt >= s.from && mt <= s.to })
        at = shot ? shot.start + (markTime(takes[shot.take], l.atMark) - shot.from) / shot.speed : cursor + 0.4
        at = Math.max(at, cursor + 0.25)
      } else at = cursor + (l.gap ?? 0.4)
      const dur = durations[l.id]
      if (dur === undefined) throw new Error(`No voice for ${l.id}`)
      lines.push({ id: l.id, start: at, end: at + dur, caption: l.caption !== false })
      cursor = at + dur
    }
    scene.duration = Math.max(cursor + (spec.tail ?? 0.4), shotsEnd)
    // Extend the last shot with a hold to the scene's end.
    if (scene.shots.length) scene.shots.at(-1).holdUntil = scene.duration
    for (const h of spec.heads ?? []) {
      const at = h.atLine ? lines.find((l) => l.id === h.atLine).start - 0.15 : 0
      scene.heads.push({ text: h.text, at })
    }
    for (const l of lines) {
      const line = { ...l, start: t + l.start, end: t + l.end, scene: spec.id }
      out.lines.push(line)
      if (!l.caption) continue
      const chunks = chunkCaption(captionText[l.id], maxChars)
      const total = chunks.reduce((n, c) => n + c.length, 0)
      let ct = line.start
      chunks.forEach((c, i) => {
        const len = (line.end - line.start) * (c.length / total)
        out.captions.push({ text: c, start: ct - (i === 0 ? 0.1 : 0), end: ct + len + (i === chunks.length - 1 ? 0.35 : 0) })
        ct += len
      })
    }
    scene.end = t + scene.duration
    out.scenes.push(scene)
    t = scene.end
  }
  out.total = Math.round(t * 30) / 30
  return out
}

/** Which recorded frame a shot shows at scene-local time `lt`. */
export function shotAt(scene, lt) {
  const shots = scene.shots
  let s = shots.find((x) => lt >= x.start && lt < x.end) ?? (lt >= shots.at(-1).start ? shots.at(-1) : shots[0])
  const clip = Math.min(s.to, s.from + Math.max(0, lt - s.start) * s.speed)
  return { shot: s, index: shots.indexOf(s), clip }
}

/** The camera on the desktop recording at clip time `clip`: scale and focus point (CSS px of the 1280 × 800 page). */
export function zoomAt(scene, clip) {
  const z = scene.zoom
  if (!z?.length) return { s: 1, x: 640, y: 400 }
  if (clip <= z[0].clip) return z[0]
  for (let i = 1; i < z.length; i++) {
    if (clip <= z[i].clip) {
      const a = z[i - 1], b = z[i]
      const k = (clip - a.clip) / Math.max(0.001, b.clip - a.clip)
      const e = k * k * (3 - 2 * k)
      return { s: a.s + (b.s - a.s) * e, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e }
    }
  }
  return z.at(-1)
}
