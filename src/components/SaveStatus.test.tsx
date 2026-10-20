import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../lib/queryClient'
import { SaveStatus } from './SaveStatus'

describe('SaveStatus', () => {
  it('shows Saved after a successful save', () => {
    render(<SaveStatus isSuccess error={null} />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('translates a raw database error from an admin save', () => {
    render(<SaveStatus isSuccess={false} error={new ApiError('new row for relation "venue_settings" violates check constraint', '23514')} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Some values aren't valid. Check the form and try again.")
    expect(screen.getByRole('alert')).not.toHaveTextContent('venue_settings')
  })

  it('shows nothing before a save', () => {
    const { container } = render(<SaveStatus isSuccess={false} error={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})
