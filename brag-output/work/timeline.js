// ---------- fake QR (illustration only) ----------
;(() => {
  const svg = $('#qr'); let seed = 7; const r = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  let out = ''
  const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" fill="#3b2f2a"/><rect x="${x+1}" y="${y+1}" width="5" height="5" fill="#fff"/><rect x="${x+2}" y="${y+2}" width="3" height="3" fill="#3b2f2a"/>`
  for (let y = 1; y < 28; y++) for (let x = 1; x < 28; x++) {
    const inF = (x < 9 && y < 9) || (x > 19 && y < 9) || (x < 9 && y > 19)
    if (!inF && r() > 0.52) out += `<rect x="${x}" y="${y}" width="1" height="1" fill="#3b2f2a"/>`
  }
  svg.innerHTML = out + finder(1, 1) + finder(21, 1) + finder(1, 21)
})()

// ---------- timeline ----------
const S = [ ['#s1', 0, 3], ['#s2', 3, 6], ['#s3', 6, 11], ['#s4', 11, 14.5], ['#s4b', 14.5, 18], ['#s5', 18, 21.5], ['#s6', 21.5, 25.01] ]

window.renderAt = function (t) {
  S.forEach(([id, a, b]) => show(id, t >= a && t < b))

  if (t < 3) {
    words('#s1', t, 0.05, 0.1, 70)
    const g = $('#s1 .gridwrap')
    const gx = easeOut(p(t, 0.0, 0.6))
    g.style.opacity = gx
    g.style.transform = `translateX(${(1 - gx) * 80}px) scale(${lerp(0.97, 1, gx)})`
    flipCells.forEach((f) => {
      setSlot(f.el, t >= f.at ? 'booked' : 'free', f.name)
      const k = p(t, f.at, 0.18)
      f.el.style.transform = t >= f.at ? `scale(${lerp(1.12, 1, easeOut(k))})` : ''
    })
    $$('#s1 .word').forEach((w) => exitOut(w, t, 3.0, 0.25, -40))
    exitOut(g, t, 3.0, 0.25, -30)
  } else if (t < 6) {
    const tile = $('#s2tile'), word = $('#s2word'), tag = $('#s2tag'), kick = $('#s2kick')
    const k = backOut(p(t, 3.0, 0.45))
    tile.style.opacity = clamp(p(t, 3.0, 0.15))
    tile.style.transform = `scale(${lerp(0.4, 1, k)}) rotate(${lerp(-12, 0, k)}deg)`
    const w = easeOut(p(t, 3.5, 0.5))
    word.style.opacity = w; word.style.transform = `translateX(${(1 - w) * -40}px)`
    rise(tag, t, 4.0, 40, 0.5)
    rise(kick, t, 4.5, 20, 0.5)
    for (const el of [tile, word, tag, kick]) exitOut(el, t, 6.0, 0.25, -30)
  } else if (t < 11) {
    words('#s3h', t, 6.1, 0.1, 60)
    rise($('#s3sub'), t, 6.9, 30, 0.5)
    const ph = $('#phone3')
    const pk = easeOut(p(t, 6.0, 0.6))
    ph.style.opacity = pk
    ph.style.transform = `translateY(${(1 - pk) * 140}px) scale(1.12)`
    setSlot(pick1, t >= 7.0 ? 'selected' : 'free')
    setSlot(pick2, t >= 7.5 ? 'selected' : 'free')
    pick1.style.transform = t >= 7.0 ? `scale(${lerp(0.92, 1, easeOut(p(t, 7.0, 0.2)))})` : ''
    pick2.style.transform = t >= 7.5 ? `scale(${lerp(0.92, 1, easeOut(p(t, 7.5, 0.2)))})` : ''
    const sb = $('#selbar'), sk = easeOut(p(t, 8.0, 0.4))
    sb.style.opacity = sk; sb.style.transform = `translateY(${(1 - sk) * 160}px)`
    const cont = $('#continue')
    cont.style.transform = (t >= 9.5 && t < 9.7) ? 'scale(0.93)' : ''
    const tap = $('#tap3'), scr = $('#phone3 .screen')
    if (t < 7.3) tapAt(tap, scr, pick1, t, 7.0)
    else if (t < 8.5) tapAt(tap, scr, pick2, t, 7.5)
    else tapAt(tap, scr, cont, t, 9.5)
    for (const w of $$('#s3h .word')) exitOut(w, t, 11.0, 0.25, -30)
    exitOut($('#s3sub'), t, 11.0, 0.25, -30)
    exitOut(ph, t, 11.0, 0.25, 40)
  } else if (t < 14.5) {
    words('#s4h', t, 11.1, 0.09, 60)
    $$('#chips .chip').forEach((c, i) => {
      const k = backOut(p(t, 11.5 + i * 0.25, 0.35))
      c.style.opacity = clamp(p(t, 11.5 + i * 0.25, 0.12)); c.style.transform = `scale(${lerp(0.6, 1, k)})`
    })
    rise($('#s4sub'), t, 12.5, 30, 0.5)
    const ph = $('#phone4')
    const pk = easeOut(p(t, 11.0, 0.5))
    ph.style.opacity = pk
    ph.style.transform = `translateY(${(1 - pk) * 120}px) scale(1.12)`
    const secs = Math.max(0, 892 - Math.floor(t - 11))
    $('#countdown').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
    const fn = $('#fname'), attached = t >= 12.0
    fn.textContent = attached ? 'receipt.jpg' : 'No file chosen'
    fn.className = attached ? '' : 'muted'
    fn.style.fontWeight = attached ? '700' : ''
    const fb = $('#phone4 .filebox')
    fb.style.borderColor = attached ? 'var(--accent)' : ''
    fb.style.transform = attached ? `scale(${lerp(1.05, 1, easeOut(p(t, 12.0, 0.25)))})` : ''
    const sub = $('#submitproof')
    sub.textContent = (t >= 12.5 && t < 13.0) ? 'Uploading…' : 'Submit proof of payment'
    sub.style.transform = (t >= 12.5 && t < 12.7) ? 'scale(0.96)' : ''
    const tap = $('#tap4'), scr = $('#phone4 .screen')
    const reviewing = t >= 13.0
    $('#payview').style.display = reviewing ? 'none' : 'flex'
    const rv = $('#reviewview'); rv.style.display = reviewing ? 'flex' : 'none'
    rise(rv, t, 13.0, 24, 0.35)
    if (t < 12.3) tapAt(tap, scr, fb, t, 12.0); else if (!reviewing) tapAt(tap, scr, sub, t, 12.5); else tap.style.opacity = 0
    const st = $$('#steps4 li')
    st[0].className = reviewing ? 'done' : 'current'
    st[1].className = reviewing ? 'current' : ''
    for (const w of $$('#s4h .word')) exitOut(w, t, 14.5, 0.25, -30)
    exitOut($('#chips'), t, 14.5, 0.25, -30)
    exitOut($('#s4sub'), t, 14.5, 0.25, -30)
    exitOut(ph, t, 14.5, 0.25, 40)
  } else if (t < 18) {
    words('#s4bh', t, 14.6, 0.1, 60)
    rise($('#s4bsub'), t, 15.9, 30, 0.5)
    const rc = $('#reviewcard'), k = easeOut(p(t, 14.5, 0.5))
    rc.style.opacity = k
    rc.style.transform = `translateY(calc(-50% + ${(1 - k) * 100}px))`
    const approved = t >= 15.5
    const ap = $('#approve')
    ap.style.transform = (t >= 15.5 && t < 15.7) ? 'scale(0.95)' : ''
    const gone = t >= 15.75
    $('#proofblock').style.display = gone ? 'none' : 'flex'
    if (!gone) tapAt($('#tap4b'), rc, ap, t, 15.5); else $('#tap4b').style.opacity = 0
    const np = $('#noproof'); np.style.display = gone ? 'block' : 'none'
    rise(np, t, 15.75, 10, 0.3)
    const rb = $('#rbadge')
    rb.className = 'badge ' + (approved ? 'status-confirmed' : 'status-payment_submitted')
    rb.textContent = approved ? 'Confirmed' : 'Payment under review'
    rb.style.transform = approved ? `scale(${lerp(1.35, 1, backOut(p(t, 15.5, 0.35)))})` : ''
    const mp = $('#phone4b'), mk = easeOut(p(t, 15.9, 0.5))
    mp.style.opacity = mk
    mp.style.transform = `translateX(${(1 - mk) * 160}px) scale(0.9)`
    for (const w of $$('#s4bh .word')) exitOut(w, t, 18.0, 0.25, -30)
    exitOut($('#s4bsub'), t, 18.0, 0.25, -30)
    if (t > 17.75) {
      const x = easeIn(p(t, 17.75, 0.25))
      rc.style.opacity = 1 - x; rc.style.transform = `translateY(calc(-50% + ${x * 40}px))`
      mp.style.opacity = 1 - x; mp.style.transform = `translateY(${x * 40}px) scale(0.9)`
    }
  } else if (t < 21.5) {
    words('#s5h', t, 18.1, 0.12, 60)
    rise($('#s5sub'), t, 18.7, 30, 0.5)
    const ac = $('#admincard'), k = easeOut(p(t, 18.0, 0.55))
    ac.style.opacity = k
    ac.style.transform = `translateY(calc(-50% + ${(1 - k) * 100}px))`
    $$('#split li').forEach((li, i) => rise(li, t, 18.6 + i * 0.25, 24, 0.4))
    for (const w of $$('#s5h .word')) exitOut(w, t, 21.5, 0.25, -30)
    exitOut($('#s5sub'), t, 21.5, 0.25, -30)
    if (t > 21.25) { const x = easeIn(p(t, 21.25, 0.25)); ac.style.opacity = 1 - x; ac.style.transform = `translateY(calc(-50% + ${x * 40}px))` }
  } else {
    const tile = $('#s6tile'), word = $('#s6word'), tag = $('#s6tag'), url = $('#s6url')
    const k = backOut(p(t, 21.5, 0.45))
    tile.style.opacity = clamp(p(t, 21.5, 0.15))
    tile.style.transform = `scale(${lerp(0.4, 1, k)}) rotate(${lerp(-12, 0, k)}deg)`
    const w = easeOut(p(t, 21.75, 0.5))
    word.style.opacity = w; word.style.transform = `translateX(${(1 - w) * -40}px)`
    rise(tag, t, 22.0, 40, 0.5)
    rise(url, t, 22.5, 24, 0.5)
  }
}
