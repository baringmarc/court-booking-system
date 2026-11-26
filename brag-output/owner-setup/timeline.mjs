// The video's timeline, shared by index.html (pictures), audio.mjs (sound) and render.mjs (YouTube chapters).
// buildTimeline() turns the narration (chapters and lines), the voice durations (rec/voice/durations.json) and the
// recorded takes (rec/<chapter>/take.json) into absolute times: scenes, footage segments, narration and captions.
//
// Scenes: a title card (the intro lines), then per chapter a short chapter card and its footage, then the outro card.
// Footage: each narration line's pictures run from its mark to the next line's mark (or the take's end). The segment
// lasts as long as its voice plus a breath; the footage plays at whatever speed fills that (between MIN_SPEED and the
// line's max speed), and holds its last frame if it is still too short.

const BREATH = 0.55 // seconds between a line's end and the next segment
const LEAD = 0.25 // the voice starts this long after its pictures
const MIN_SPEED = 0.8
const MAX_SPEED = 1.5
// Lines whose footage is long by design, played faster with a "Sped up" tag.
const FAST = { court4: 4 }
const CHAPTER_CARD = 2.4

/** Splits a caption into chunks of about `max` characters, at sentence, then clause, then word boundaries. */
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
      if (out.length && (out.at(-1) + ' ' + s).length <= max && s.length < 18) out[out.length - 1] += ' ' + s
      else out.push(s)
    }
  }
  return out
}

/** The camera's keyframes for a take, in clip time: moves only when the focus leaves the middle of the current view. */
export function cameraKeys(take) {
  const keys = [{ t: 0, s: 1, x: 640, y: 400 }]
  let cur = keys[0]
  for (const f of take.focus ?? []) {
    const s = f.s
    // Inside the middle 60% of the current view, at the same zoom: stay put.
    const hw = (640 / cur.s) * 0.6, hh = (400 / cur.s) * 0.6
    if (Math.abs(s - cur.s) < 0.05 && Math.abs(f.x - cur.x) < hw && Math.abs(f.y - cur.y) < hh) continue
    // Aimed a little below the focus, so the focused element sits above the captions.
    const next = { t: f.t, s, x: s === 1 ? 640 : f.x, y: s === 1 ? 400 : f.y + 70 / s }
    keys.push(next)
    cur = next
  }
  return keys
}

/** The camera at clip time `clip`: each move eases over MOVE seconds from its keyframe. */
const MOVE = 0.75
export function cameraAt(keys, clip) {
  let cam = keys[0]
  for (let i = 1; i < keys.length; i++) {
    const k = keys[i]
    if (clip < k.t) break
    const e = Math.min(1, (clip - k.t) / MOVE)
    const q = e * e * (3 - 2 * e)
    cam = { s: cam.s + (k.s - cam.s) * q, x: cam.x + (k.x - cam.x) * q, y: cam.y + (k.y - cam.y) * q }
  }
  return cam
}

export function buildTimeline({ durations, takes, narration }) {
  const out = { scenes: [], lines: [], captions: [], chapters: [], total: 0 }
  const linesOf = (chapter) => narration.lines.filter((l) => l.chapter === chapter)
  let t = 0
  const say = (scene, line, at) => {
    const dur = durations[line.id]
    if (dur === undefined) throw new Error(`No voice for ${line.id}`)
    const entry = { id: line.id, start: at, end: at + dur, scene: scene.id, caption: line.caption }
    out.lines.push(entry)
    return entry
  }
  // Title card: both intro lines.
  {
    const scene = { id: 'title', kind: 'title', start: t }
    let at = t + 0.6
    for (const l of linesOf('intro')) at = say(scene, l, at).end + 0.5
    scene.end = at + 0.6
    out.scenes.push(scene)
    t = scene.end
  }
  narration.chapters.forEach((ch, index) => {
    out.chapters.push({ id: ch.id, title: ch.title, number: index + 1, start: t })
    out.scenes.push({ id: `card-${ch.id}`, kind: 'card', chapter: ch, number: index + 1, of: narration.chapters.length, start: t, end: t + CHAPTER_CARD })
    t += CHAPTER_CARD
    const take = takes[ch.id]
    const lines = linesOf(ch.id)
    const scene = { id: ch.id, kind: 'app', chapter: ch, number: index + 1, take: ch.id, start: t, segments: [], keys: cameraKeys(take) }
    lines.forEach((l, i) => {
      const from = take.marks[l.id]
      const to = i + 1 < lines.length ? take.marks[lines[i + 1].id] : take.marks.end
      if (from === undefined || to === undefined) throw new Error(`Take ${ch.id} lacks marks for ${l.id}`)
      const voice = durations[l.id]
      const need = LEAD + voice + BREATH
      const max = FAST[l.id] ?? MAX_SPEED
      const speed = Math.min(max, Math.max(MIN_SPEED, (to - from) / need))
      const len = Math.max(need, (to - from) / speed)
      scene.segments.push({ line: l.id, from, to, speed, start: t, end: t + len, fast: speed > 1.3 })
      say(scene, l, t + LEAD)
      t += len
    })
    scene.end = t
    out.scenes.push(scene)
  })
  {
    const scene = { id: 'outro', kind: 'outro', start: t }
    let at = t + 0.6
    for (const l of linesOf('outro')) at = say(scene, l, at).end + 0.5
    scene.end = at + 3.0
    out.scenes.push(scene)
    t = scene.end
  }
  // Captions: every line, in chunks timed by their length.
  for (const line of out.lines) {
    // The outro card shows outro2's words itself, and its caption would cover the AI-voice note.
    if (line.id === 'outro2') continue
    const chunks = chunkCaption(line.caption, 70)
    const total = chunks.reduce((n, c) => n + c.length, 0)
    let ct = line.start
    chunks.forEach((c, i) => {
      const len = (line.end - line.start) * (c.length / total)
      out.captions.push({ text: c, start: ct - (i === 0 ? 0.1 : 0), end: ct + len + (i === chunks.length - 1 ? 0.35 : 0) })
      ct += len
    })
  }
  out.total = Math.round(t * 30) / 30
  return out
}

/** The footage at absolute time `t` in an app scene: the segment and the clip time in its take. */
export function clipAt(scene, t) {
  const seg = scene.segments.find((s) => t >= s.start && t < s.end) ?? scene.segments.at(-1)
  return { seg, clip: Math.min(seg.to, seg.from + Math.max(0, t - seg.start) * seg.speed) }
}
