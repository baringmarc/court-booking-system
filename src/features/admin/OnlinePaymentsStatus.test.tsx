// T11.23: the read-only online payments line on the settings page. Plotline manages the switch, not the venue.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OnlinePaymentsStatus } from './OnlinePaymentsStatus'

describe('OnlinePaymentsStatus', () => {
  it('on: a heading and "Online payments (PayMongo): On. Managed by Plotline."', () => {
    render(<OnlinePaymentsStatus enabled />)
    expect(screen.getByRole('heading', { name: 'Online payments' })).toBeInTheDocument()
    expect(screen.getByText('Online payments (PayMongo): On. Managed by Plotline.')).toBeInTheDocument()
  })

  it('off: "Online payments (PayMongo): Off. Managed by Plotline."', () => {
    render(<OnlinePaymentsStatus enabled={false} />)
    expect(screen.getByText('Online payments (PayMongo): Off. Managed by Plotline.')).toBeInTheDocument()
  })

  it('has no control to change it', () => {
    render(<OnlinePaymentsStatus enabled />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
