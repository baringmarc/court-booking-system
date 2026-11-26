// Copied from ../what-is-plotline/, with page addresses, camera focus points and click times added.
// Records a page as JPEG frames through Chrome's screencast (sharper than Playwright's video), with named marks, and
// draws a pointer (desktop) or a touch ripple (phone) into the page, since a recording shows neither.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Injected into every document of a context: the pointer or the touch ripple. */
export function overlayScript(kind) {
  const install = () => {
    if (document.getElementById('rec-pointer')) return
    const style = document.createElement('style')
    style.textContent = `
      #rec-pointer { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; }
      #rec-pointer.mouse { width: 26px; height: 26px; margin: -13px 0 0 -13px; border-radius: 50%; background: rgba(196,98,62,.42); border: 2px solid #c4623e;
        transition: width .12s, height .12s, margin .12s, background .12s; }
      #rec-pointer.mouse.down { width: 38px; height: 38px; margin: -19px 0 0 -19px; background: rgba(196,98,62,.7); }
      .rec-ripple { position: fixed; z-index: 2147483647; pointer-events: none; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%;
        background: rgba(20,52,30,.25); border: 2px solid rgba(20,52,30,.45); animation: rec-ripple .55s ease-out forwards; }
      @keyframes rec-ripple { 0% { transform: scale(.55); opacity: 1 } 70% { opacity: .9 } 100% { transform: scale(1.25); opacity: 0 } }`
    document.documentElement.append(style)
    if (kind === 'mouse') {
      const p = document.createElement('div')
      p.id = 'rec-pointer'
      p.className = 'mouse'
      const [x, y] = (sessionStorage.getItem('rec-pointer') ?? '640,400').split(',')
      p.style.transform = `translate(${x}px, ${y}px)`
      document.documentElement.append(p)
      addEventListener('mousemove', (e) => {
        p.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
        sessionStorage.setItem('rec-pointer', `${e.clientX},${e.clientY}`)
      }, true)
      addEventListener('mousedown', () => p.classList.add('down'), true)
      addEventListener('mouseup', () => setTimeout(() => p.classList.remove('down'), 160), true)
    } else {
      const marker = document.createElement('div')
      marker.id = 'rec-pointer'
      document.documentElement.append(marker)
      addEventListener('pointerdown', (e) => {
        const r = document.createElement('div')
        r.className = 'rec-ripple'
        r.style.left = `${e.clientX}px`
        r.style.top = `${e.clientY}px`
        document.documentElement.append(r)
        setTimeout(() => r.remove(), 700)
      }, true)
    }
  }
  if (document.documentElement) install()
  else document.addEventListener('DOMContentLoaded', install)
}

/**
 * Starts recording `page` into `dir`. Returns { mark(name), focus(x, y, s), stop() }. stop() writes take.json: frames,
 * marks (with the page's address at each) and camera focus points, with times in seconds from the first frame.
 */
export async function record(page, dir, { maxWidth, maxHeight, quality = 90 }) {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const cdp = await page.context().newCDPSession(page)
  const frames = []
  const writes = []
  let n = 0
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    const file = `${String(++n).padStart(5, '0')}.jpg`
    frames.push({ file, wall: metadata.timestamp ?? Date.now() / 1000, at: Date.now() / 1000, url: page.url() })
    writes.push(writeFile(join(dir, file), Buffer.from(data, 'base64')))
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth, maxHeight, everyNthFrame: 1 })
  const marks = []
  const focus = []
  const taps = []
  return {
    mark(name) {
      marks.push({ name, at: Date.now() / 1000, url: page.url() })
    },
    /** Where the camera should look from now on: a point in page CSS px and a zoom (1 shows the whole page). */
    focus(x, y, s) {
      focus.push({ at: Date.now() / 1000, x: Math.round(x), y: Math.round(y), s })
    },
    /** A click, for the soundtrack's tick. */
    tap() {
      taps.push(Date.now() / 1000)
    },
    async stop() {
      await page.waitForTimeout(300)
      await cdp.send('Page.stopScreencast')
      await Promise.all(writes)
      await cdp.detach().catch(() => {})
      if (!frames.length) throw new Error(`No frames recorded into ${dir}`)
      // Frame times come from the compositor (metadata.timestamp); marks from Node's clock. Their offset is the median
      // gap between a frame's timestamp and its arrival, which is a few milliseconds.
      const gaps = frames.map((f) => f.at - f.wall).sort((a, b) => a - b)
      const offset = gaps[Math.floor(gaps.length / 2)]
      const t0 = frames[0].wall
      const take = {
        // Each frame carries the page's address when it changed, for the window's address bar.
        frames: frames.map((f, i) => ({ file: f.file, t: +(f.wall - t0).toFixed(3), ...(i === 0 || f.url !== frames[i - 1].url ? { url: f.url } : {}) })),
        marks: Object.fromEntries(marks.map((m) => [m.name, +(m.at - offset - t0).toFixed(3)])),
        urls: Object.fromEntries(marks.map((m) => [m.name, m.url])),
        focus: focus.map((f) => ({ t: +Math.max(0, f.at - offset - t0).toFixed(3), x: f.x, y: f.y, s: f.s })),
        taps: taps.map((at) => +Math.max(0, at - offset - t0).toFixed(3)),
        duration: +(Math.max(frames.at(-1).wall, ...marks.map((m) => m.at - offset)) - t0 + 0.3).toFixed(3),
      }
      await writeFile(join(dir, 'take.json'), JSON.stringify(take, null, 1))
      console.log(`  ${dir.split('/').slice(-1)[0]}: ${frames.length} frames, ${take.duration.toFixed(1)} s, marks: ${Object.keys(take.marks).join(' ')}`)
      return take
    },
  }
}
