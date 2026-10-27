import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchAmenities, fetchInfoSections, fetchSocialLinks, type InfoSection } from './api'
import { AmenityChips, CancellationPolicyLink, InfoSections, StayConnected, VenueLocation } from './VenueInfo'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchAmenities: vi.fn(),
  fetchInfoSections: vi.fn(),
  fetchSocialLinks: vi.fn(),
}))

function renderWith(ui: ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter></QueryClientProvider>)
}

const sections: InfoSection[] = [
  { id: 's1', title: 'Waiver', body: 'You play at your own risk.', sort_order: 0 },
  { id: 's2', title: 'Cancellation and refund policy', body: 'Cancel before the cutoff.\n\n**No refunds in the app.**', sort_order: 1 },
]

beforeEach(() => {
  vi.mocked(fetchAmenities).mockReset().mockResolvedValue([
    { id: 'c', builtin_key: null, custom_name: 'Massage chairs', created_at: '2030-01-01' },
    { id: 'w', builtin_key: 'wifi', custom_name: null, created_at: '2030-01-02' },
    { id: 'r', builtin_key: 'restrooms', custom_name: null, created_at: '2030-01-03' },
  ])
  vi.mocked(fetchInfoSections).mockReset().mockResolvedValue(sections)
  vi.mocked(fetchSocialLinks).mockReset().mockResolvedValue([
    { platform: 'website', url: 'https://claudex.example.ph' },
    { platform: 'facebook', url: 'https://www.facebook.com/claudex' },
  ])
  Element.prototype.scrollIntoView = vi.fn()
})

describe('AmenityChips', () => {
  it('shows chips with icons: built-ins in catalog order, then custom ones', async () => {
    renderWith(<AmenityChips />)
    const list = await screen.findByRole('list')
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Restrooms (CR)', 'Wi-Fi', 'Massage chairs'])
    expect(within(list).getAllByRole('listitem')[0].querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('heading', { name: 'Amenities' })).toBeInTheDocument()
  })

  it('renders nothing with no amenities or a failed load', async () => {
    vi.mocked(fetchAmenities).mockResolvedValueOnce([])
    const { container, unmount } = renderWith(<AmenityChips />)
    await vi.waitFor(() => expect(fetchAmenities).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
    unmount()
    vi.mocked(fetchAmenities).mockRejectedValueOnce(new Error('boom'))
    const failed = renderWith(<AmenityChips />)
    await vi.waitFor(() => expect(fetchAmenities).toHaveBeenCalledTimes(2))
    expect(failed.container).toBeEmptyDOMElement()
  })
})

describe('VenueLocation', () => {
  it('shows the address, a lazy map and "Open in Google Maps", with a heading band and no social links', () => {
    renderWith(<VenueLocation venueName="Claudex Courts" address="123 Rizal Ave, Makati" mapsQuery="Claudex Courts Makati" />)
    expect(screen.getByRole('heading', { name: 'Location' })).toBeInTheDocument()
    expect(screen.getByText('123 Rizal Ave, Makati')).toBeInTheDocument()
    const map = screen.getByTitle('Map of Claudex Courts')
    expect(map).toHaveAttribute('loading', 'lazy')
    expect(map).toHaveAttribute('src', 'https://www.google.com/maps?q=Claudex%20Courts%20Makati&output=embed')
    const open = screen.getByRole('link', { name: 'Open in Google Maps (opens in a new tab)' })
    expect(open).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Claudex%20Courts%20Makati')
    expect(open).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('heading', { name: 'Location' })).toHaveClass('card-head')
    // The social links moved to the footer's "Stay connected" band (T11.4).
    expect(screen.queryByRole('list', { name: 'Social links' })).not.toBeInTheDocument()
    expect(fetchSocialLinks).not.toHaveBeenCalled()
  })

  it('is hidden without an address or map search', () => {
    const { container } = renderWith(<VenueLocation venueName="Claudex Courts" address=" " mapsQuery="" />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('StayConnected', () => {
  it('shows the band: fixed text, then a card per link in platform order with its logo', async () => {
    vi.mocked(fetchSocialLinks).mockResolvedValueOnce([
      { platform: 'website', url: 'https://claudex.example.ph' },
      { platform: 'x', url: 'https://x.com/claudex' },
      { platform: 'messenger', url: 'https://m.me/claudex' },
      { platform: 'youtube', url: 'https://www.youtube.com/@claudex' },
      { platform: 'tiktok', url: 'https://www.tiktok.com/@claudex' },
      { platform: 'instagram', url: 'https://www.instagram.com/claudex' },
      { platform: 'facebook', url: 'https://www.facebook.com/claudex' },
    ])
    renderWith(<StayConnected />)
    const band = await screen.findByRole('region', { name: 'Connect with us' })
    expect(within(band).getByText('Stay connected')).toBeInTheDocument()
    expect(within(band).getByText('Follow us on social media for schedules, events, announcements and community updates.')).toBeInTheDocument()
    const links = within(within(band).getByRole('list', { name: 'Social links' })).getAllByRole('link')
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Facebook (opens in a new tab)', 'https://www.facebook.com/claudex'],
      ['Instagram (opens in a new tab)', 'https://www.instagram.com/claudex'],
      ['TikTok (opens in a new tab)', 'https://www.tiktok.com/@claudex'],
      ['YouTube (opens in a new tab)', 'https://www.youtube.com/@claudex'],
      ['X (opens in a new tab)', 'https://x.com/claudex'],
      ['Messenger (opens in a new tab)', 'https://m.me/claudex'],
      ['Website (opens in a new tab)', 'https://claudex.example.ph'],
    ])
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank')
      expect(a).toHaveAttribute('rel', 'noopener noreferrer')
    }
    // Each brand shows its own logo (decorative); the website keeps a plain globe.
    const platforms = links.map((a) => a.querySelector('svg')?.getAttribute('data-platform') ?? null)
    expect(platforms).toEqual(['facebook', 'instagram', 'tiktok', 'youtube', 'x', 'messenger', null])
    for (const a of links) expect(a.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows only the platforms that have a link', async () => {
    // The default mock: website and Facebook, stored out of order.
    renderWith(<StayConnected />)
    const list = await screen.findByRole('list', { name: 'Social links' })
    const links = within(list).getAllByRole('link')
    expect(links.map((a) => a.textContent)).toEqual(['Facebook (opens in a new tab)', 'Website (opens in a new tab)'])
    expect(links[0].querySelector('svg')).toHaveAttribute('data-platform', 'facebook')
    expect(links[1].querySelector('svg')).not.toHaveAttribute('data-platform')
  })

  it('renders nothing when the links fail to load', async () => {
    vi.mocked(fetchSocialLinks).mockRejectedValueOnce(new Error('boom'))
    const { container } = renderWith(<StayConnected />)
    await vi.waitFor(() => expect(fetchSocialLinks).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there are no links', async () => {
    vi.mocked(fetchSocialLinks).mockResolvedValueOnce([])
    const { container } = renderWith(<StayConnected />)
    await vi.waitFor(() => expect(fetchSocialLinks).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe('InfoSections', () => {
  it('renders nothing when the sections fail to load', async () => {
    vi.mocked(fetchInfoSections).mockRejectedValueOnce(new Error('boom'))
    const { container } = renderWith(<InfoSections />)
    await vi.waitFor(() => expect(fetchInfoSections).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('lists the sections as closed panels that open, with the safe markdown body', async () => {
    renderWith(<InfoSections />)
    const waiver = (await screen.findByText('Waiver')).closest('details')!
    expect(waiver).not.toHaveAttribute('open')
    await userEvent.click(screen.getByText('Waiver'))
    expect(waiver).toHaveAttribute('open')
    expect(screen.getByText('No refunds in the app.').tagName).toBe('STRONG')
    expect(screen.getByRole('heading', { name: 'Good to know' })).toBeInTheDocument()
  })

  it('opens and scrolls to the section named in the link', async () => {
    renderWith(<InfoSections />, '/#info-s2')
    const policy = (await screen.findByText('Cancellation and refund policy')).closest('details')!
    expect(policy).toHaveAttribute('open')
    expect(policy).toHaveAttribute('id', 'info-s2')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('renders nothing without sections', async () => {
    vi.mocked(fetchInfoSections).mockResolvedValueOnce([])
    const { container } = renderWith(<InfoSections />)
    await vi.waitFor(() => expect(fetchInfoSections).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})

describe('CancellationPolicyLink', () => {
  it('is hidden when the sections fail to load', async () => {
    vi.mocked(fetchInfoSections).mockRejectedValueOnce(new Error('boom'))
    const { container } = renderWith(<CancellationPolicyLink />)
    await vi.waitFor(() => expect(fetchInfoSections).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it("links to the venue's policy section in a new tab", async () => {
    renderWith(<CancellationPolicyLink />)
    const link = await screen.findByRole('link', { name: 'Cancellation and refund policy (opens in a new tab)' })
    expect(link).toHaveAttribute('href', '/#info-s2')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('is hidden when there is no such section', async () => {
    vi.mocked(fetchInfoSections).mockResolvedValueOnce([sections[0]])
    const { container } = renderWith(<CancellationPolicyLink />)
    await vi.waitFor(() => expect(fetchInfoSections).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
