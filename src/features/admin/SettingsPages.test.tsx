import type { ComponentType } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../lib/queryClient'
import { catalogKeys, fetchVenueSettings, updateVenueSettings, type VenueSettings } from '../catalog/api'
import { fetchAmenities, fetchInfoSections, fetchPaymentAccounts, fetchSocialLinks, type PaymentAccount, type InfoSection } from '../venue/api'
import { saveInfoSection, savePaymentAccount } from './api'
import { SettingsPage } from './SettingsPage'

vi.mock('../catalog/api', async (original) => ({ ...(await original<typeof import('../catalog/api')>()), fetchVenueSettings: vi.fn(), updateVenueSettings: vi.fn() }))
vi.mock('../venue/api', async (original) => ({ ...(await original<typeof import('../venue/api')>()), fetchAmenities: vi.fn(), fetchInfoSections: vi.fn(), fetchPaymentAccounts: vi.fn(), fetchSocialLinks: vi.fn() }))
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), saveInfoSection: vi.fn(), savePaymentAccount: vi.fn() }))

const INITIAL: VenueSettings = {
  venue_id: '00000000-0000-4000-8000-0000000000a1', name: 'E2E Settings Venue', address: '123 Court Street',
  banner_alt: null, banner_path: null, booking_window_days: 30, cancel_cutoff_hours: 1, city: 'Makati', currency: 'PHP',
  maps_url: '', max_rejections: 2, online_payments_enabled: false, payment_hold_minutes: 60,
  payment_instructions: 'Pay to the account above.', showcase_opt_in: false, slot_minutes: 60,
  sport_order: ['badminton', 'pickleball', 'tennis'], theme: 'plotline', timezone: 'Asia/Manila',
  updated_at: '2026-11-04T00:00:00Z', waiver_text: 'Respect venue rules.', walk_ins_enabled: false,
}
let stored: VenueSettings
const categories = [
  ['venue', 'Venue Profile', 'VenueProfileSettingsPage'],
  ['payments', 'Payment Setup', 'PaymentSettingsPage'],
  ['booking', 'Booking Rules', 'BookingRulesSettingsPage'],
  ['appearance', 'Website Appearance', 'AppearanceSettingsPage'],
  ['policies', 'Policies & Waivers', 'PoliciesSettingsPage'],
] as const

beforeEach(() => {
  stored = { ...INITIAL }
  vi.mocked(fetchVenueSettings).mockReset().mockImplementation(async () => stored)
  vi.mocked(updateVenueSettings).mockReset().mockImplementation(async (values) => {
    stored = { ...stored, ...values, updated_at: new Date().toISOString() }
    return stored
  })
  vi.mocked(fetchAmenities).mockResolvedValue([])
  vi.mocked(fetchInfoSections).mockResolvedValue([])
  vi.mocked(fetchPaymentAccounts).mockResolvedValue([])
  vi.mocked(fetchSocialLinks).mockResolvedValue([])
  vi.mocked(savePaymentAccount).mockReset().mockResolvedValue({ id: 'account-a' })
  vi.mocked(saveInfoSection).mockReset().mockResolvedValue({ id: 'section-a' })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
})
afterEach(() => { vi.unstubAllGlobals() })

function mount(path = '/admin/settings') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter([
    { path: '/admin/settings', Component: SettingsPage },
    ...categories.map(([slug, , name]) => ({
      path: `/admin/settings/${slug}`,
      lazy: async () => {
        const modulePath = `./${name}.tsx`
        const module = await import(/* @vite-ignore */ modulePath) as Record<string, ComponentType>
        return { Component: module[name] }
      },
    })),
  ], { initialEntries: [path] })
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
  return { client, router }
}

async function saveButton(label?: RegExp) {
  const buttons = screen.getAllByRole('button', { name: label ?? /^Save /i })
  await userEvent.click(buttons[0])
}

describe('T17.4 settings category pages', () => {
  it('keeps /admin/settings as a five-card landing with dedicated routes', async () => {
    mount()
    for (const [slug, label] of categories) {
      expect(await screen.findByRole('link', { name: new RegExp(label) })).toHaveAttribute('href', `/admin/settings/${slug}`)
    }
    expect(screen.queryByLabelText('Venue name')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /settings/i })).not.toBeInTheDocument()
  })

  it.each(categories)('%s loads directly and offers Back to Settings', async (slug, label) => {
    mount(`/admin/settings/${slug}`)
    expect(await screen.findByRole('heading', { name: label })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: /Back to Settings/ }))
    expect(await screen.findByRole('link', { name: /Venue Profile/ })).toBeInTheDocument()
  })

  it('preserves venue, location, city and social fields while removing venue showcase controls', async () => {
    mount('/admin/settings/venue')
    expect(await screen.findByLabelText('Venue name')).toHaveValue(INITIAL.name)
    expect(screen.getByLabelText('City')).toHaveValue(INITIAL.city)
    expect(screen.getByLabelText('Address')).toHaveValue(INITIAL.address)
    expect(screen.getByLabelText(/Google Maps link/)).toHaveValue('')
    expect(screen.queryByLabelText('List this venue on the Plotline website')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save city' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Social links' })).toBeInTheDocument()
    for (const text of ['Asia/Manila', 'PHP', '60 min']) expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('preserves payment accounts, QR, instructions and read-only online status on Payment Setup', async () => {
    mount('/admin/settings/payments')
    expect(await screen.findByRole('heading', { name: 'Payment accounts' })).toBeInTheDocument()
    expect(await screen.findByRole('form', { name: 'New payment account' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Account name/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Account or mobile number/)).toBeInTheDocument()
    expect(screen.getByLabelText(/QR/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /instructions|Shown to players/i })).toHaveValue(INITIAL.payment_instructions)
    expect(screen.getByText(/Online payments \(PayMongo\): Off/)).toBeInTheDocument()
  })

  it('saves only booking rules, shows pending/success and preserves saved values across category navigation', async () => {
    mount('/admin/settings/booking')
    const window = await screen.findByLabelText('Booking window', { exact: true })
    expect(window).toHaveValue(30)
    expect(screen.getByLabelText('Payment hold', { exact: true })).toHaveValue(60)
    expect(screen.getByLabelText('Cancellation cutoff', { exact: true })).toHaveValue(1)
    expect(screen.getByLabelText('Proof rejections allowed', { exact: true })).toHaveValue(2)
    await userEvent.clear(window)
    await userEvent.type(window, '45')
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument()
    let resolve: (value: VenueSettings) => void = () => {}
    vi.mocked(updateVenueSettings).mockImplementationOnce((values) => new Promise((done) => {
      resolve = (value) => { stored = { ...value, ...values }; done(stored) }
    }))
    await saveButton()
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled()
    await act(async () => { resolve(stored) })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(updateVenueSettings).toHaveBeenCalledWith({ booking_window_days: 45, payment_hold_minutes: 60, cancel_cutoff_hours: 1, max_rejections: 2 })
    await userEvent.click(screen.getByRole('link', { name: /Back to Settings/ }))
    await userEvent.click(await screen.findByRole('link', { name: /Booking Rules/ }))
    expect(await screen.findByLabelText('Booking window', { exact: true })).toHaveValue(45)
  })

  const RULES = [
    ['Booking window', 'booking_window_days', '1', '365', 'days ahead', "Players can book from today up to this many days ahead. For example, 30 means today plus the next 30 days. Walk-ins you add yourself aren't limited."],
    ['Payment hold', 'payment_hold_minutes', '5', '1440', 'minutes', "How long an online booking keeps its slot while the player pays. If they don't upload proof of payment in time, the booking expires and the slot opens up again."],
    ['Cancellation cutoff', 'cancel_cutoff_hours', '0', '168', 'hours before start', 'Players can cancel online until this many hours before their start time; after that they have to contact you. 0 lets them cancel right up to the start. You can still cancel any booking yourself.'],
    ['Proof rejections allowed', 'max_rejections', '1', '10', 'rejections', "How many times you can reject a player's proof of payment before the booking is rejected and its slot opens up. Until then, each rejection gives the player a new payment hold to send a better proof. With 1, the first rejection rejects the booking."],
  ] as const

  it.each(RULES)('booking rules: %s is a required whole number with min/max and a visible unit-then-hint description', async (label, _key, min, max, unit, hint) => {
    mount('/admin/settings/booking')
    const input = await screen.findByLabelText(label, { exact: true })
    expect(input).toHaveAttribute('type', 'number')
    expect(input).toBeRequired()
    expect(input).toHaveAttribute('step', '1')
    expect(input).toHaveAttribute('min', min)
    expect(input).toHaveAttribute('max', max)
    expect(input).toHaveAccessibleDescription(`${unit} ${hint}`)
    expect(screen.getByText(hint)).toBeVisible()
    expect(screen.getByText(hint).tagName).toBe('P')
    expect(screen.getByText(unit, { exact: true })).toBeVisible()
  })

  it('booking rules: fields appear in order and old parenthesised labels are gone', async () => {
    mount('/admin/settings/booking')
    await screen.findByLabelText('Booking window', { exact: true })
    const inputs = within(screen.getByRole('form', { name: 'Booking rules' })).getAllByRole('spinbutton')
    expect(inputs.map((i) => i.getAttribute('max'))).toEqual(['365', '1440', '168', '10'])
    expect(screen.queryByLabelText('Payment hold (minutes)')).not.toBeInTheDocument()
  })

  it('retains dirty name after another group saves and settings refetches', async () => {
    const { client } = mount('/admin/settings/venue')
    const name = await screen.findByLabelText('Venue name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Unsaved venue name')
    await userEvent.clear(screen.getByLabelText('Address'))
    await userEvent.type(screen.getByLabelText('Address'), '456 New Street')
    await saveButton(/Save location/)
    await waitFor(() => expect(updateVenueSettings).toHaveBeenCalledWith({ address: '456 New Street', maps_url: '' }))
    await act(async () => { await client.invalidateQueries({ queryKey: catalogKeys.settings() }) })
    expect(screen.getByLabelText('Venue name')).toHaveValue('Unsaved venue name')
    expect(screen.getByLabelText('Address')).toHaveValue('456 New Street')
  })

  it('blocks dirty internal navigation, Stay keeps values, Leave permits navigation', async () => {
    mount('/admin/settings/booking')
    const input = await screen.findByLabelText('Payment hold', { exact: true })
    await userEvent.clear(input)
    await userEvent.type(input, '90')
    await userEvent.click(screen.getByRole('link', { name: /Back to Settings/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Unsaved changes' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stay' }))
    expect(screen.getByLabelText('Payment hold', { exact: true })).toHaveValue(90)
    await userEvent.click(screen.getByRole('link', { name: /Back to Settings/ }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Unsaved changes' })).getByRole('button', { name: 'Leave' }))
    expect(await screen.findByRole('link', { name: /Booking Rules/ })).toBeInTheDocument()
    expect(updateVenueSettings).not.toHaveBeenCalled()
  })

  it('keeps failed drafts, reports save errors, and permits retry', async () => {
    mount('/admin/settings/booking')
    const input = await screen.findByLabelText('Payment hold', { exact: true })
    await userEvent.clear(input)
    await userEvent.type(input, '90')
    vi.mocked(updateVenueSettings).mockRejectedValueOnce(new ApiError('permission denied for table venue_settings', '42501'))
    await saveButton()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(input).toHaveValue(90)
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument()
    await saveButton()
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(stored.payment_hold_minutes).toBe(90)
  })

  it('retains appearance sections and immediate-save theme semantics', async () => {
    mount('/admin/settings/appearance')
    for (const name of ['Website colors', 'Home page banner', 'Amenities', 'Info sections', 'Sport order']) {
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('button', { name: 'Plum' }))
    await waitFor(() => expect(updateVenueSettings).toHaveBeenCalledWith({ theme: 'plum' }))
    expect(screen.getByRole('button', { name: 'Plum' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('retains waiver content and saves only policies', async () => {
    mount('/admin/settings/policies')
    const input = await screen.findByRole('textbox', { name: 'Waiver' })
    expect(input).toHaveValue(INITIAL.waiver_text)
    await userEvent.clear(input)
    await userEvent.type(input, 'Updated policy')
    await saveButton(/Save waiver/)
    await waitFor(() => expect(updateVenueSettings).toHaveBeenCalledWith({ waiver_text: 'Updated policy' }))
  })

  it('keeps a dirty Add payment account draft protected after saving a simultaneous Edit form', async () => {
    const account: PaymentAccount = { id: 'account-a', label: 'GCash', account_name: 'Ada', account_number: '09170000000', qr_path: null, position: 0 }
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([account])
    mount('/admin/settings/payments')
    const add = await screen.findByRole('form', { name: 'New payment account' })
    await userEvent.type(within(add).getByLabelText(/Label/), 'Unsaved Maya account')
    await userEvent.click(screen.getByRole('button', { name: 'Edit GCash' }))
    const edit = screen.getByRole('form', { name: 'Edit GCash' })
    await userEvent.clear(within(edit).getByLabelText('Account name'))
    await userEvent.type(within(edit).getByLabelText('Account name'), 'Updated Ada')
    await userEvent.click(within(edit).getByRole('button', { name: 'Save account' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit GCash' })).not.toBeInTheDocument())
    expect(savePaymentAccount).toHaveBeenCalledWith(account, { label: 'GCash', account_name: 'Updated Ada', account_number: '09170000000' }, { kind: 'keep' })
    expect(within(screen.getByRole('form', { name: 'New payment account' })).getByLabelText(/Label/)).toHaveValue('Unsaved Maya account')
    await userEvent.click(screen.getByRole('link', { name: /Back to Settings/ }))
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument()
  })

  it('keeps a dirty New info section draft protected after saving a simultaneous Edit form', async () => {
    const section: InfoSection = { id: 'section-a', title: 'House rules', body: 'Original rules', sort_order: 0 }
    vi.mocked(fetchInfoSections).mockResolvedValue([section])
    mount('/admin/settings/appearance')
    const add = await screen.findByRole('form', { name: 'New info section' })
    await userEvent.type(within(add).getByLabelText('Title'), 'Unsaved new section')
    await userEvent.click(screen.getByRole('button', { name: 'Edit House rules' }))
    const edit = screen.getByRole('form', { name: 'Edit House rules' })
    await userEvent.clear(within(edit).getByLabelText('Text'))
    await userEvent.type(within(edit).getByLabelText('Text'), 'Updated rules')
    await userEvent.click(within(edit).getByRole('button', { name: 'Save section' }))
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit House rules' })).not.toBeInTheDocument())
    expect(saveInfoSection).toHaveBeenCalledWith('section-a', { title: 'House rules', body: 'Updated rules' })
    expect(within(screen.getByRole('form', { name: 'New info section' })).getByLabelText('Title')).toHaveValue('Unsaved new section')
    await userEvent.click(screen.getByRole('link', { name: /Back to Settings/ }))
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument()
  })

  it('marks removal of an existing payment QR code dirty and warns before navigation', async () => {
    const account: PaymentAccount = { id: 'account-a', label: 'GCash', account_name: 'Ada', account_number: '09170000000', qr_path: `${INITIAL.venue_id}/qr.png`, position: 0 }
    vi.mocked(fetchPaymentAccounts).mockResolvedValue([account])
    mount('/admin/settings/payments')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit GCash' }))
    const edit = screen.getByRole('form', { name: 'Edit GCash' })
    expect(within(edit).getByRole('img', { name: 'QR code for GCash' })).toBeInTheDocument()
    await userEvent.click(within(edit).getByRole('button', { name: 'Remove QR code' }))
    expect(within(edit).queryByRole('img', { name: 'QR code for GCash' })).not.toBeInTheDocument()
    expect(within(edit).getByText('The QR code will be removed when you save.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: /Back to Settings/ }))
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeInTheDocument()
    expect(savePaymentAccount).not.toHaveBeenCalled()
  })

  it('prevents switching payment-account Edit forms from discarding the active draft', async () => {
    const accounts: PaymentAccount[] = [
      { id: 'account-a', label: 'GCash', account_name: 'Ada', account_number: '09170000000', qr_path: null, position: 0 },
      { id: 'account-b', label: 'Maya', account_name: 'Pat', account_number: '09170000001', qr_path: null, position: 1 },
    ]
    vi.mocked(fetchPaymentAccounts).mockResolvedValue(accounts)
    mount('/admin/settings/payments')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit GCash' }, { timeout: 10_000 }))
    const edit = screen.getByRole('form', { name: 'Edit GCash' })
    await userEvent.clear(within(edit).getByLabelText('Account name'))
    await userEvent.type(within(edit).getByLabelText('Account name'), 'Unsaved account owner')
    const other = screen.getByRole('button', { name: 'Edit Maya' })
    expect(other).toBeDisabled()
    await userEvent.click(other)
    expect(screen.getByRole('form', { name: 'Edit GCash' })).toBeInTheDocument()
    expect(within(edit).getByLabelText('Account name')).toHaveValue('Unsaved account owner')
    expect(screen.queryByRole('form', { name: 'Edit Maya' })).not.toBeInTheDocument()
    expect(savePaymentAccount).not.toHaveBeenCalled()
  })

  it('prevents switching info-section Edit forms from discarding the active draft', async () => {
    const sections: InfoSection[] = [
      { id: 'section-a', title: 'House rules', body: 'Original rules', sort_order: 0 },
      { id: 'section-b', title: 'Cancellation policy', body: 'Original policy', sort_order: 1 },
    ]
    vi.mocked(fetchInfoSections).mockResolvedValue(sections)
    mount('/admin/settings/appearance')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit House rules' }, { timeout: 10_000 }))
    const edit = screen.getByRole('form', { name: 'Edit House rules' })
    await userEvent.clear(within(edit).getByLabelText('Text'))
    await userEvent.type(within(edit).getByLabelText('Text'), 'Unsaved house rules')
    const other = screen.getByRole('button', { name: 'Edit Cancellation policy' })
    expect(other).toBeDisabled()
    await userEvent.click(other)
    expect(screen.getByRole('form', { name: 'Edit House rules' })).toBeInTheDocument()
    expect(within(edit).getByLabelText('Text')).toHaveValue('Unsaved house rules')
    expect(screen.queryByRole('form', { name: 'Edit Cancellation policy' })).not.toBeInTheDocument()
    expect(saveInfoSection).not.toHaveBeenCalled()
  })
})
