import type { CourtWithPhotos } from './api'
import { CourtGallery } from './CourtGallery'

type Props = {
  courts: CourtWithPhotos[]
  /** The court info panel on /book: descriptions, and every photo as a swipeable gallery. */
  detailed?: boolean
}

/** Court cards with each court's cover photo (or a sport placeholder) and name. */
export function CourtTiles({ courts, detailed = false }: Props) {
  return (
    <ul className="court-tiles">
      {courts.map((c) => (
        <li key={c.id} className="court-tile">
          {detailed ? (
            <CourtGallery court={c} photos={c.court_photos} />
          ) : (
            <CourtGallery court={c} photos={c.court_photos} coverOnly />
          )}
          <div className="court-tile-body">
            <p className="court-tile-name">{c.name}</p>
            {detailed && c.description && <p className="muted small">{c.description}</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}
