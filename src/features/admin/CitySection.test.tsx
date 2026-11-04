// T17.8: venue staff retain city editing without platform showcase controls.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { updateVenueSettings, type VenueSettings } from '../catalog/api'
import type { ComponentType } from 'react'

const cityModule = './CitySection.tsx'
const { CitySection } = await import(/* @vite-ignore */ cityModule) as { CitySection: ComponentType<{ settings: Pick<VenueSettings, 'city'> }> }

vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), updateVenueSettings: vi.fn() }))

function renderSection(settings: Pick<VenueSettings, 'city'>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <CitySection settings={settings} />
    </QueryClientProvider>,
  )
}

const savedSettings: VenueSettings = {
  venue_id: '00000000-0000-4000-8000-0000000000a1', name: 'E2E Settings Venue', address: '',
  banner_alt: null, banner_path: null, booking_window_days: 30, cancel_cutoff_hours: 1, city: '', currency: 'PHP',
  maps_url: '', max_rejections: 2, online_payments_enabled: false, payment_hold_minutes: 60,
  payment_instructions: '', showcase_opt_in: false, slot_minutes: 60,
  sport_order: ['badminton', 'pickleball', 'tennis'], theme: 'plotline', timezone: 'Asia/Manila',
  updated_at: '2026-11-04T00:00:00Z', waiver_text: '',
}

describe('CitySection', () => {
  beforeEach(() => {
    vi.mocked(updateVenueSettings).mockReset().mockResolvedValue(savedSettings)
  })

  it('shows the saved city without venue-editable showcase controls', () => {
    renderSection({ city: 'Cebu' })
    expect(screen.queryByRole('heading', { name: 'Showcase' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('Cebu')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('allows a venue with no city to keep the field empty', () => {
    renderSection({ city: '' })
    expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('"Save city" saves only the trimmed city, then confirms', async () => {
    renderSection({ city: '' })
    await userEvent.type(screen.getByRole('textbox', { name: 'City' }), '  Davao  ')
    await userEvent.click(screen.getByRole('button', { name: 'Save city' }))
    expect(updateVenueSettings).toHaveBeenCalledWith({ city: 'Davao' })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('clearing city saves an empty city without writing either showcase flag', async () => {
    renderSection({ city: 'Cebu' })
    await userEvent.clear(screen.getByRole('textbox', { name: 'City' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save city' }))
    expect(updateVenueSettings).toHaveBeenCalledWith({ city: '' })
  })

  it('caps the city at 80 characters', () => {
    renderSection({ city: '' })
    expect(screen.getByRole('textbox', { name: 'City' })).toHaveAttribute('maxlength', '80')
  })

  it('shows a save error', async () => {
    vi.mocked(updateVenueSettings).mockRejectedValue(new ApiError('permission denied for table venue_settings', '42501'))
    renderSection({ city: 'Cebu' })
    await userEvent.click(screen.getByRole('button', { name: 'Save city' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
