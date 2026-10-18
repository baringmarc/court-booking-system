import { useState } from 'react'
import { useVenueSettings } from './hooks'
import { mediaUrl } from './media'

/**
 * The optional site banner, home page only (SPEC §7): an image with its alt text, no headline or link.
 * Renders nothing at all while settings load or fail, when no banner is set, or if the image fails.
 */
export function HomeBanner() {
  const settings = useVenueSettings()
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const path = settings.data?.banner_path
  const alt = settings.data?.banner_alt

  if (!path || !alt || path === failedPath) return null
  return (
    <img className="home-banner" src={mediaUrl(path)} alt={alt} width={2200} height={733}
      fetchPriority="high" decoding="async" onError={() => setFailedPath(path)} />
  )
}
