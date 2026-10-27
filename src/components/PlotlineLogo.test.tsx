import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlotlineLogo, PlotlineTile } from './PlotlineLogo'

describe('PlotlineLogo', () => {
  it('renders the tile as a decorative image at the requested size', () => {
    const { container } = render(<PlotlineTile size={40} />)
    const img = container.querySelector('img')!
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('width', '40')
    expect(img).toHaveAttribute('height', '40')
  })

  it('shows the lowercase wordmark as live text beside the tile', () => {
    render(<PlotlineLogo size={32} />)
    expect(screen.getByText('plotline')).toBeInTheDocument()
  })
})
