import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { fetchCourts, fetchVenueSettings, type CourtWithPhotos, type VenueSettings } from '../catalog/api'
import { fetchUpcomingOpenPlay, type OpenPlaySession } from '../openPlay/api'
import { deleteOpenPlay, saveOpenPlay } from './api'
import { OpenPlayPage } from './OpenPlayPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchVenueSettings: vi.fn(),
}))
vi.mock('../openPlay/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchUpcomingOpenPlay: vi.fn(),
}))
vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveOpenPlay: vi.fn(),
  deleteOpenPlay: vi.fn(),
}))

const court = (id: string, name: string, is_active = true) => ({ id, name, sport: 'pickleball', is_active, court_photos: [] }) as unknown as CourtWithPhotos
const upcoming: OpenPlaySession = {
  id: 'S1',
  title: 'Saturday open play',
  details: 'Bring a paddle.',
  links: [{ label: 'RSVP', url: 'https://forms.gle/abc' }],
  starts_at: '2030-01-05T05:00:00.000Z', // 1 PM Manila
  ends_at: '2030-01-05T07:00:00.000Z',
  court_ids: ['A', 'B'],
}
const running: OpenPlaySession = {
  ...upcoming, id: 'S0', title: 'Morning drills', links: [],
  starts_at: new Date(Date.now() - 3_600_000).toISOString(), ends_at: new Date(Date.now() + 3_600_000).toISOString(),
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><OpenPlayPage /></QueryClientProvider>)
}

async function fillNew() {
  const form = await screen.findByRole('form', { name: 'Open play session' })
  await userEvent.click(within(form).getByRole('checkbox', { name: /Pickleball 2/ }))
  fireEvent.change(within(form).getByLabelText('Starts'), { target: { value: '2030-01-05T13:00' } })
  fireEvent.change(within(form).getByLabelText('Ends'), { target: { value: '2030-01-05T15:00' } })
  await userEvent.type(within(form).getByLabelText('Title'), '  Saturday open play ')
  return form
}

describe('OpenPlayPage', () => {
  beforeEach(() => {
    vi.mocked(fetchCourts).mockReset().mockResolvedValue([court('A', 'Pickleball 1'), court('B', 'Pickleball 2')])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
    vi.mocked(fetchUpcomingOpenPlay).mockReset().mockResolvedValue([])
    vi.mocked(saveOpenPlay).mockReset().mockResolvedValue('S9')
    vi.mocked(deleteOpenPlay).mockReset().mockResolvedValue()
  })

  it('adds a session with its courts, times in the venue zone, title and links', async () => {
    renderPage()
    expect(await screen.findByText('No upcoming open play sessions.')).toBeInTheDocument()
    const form = await fillNew()
    await userEvent.type(within(form).getByLabelText('Link 1 label'), 'RSVP')
    await userEvent.type(within(form).getByLabelText('Link 1 address'), 'https://forms.gle/abc')
    await userEvent.click(within(form).getByRole('button', { name: 'Add session' }))
    expect(saveOpenPlay).toHaveBeenCalledWith(null, {
      courtIds: ['B'],
      start: '2030-01-05T05:00:00.000Z',
      end: '2030-01-05T07:00:00.000Z',
      title: 'Saturday open play',
      details: '',
      links: [{ label: 'RSVP', url: 'https://forms.gle/abc' }],
    })
    // The form empties again after a save.
    expect(await within(await screen.findByRole('form', { name: 'Open play session' })).findByLabelText('Title')).toHaveValue('')
  })

  it('catches a missing court and a link that is not https before saving', async () => {
    renderPage()
    const form = await fillNew()
    await userEvent.click(within(form).getByRole('checkbox', { name: /Pickleball 2/ }))
    await userEvent.click(within(form).getByRole('button', { name: 'Add session' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose at least one court.')

    await userEvent.click(within(form).getByRole('checkbox', { name: /Pickleball 1/ }))
    await userEvent.type(within(form).getByLabelText('Link 2 label'), 'Sign up')
    await userEvent.type(within(form).getByLabelText('Link 2 address'), 'http://forms.gle/abc')
    await userEvent.click(within(form).getByRole('button', { name: 'Add session' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Link 2 needs an address starting with https://.')
    expect(saveOpenPlay).not.toHaveBeenCalled()
  })

  it("shows the server's message when the time clashes with bookings", async () => {
    vi.mocked(saveOpenPlay).mockRejectedValue(
      new ApiError('There are bookings on Pickleball 2 at that time. Cancel or move them first.', 'P0001', 'slot_unavailable'),
    )
    renderPage()
    const form = await fillNew()
    await userEvent.click(within(form).getByRole('button', { name: 'Add session' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'There are bookings on Pickleball 2 at that time. Cancel or move them first.',
    )
    expect(within(form).getByLabelText('Title')).toHaveValue('  Saturday open play ')
  })

  it('lists upcoming sessions, edits one that has not started, and only deletes a running one', async () => {
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([running, upcoming])
    renderPage()
    const list = await screen.findByRole('list')
    expect(within(list).getAllByRole('listitem')[1]).toHaveTextContent('Saturday open playSat, Jan 5 · 1 PM – 3 PMPickleball 1, Pickleball 2')
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('In progress')
    expect(screen.queryByRole('button', { name: 'Edit Morning drills' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Edit Saturday open play' }))
    const form = screen.getByRole('form', { name: 'Open play session' })
    expect(screen.getByRole('heading', { name: 'Edit Saturday open play' })).toBeInTheDocument()
    expect(within(form).getByLabelText('Starts')).toHaveValue('2030-01-05T13:00')
    expect(within(form).getByLabelText('Link 1 address')).toHaveValue('https://forms.gle/abc')
    expect(within(form).getByRole('checkbox', { name: /Pickleball 1/ })).toBeChecked()
    await userEvent.clear(within(form).getByLabelText('Title'))
    await userEvent.type(within(form).getByLabelText('Title'), 'Moved')
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(saveOpenPlay).toHaveBeenCalledWith('S1', expect.objectContaining({ title: 'Moved', courtIds: ['A', 'B'] }))
    expect(await screen.findByRole('heading', { name: 'New session' })).toBeInTheDocument()
  })

  it('lists and edits a session whose court was archived, which can be unticked', async () => {
    vi.mocked(fetchCourts).mockResolvedValue([court('A', 'Pickleball 1'), court('B', 'Pickleball 2', false)])
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([upcoming])
    renderPage()
    expect(await screen.findByText('Pickleball 1, Pickleball 2')).toBeInTheDocument()
    // A new session only offers active courts.
    expect(within(screen.getByRole('form', { name: 'Open play session' })).queryByRole('checkbox', { name: /Pickleball 2/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Saturday open play' }))
    const form = screen.getByRole('form', { name: 'Open play session' })
    const archived = within(form).getByRole('checkbox', { name: /Pickleball 2.*\(archived\)/ })
    expect(archived).toBeChecked()
    await userEvent.click(archived)
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(saveOpenPlay).toHaveBeenCalledWith('S1', expect.objectContaining({ courtIds: ['A'] }))
  })

  it('deletes a session after confirming', async () => {
    vi.mocked(fetchUpcomingOpenPlay).mockResolvedValue([running])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Morning drills' }))
    expect(deleteOpenPlay).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Morning drills' }))
    expect(vi.mocked(deleteOpenPlay).mock.calls[0][0]).toBe('S0')
    confirm.mockRestore()
  })

  it('shows an error with a retry when the sessions fail to load', async () => {
    vi.mocked(fetchUpcomingOpenPlay).mockRejectedValue(new TypeError('Failed to fetch'))
    renderPage()
    expect(await screen.findByText(/Could not reach the server/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
