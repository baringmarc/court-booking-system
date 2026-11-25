// T34.1: the "Share your booking site" QR card in the admin sidebar, the collapsed-sidebar dialog and the mobile drawer.
// The canvas is stubbed (jsdom has none); bookingQr.ts itself runs for real.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { venueBookUrl } from '../../lib/venueUrl'
import { authState } from '../../test/authState'
import { AuthContext } from '../auth/AuthContext'
import { fetchMemberVenues } from '../auth/api'
import { VenueContext } from '../venue/VenueContext'
import { AdminLayout } from './AdminLayout'
import { subscribeToBookingChanges } from './api'

const h = vi.hoisted(() => ({ settings: { name: 'Test Venue', logo_path: null as string | null } }))
vi.mock('../auth/api', () => ({ fetchMemberVenues: vi.fn().mockResolvedValue([]) }))
vi.mock('./api', async (original) => ({ ...(await original<object>()), subscribeToBookingChanges: vi.fn() }))
vi.mock('../catalog/hooks', async (original) => ({ ...(await original<object>()), useVenueSettings: () => ({ data: h.settings }) }))
vi.mock('../catalog/media', () => ({ mediaUrl: (path: string) => `https://cdn.test/${path}` }))

const venue = { id: 'venue-a', slug: 'a-venue', status: 'active' as const }
const ADDRESS = venueBookUrl('a-venue', window.location)
const ALT = "QR code for Test Venue's booking site"

const ctx = {
  fillStyle: '', strokeStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
  fillRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), arcTo: vi.fn(), arc: vi.fn(),
  closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(), rect: vi.fn(), save: vi.fn(), restore: vi.fn(), clip: vi.fn(), roundRect: vi.fn(),
}
const state = { logoFails: false, hold: false, held: [] as (() => void)[], urls: 0, clicked: [] as { download: string; href: string }[] }
class FakeImage {
  crossOrigin: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  width = 100
  height = 100
  naturalWidth = 100
  naturalHeight = 100
  private url = ''
  get src() { return this.url }
  set src(value: string) {
    this.url = value
    queueMicrotask(() => (state.logoFails ? this.onerror?.() : this.onload?.()))
  }
}

let client: QueryClient
const auth = authState('admin')
function tree() {
  return (
    <QueryClientProvider client={client}>
      <VenueContext.Provider value={venue}><AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={['/admin']}><Routes>
          <Route path="/admin" element={<AdminLayout />}><Route index element={<h1>Dashboard page</h1>} /></Route>
        </Routes></MemoryRouter>
      </AuthContext.Provider></VenueContext.Provider>
    </QueryClientProvider>
  )
}
const mount = () => render(tree())

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  setCurrentVenue(venue)
  h.settings = { name: 'Test Venue', logo_path: null }
  state.logoFails = false
  state.hold = false
  state.held = []
  state.urls = 0
  state.clicked = []
  for (const fn of Object.values(ctx)) if (typeof fn === 'function') (fn as ReturnType<typeof vi.fn>).mockReset()
  vi.mocked(fetchMemberVenues).mockReset().mockResolvedValue([])
  vi.mocked(subscribeToBookingChanges).mockReset().mockImplementation(() => () => {})
  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:qr-${++state.urls}`), revokeObjectURL: vi.fn() }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback, type) => {
    const deliver = () => callback(new Blob([new Uint8Array(8)], { type: type ?? 'image/png' }))
    if (state.hold) state.held.push(deliver)
    else deliver()
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    state.clicked.push({ download: this.download, href: this.href })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const aside = () => document.querySelector('aside.admin-sidebar') as HTMLElement
const saveIn = (root: HTMLElement) => within(root).getByRole('button', { name: 'Save' })

describe('T34.1 sidebar card', () => {
  it('shows the QR image, the heading text and Save, above the Collapse sidebar button', async () => {
    mount()
    const img = await within(aside()).findByRole('img', { name: ALT })
    expect(img).toHaveAttribute('src', 'blob:qr-1')
    expect(within(aside()).getByText('Share your booking site')).toBeInTheDocument()
    await waitFor(() => expect(saveIn(aside())).toBeEnabled())
    const collapse = within(aside()).getByRole('button', { name: 'Collapse sidebar' })
    expect(collapse.compareDocumentPosition(saveIn(aside())) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(collapse.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('shows a placeholder and a disabled Save while drawing, then the image and an enabled Save', async () => {
    state.hold = true
    mount()
    await waitFor(() => expect(state.held).toHaveLength(1))
    expect(within(aside()).queryByRole('img', { name: ALT })).not.toBeInTheDocument()
    expect(saveIn(aside())).toBeDisabled()
    act(() => state.held.forEach((deliver) => deliver()))
    expect(await within(aside()).findByRole('img', { name: ALT })).toHaveAttribute('src', 'blob:qr-1')
    expect(saveIn(aside())).toBeEnabled()
  })

  it('Save downloads the PNG as <slug>-booking-qr.png from the blob URL', async () => {
    mount()
    await within(aside()).findByRole('img', { name: ALT })
    await waitFor(() => expect(saveIn(aside())).toBeEnabled())
    await userEvent.click(saveIn(aside()))
    expect(state.clicked).toEqual([{ download: 'a-venue-booking-qr.png', href: 'blob:qr-1' }])
  })

  it('draws no logo when the venue has none', async () => {
    mount()
    await within(aside()).findByRole('img', { name: ALT })
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('draws the venue logo once, from the media URL, when logo_path is set', async () => {
    h.settings = { name: 'Test Venue', logo_path: 'v/logo.png' }
    mount()
    await within(aside()).findByRole('img', { name: ALT })
    expect(ctx.drawImage).toHaveBeenCalledTimes(1)
    expect(ctx.drawImage.mock.calls[0][0]).toBeInstanceOf(FakeImage)
    expect((ctx.drawImage.mock.calls[0][0] as FakeImage).src).toBe('https://cdn.test/v/logo.png')
  })

  it('still shows the QR image when the logo fails to load', async () => {
    h.settings = { name: 'Test Venue', logo_path: 'v/logo.png' }
    state.logoFails = true
    mount()
    expect(await within(aside()).findByRole('img', { name: ALT })).toBeInTheDocument()
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })

  it('shows the booking link as text and a disabled Save when the picture cannot be drawn', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    mount()
    expect(await within(aside()).findByText(ADDRESS)).toBeInTheDocument()
    expect(within(aside()).queryByRole('img', { name: ALT })).not.toBeInTheDocument()
    expect(saveIn(aside())).toBeDisabled()
  })

  it('draws once for the same slug and logo across a re-render, and revokes the object URL on unmount', async () => {
    const { rerender, unmount } = mount()
    await within(aside()).findByRole('img', { name: ALT })
    rerender(tree())
    await within(aside()).findByRole('img', { name: ALT })
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(1)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:qr-1')
  })

  it('redraws and revokes the previous object URL when the logo changes', async () => {
    const { rerender } = mount()
    await within(aside()).findByRole('img', { name: ALT })
    h.settings = { name: 'Test Venue', logo_path: 'v/new.png' }
    rerender(tree())
    await waitFor(() => expect(within(aside()).getByRole('img', { name: ALT })).toHaveAttribute('src', 'blob:qr-2'))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:qr-1')
  })
})

describe('T34.1 collapsed sidebar', () => {
  async function collapse() {
    mount()
    await within(aside()).findByRole('img', { name: ALT })
    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
  }

  it('replaces the card with a "Share your booking site" icon button', async () => {
    await collapse()
    expect(screen.queryByRole('img', { name: ALT })).not.toBeInTheDocument()
    expect(screen.queryByText(ADDRESS)).not.toBeInTheDocument()
    expect(within(aside()).getByRole('button', { name: 'Share your booking site' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('opens a modal dialog with a larger QR image, the note, Save and Close', async () => {
    await collapse()
    await userEvent.click(screen.getByRole('button', { name: 'Share your booking site' }))
    const dialog = screen.getByRole('dialog', { name: 'Share your booking site' })
    expect(dialog.tagName).toBe('DIALOG')
    expect(await within(dialog).findByRole('img', { name: ALT })).toHaveAttribute('src', expect.stringMatching(/^blob:qr-/))
    expect(within(dialog).getByText(/booking/i)).toBeInTheDocument()
    await waitFor(() => expect(saveIn(dialog)).toBeEnabled())
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    await userEvent.click(saveIn(dialog))
    expect(state.clicked.map((c) => c.download)).toEqual(['a-venue-booking-qr.png'])
  })

  it('Close closes it and returns focus to the icon button', async () => {
    await collapse()
    await userEvent.click(screen.getByRole('button', { name: 'Share your booking site' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Share your booking site' })).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share your booking site' })).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('Escape (the dialog close event) closes it and returns focus to the icon button', async () => {
    await collapse()
    await userEvent.click(screen.getByRole('button', { name: 'Share your booking site' }))
    const dialog = screen.getByRole('dialog', { name: 'Share your booking site' })
    dialog.removeAttribute('open')
    fireEvent(dialog, new Event('close'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share your booking site' })).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })

  it('a click on the backdrop (the dialog itself) closes it, a click inside does not', async () => {
    await collapse()
    await userEvent.click(screen.getByRole('button', { name: 'Share your booking site' }))
    const dialog = screen.getByRole('dialog', { name: 'Share your booking site' })
    await userEvent.click(await within(dialog).findByRole('img', { name: ALT }))
    expect(screen.getByRole('dialog', { name: 'Share your booking site' })).toBeInTheDocument()
    await userEvent.click(dialog)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share your booking site' })).toHaveFocus())
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
  })
})

describe('T34.1 mobile drawer', () => {
  const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
  async function openDrawer() {
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('dialog')
    expect(drawer).toHaveClass('admin-drawer')
    await within(drawer).findByRole('img', { name: ALT })
    await waitFor(() => expect(saveIn(drawer)).toBeEnabled())
    return drawer
  }

  it('contains the same card (image, note, Save) below the links', async () => {
    const drawer = await openDrawer()
    expect(within(drawer).getByText('Share your booking site')).toBeInTheDocument()
    const nav = within(drawer).getByRole('navigation', { name: 'Admin' })
    expect(nav.compareDocumentPosition(saveIn(drawer)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(nav.compareDocumentPosition(within(drawer).getByRole('img', { name: ALT })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('Save is the last focusable item, so Tab from Save wraps to the first and Shift+Tab from the first lands on Save', async () => {
    const drawer = await openDrawer()
    const items = [...drawer.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const save = saveIn(drawer)
    expect(items.at(-1)).toBe(save)
    save.focus()
    await userEvent.tab()
    expect(items[0]).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(save).toHaveFocus()
  })
})
