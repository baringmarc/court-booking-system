import { useState } from 'react'
import { SPORT_LABELS, type Court, type Sport } from './api'
import { mediaUrl } from './media'

const SPORT_ICONS: Record<Sport, string> = { badminton: '🏸', pickleball: '🏓', basketball: '🏀', tennis: '🎾' }

/**
 * A court's photo at 16:9, lazy-loaded with fixed dimensions so it never shifts the layout. Courts
 * without a photo, or whose photo fails to load, get a neutral placeholder for their sport.
 */
export function CourtPhoto({ court }: { court: Pick<Court, 'name' | 'sport' | 'photo_path'> }) {
  // Remembers which path failed, so a new photo gets a fresh try without an effect.
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const path = court.photo_path

  if (path && path !== failedPath) {
    return (
      <img className="court-photo" src={mediaUrl(path)} alt={`Photo of ${court.name}`} width={640} height={360}
        loading="lazy" decoding="async" onError={() => setFailedPath(path)} />
    )
  }
  return (
    <div className="court-photo court-photo-placeholder" role="img" aria-label={`${SPORT_LABELS[court.sport]} court`}>
      <span aria-hidden="true">{SPORT_ICONS[court.sport]}</span>
    </div>
  )
}
