import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { authState } from '../test/authState'
import { AuthContext } from '../features/auth/AuthContext'
import { Layout } from './Layout'

describe('Layout (public header)', () => {
  it('has no Admin link, even for an admin', () => {
    render(
      <AuthContext.Provider value={authState('admin')}>
        <MemoryRouter><Layout /></MemoryRouter>
      </AuthContext.Provider>,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav).toHaveTextContent('Book')
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument()
  })
})
