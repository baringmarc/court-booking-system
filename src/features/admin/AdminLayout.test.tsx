import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { AdminLayout } from './AdminLayout'

function renderAdmin() {
  render(
    <AuthContext.Provider value={authState('admin')}>
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<h1>Dashboard</h1>} />
            <Route path="bookings" element={<h1>Bookings</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('AdminLayout focus', () => {
  it('has a skip link as the first stop that focuses <main>', async () => {
    renderAdmin()
    await userEvent.tab()
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('main')).toHaveFocus()
  })

  it('moves focus to <main> after an admin page change', async () => {
    renderAdmin()
    expect(document.body).toHaveFocus()
    await userEvent.click(screen.getByRole('link', { name: 'Bookings' }))
    expect(await screen.findByRole('heading', { name: 'Bookings' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveFocus()
  })
})
