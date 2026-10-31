// T13.4: admin means "member of THIS venue", not "member of any venue".
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { authState } from '../../test/authState'
import { VenueContext } from '../venue/VenueContext'
import { AuthContext, type AuthState } from './AuthContext'
import { useIsVenueAdmin } from './useIsVenueAdmin'

function Probe() {
  return <p>{useIsVenueAdmin() ? 'yes' : 'no'}</p>
}

function renderProbe(auth: AuthState, venueId = 'venue-a') {
  render(
    <VenueContext.Provider value={{ id: venueId, slug: 'a-venue', status: 'active' }}>
      <AuthContext.Provider value={auth}><Probe /></AuthContext.Provider>
    </VenueContext.Provider>,
  )
}

describe('useIsVenueAdmin (T13.4)', () => {
  it('true for a member of this venue', () => {
    renderProbe(authState('admin', { venueIds: ['venue-a'] }))
    expect(screen.getByText('yes')).toBeInTheDocument()
  })

  it('true when this venue is one of several', () => {
    renderProbe(authState('admin', { venueIds: ['venue-b', 'venue-a'] }))
    expect(screen.getByText('yes')).toBeInTheDocument()
  })

  it('false for a member of another venue only, even though isAdmin is true', () => {
    renderProbe(authState('admin', { venueIds: ['venue-b'], isAdmin: true }))
    expect(screen.getByText('no')).toBeInTheDocument()
  })

  it('false for a player and for anon', () => {
    renderProbe(authState('player'))
    expect(screen.getByText('no')).toBeInTheDocument()
  })

  it('false for anon', () => {
    renderProbe(authState('anon'))
    expect(screen.getByText('no')).toBeInTheDocument()
  })
})
