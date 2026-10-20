import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SignupPage } from './SignupPage'

describe('SignupPage', () => {
  it('points visitors to Google sign-in or guest booking while confirmation emails are off', () => {
    render(<MemoryRouter><SignupPage /></MemoryRouter>)
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent(/can't send confirmation emails yet/)
    expect(note).toHaveTextContent('Continue with Google')
    expect(screen.getByRole('link', { name: 'book as a guest' })).toHaveAttribute('href', '/book')
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeInTheDocument()
  })
})
