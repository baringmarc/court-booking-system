// T14.13: the admin showcase card on the settings page.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { updateVenueSettings, type VenueSettings } from '../catalog/api'
import { ShowcaseSection } from './ShowcaseSection'

vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), updateVenueSettings: vi.fn() }))

function renderSection(settings: Pick<VenueSettings, 'city' | 'showcase_opt_in'>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ShowcaseSection settings={settings} />
    </QueryClientProvider>,
  )
}

describe('ShowcaseSection', () => {
  beforeEach(() => {
    vi.mocked(updateVenueSettings).mockReset().mockResolvedValue({ city: '' } as VenueSettings)
  })

  it('shows a Showcase heading, the city seeded from settings and the opt-in checkbox', () => {
    renderSection({ city: 'Cebu', showcase_opt_in: true })
    expect(screen.getByRole('heading', { name: 'Showcase' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('Cebu')
    expect(screen.getByRole('checkbox', { name: 'List this venue on the Plotline website' })).toBeChecked()
  })

  it('is unchecked and empty for a venue that has not opted in', () => {
    renderSection({ city: '', showcase_opt_in: false })
    expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: 'List this venue on the Plotline website' })).not.toBeChecked()
  })

  it('"Save showcase" saves the trimmed city and the opt-in, then confirms', async () => {
    renderSection({ city: '', showcase_opt_in: false })
    await userEvent.type(screen.getByRole('textbox', { name: 'City' }), '  Davao  ')
    await userEvent.click(screen.getByRole('checkbox', { name: 'List this venue on the Plotline website' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save showcase' }))
    expect(updateVenueSettings).toHaveBeenCalledWith({ city: 'Davao', showcase_opt_in: true })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('opting out saves showcase_opt_in false and keeps the city', async () => {
    renderSection({ city: 'Cebu', showcase_opt_in: true })
    await userEvent.click(screen.getByRole('checkbox', { name: 'List this venue on the Plotline website' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save showcase' }))
    expect(updateVenueSettings).toHaveBeenCalledWith({ city: 'Cebu', showcase_opt_in: false })
  })

  it('caps the city at 80 characters', () => {
    renderSection({ city: '', showcase_opt_in: false })
    expect(screen.getByRole('textbox', { name: 'City' })).toHaveAttribute('maxlength', '80')
  })

  it('shows a save error', async () => {
    vi.mocked(updateVenueSettings).mockRejectedValue(new ApiError('permission denied for table venue_settings', '42501'))
    renderSection({ city: 'Cebu', showcase_opt_in: true })
    await userEvent.click(screen.getByRole('button', { name: 'Save showcase' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
