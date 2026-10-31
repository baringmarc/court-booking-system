import { beforeEach, describe, expect, it } from 'vitest'
import { currentVenue, currentVenueId, setCurrentVenue, type CurrentVenue } from './currentVenue'

const venue: CurrentVenue = { id: 'b0000000-0000-4000-8000-0000000000b1', slug: 'bay-courts', status: 'active' }

beforeEach(() => setCurrentVenue(null))

describe('currentVenue (T13.3)', () => {
  it('throws "No venue is selected." when nothing is set', () => {
    expect(() => currentVenue()).toThrow('No venue is selected.')
    expect(() => currentVenueId()).toThrow('No venue is selected.')
  })

  it('returns the venue that was set, and its id', () => {
    setCurrentVenue(venue)
    expect(currentVenue()).toEqual(venue)
    expect(currentVenueId()).toBe(venue.id)
  })

  it('setting null clears it again', () => {
    setCurrentVenue(venue)
    setCurrentVenue(null)
    expect(() => currentVenue()).toThrow('No venue is selected.')
  })

  it('replaces the venue when set twice', () => {
    setCurrentVenue(venue)
    setCurrentVenue({ ...venue, id: 'b0000000-0000-4000-8000-0000000000b2', slug: 'other-courts' })
    expect(currentVenueId()).toBe('b0000000-0000-4000-8000-0000000000b2')
    expect(currentVenue().slug).toBe('other-courts')
  })
})
