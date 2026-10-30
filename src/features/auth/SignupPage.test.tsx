import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SignupPage } from './SignupPage'

describe('SignupPage', () => {
  it('no longer warns that confirmation emails are off, and keeps Google sign-in and the form', () => {
    render(<MemoryRouter><SignupPage /></MemoryRouter>)
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    expect(screen.queryByText(/can't send confirmation emails yet/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument()
  })
})
