// T11.24: the address and quick facts in the home page hero.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QuickFacts, VenueAddress } from './VenueInfo'

const MAPS = 'https://maps.app.goo.gl/E2eAyalaTriangle'

describe('VenueAddress', () => {
  it('with a valid Maps link: the address is a link opening a new tab', () => {
    render(<VenueAddress address="123 Rizal Ave, Makati City" mapsUrl={MAPS} />)
    const link = screen.getByRole('link', { name: /123 Rizal Ave, Makati City/ })
    expect(link).toHaveAttribute('href', MAPS)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveTextContent('(opens Google Maps in a new tab)')
  })

  it('with no link: plain text', () => {
    render(<VenueAddress address="123 Rizal Ave, Makati City" mapsUrl="" />)
    expect(screen.getByText('123 Rizal Ave, Makati City')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('with an invalid link: plain text', () => {
    render(<VenueAddress address="123 Rizal Ave" mapsUrl="https://maps.google.com.evil.test/x" />)
    expect(screen.getByText('123 Rizal Ave')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('a blank address renders nothing, even with a link', () => {
    const { container } = render(<VenueAddress address="   " mapsUrl={MAPS} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('keeps line breaks and never truncates a long address', () => {
    const long = 'Unit 4, Very Long Building Name Tower\nSome Street, Barangay Poblacion, Makati City 1210'
    render(<VenueAddress address={long} mapsUrl="" />)
    const el = screen.getByText((_, n) => n?.textContent === long && n.classList.contains('pre-line'))
    expect(el).toBeInTheDocument()
  })
})

describe('QuickFacts', () => {
  it('several courts and the slot length', () => {
    render(<QuickFacts courtCount={3} slotMinutes={60} />)
    const list = screen.getByRole('list', { name: 'Quick facts' })
    const items = screen.getAllByRole('listitem')
    expect(list).toBeInTheDocument()
    expect(items.map((i) => i.textContent?.trim())).toEqual(['3 courts', '60-min slots'])
  })

  it('one court is singular', () => {
    render(<QuickFacts courtCount={1} slotMinutes={30} />)
    expect(screen.getByText('1 court')).toBeInTheDocument()
    expect(screen.getByText('30-min slots')).toBeInTheDocument()
  })

  it('no courts: only the slot length', () => {
    render(<QuickFacts courtCount={0} slotMinutes={60} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('60-min slots')).toBeInTheDocument()
    expect(screen.queryByText(/court/)).not.toBeInTheDocument()
  })

  it('courts unknown: only the slot length', () => {
    render(<QuickFacts slotMinutes={60} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('slot length unknown: only the courts', () => {
    render(<QuickFacts courtCount={2} />)
    expect(screen.getAllByRole('listitem').map((i) => i.textContent?.trim())).toEqual(['2 courts'])
  })

  it('nothing known renders nothing', () => {
    const { container } = render(<QuickFacts />)
    expect(container).toBeEmptyDOMElement()
  })

  it('each fact has an icon', () => {
    render(<QuickFacts courtCount={3} slotMinutes={60} />)
    for (const li of screen.getAllByRole('listitem')) expect(li.querySelector('svg')).not.toBeNull()
  })
})
