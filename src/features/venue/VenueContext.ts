import { createContext } from 'react'
import type { CurrentVenue } from '../../lib/currentVenue'

export const VenueContext = createContext<CurrentVenue | null>(null)
