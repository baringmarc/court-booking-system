// T26.6: Send invoice in the console. The invoice document's action bar gets Preview PDF, Send invoice (draft),
// Resend invoice (sent), a confirmation naming the venue's owners, the emails the function returned, the header's
// "Emailed to owners" line and each refusal. Mocks ./api, never the network.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authState } from '../../test/authState'
import { ApiError } from '../../lib/queryClient'
import { AuthContext } from '../auth/AuthContext'
import type { InvoiceDetailPageData, InvoiceLine, InvoiceOverview } from './api'

type SendResult = { recipients: string[]; kind: 'send' | 'resend'; status: 'draft' | 'sent' }
const mocks = vi.hoisted(() => ({
  admin: vi.fn<() => Promise<boolean>>(),
  invoices: vi.fn<(input: unknown) => Promise<unknown>>(),
  detail: vi.fn<(input: { invoiceId: string; page: number }) => Promise<unknown>>(),
  send: vi.fn<(id: string) => Promise<SendResult>>(),
  pdf: vi.fn<(id: string) => Promise<Blob>>(),
}))
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  fetchIsPlatformAdmin: mocks.admin, fetchInvoicesPage: mocks.invoices, fetchInvoiceDetailPage: mocks.detail,
  sendInvoice: mocks.send, fetchInvoicePdf: mocks.pdf,
}))

const { ConsoleApp } = await import('./ConsoleApp')

// last_emailed_at / email_count are optional on InvoiceOverview (T26.6); the cast keeps this file compiling while red.
type Emailed = { last_emailed_at?: string | null; email_count?: number }
function invoice(over: Partial<InvoiceOverview> & Emailed = {}): InvoiceOverview {
  return {
    invoice_id: 'i1', venue_id: 'v1', slug: 'e2e-alpha', name: 'E2E Alpha Courts', billing_month: '2026-03-01', status: 'draft',
    sent_at: null, paid_at: null, paid_method: null, paid_reference: null,
    fee_count: 2, fee_total: 25.5, adjustment_total: -5, total: 20.5, due_at: null, overdue: false, ...over,
  } as InvoiceOverview
}
const LINES: InvoiceLine[] = [
  { charge_id: 'c1', booking_id: 'b1', reference_code: 'CB-XXXXAB', kind: 'booking_fee', amount: 15.5, charged_at: '2026-03-05T05:00:00Z' },
]
function detail(over: Partial<InvoiceOverview> & Emailed = {}): InvoiceDetailPageData {
  return { ...invoice(over), lines: LINES, line_total: LINES.length }
}

function renderAt(path = '/invoices?open=i1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}><AuthContext.Provider value={authState('admin')}>
      <MemoryRouter initialEntries={[path]}><ConsoleApp /></MemoryRouter>
    </AuthContext.Provider></QueryClientProvider>,
  )
}
async function open(over: Partial<InvoiceOverview> & Emailed = {}) {
  mocks.invoices.mockResolvedValue({ rows: [invoice(over)], total: 1 })
  mocks.detail.mockResolvedValue(detail(over))
  renderAt()
  const re = /E2E-ALPHA-202603/i
  const panel = await waitFor(() => {
    const el = screen.queryByRole('dialog', { name: re }) ?? screen.queryByRole('region', { name: re })
    expect(el).not.toBeNull()
    return el as HTMLElement
  })
  await within(panel).findByText('CB-XXXXAB')
  return panel
}
async function confirmDialog(): Promise<HTMLElement> {
  const text = await screen.findByText(/Email invoice E2E-ALPHA-202603 to every owner of E2E Alpha Courts\?/)
  return text.closest('[role="dialog"]') as HTMLElement
}
function confirmButton(dialog: HTMLElement) {
  const button = within(dialog).getAllByRole('button').find((b) => b.textContent?.trim() !== 'Cancel')
  expect(button, 'a confirm button in the dialog').toBeDefined()
  return button as HTMLElement
}
/** Billing links outside the console's navigation (the nav always has one). */
const billingLinksInPage = () => screen.getAllByRole('link', { name: 'Billing' }).filter((a) => !a.closest('nav'))

beforeEach(() => {
  mocks.admin.mockReset().mockResolvedValue(true)
  mocks.invoices.mockReset()
  mocks.detail.mockReset()
  mocks.send.mockReset().mockResolvedValue({ recipients: ['a@x.com', 'b@y.com'], kind: 'send', status: 'sent' })
  mocks.pdf.mockReset().mockResolvedValue(new Blob(['%PDF-1.7'], { type: 'application/pdf' }))
})
afterEach(() => { vi.restoreAllMocks() })

describe('which send buttons each status shows', () => {
  it('a draft has Send invoice, Mark as sent and Preview PDF, and no Resend', async () => {
    const panel = await open({ status: 'draft' })
    expect(within(panel).getByRole('button', { name: 'Send invoice' })).toBeEnabled()
    expect(within(panel).getByRole('button', { name: 'Mark as sent' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Preview PDF' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Resend invoice' })).not.toBeInTheDocument()
  })

  it('a sent invoice has Resend invoice and Preview PDF, and no Send invoice or Mark as sent', async () => {
    const panel = await open({ status: 'sent', sent_at: '2026-03-02T04:00:00Z' })
    expect(within(panel).getByRole('button', { name: 'Resend invoice' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Preview PDF' })).toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Send invoice' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Mark as sent' })).not.toBeInTheDocument()
  })

  it('a paid invoice has no Send or Resend, only Preview PDF', async () => {
    const panel = await open({ status: 'paid', sent_at: '2026-03-02T04:00:00Z', paid_at: '2026-03-10T04:00:00Z', paid_method: 'GCash' })
    expect(within(panel).queryByRole('button', { name: 'Send invoice' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Resend invoice' })).not.toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Preview PDF' })).toBeInTheDocument()
  })
})

describe('sending a draft', () => {
  it('asks first, naming the invoice and the venue, and calls nothing before the user confirms', async () => {
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invoice' }))
    const dialog = await confirmDialog()
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('Cancel closes the dialog without sending', async () => {
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invoice' }))
    const dialog = await confirmDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText(/to every owner of E2E Alpha Courts/)).not.toBeInTheDocument())
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('Escape cancels without sending', async () => {
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invoice' }))
    const dialog = await confirmDialog()
    dialog.focus()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText(/to every owner of E2E Alpha Courts/)).not.toBeInTheDocument())
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('confirming sends the invoice id once, lists the emails the function returned, and re-reads the invoice', async () => {
    const panel = await open()
    const detailCalls = mocks.detail.mock.calls.length
    const listCalls = mocks.invoices.mock.calls.length
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invoice' }))
    const dialog = await confirmDialog()
    mocks.detail.mockResolvedValue(detail({ status: 'sent', sent_at: '2026-11-13T04:00:00Z', last_emailed_at: '2026-11-13T04:00:00Z', email_count: 1 }))
    await userEvent.click(confirmButton(dialog))
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith('i1')
    const message = await screen.findByText('Sent to a@x.com, b@y.com')
    expect(message.closest('[role="status"]')).not.toBeNull()
    await waitFor(() => expect(mocks.detail.mock.calls.length).toBeGreaterThan(detailCalls))
    await waitFor(() => expect(mocks.invoices.mock.calls.length).toBeGreaterThan(listCalls))
    // The draft became sent: the document now offers Resend.
    expect(await screen.findByRole('button', { name: 'Resend invoice' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send invoice' })).not.toBeInTheDocument()
    expect(screen.queryByText(/to every owner of E2E Alpha Courts/)).not.toBeInTheDocument()
  })

  it('disables the actions and shows a Sending label while the send is in flight', async () => {
    mocks.send.mockReturnValue(new Promise(() => {}))
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invoice' }))
    await userEvent.click(confirmButton(await confirmDialog()))
    const pending = await screen.findByRole('button', { name: /sending/i })
    expect(pending).toBeDisabled()
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
})

describe('resending a sent invoice', () => {
  it('uses the same confirmation, sends once, and lists the emails', async () => {
    mocks.send.mockResolvedValue({ recipients: ['owner@x.com'], kind: 'resend', status: 'sent' })
    const panel = await open({ status: 'sent', sent_at: '2026-03-02T04:00:00Z' })
    await userEvent.click(within(panel).getByRole('button', { name: 'Resend invoice' }))
    const dialog = await confirmDialog()
    expect(mocks.send).not.toHaveBeenCalled()
    await userEvent.click(confirmButton(dialog))
    expect(mocks.send).toHaveBeenCalledWith('i1')
    expect(await screen.findByText('Sent to owner@x.com')).toBeInTheDocument()
  })
})

describe('refusals', () => {
  async function sendRefused(error: Error) {
    mocks.send.mockRejectedValue(error)
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: 'Send invoice' }))
    await userEvent.click(confirmButton(await confirmDialog()))
  }
  const alertWith = async (text: string) => (await screen.findAllByRole('alert')).find((a) => a.textContent?.includes(text))

  it('billing_details_missing shows the message and a link to the Billing page', async () => {
    await sendRefused(new ApiError('Add a Plotline payment account before sending invoices.', '409', 'billing_details_missing'))
    expect(await alertWith('Add a Plotline payment account before sending invoices.')).toBeDefined()
    const links = billingLinksInPage()
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', '/billing')
    expect(screen.queryByText(/^Sent to /)).not.toBeInTheDocument()
  })

  it.each([
    ['no_recipients', '409', 'This venue has no owner to send the invoice to.'],
    ['send_failed', '502', "We couldn't send the email. Nothing was changed."],
    ['invalid_status', '409', 'A paid invoice is not sent.'],
  ])('%s shows the function message and no Billing link', async (hint, status, message) => {
    await sendRefused(new ApiError(message, status, hint))
    expect(await alertWith(message)).toBeDefined()
    expect(screen.queryAllByRole('link', { name: 'Billing' }).filter((a) => !a.closest('nav'))).toHaveLength(0)
  })

  it('a plain error shows its message', async () => {
    await sendRefused(new Error('boom'))
    expect(await alertWith('boom')).toBeDefined()
  })
})

describe('Preview PDF', () => {
  it('fetches the PDF for this invoice and opens its blob URL', async () => {
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' })
    mocks.pdf.mockResolvedValue(blob)
    const create = vi.fn(() => 'blob:preview-1')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: create })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
    const hrefSet = vi.fn()
    const opened = { closed: false, close: vi.fn(), focus: vi.fn(), document: { write: vi.fn(), close: vi.fn() }, location: { set href(v: string) { hrefSet(v) } } }
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window)
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: 'Preview PDF' }))
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledWith('i1'))
    await waitFor(() => expect(create).toHaveBeenCalledWith(blob))
    // Either window.open(url) directly, or a pre-opened window sent to the url.
    await waitFor(() => {
      const viaOpen = openSpy.mock.calls.some((c) => c[0] === 'blob:preview-1')
      expect(viaOpen || hrefSet.mock.calls.some((c) => c[0] === 'blob:preview-1')).toBe(true)
    })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('disables the button while the PDF is being fetched', async () => {
    mocks.pdf.mockReturnValue(new Promise(() => {}))
    vi.spyOn(window, 'open').mockReturnValue(null)
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: 'Preview PDF' }))
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledTimes(1))
    expect(within(panel).queryByRole('button', { name: 'Preview PDF' })).toBeNull()
    expect(await within(panel).findByRole('button', { name: /^(Preparing|Opening|Loading)/i })).toBeDisabled()
  })

  it('shows the error when the PDF cannot be fetched', async () => {
    mocks.pdf.mockRejectedValue(new ApiError("You can't open this invoice.", '403', 'forbidden'))
    vi.spyOn(window, 'open').mockReturnValue(null)
    const panel = await open()
    await userEvent.click(within(panel).getByRole('button', { name: 'Preview PDF' }))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((a) => a.textContent?.includes("You can't open this invoice."))).toBe(true)
  })
})

describe('the Emailed to owners line', () => {
  it('shows the date once when the invoice was emailed once', async () => {
    const panel = await open({ status: 'sent', sent_at: '2026-11-13T04:00:00Z', last_emailed_at: '2026-11-13T04:00:00Z', email_count: 1 })
    expect(within(panel).getByText(/Emailed to owners on Nov 13, 2026/)).toBeInTheDocument()
    expect(within(panel).queryByText(/\d+ times/)).not.toBeInTheDocument()
  })

  it('adds the count when it was emailed more than once', async () => {
    const panel = await open({ status: 'sent', sent_at: '2026-11-10T04:00:00Z', last_emailed_at: '2026-11-13T04:00:00Z', email_count: 3 })
    expect(within(panel).getByText(/Emailed to owners on Nov 13, 2026 \(3 times\)/)).toBeInTheDocument()
  })

  it.each([
    ['null and 0', { last_emailed_at: null, email_count: 0 }],
    ['absent', {}],
  ])('shows nothing when never emailed (%s)', async (_name, extra) => {
    const panel = await open(extra)
    expect(within(panel).queryByText(/Emailed to owners/)).not.toBeInTheDocument()
  })
})
