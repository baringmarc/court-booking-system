import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setCurrentVenue } from '../../lib/currentVenue'
import { updateVenueSettings, type VenueSettings } from '../catalog/api'
import { type PaymentAccount } from '../venue/api'
import { deletePaymentAccount, fetchSetupStatus, reorderPaymentAccounts, savePaymentAccount, type SetupStatus } from './api'
import { PaymentInstructionsForm } from './SettingsPage'
import { adminKeys } from './api'
import { useDeletePaymentAccount, useReorderPaymentAccounts, useSavePaymentAccount } from './hooks'
import { useUpdateVenueSettings } from '../catalog/hooks'

vi.mock('../catalog/api', async (original) => ({ ...(await original<typeof import('../catalog/api')>()), updateVenueSettings: vi.fn() }))
vi.mock('./api', async (original) => ({ ...(await original<typeof import('./api')>()), fetchSetupStatus: vi.fn(), savePaymentAccount: vi.fn(), deletePaymentAccount: vi.fn(), reorderPaymentAccounts: vi.fn() }))

const INITIAL: VenueSettings = {
  venue_id: '00000000-0000-4000-8000-0000000000a1', name: 'Setup Venue', address: '', banner_alt: null, banner_path: null,
  booking_window_days: 30, cancel_cutoff_hours: 1, city: '', currency: 'PHP', maps_url: '', max_rejections: 2,
  online_payments_enabled: false, payment_hold_minutes: 60, payment_instructions: '', showcase_opt_in: false,
  slot_minutes: 60, sport_order: ['badminton', 'pickleball', 'tennis'], theme: 'plotline', timezone: 'Asia/Manila',
  updated_at: '2026-11-04T00:00:00Z', waiver_text: '',
}
const STATUS: SetupStatus = { items: [{ key: 'payment', label: 'Add a payment account with an account number', required: true, done: true }], ready: false }

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(adminKeys.setup(), STATUS)
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('T17.6 payment setup clarity', () => {
  beforeEach(() => {
    setCurrentVenue({ id: INITIAL.venue_id, slug: 'setup-venue', status: 'draft' })
    vi.mocked(updateVenueSettings).mockReset().mockResolvedValue(INITIAL)
    vi.mocked(fetchSetupStatus).mockReset().mockResolvedValue(STATUS)
    vi.mocked(savePaymentAccount).mockReset().mockResolvedValue({ id: 'account-a' })
    vi.mocked(deletePaymentAccount).mockReset().mockResolvedValue(undefined)
    vi.mocked(reorderPaymentAccounts).mockReset().mockResolvedValue(undefined)
  })

  it('lets an admin edit example instructions without saving until Save instructions is pressed', async () => {
    const { client } = setup()
    render(<QueryClientProvider client={client}><PaymentInstructionsForm initial={INITIAL} /></QueryClientProvider>)
    const textbox = screen.getByRole('textbox')
    expect(textbox).toHaveValue('')
    await userEvent.click(screen.getByRole('button', { name: 'Use example' }))
    expect(textbox).not.toHaveValue('')
    expect(updateVenueSettings).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Save instructions' }))
    await waitFor(() => expect(updateVenueSettings).toHaveBeenCalledWith({ payment_instructions: expect.any(String) }))
    expect(updateVenueSettings).toHaveBeenCalledTimes(1)
  })

  it('invalidates setup status after payment instructions are saved', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => useUpdateVenueSettings(), { wrapper })
    await act(async () => { await result.current.mutateAsync({ payment_instructions: 'Pay to GCash 09170000000' }) })
    expect(client.getQueryState(adminKeys.setup())?.isInvalidated).toBe(true)
  })

  it.each(['save', 'delete', 'reorder'] as const)('invalidates setup status after payment account %s', async (action) => {
    const { client, wrapper } = setup()
    if (action === 'save') {
      const { result } = renderHook(() => useSavePaymentAccount(), { wrapper })
      await act(async () => { await result.current.mutateAsync({ existing: null, input: { label: 'GCash', account_name: 'Ana', account_number: '09170000000' }, qr: { kind: 'keep' } }) })
    } else if (action === 'delete') {
      const { result } = renderHook(() => useDeletePaymentAccount(), { wrapper })
      const account: PaymentAccount = { id: '00000000-0000-4000-8000-0000000000b1', label: 'GCash', account_name: 'Ana', account_number: '09170000000', qr_path: null, position: 0 }
      await act(async () => { await result.current.mutateAsync(account) })
    } else {
      const { result } = renderHook(() => useReorderPaymentAccounts(), { wrapper })
      await act(async () => { await result.current.mutateAsync(['account-a']) })
    }
    expect(client.getQueryState(adminKeys.setup())?.isInvalidated).toBe(true)
  })
})
