// T11.20: the admin waiver card on the settings page.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { updateVenueSettings, type VenueSettings } from '../catalog/api'
import { DEFAULT_WAIVER_TEXT, WAIVER_MAX } from '../venue/waiver'
import { WaiverSection } from './WaiverSection'

vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), updateVenueSettings: vi.fn() }))

function renderSection(waiver_text: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <WaiverSection settings={{ waiver_text }} />
    </QueryClientProvider>,
  )
}

describe('WaiverSection', () => {
  beforeEach(() => {
    vi.mocked(updateVenueSettings).mockReset().mockResolvedValue({ waiver_text: '' } as VenueSettings)
  })

  it('shows a Waiver heading and a textarea seeded with the current text, capped at 2000 characters', () => {
    renderSection('Play at your own risk.')
    expect(screen.getByRole('heading', { name: 'Waiver' })).toBeInTheDocument()
    const box = screen.getByRole('textbox', { name: 'Waiver' })
    expect(box).toHaveValue('Play at your own risk.')
    expect(box).toHaveAttribute('maxlength', String(WAIVER_MAX))
  })

  it("says it is the venue's own text worth having checked, and that blank turns it off", () => {
    renderSection('x')
    expect(screen.getByText(/own text/i)).toBeInTheDocument()
    expect(screen.getByText(/checked/i)).toBeInTheDocument()
    expect(screen.getByText(/blank/i)).toBeInTheDocument()
  })

  it('"Reset to default" fills the box with the default text', async () => {
    renderSection('')
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }))
    expect(screen.getByRole('textbox', { name: 'Waiver' })).toHaveValue(DEFAULT_WAIVER_TEXT)
    expect(updateVenueSettings).not.toHaveBeenCalled()
  })

  it('"Save waiver" saves the edited text and confirms', async () => {
    renderSection('Old text')
    const box = screen.getByRole('textbox', { name: 'Waiver' })
    await userEvent.clear(box)
    await userEvent.type(box, 'New text')
    await userEvent.click(screen.getByRole('button', { name: 'Save waiver' }))
    expect(updateVenueSettings).toHaveBeenCalledWith({ waiver_text: 'New text' })
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('saves an empty string to turn the waiver off', async () => {
    renderSection('Old text')
    await userEvent.clear(screen.getByRole('textbox', { name: 'Waiver' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save waiver' }))
    expect(updateVenueSettings).toHaveBeenCalledWith({ waiver_text: '' })
  })

  it('shows a save error', async () => {
    vi.mocked(updateVenueSettings).mockRejectedValue(new ApiError('permission denied for table venue_settings', '42501'))
    renderSection('Old text')
    await userEvent.click(screen.getByRole('button', { name: 'Save waiver' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
