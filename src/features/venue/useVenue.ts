import { useContext } from 'react'
import type { CurrentVenue } from '../../lib/currentVenue'
import { VenueContext } from './VenueContext'

export function useVenue(): CurrentVenue {
  const venue = useContext(VenueContext)
  if (!venue) throw new Error('useVenue must be used inside VenueProvider.')
  return venue
}
