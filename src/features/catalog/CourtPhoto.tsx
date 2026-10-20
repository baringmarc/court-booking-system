import { useState } from 'react'
import { SPORT_LABELS, type Court, type Sport } from './api'
import { mediaUrl } from './media'

const SPORT_ICONS: Record<Sport, string> = { badminton: '🏸', pickleball: '🏓', basketball: '🏀', tennis: '🎾' }

type Props = {
  court: Pick<Court, 'name' | 'sport'>
  /** The stored object path, or null for no photo. */
  path: string | null
  /** Defaults to "Photo of {court}". */
  alt?: string
}

/**
 * A court photo at 16:9, lazy-loaded with fixed dimensions so it never shifts the layout. No photo, or one
 * that fails to load, gets a neutral placeholder for the court's sport.
 */
export function CourtPhoto({ court, path, alt }: Props) {
  // Remembers which path failed, so a new photo gets a fresh try without an effect.
  const [failedPath, setFailedPath] = useState<string | null>(null)

  if (path && path !== failedPath) {
    return (
      <img className="court-photo" src={mediaUrl(path)} alt={alt ?? `Photo of ${court.name}`} width={640} height={360}
        loading="lazy" decoding="async" onError={() => setFailedPath(path)} />
    )
  }
  return <SportPlaceholder sport={court.sport} />
}

export function SportPlaceholder({ sport }: { sport: Sport }) {
  return (
    <div className="court-photo court-photo-placeholder" role="img" aria-label={`${SPORT_LABELS[sport]} court`}>
      <span aria-hidden="true">{SPORT_ICONS[sport]}</span>
    </div>
  )
}
