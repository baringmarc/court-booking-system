import type { Court } from './api'
import { CourtPhoto } from './CourtPhoto'

/** Court cards with each court's photo (or a sport placeholder), name and description. */
export function CourtTiles({ courts, showDescription = false }: { courts: Court[]; showDescription?: boolean }) {
  return (
    <ul className="court-tiles">
      {courts.map((c) => (
        <li key={c.id} className="court-tile">
          <CourtPhoto court={c} />
          <div className="court-tile-body">
            <p className="court-tile-name">{c.name}</p>
            {showDescription && c.description && <p className="muted small">{c.description}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}
