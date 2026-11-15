import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CheckoutForm } from './CheckoutForm'

const empty = { name: '', email: '', phone: '' }

describe('CheckoutForm', () => {
  it('shows field errors and does not submit an incomplete guest form', async () => {
    const onSubmit = vi.fn()
    render(<CheckoutForm initial={empty} isGuest pending={false} onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reserve and continue to payment' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Reserve and continue to payment' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Gina Guest', email: 'gina@example.com', phone: '09172222222' }, false)
  })

  it('lets a guest book without a phone number and submits an empty phone', async () => {
    const onSubmit = vi.fn()
    render(<CheckoutForm initial={empty} isGuest pending={false} onSubmit={onSubmit} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Gina Guest')
    await userEvent.type(screen.getByLabelText('Email'), 'gina@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Reserve and continue to payment' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Reserve and continue to payment' }))
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
    await userEvent.click(screen.getByRole('button', { name: 'Reserve and continue to payment' }))
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Pat Player', email: 'pat@example.com', phone: '' }, false)
  })

  it('disables the button while the booking is being created', () => {
    render(<CheckoutForm initial={empty} isGuest pending onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Reserving…' })).toBeDisabled()
  })

  it('names the submit button "Reserve and continue to payment"', () => {
    render(<CheckoutForm initial={empty} isGuest pending={false} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Reserve and continue to payment' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Confirm booking' })).not.toBeInTheDocument()
  })

  it.each([
    [24, 'Free online cancellation until 24 hours before your start time'],
    [1, 'Free online cancellation until 1 hour before your start time'],
    [0, 'Free online cancellation until your start time'],
  ])('discloses the cancellation cutoff for %i hours', (hours, text) => {
    render(<CheckoutForm initial={empty} isGuest pending={false} onSubmit={vi.fn()} cancelCutoffHours={hours} />)
    expect(screen.getByText(text, { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Refunds for paid bookings are arranged with the venue.', { exact: false })).toBeInTheDocument()
  })

  it('does not say "1 hours" for a one-hour cutoff', () => {
    render(<CheckoutForm initial={empty} isGuest pending={false} onSubmit={vi.fn()} cancelCutoffHours={1} />)
    expect(screen.queryByText(/1 hours/)).not.toBeInTheDocument()
  })

  it('shows no cancellation disclosure when the cutoff is not given', () => {
    render(<CheckoutForm initial={empty} isGuest pending={false} onSubmit={vi.fn()} />)
    expect(screen.queryByText(/Free online cancellation/)).not.toBeInTheDocument()
  })

  it('keeps "Reserving…" on the pending button with the disclosure shown', () => {
    render(<CheckoutForm initial={empty} isGuest pending onSubmit={vi.fn()} cancelCutoffHours={24} />)
    expect(screen.getByRole('button', { name: 'Reserving…' })).toBeDisabled()
    expect(screen.getByText(/Free online cancellation until 24 hours/)).toBeInTheDocument()
  })
})
