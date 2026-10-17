import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorMessage } from './ErrorMessage'

describe('ErrorMessage', () => {
  it('shows the error message in an alert', () => {
    render(<ErrorMessage error={new Error('Court not found')} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Court not found')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('falls back to a generic message for non-Error values', () => {
    render(<ErrorMessage error="boom" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.')
  })

  it('calls onRetry when "Try again" is clicked', async () => {
    const onRetry = vi.fn()
    render(<ErrorMessage error={new Error('x')} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
