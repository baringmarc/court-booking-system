import type { Tables } from './database.types'

/** The venue this page belongs to. It comes from the host and can't change without a page load (another venue is another subdomain). */
export type CurrentVenue = Pick<Tables<'venues'>, 'id' | 'slug' | 'status'>

let current: CurrentVenue | null = null

/** Set once by `VenueProvider`, before any page renders. */
export function setCurrentVenue(venue: CurrentVenue | null) {
  current = venue
}

export function currentVenue(): CurrentVenue {
  if (!current) throw new Error('No venue is selected.')
  return current
}

export function currentVenueId() {
  return currentVenue().id
}
