import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { fetchCourts, fetchOperatingHours, fetchVenueSettings, type CourtWithPhotos, type OperatingHours, type VenueSettings } from '../catalog/api'
import { fetchUpcomingOpenPlay, type OpenPlaySession } from '../openPlay/api'
import { deleteOpenPlay, saveOpenPlay } from './api'
import { OpenPlayPage } from './OpenPlayPage'

vi.mock('../catalog/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchCourts: vi.fn(),
  fetchOperatingHours: vi.fn(),
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
// The clock is Fri 2030-01-04 10 AM in Manila, so "Tomorrow" is the session's Saturday.
const NOW = new Date('2030-01-04T02:00:00.000Z')
const running: OpenPlaySession = {
  ...upcoming, id: 'S0', title: 'Morning drills', links: [],
  starts_at: '2030-01-04T01:00:00.000Z', ends_at: '2030-01-04T03:00:00.000Z',
}
const sixToTen = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, open_time: '06:00:00', close_time: '22:00:00', is_closed: false })) as OperatingHours[]

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><OpenPlayPage /></QueryClientProvider>)
}

async function fillNew() {
  const form = await screen.findByRole('form', { name: 'Open play session' })
  await userEvent.click(within(form).getByRole('checkbox', { name: /Pickleball 2/ }))
  await userEvent.click(within(form).getByRole('button', { name: 'Tomorrow' }))
  await userEvent.click(within(form).getByRole('radio', { name: '1 PM' }))
  await userEvent.click(within(form).getByRole('radio', { name: '2 hrs' }))
  await userEvent.type(within(form).getByLabelText('Title'), '  Saturday open play ')
  return form
}

describe('OpenPlayPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    vi.mocked(fetchOperatingHours).mockReset().mockResolvedValue(sixToTen)
    vi.mocked(fetchCourts).mockReset().mockResolvedValue([court('A', 'Pickleball 1'), court('B', 'Pickleball 2')])
    vi.mocked(fetchVenueSettings).mockReset().mockResolvedValue({ timezone: 'Asia/Manila' } as VenueSettings)
    vi.mocked(fetchUpcomingOpenPlay).mockReset().mockResolvedValue([])
    vi.mocked(saveOpenPlay).mockReset().mockResolvedValue('S9')
    vi.mocked(deleteOpenPlay).mockReset().mockResolvedValue()
  })

  afterEach(() => {
    vi.useRealTimers()
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

  it('offers only the hours left today and asks for a start and a length', async () => {
    renderPage()
    const form = await screen.findByRole('form', { name: 'Open play session' })
    await userEvent.click(within(form).getByRole('checkbox', { name: /Pickleball 1/ }))
    expect(within(form).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true')
    // 10 AM has started: today starts at 11 AM and runs to 9 PM.
    const starts = within(within(form).getByRole('group', { name: 'Starts' }))
    expect(starts.queryByRole('radio', { name: '10 AM' })).toBeNull()
    expect(starts.getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual(
      ['11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM'])
    expect(within(form).getByText('Choose a start time first.')).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Title'), 'Drills')
    await userEvent.click(within(form).getByRole('button', { name: 'Add session' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose a start time.')

    await userEvent.click(within(form).getByRole('radio', { name: '8 PM' }))
    expect(within(within(form).getByRole('group', { name: 'How long' })).getAllByRole('radio')).toHaveLength(2)
    await userEvent.click(within(form).getByRole('button', { name: 'Add session' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose how long the session runs.')

    // A length that no longer fits after moving the start drops out instead of being sent.
    await userEvent.click(within(form).getByRole('radio', { name: '2 hrs' }))
    await userEvent.click(within(form).getByRole('radio', { name: '9 PM' }))
    expect(within(form).getByRole('radio', { name: '1 hr' })).not.toBeChecked()
    await userEvent.click(within(form).getByRole('button', { name: 'Add session' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose how long the session runs.')
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
    expect(within(form).getByRole('button', { name: 'Tomorrow' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(form).getByRole('radio', { name: '1 PM' })).toBeChecked()
    expect(within(form).getByRole('radio', { name: '2 hrs' })).toBeChecked()
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
