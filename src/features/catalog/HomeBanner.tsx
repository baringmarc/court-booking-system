import { useState } from 'react'
import { PhotoViewer } from '../../components/PhotoViewer'
import { useVenueSettings } from './hooks'
import { mediaUrl } from './media'

/**
 * The optional site banner, home page only (SPEC §7): an image with its alt text, no headline or link.
 * Renders nothing at all while settings load or fail, when no banner is set, or if the image fails.
 * Tapping it opens the whole image full screen (T9.11e).
 */
export function HomeBanner() {
  const settings = useVenueSettings()
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)
  const path = settings.data?.banner_path
  const alt = settings.data?.banner_alt

  if (!path || !alt || path === failedPath) return null
  return (
    <>
      <button type="button" className="photo-open banner-open" aria-label={`View full screen: ${alt}`} onClick={() => setViewing(true)}>
        <img className="home-banner" src={mediaUrl(path)} alt={alt} width={2200} height={733}
          fetchPriority="high" decoding="async" onError={() => setFailedPath(path)} />
      </button>
      {viewing && (
        <PhotoViewer photos={[{ src: mediaUrl(path), alt }]} start={0} label="Banner photo" onClose={() => setViewing(false)} />
      )}
    </>
  )
}
