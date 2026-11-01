// T14.11: the admin nav links to the statement.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { VenueContext } from '../venue/VenueContext'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { AdminLayout } from './AdminLayout'

vi.mock('../auth/api', () => ({ fetchMemberVenues: vi.fn().mockResolvedValue([]) }))
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<object>()), subscribeToBookingChanges: () => () => {} }))

const VENUE = { id: 'venue-a', slug: 'a-venue', status: 'active' as const }
beforeEach(() => { setCurrentVenue(VENUE) })

describe('AdminLayout statement link', () => {
  it('has a "Statement" link to /admin/statement in the admin nav', () => {
    render(
      <QueryClientProvider client={new QueryClient()}><VenueContext.Provider value={VENUE}><AuthContext.Provider value={authState('admin')}>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes><Route path="/admin" element={<AdminLayout />}><Route index element={<h1>Dashboard</h1>} /></Route></Routes>
        </MemoryRouter>
      </AuthContext.Provider></VenueContext.Provider></QueryClientProvider>,
    )
    expect(screen.getByRole('link', { name: 'Statement' })).toHaveAttribute('href', '/admin/statement')
  })
})
