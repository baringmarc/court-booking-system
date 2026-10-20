// Dev-only palette preview (T9.1): each candidate on real components, light and dark, with its contrast checks.
// Routed only when import.meta.env.DEV, so none of this reaches the production bundle.
import { useState, type CSSProperties } from 'react'
import type { Court } from '../features/catalog/api'
import type { Selection, Slot } from '../features/booking/selection'
import { SlotGrid } from '../features/booking/SlotGrid'
import { PALETTES, paletteChecks, tokenStyle, type Palette, type Tokens } from './palettes'
import './palettes.css'

const courts = ['Badminton 1', 'Badminton 2', 'Badminton 3'].map(
  (name, i) => ({ id: `c${i}`, name, sport: 'badminton' }) as Court,
)
// 2030-01-07, Manila 5 PM, 6 PM and 7 PM (UTC+8).
const times = ['2030-01-07T09:00:00.000Z', '2030-01-07T10:00:00.000Z', '2030-01-07T11:00:00.000Z']
const slot = (court_id: string, i: number, status: Slot['status']): Slot => ({
  court_id, slot_start: times[i], slot_end: new Date(Date.parse(times[i]) + 3_600_000).toISOString(), price: 350, status,
})
const slotsByCourt = new Map<string, Slot[]>([
  ['c0', [slot('c0', 0, 'past'), slot('c0', 1, 'free'), slot('c0', 2, 'free')]],
  ['c1', [slot('c1', 0, 'booked'), slot('c1', 1, 'booked'), slot('c1', 2, 'free')]],
  ['c2', [slot('c2', 0, 'blackout'), slot('c2', 1, 'free'), slot('c2', 2, 'free')]],
])

function Sample({ tokens, scheme }: { tokens: Tokens; scheme: 'light' | 'dark' }) {
  const [selection, setSelection] = useState<Selection>({ courtId: 'c0', starts: [times[1]] })
  const style = { ...tokenStyle(tokens), colorScheme: scheme } as CSSProperties
  return (
    <div className="palette-frame stack" style={style}>
      <div className="palette-bar">
        <strong><span className="brand-mark" aria-hidden="true">◆</span> Claudex Courts</strong>
        <span className="palette-scheme">{scheme}</span>
      </div>
      <div className="form-actions">
        <button type="button" className="btn btn-small">Continue</button>
        <button type="button" className="btn btn-small btn-outline">Clear</button>
        <button type="button" className="btn btn-small btn-danger">Cancel booking</button>
      </div>
      <div className="form-actions">
        <span className="badge status-confirmed">Confirmed</span>
        <span className="badge status-payment_submitted">Payment under review</span>
        <span className="badge status-cancelled">Cancelled</span>
      </div>
      <div className="card">
        <h3>Booking CB-7KQ2XD</h3>
        <p className="muted">Badminton 1 · Mon 7 Jan, 6–7 PM</p>
        <a href="#preview" onClick={(e) => e.preventDefault()}>View booking</a>
      </div>
      <div className="alert alert-info"><p>Pay within 60 minutes to keep your slot.</p></div>
      <div className="alert alert-error"><p>That slot was just taken. Please choose again.</p></div>
      <SlotGrid
        courts={courts}
        times={times}
        slotsByCourt={slotsByCourt}
        selection={selection}
        onToggle={(s) => setSelection({ courtId: s.court_id, starts: [s.slot_start] })}
        timeZone="Asia/Manila"
        currency="PHP"
      />
    </div>
  )
}

function ChecksTable({ palette }: { palette: Palette }) {
  const light = paletteChecks(palette.light)
  const dark = paletteChecks(palette.dark)
  return (
    <table className="palette-checks">
      <caption className="sr-only">{palette.name} contrast checks</caption>
      <thead>
        <tr><th scope="col">Pair</th><th scope="col">Light</th><th scope="col">Dark</th><th scope="col">Needs</th></tr>
      </thead>
      <tbody>
        {light.map((check, i) => (
          <tr key={check.label}>
            <th scope="row">{check.label}</th>
            {[check, dark[i]].map((c, j) => (
              <td key={j} className={c.pass ? 'pass' : 'fail'}>{c.ratio.toFixed(2)}{c.pass ? '' : ' ✗'}</td>
            ))}
            <td>{check.min}:1</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function PalettePreview() {
  return (
    <main className="palette-page">
      <h1>Palette preview</h1>
      <p>Dev only. Each palette on real components, in light and dark mode, with WCAG contrast ratios (AA: 4.5:1 for text, 3:1 for outlines).</p>
      {PALETTES.map((palette, i) => (
        <section key={palette.id} className="palette" aria-labelledby={`palette-${palette.id}`}>
          <h2 id={`palette-${palette.id}`}>{i + 1}. {palette.name}</h2>
          <p className="palette-mood">{palette.mood}</p>
          <div className="palette-pair">
            <Sample tokens={palette.light} scheme="light" />
            <Sample tokens={palette.dark} scheme="dark" />
          </div>
          <ChecksTable palette={palette} />
        </section>
      ))}
    </main>
  )
}
