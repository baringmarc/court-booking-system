import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { updateVenueSettings, type VenueSettings } from '../catalog/api'
import { fetchAmenities, fetchInfoSections, fetchSocialLinks, type InfoSection } from '../venue/api'
import { AmenitiesSection } from './AmenitiesSection'
import {
  addCustomAmenity, deleteInfoSection, moveInfoSection, removeAmenity, saveInfoSection, saveSocialLinks, setBuiltinAmenity,
} from './api'
import { InfoSectionsSection } from './InfoSectionsSection'
import { LocationSection } from './LocationSection'
import { SocialLinksSection } from './SocialLinksSection'

vi.mock('../catalog/api', async (importOriginal) => ({ ...(await importOriginal<object>()), updateVenueSettings: vi.fn() }))
vi.mock('../venue/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchSocialLinks: vi.fn(),
  fetchInfoSections: vi.fn(),
  fetchAmenities: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveSocialLinks: vi.fn(),
  saveInfoSection: vi.fn(),
  deleteInfoSection: vi.fn(),
  moveInfoSection: vi.fn(),
  setBuiltinAmenity: vi.fn(),
  addCustomAmenity: vi.fn(),
  removeAmenity: vi.fn(),
}))

function renderWithClient(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const section = (id: string, title: string, sort_order: number): InfoSection => ({ id, title, body: `${title} text`, sort_order })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(updateVenueSettings).mockImplementation(async (v) => v as VenueSettings)
  vi.mocked(fetchSocialLinks).mockResolvedValue([{ platform: 'facebook', url: 'https://www.facebook.com/claudex' }])
  vi.mocked(fetchInfoSections).mockResolvedValue([section('s1', 'Waiver', 0), section('s2', 'House rules', 1)])
  vi.mocked(fetchAmenities).mockResolvedValue([
    { id: 'a1', builtin_key: 'wifi', custom_name: null, created_at: '2030-01-01' },
    { id: 'a2', builtin_key: null, custom_name: 'Massage chairs', created_at: '2030-01-02' },
  ])
  for (const fn of [saveSocialLinks, deleteInfoSection, moveInfoSection, setBuiltinAmenity, addCustomAmenity, removeAmenity]) {
    vi.mocked(fn).mockResolvedValue(undefined)
  }
  vi.mocked(saveInfoSection).mockResolvedValue({ id: 's9' })
})

describe('LocationSection', () => {
  it('saves the trimmed address and map search, and previews the map from them', async () => {
    renderWithClient(<LocationSection settings={{ address: '', maps_query: '' }} />)
    expect(screen.getByText(/Add an address to see the map/)).toBeInTheDocument()
    const form = screen.getByRole('form', { name: 'Location' })
    await userEvent.type(within(form).getByLabelText('Address'), ' 123 Rizal Ave, Makati ')
    fireEvent.blur(within(form).getByLabelText('Address'))
    expect(screen.getByTitle('Map preview: 123 Rizal Ave, Makati')).toHaveAttribute(
      'src', 'https://www.google.com/maps?q=123%20Rizal%20Ave%2C%20Makati&output=embed')
    await userEvent.type(within(form).getByLabelText(/Map search/), 'Claudex Courts')
    await userEvent.click(within(form).getByRole('button', { name: 'Save location' }))
    expect(vi.mocked(updateVenueSettings).mock.calls[0][0]).toEqual({ address: '123 Rizal Ave, Makati', maps_query: 'Claudex Courts' })
    expect(screen.getByTitle('Map preview: Claudex Courts')).toBeInTheDocument()
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
})

describe('SocialLinksSection', () => {
  it("refuses another platform's link before saving, then saves every platform", async () => {
    renderWithClient(<SocialLinksSection />)
    const form = await screen.findByRole('form', { name: 'Social links' })
    expect(within(form).getByLabelText('Facebook')).toHaveValue('https://www.facebook.com/claudex')
    await userEvent.type(within(form).getByLabelText('Instagram'), 'https://www.facebook.com/claudex')
    await userEvent.click(within(form).getByRole('button', { name: 'Save links' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Instagram: use an https:// link like https://www.instagram.com/yourpage.')
    expect(within(form).getByLabelText('Instagram')).toHaveAttribute('aria-invalid', 'true')
    expect(saveSocialLinks).not.toHaveBeenCalled()

    await userEvent.clear(within(form).getByLabelText('Instagram'))
    await userEvent.type(within(form).getByLabelText('Instagram'), ' https://instagram.com/claudex.courts ')
    await userEvent.clear(within(form).getByLabelText('Facebook'))
    await userEvent.click(within(form).getByRole('button', { name: 'Save links' }))
    expect(saveSocialLinks).toHaveBeenCalledWith({
      facebook: '', instagram: 'https://instagram.com/claudex.courts', tiktok: '', youtube: '', x: '', messenger: '', website: '',
    })
  })

  it("shows the server's error", async () => {
    vi.mocked(saveSocialLinks).mockRejectedValue(new ApiError('new row violates check constraint', '23514'))
    renderWithClient(<SocialLinksSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Save links' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Some values aren't valid")
  })
})

describe('InfoSectionsSection', () => {
  it('lists sections in order, moves, edits, adds and deletes them', async () => {
    renderWithClient(<InfoSectionsSection />)
    const list = await screen.findByRole('list')
    expect(within(list).getAllByRole('listitem').map((li) => li.querySelector('strong')?.textContent)).toEqual(['Waiver', 'House rules'])
    expect(screen.getByRole('button', { name: 'Move Waiver up' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Move Waiver down' }))
    expect(moveInfoSection).toHaveBeenCalledWith('s1', 1)

    await userEvent.click(screen.getByRole('button', { name: 'Edit House rules' }))
    const edit = screen.getByRole('form', { name: 'Edit House rules' })
    await userEvent.clear(within(edit).getByLabelText('Title'))
    await userEvent.type(within(edit).getByLabelText('Title'), ' House rules and etiquette ')
    await userEvent.click(within(edit).getByRole('button', { name: 'Save section' }))
    expect(saveInfoSection).toHaveBeenCalledWith('s2', { title: 'House rules and etiquette', body: 'House rules text' })

    const add = screen.getByRole('form', { name: 'New info section' })
    await userEvent.type(within(add).getByLabelText('Title'), 'Parking')
    await userEvent.type(within(add).getByLabelText('Text'), 'Free for players.')
    await userEvent.click(within(add).getByRole('button', { name: 'Add section' }))
    expect(saveInfoSection).toHaveBeenLastCalledWith(null, { title: 'Parking', body: 'Free for players.' })
    expect(await within(screen.getByRole('form', { name: 'New info section' })).findByLabelText('Title')).toHaveValue('')

    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    await userEvent.click(screen.getByRole('button', { name: 'Delete Waiver' }))
    expect(vi.mocked(deleteInfoSection).mock.calls[0][0]).toBe('s1')
  })

  it('shows a validation error from the server on the form', async () => {
    vi.mocked(saveInfoSection).mockRejectedValue(new ApiError('violates check constraint', '23514'))
    renderWithClient(<InfoSectionsSection />)
    const add = await screen.findByRole('form', { name: 'New info section' })
    await userEvent.type(within(add).getByLabelText('Title'), 'Rules')
    await userEvent.click(within(add).getByRole('button', { name: 'Add section' }))
    expect(await within(add).findByRole('alert')).toHaveTextContent("Some values aren't valid")
  })

  it('handles no sections', async () => {
    vi.mocked(fetchInfoSections).mockResolvedValueOnce([])
    renderWithClient(<InfoSectionsSection />)
    expect(await screen.findByText('No info sections yet.')).toBeInTheDocument()
  })

  it('shows a failed load with a retry', async () => {
    vi.mocked(fetchInfoSections).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderWithClient(<InfoSectionsSection />)
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('form', { name: 'New info section' })).toBeInTheDocument()
  })
})

describe('AmenitiesSection', () => {
  it('switches built-ins on and off with their icons, and adds and removes custom ones', async () => {
    renderWithClient(<AmenitiesSection />)
    const wifi = await screen.findByRole('checkbox', { name: 'Wi-Fi' })
    expect(wifi).toBeChecked()
    expect(wifi.parentElement!.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Parking' }))
    expect(setBuiltinAmenity).toHaveBeenCalledWith('parking', true)
    await userEvent.click(wifi)
    expect(setBuiltinAmenity).toHaveBeenLastCalledWith('wifi', false)

    await userEvent.click(screen.getByRole('button', { name: 'Remove Massage chairs' }))
    expect(vi.mocked(removeAmenity).mock.calls[0][0]).toBe('a2')
    const add = screen.getByRole('form', { name: 'Add a custom amenity' })
    await userEvent.type(within(add).getByLabelText('Custom amenity'), ' Sauna ')
    await userEvent.click(within(add).getByRole('button', { name: 'Add' }))
    expect(vi.mocked(addCustomAmenity).mock.calls[0][0]).toBe('Sauna')
  })

  it('flips a built-in at once and back again if the save fails', async () => {
    let fail!: (e: Error) => void
    vi.mocked(setBuiltinAmenity).mockImplementation(() => new Promise((_, reject) => { fail = reject }))
    renderWithClient(<AmenitiesSection />)
    const parking = await screen.findByRole('checkbox', { name: 'Parking' })
    await userEvent.click(parking)
    expect(parking).toBeChecked()
    vi.mocked(fetchAmenities).mockClear()
    fail(new ApiError('permission denied', '42501'))
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have permission")
    expect(parking).not.toBeChecked()
  })

  it('explains a duplicate custom amenity', async () => {
    vi.mocked(addCustomAmenity).mockRejectedValue(new ApiError('duplicate key value', '23505'))
    renderWithClient(<AmenitiesSection />)
    const add = await screen.findByRole('form', { name: 'Add a custom amenity' })
    await userEvent.type(within(add).getByLabelText('Custom amenity'), 'massage chairs')
    await userEvent.click(within(add).getByRole('button', { name: 'Add' }))
    expect(await within(add).findByRole('alert')).toHaveTextContent('That would duplicate something that already exists')
  })
})
