import { useEffect } from 'react'
import { useVenueSettings } from '../catalog/hooks'

/** The static HTML starts neutral; the settings row supplies this venue's public and admin title. */
export function VenueTitleSync() {
  const name = useVenueSettings().data?.name

  useEffect(() => {
    document.title = name || 'Plotline'
  }, [name])

  useEffect(() => () => {
    document.title = 'Plotline'
  }, [])

  return null
}
