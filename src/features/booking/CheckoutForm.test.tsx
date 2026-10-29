import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CheckoutForm } from './CheckoutForm'

const empty = { name: '', email: '', phone: '' }

describe('CheckoutForm', () => {
  it('shows field errors and does not submit an incomplete guest form', async () => {
    const onSubmit = vi.fn()
    render(<CheckoutForm initial={empty} isGuest pending={false} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('Please enter your name.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Please enter your email.')
  })

  it('submits a trimmed guest contact', async () => {
    const onSubmit = vi.fn()
    render(<CheckoutForm initial={empty} isGuest pending={false} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Name'), '  Gina Guest ')
    await userEvent.type(screen.getByLabelText('Email'), 'gina@example.com')
    await userEvent.type(screen.getByLabelText('Mobile number (optional)'), '+63 917 222 2222')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Gina Guest', email: 'gina@example.com', phone: '09172222222' }, false)
  })

  it('lets a guest book without a phone number and submits an empty phone', async () => {
    const onSubmit = vi.fn()
    render(<CheckoutForm initial={empty} isGuest pending={false} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Gina Guest')
    await userEvent.type(screen.getByLabelText('Email'), 'gina@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Gina Guest', email: 'gina@example.com', phone: '' }, false)
  })

  it('labels the phone field as optional with a privacy hint, for guests and players', () => {
    const { unmount } = render(<CheckoutForm initial={empty} isGuest pending={false} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('Mobile number (optional)')).toBeInTheDocument()
    expect(screen.getByText(/The venue uses it only to reach you about your booking\./)).toBeInTheDocument()
    unmount()
    render(<CheckoutForm initial={empty} isGuest={false} pending={false} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('Mobile number (optional)')).toBeInTheDocument()
    expect(screen.getByText(/The venue uses it only to reach you about your booking\./)).toBeInTheDocument()
  })

  it('shows PHONE_ERROR for an invalid number and does not submit', async () => {
    const onSubmit = vi.fn()
    render(<CheckoutForm initial={{ name: 'Pat', email: 'p@example.com', phone: '' }} isGuest pending={false} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Mobile number (optional)'), '028123456')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Mobile number (optional)')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter an 11-digit mobile number, like 09171234567.')).toBeInTheDocument()
  })

  it('prefills a logged-in player and keeps their account email read-only', async () => {
    const onSubmit = vi.fn()
    render(
      <CheckoutForm initial={{ name: 'Pat Player', email: 'pat@example.com', phone: '' }} isGuest={false}
        pending={false} onSubmit={onSubmit} />,
    )
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm booking' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Pat Player', email: 'pat@example.com', phone: '' }, false)
  })

  it('disables the button while the booking is being created', () => {
    render(<CheckoutForm initial={empty} isGuest pending onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Reserving…' })).toBeDisabled()
  })
})
